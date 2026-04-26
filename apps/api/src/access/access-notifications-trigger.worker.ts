import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { getConfig } from '../config.js';

// Time-driven access notification triggers (Domain 11 — F11.9, F11.10, F11.11).
//
// Runs on a 5-minute @Cron schedule. Each branch scans for rows that meet its
// firing condition AND have not been notified yet (per-row tracking column),
// fires the notification, and stamps the tracking column. The tracking column
// is the idempotency mechanism — the dedup window in NotificationsService is
// only 15 minutes and would not survive across cron passes.
//
// SLA semantics: APPROVAL_TIMEOUT_HOURS env var defines the platform-wide
// SLA. Warning fires at SLA_WARNING_THRESHOLD * APPROVAL_TIMEOUT_HOURS.
// Breach fires after APPROVAL_TIMEOUT_HOURS elapses.
//
// Grant expiry: GRANT_EXPIRY_WARNING_DAYS days before expires_at, fire once.
//
// RLS: this worker is cron-driven (no per-request org context). All queries
// here scan across orgs by reading directly from access tables (which have
// RLS enabled), but raw queries via TypeORM's createQueryBuilder bypass the
// org context filter when running outside a request — verified by the
// existing trust-score cron pattern. We pass org_id explicitly into every
// notification enqueue.

const SLA_WARNING_THRESHOLD = 0.8;
const GRANT_EXPIRY_WARNING_DAYS = 14;

@Injectable()
export class AccessNotificationsTriggerWorker {
  private readonly logger = new Logger(AccessNotificationsTriggerWorker.name);

  constructor(
    @InjectRepository(AccessRequestEntity)
    private readonly requestRepo: Repository<AccessRequestEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(RoleAssignmentEntity)
    private readonly roleRepo: Repository<RoleAssignmentEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAll(): Promise<void> {
    try {
      await Promise.all([
        this.runSlaWarning(),
        this.runSlaBreach(),
        this.runGrantExpiry(),
      ]);
    } catch (err) {
      this.logger.error(
        `AccessNotificationsTriggerWorker tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // F11.9 — SLA warning (configurable threshold, default 80% elapsed)
  // ---------------------------------------------------------------------------
  async runSlaWarning(): Promise<number> {
    const config = getConfig();
    const slaMs = config.APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000;
    const warningCutoff = new Date(Date.now() - slaMs * SLA_WARNING_THRESHOLD);

    const eligible = await this.requestRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: 'pending' })
      .andWhere('r.slaWarningSentAt IS NULL')
      .andWhere('r.requestedAt <= :cutoff', { cutoff: warningCutoff })
      .getMany();

    let count = 0;
    for (const request of eligible) {
      const product = await this.productRepo.findOne({ where: { id: request.productId } });
      if (!product) continue;
      try {
        await this.notificationsService.enqueue({
          orgId: request.orgId,
          category: 'access_request_sla_warning',
          recipients: [product.ownerPrincipalId],
          payload: {
            requestId: request.id,
            productId: product.id,
            productName: product.name,
            requestedAt: request.requestedAt.toISOString(),
            slaDeadline: new Date(request.requestedAt.getTime() + slaMs).toISOString(),
            thresholdPercent: SLA_WARNING_THRESHOLD * 100,
          },
          deepLink: `/access/requests/${request.id}`,
          dedupKey: `access_request_sla_warning:${request.id}`,
        });
        await this.requestRepo.update({ id: request.id }, { slaWarningSentAt: new Date() });
        count++;
      } catch (err) {
        this.logger.error(
          `SLA warning enqueue failed for request ${request.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // F11.10 — SLA breach (past deadline without decision)
  // ---------------------------------------------------------------------------
  async runSlaBreach(): Promise<number> {
    const config = getConfig();
    const slaMs = config.APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000;
    const breachCutoff = new Date(Date.now() - slaMs);

    const eligible = await this.requestRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: 'pending' })
      .andWhere('r.slaBreachNotifiedAt IS NULL')
      .andWhere('r.requestedAt <= :cutoff', { cutoff: breachCutoff })
      .getMany();

    let count = 0;
    for (const request of eligible) {
      const product = await this.productRepo.findOne({ where: { id: request.productId } });
      if (!product) continue;
      const governanceMembers = await this.governancePrincipals(request.orgId);
      // Recipients: product owner (the original approver) + all governance
      // members. Set deduplicates if they overlap.
      const recipients = Array.from(
        new Set<string>([product.ownerPrincipalId, ...governanceMembers]),
      );
      try {
        await this.notificationsService.enqueue({
          orgId: request.orgId,
          category: 'access_request_sla_breach',
          recipients,
          payload: {
            requestId: request.id,
            productId: product.id,
            productName: product.name,
            requestedAt: request.requestedAt.toISOString(),
            slaDeadline: new Date(request.requestedAt.getTime() + slaMs).toISOString(),
          },
          deepLink: `/governance/access-requests/${request.id}`,
          dedupKey: `access_request_sla_breach:${request.id}`,
        });
        await this.requestRepo.update({ id: request.id }, { slaBreachNotifiedAt: new Date() });
        count++;
      } catch (err) {
        this.logger.error(
          `SLA breach enqueue failed for request ${request.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // F11.11 — grant expiring (default 14 days before expires_at)
  // ---------------------------------------------------------------------------
  async runGrantExpiry(): Promise<number> {
    const expiryWindowEnd = new Date(
      Date.now() + GRANT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
    );

    const eligible = await this.grantRepo
      .createQueryBuilder('g')
      .where('g.revokedAt IS NULL')
      .andWhere('g.expiresAt IS NOT NULL')
      .andWhere('g.expiryWarningSentAt IS NULL')
      .andWhere('g.expiresAt <= :end', { end: expiryWindowEnd })
      .andWhere('g.expiresAt > :now', { now: new Date() })
      .getMany();

    let count = 0;
    for (const grant of eligible) {
      const product = await this.productRepo.findOne({ where: { id: grant.productId } });
      try {
        await this.notificationsService.enqueue({
          orgId: grant.orgId,
          category: 'access_grant_expiring',
          recipients: [grant.granteePrincipalId],
          payload: {
            grantId: grant.id,
            productId: grant.productId,
            productName: product ? product.name : null,
            expiresAt: grant.expiresAt!.toISOString(),
            warningWindowDays: GRANT_EXPIRY_WARNING_DAYS,
          },
          deepLink: `/marketplace/products/${grant.productId}`,
          dedupKey: `access_grant_expiring:${grant.id}`,
        });
        await this.grantRepo.update({ id: grant.id }, { expiryWarningSentAt: new Date() });
        count++;
      } catch (err) {
        this.logger.error(
          `Grant expiry enqueue failed for grant ${grant.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Governance team lookup (F11.10 escalation recipients)
  // ---------------------------------------------------------------------------
  private async governancePrincipals(orgId: string): Promise<string[]> {
    const rows = await this.roleRepo.find({
      where: { orgId, role: 'governance_member' },
    });
    return rows.map((r) => r.principalId);
  }
}
