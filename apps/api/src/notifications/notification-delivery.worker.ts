import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import {
  type NotificationDeliveryChannel,
  DELIVERY_RETRY_DELAYS_SECONDS,
  MAX_DELIVERY_ATTEMPTS,
} from '@provenance/types';
import { EmailService } from '../email/email.service.js';
import { getConfig } from '../config.js';
import { NotificationDeliveryOutboxEntity } from './entities/notification-delivery-outbox.entity.js';
import { renderEmail } from './notification-renderer.js';

// NotificationDeliveryWorker — drains notifications.delivery_outbox on a
// 30-second cadence (ADR-009 §2). Email is the only channel implemented in
// PR #3; webhook lands in PR #4 reusing the same worker entry point.
//
// Concurrency: SELECT ... FOR UPDATE SKIP LOCKED inside a transaction means
// multiple API instances sharing this worker will not race for the same row.
//
// Retry: NF11.3 — 3 attempts with exponential backoff (1m / 5m / 25m), then
// the row is marked failed. Failed rows are surfaced in operational tooling
// (PR #5 preferences UI) and do not retry automatically.
//
// Self-contained: each outbox row carries the rendering inputs
// (category/payload/deep_link) plus the snapshotted target, so this worker
// does not need to join notifications.notifications and therefore does not
// need to set an RLS org context per-row.

const CLAIM_BATCH_SIZE = 50;

@Injectable()
export class NotificationDeliveryWorker {
  private readonly logger = new Logger(NotificationDeliveryWorker.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain(): Promise<void> {
    try {
      await this.drainOnce();
    } catch (err) {
      this.logger.error(
        `NotificationDeliveryWorker drain failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Single drain pass. Public for test injection — production callers should
  // rely on the @Cron schedule.
  async drainOnce(): Promise<{ delivered: number; retried: number; failed: number }> {
    const result = { delivered: 0, retried: 0, failed: 0 };

    // Claim a batch under FOR UPDATE SKIP LOCKED, then release the lock by
    // ending the claim transaction immediately. Each row is processed in its
    // own transaction so a long send doesn't hold the lock on its peers.
    const claimed = await this.dataSource.transaction(async (em) => {
      return em
        .createQueryBuilder(NotificationDeliveryOutboxEntity, 'o')
        .where('o.deliveredAt IS NULL')
        .andWhere('o.failedAt IS NULL')
        .andWhere('o.nextAttemptAt <= :now', { now: new Date() })
        .orderBy('o.nextAttemptAt', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .limit(CLAIM_BATCH_SIZE)
        .getMany();
    });

    for (const row of claimed) {
      const outcome = await this.processOne(row);
      if (outcome === 'delivered') result.delivered++;
      else if (outcome === 'retried') result.retried++;
      else if (outcome === 'failed') result.failed++;
    }

    if (claimed.length > 0) {
      this.logger.log(
        `NotificationDeliveryWorker: ${result.delivered} delivered, ${result.retried} retried, ${result.failed} failed (batch=${claimed.length})`,
      );
    }

    return result;
  }

  private async processOne(
    row: NotificationDeliveryOutboxEntity,
  ): Promise<'delivered' | 'retried' | 'failed'> {
    try {
      await this.send(row);
      await this.markDelivered(row);
      return 'delivered';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempt = row.attemptCount + 1;
      if (nextAttempt >= MAX_DELIVERY_ATTEMPTS) {
        await this.markFailed(row, message);
        return 'failed';
      }
      await this.scheduleRetry(row, message);
      return 'retried';
    }
  }

  private async send(row: NotificationDeliveryOutboxEntity): Promise<void> {
    const config = getConfig();
    if (row.channel === 'email') {
      const message = renderEmail(this.outboxToNotification(row), {
        appBaseUrl: config.APP_BASE_URL,
      });
      const receipt = await this.emailService.send({
        ...message,
        to: row.target,
      });
      if (!receipt.accepted) {
        throw new Error(
          `Email delivery rejected by transport: messageId=${receipt.messageId}`,
        );
      }
      return;
    }
    // Webhook channel lands in PR #4. Defensive guard: if a webhook row
    // somehow reaches the worker before the channel is implemented, mark it
    // as a hard failure rather than silently dropping it.
    throw new Error(
      `NotificationDeliveryWorker: channel '${row.channel as NotificationDeliveryChannel}' not yet implemented`,
    );
  }

  private async markDelivered(row: NotificationDeliveryOutboxEntity): Promise<void> {
    await this.dataSource.transaction(async (em: EntityManager) => {
      await em.update(
        NotificationDeliveryOutboxEntity,
        { id: row.id },
        {
          deliveredAt: new Date(),
          attemptCount: row.attemptCount + 1,
          lastError: null,
        },
      );
    });
  }

  private async scheduleRetry(
    row: NotificationDeliveryOutboxEntity,
    error: string,
  ): Promise<void> {
    // After failure N (zero-indexed: row.attemptCount), wait
    // DELIVERY_RETRY_DELAYS_SECONDS[N] seconds before the next try.
    const delaySeconds =
      DELIVERY_RETRY_DELAYS_SECONDS[row.attemptCount] ??
      DELIVERY_RETRY_DELAYS_SECONDS[DELIVERY_RETRY_DELAYS_SECONDS.length - 1];
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
    await this.dataSource.transaction(async (em: EntityManager) => {
      await em.update(
        NotificationDeliveryOutboxEntity,
        { id: row.id },
        {
          attemptCount: row.attemptCount + 1,
          nextAttemptAt,
          lastError: truncateError(error),
        },
      );
    });
  }

  private async markFailed(
    row: NotificationDeliveryOutboxEntity,
    error: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em: EntityManager) => {
      await em.update(
        NotificationDeliveryOutboxEntity,
        { id: row.id },
        {
          attemptCount: row.attemptCount + 1,
          failedAt: new Date(),
          lastError: truncateError(error),
        },
      );
    });
  }

  private outboxToNotification(
    row: NotificationDeliveryOutboxEntity,
  ): import('@provenance/types').Notification {
    return {
      id: row.notificationId,
      orgId: row.orgId,
      // recipientPrincipalId is not snapshotted on the outbox row; the
      // renderer doesn't use it. Pass an empty string so the type matches
      // without claiming an identity we didn't snapshot.
      recipientPrincipalId: '',
      category: row.category,
      payload: row.payload,
      deepLink: row.deepLink,
      dedupKey: '',
      dedupCount: 1,
      readAt: null,
      dismissedAt: null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function truncateError(error: string): string {
  // last_error is unbounded TEXT in the schema, but unbounded errors fill the
  // table with stack traces. 1024 chars is enough to identify the problem
  // without bloating the row.
  return error.length > 1024 ? error.slice(0, 1024) : error;
}
