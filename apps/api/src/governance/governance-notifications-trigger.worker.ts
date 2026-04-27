import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GracePeriodEntity } from './entities/grace-period.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// Time-driven governance notification triggers (Domain 11 — F11.21).
//
// Same pattern as AccessNotificationsTriggerWorker: scan rows that meet the
// firing condition AND have not been notified yet, fire the notification,
// stamp the per-row idempotency marker. The dedup window in
// NotificationsService is only 15 minutes and would not survive across cron
// passes that span days, so per-row tracking is required.
//
// PRD F11.21: "Triggered when a compliance grace period is approaching
// expiration (configurable threshold, default 7 days before expiry)."

const GRACE_PERIOD_WARNING_DAYS = 7;

@Injectable()
export class GovernanceNotificationsTriggerWorker {
  private readonly logger = new Logger(GovernanceNotificationsTriggerWorker.name);

  constructor(
    @InjectRepository(GracePeriodEntity)
    private readonly gracePeriodRepo: Repository<GracePeriodEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAll(): Promise<void> {
    try {
      await this.runGracePeriodExpiring();
    } catch (err) {
      this.logger.error(
        `GovernanceNotificationsTriggerWorker tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runGracePeriodExpiring(): Promise<number> {
    const warningCutoff = new Date(
      Date.now() + GRACE_PERIOD_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );

    const eligible = await this.gracePeriodRepo
      .createQueryBuilder('g')
      .where('g.outcome = :outcome', { outcome: 'pending' })
      .andWhere('g.expiryWarningSentAt IS NULL')
      .andWhere('g.endsAt <= :cutoff', { cutoff: warningCutoff })
      .andWhere('g.endsAt > :now', { now: new Date() })
      .getMany();

    let count = 0;
    for (const gp of eligible) {
      const product = await this.productRepo.findOne({ where: { id: gp.productId } });
      if (!product) continue;
      try {
        const daysRemaining = Math.max(
          0,
          Math.ceil((gp.endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );
        await this.notificationsService.enqueue({
          orgId: gp.orgId,
          category: 'grace_period_expiring',
          recipients: [product.ownerPrincipalId],
          payload: {
            gracePeriodId: gp.id,
            productId: product.id,
            productName: product.name,
            policyDomain: gp.policyDomain,
            policyVersionId: gp.policyVersionId,
            endsAt: gp.endsAt.toISOString(),
            daysRemaining,
          },
          deepLink: `/products/${product.id}/compliance`,
          dedupKey: `grace_period_expiring:${gp.id}`,
        });
        await this.gracePeriodRepo.update(
          { id: gp.id },
          { expiryWarningSentAt: new Date() },
        );
        count++;
      } catch (err) {
        this.logger.error(
          `Grace period expiring enqueue failed for ${gp.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return count;
  }
}
