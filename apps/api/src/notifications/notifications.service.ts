import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  type EnqueueNotificationInput,
  type Notification,
  type NotificationCategory,
  type NotificationDeliveryChannel,
  type NotificationList,
  type NotificationListFilters,
  DEFAULT_DEDUP_WINDOW_SECONDS,
} from '@provenance/types';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationDeliveryOutboxEntity } from './entities/notification-delivery-outbox.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { resolveChannels } from './channel-resolver.js';
import {
  NotificationPreferencesService,
  preferenceKey,
} from './notification-preferences.service.js';

// In-platform notification routing for Domain 11 (ADR-009).
//
// Single entry point for any module that needs to notify a principal about a
// platform event. Trigger modules call `enqueue()` with a pre-resolved
// recipient list (recipients are snapshotted at trigger time, never resolved
// lazily here).
//
// PR #2 landed the in-platform tier; PR #3 (this version) wires the email
// channel by writing rows to notifications.delivery_outbox in the same
// transaction as the parent notifications.notifications row. The outbox is
// drained asynchronously by NotificationDeliveryWorker. Webhook channel
// (PR #4) reuses the same outbox.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repo: Repository<NotificationEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  // F11.1 + F11.2 (in-platform + email) + F11.5. Routes a notification to
  // each recipient, deduplicating against any row with the same (orgId,
  // recipientPrincipalId, category, dedupKey) created within
  // DEFAULT_DEDUP_WINDOW_SECONDS. On dedup hit, the existing row's
  // dedupCount is incremented and no new outbox rows are written —
  // suppression covers downstream channels too (ADR-009 §5).
  //
  // For each fresh notification, outbox rows are written for every
  // out-of-band channel the category routes to by default. Recipient
  // contact info (email address) is snapshotted on the outbox row at
  // enqueue time so a later profile change cannot redirect a queued
  // delivery (ADR-009 §3).
  async enqueue(input: EnqueueNotificationInput): Promise<Notification[]> {
    if (input.recipients.length === 0) {
      return [];
    }

    const since = new Date(Date.now() - DEFAULT_DEDUP_WINDOW_SECONDS * 1000);

    // Resolve per-recipient channel set up front. Each recipient may have
    // their own preference (opt-out, channel override, etc.); we batch the
    // preference lookup so this is one round-trip regardless of recipient
    // count. The pre-resolved channel sets feed both the contact-info
    // pre-fetch (only fetch principals if any out-of-band channels are
    // actually in play) and the per-recipient outbox write loop below.
    const principalPreferences = await this.preferences.loadByRecipients(
      input.orgId,
      input.recipients,
    );
    const channelsByRecipient = new Map<string, NotificationDeliveryChannel[]>();
    let needContactLookup = false;
    for (const recipientPrincipalId of input.recipients) {
      const pref =
        principalPreferences.get(preferenceKey(recipientPrincipalId, input.category)) ?? null;
      const channels = resolveChannels(input.category, pref);
      channelsByRecipient.set(recipientPrincipalId, channels);
      if (channels.some((c) => c !== 'in_platform')) {
        needContactLookup = true;
      }
    }

    const principalContacts = needContactLookup
      ? await this.loadPrincipalContacts(input.recipients)
      : new Map<string, PrincipalEntity>();

    const out: Notification[] = [];

    for (const recipientPrincipalId of input.recipients) {
      const existing = await this.findDedupCandidate({
        orgId: input.orgId,
        recipientPrincipalId,
        category: input.category,
        dedupKey: input.dedupKey,
        since,
      });

      if (existing) {
        await this.repo.increment({ id: existing.id }, 'dedupCount', 1);
        out.push(this.toDto({ ...existing, dedupCount: existing.dedupCount + 1 }));
        continue;
      }

      const recipientChannels = channelsByRecipient.get(recipientPrincipalId) ?? ['in_platform'];
      const outOfBandChannels = recipientChannels.filter((c) => c !== 'in_platform');

      const saved = await this.dataSource.transaction(async (em) => {
        const notifRepo = em.getRepository(NotificationEntity);
        const outboxRepo = em.getRepository(NotificationDeliveryOutboxEntity);

        const draft = notifRepo.create({
          orgId: input.orgId,
          recipientPrincipalId,
          category: input.category,
          payload: input.payload,
          deepLink: input.deepLink,
          dedupKey: input.dedupKey,
          dedupCount: 1,
          readAt: null,
          dismissedAt: null,
        });
        const savedRow = await notifRepo.save(draft);

        for (const channel of outOfBandChannels) {
          const target = this.resolveTargetForChannel(
            channel,
            recipientPrincipalId,
            principalContacts,
          );
          if (!target) continue;
          const outboxRow = outboxRepo.create({
            notificationId: savedRow.id,
            orgId: input.orgId,
            channel,
            target,
            // Snapshot rendering inputs so the cron worker can render without
            // joining notifications.notifications (which is RLS-enforced and
            // would require setting an org context per-row).
            category: input.category,
            payload: input.payload,
            deepLink: input.deepLink,
            attemptCount: 0,
            nextAttemptAt: new Date(),
            deliveredAt: null,
            failedAt: null,
            lastError: null,
          });
          await outboxRepo.save(outboxRow);
        }

        return savedRow;
      });

      out.push(this.toDto(saved));
    }

    return out;
  }

  async list(
    orgId: string,
    recipientPrincipalId: string,
    filters: NotificationListFilters,
  ): Promise<NotificationList> {
    const excludeDismissed = filters.excludeDismissed !== false;

    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.orgId = :orgId', { orgId })
      .andWhere('n.recipientPrincipalId = :recipientPrincipalId', {
        recipientPrincipalId,
      })
      .orderBy('n.createdAt', 'DESC')
      .take(filters.limit)
      .skip(filters.offset);

    if (filters.category) {
      qb.andWhere('n.category = :category', { category: filters.category });
    }
    if (filters.unreadOnly) {
      qb.andWhere('n.readAt IS NULL');
    }
    if (excludeDismissed) {
      qb.andWhere('n.dismissedAt IS NULL');
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      items: rows.map((r) => this.toDto(r)),
      meta: {
        total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

  async markRead(
    orgId: string,
    recipientPrincipalId: string,
    notificationId: string,
  ): Promise<Notification> {
    const row = await this.findOwnedOrThrow(orgId, recipientPrincipalId, notificationId);
    if (row.readAt) {
      return this.toDto(row);
    }
    const readAt = new Date();
    await this.repo.update({ id: row.id }, { readAt });
    return this.toDto({ ...row, readAt });
  }

  async dismiss(
    orgId: string,
    recipientPrincipalId: string,
    notificationId: string,
  ): Promise<Notification> {
    const row = await this.findOwnedOrThrow(orgId, recipientPrincipalId, notificationId);
    if (row.dismissedAt) {
      return this.toDto(row);
    }
    const dismissedAt = new Date();
    await this.repo.update({ id: row.id }, { dismissedAt });
    return this.toDto({ ...row, dismissedAt });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadPrincipalContacts(
    principalIds: string[],
  ): Promise<Map<string, PrincipalEntity>> {
    const rows = await this.principalRepo.find({
      where: { id: In(principalIds) },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private resolveTargetForChannel(
    channel: NotificationDeliveryChannel,
    recipientPrincipalId: string,
    contacts: Map<string, PrincipalEntity>,
  ): string | null {
    if (channel === 'email') {
      const principal = contacts.get(recipientPrincipalId);
      if (!principal || !principal.email) {
        // Principal lookup miss or no email on file. The in-platform row is
        // still written; the recipient sees the notification next time they
        // log in. Webhook channel (PR #4) follows the same pattern.
        this.logger.warn(
          `No email on file for principal ${recipientPrincipalId}; skipping email delivery`,
        );
        return null;
      }
      return principal.email;
    }
    // PR #4 will add 'webhook' resolution against principal preferences.
    return null;
  }

  private async findDedupCandidate(args: {
    orgId: string;
    recipientPrincipalId: string;
    category: NotificationCategory;
    dedupKey: string;
    since: Date;
  }): Promise<NotificationEntity | null> {
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.orgId = :orgId', { orgId: args.orgId })
      .andWhere('n.recipientPrincipalId = :recipientPrincipalId', {
        recipientPrincipalId: args.recipientPrincipalId,
      })
      .andWhere('n.category = :category', { category: args.category })
      .andWhere('n.dedupKey = :dedupKey', { dedupKey: args.dedupKey })
      .andWhere('n.createdAt >= :since', { since: args.since })
      .orderBy('n.createdAt', 'DESC')
      .take(1);
    return qb.getOne();
  }

  private async findOwnedOrThrow(
    orgId: string,
    recipientPrincipalId: string,
    notificationId: string,
  ): Promise<NotificationEntity> {
    const row = await this.repo.findOne({
      where: { id: notificationId, orgId, recipientPrincipalId },
    });
    if (!row) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }
    return row;
  }

  private toDto(row: NotificationEntity): Notification {
    return {
      id: row.id,
      orgId: row.orgId,
      recipientPrincipalId: row.recipientPrincipalId,
      category: row.category,
      payload: row.payload,
      deepLink: row.deepLink,
      dedupKey: row.dedupKey,
      dedupCount: row.dedupCount,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
