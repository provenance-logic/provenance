import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  type EnqueueNotificationInput,
  type Notification,
  type NotificationCategory,
  type NotificationList,
  type NotificationListFilters,
  DEFAULT_DEDUP_WINDOW_SECONDS,
} from '@provenance/types';
import { NotificationEntity } from './entities/notification.entity.js';

// In-platform notification routing for Domain 11 (ADR-009).
//
// This service is the single entry point for any module that needs to
// notify a principal about a platform event. Trigger modules call
// `enqueue()` with a pre-resolved recipient list (recipients are
// snapshotted at trigger time, never resolved lazily here).
//
// PR #2 covers the in-platform channel only — the row written here IS
// the in-platform delivery. Email/webhook delivery channels and the
// outbox/worker that drives them land in subsequent PRs.
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repo: Repository<NotificationEntity>,
  ) {}

  // F11.1 + F11.5. Routes a notification to each recipient, deduplicating
  // against any row with the same (orgId, recipientPrincipalId, category,
  // dedupKey) created within DEFAULT_DEDUP_WINDOW_SECONDS. On dedup hit,
  // the existing row's dedupCount is incremented and the existing row is
  // returned in place of a new row — the caller cannot distinguish a
  // dedup hit from a fresh row except by inspecting dedupCount.
  async enqueue(input: EnqueueNotificationInput): Promise<Notification[]> {
    if (input.recipients.length === 0) {
      return [];
    }

    const since = new Date(Date.now() - DEFAULT_DEDUP_WINDOW_SECONDS * 1000);
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
        // Return the in-memory row with the bumped count to avoid an extra
        // round-trip; the persisted row is now dedupCount + 1 either way.
        out.push(this.toDto({ ...existing, dedupCount: existing.dedupCount + 1 }));
        continue;
      }

      const draft = this.repo.create({
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
      const saved = await this.repo.save(draft);
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
