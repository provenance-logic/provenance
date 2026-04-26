import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  type NotificationCategory,
  type NotificationDeliveryChannel,
  type NotificationPreference,
  type UpdateNotificationPreferenceRequest,
} from '@provenance/types';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity.js';

// Per-principal preference CRUD (F11.3). Caller scoping is enforced at the
// controller layer — this service trusts the principalId argument.
@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreferenceEntity)
    private readonly repo: Repository<NotificationPreferenceEntity>,
  ) {}

  async list(orgId: string, principalId: string): Promise<NotificationPreference[]> {
    const rows = await this.repo.find({
      where: { orgId, principalId },
      order: { category: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Bulk lookup used by NotificationsService.enqueue to fetch preferences for
   * a list of recipients in one round-trip. Returns a Map keyed on
   * (principalId, category) joined as `${principalId}::${category}`.
   */
  async loadByRecipients(
    orgId: string,
    principalIds: string[],
  ): Promise<Map<string, NotificationPreference>> {
    if (principalIds.length === 0) {
      return new Map();
    }
    const rows = await this.repo.find({
      where: { orgId, principalId: In(principalIds) },
    });
    const out = new Map<string, NotificationPreference>();
    for (const r of rows) {
      out.set(preferenceKey(r.principalId, r.category), this.toDto(r));
    }
    return out;
  }

  async upsert(
    orgId: string,
    principalId: string,
    category: NotificationCategory,
    update: UpdateNotificationPreferenceRequest,
  ): Promise<NotificationPreference> {
    if (update.channels) {
      validateChannelSet(update.channels);
    }
    const existing = await this.repo.findOne({
      where: { principalId, category },
    });
    const merged: NotificationPreferenceEntity = existing ?? this.repo.create({
      orgId,
      principalId,
      category,
      enabled: true,
      channels: [],
    });
    if (update.enabled !== undefined) {
      merged.enabled = update.enabled;
    }
    if (update.channels !== undefined) {
      merged.channels = update.channels;
    }
    const saved = await this.repo.save(merged);
    return this.toDto(saved);
  }

  /**
   * Resets a preference to the platform default by deleting the row. The
   * channel resolver treats a missing preference as "use CATEGORY_DEFAULT_CHANNELS,"
   * so deletion is the correct shape for "reset to default."
   */
  async reset(
    principalId: string,
    category: NotificationCategory,
  ): Promise<void> {
    await this.repo.delete({ principalId, category });
  }

  private toDto(row: NotificationPreferenceEntity): NotificationPreference {
    return {
      orgId: row.orgId,
      principalId: row.principalId,
      category: row.category,
      enabled: row.enabled,
      // PostgreSQL returns text[] as string[]; types align — but TypeORM may
      // return null for an unset column. Guard against that to keep the DTO
      // contract stable.
      channels: row.channels ?? [],
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export function preferenceKey(principalId: string, category: string): string {
  return `${principalId}::${category}`;
}

const ALLOWED_CHANNELS: ReadonlySet<NotificationDeliveryChannel> = new Set([
  'in_platform',
  'email',
  'webhook',
]);

function validateChannelSet(channels: NotificationDeliveryChannel[]): void {
  for (const c of channels) {
    if (!ALLOWED_CHANNELS.has(c)) {
      throw new BadRequestException(`Unknown notification channel: ${c}`);
    }
  }
  // Duplicates are rejected to keep the override unambiguous.
  if (new Set(channels).size !== channels.length) {
    throw new BadRequestException('Channel override contains duplicates');
  }
}
