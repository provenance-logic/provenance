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
  type PrincipalNotificationSettings,
  type UpdateNotificationPreferenceRequest,
  type UpdatePrincipalNotificationSettingsRequest,
} from '@provenance/types';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity.js';
import { PrincipalNotificationSettingsEntity } from './entities/principal-notification-settings.entity.js';

// Per-principal preference CRUD (F11.3). Caller scoping is enforced at the
// controller layer — this service trusts the principalId argument.
@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreferenceEntity)
    private readonly repo: Repository<NotificationPreferenceEntity>,
    @InjectRepository(PrincipalNotificationSettingsEntity)
    private readonly settingsRepo: Repository<PrincipalNotificationSettingsEntity>,
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

  // ---------------------------------------------------------------------------
  // Per-principal settings (PR #4 — webhook URL configuration)
  // ---------------------------------------------------------------------------

  async getSettings(
    orgId: string,
    principalId: string,
  ): Promise<PrincipalNotificationSettings> {
    const row = await this.settingsRepo.findOne({
      where: { orgId, principalId },
    });
    if (!row) {
      // Return a synthetic "no settings yet" record so the caller doesn't have
      // to special-case 404 vs "no webhook configured." Both states are the
      // same to clients: no webhook URL on file.
      return {
        orgId,
        principalId,
        webhookUrl: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return this.toSettingsDto(row);
  }

  async upsertSettings(
    orgId: string,
    principalId: string,
    update: UpdatePrincipalNotificationSettingsRequest,
  ): Promise<PrincipalNotificationSettings> {
    const normalized = normalizeWebhookUrl(update.webhookUrl);
    const existing = await this.settingsRepo.findOne({
      where: { principalId },
    });
    const merged: PrincipalNotificationSettingsEntity = existing ?? this.settingsRepo.create({
      orgId,
      principalId,
      webhookUrl: null,
    });
    merged.webhookUrl = normalized;
    const saved = await this.settingsRepo.save(merged);
    return this.toSettingsDto(saved);
  }

  /**
   * Bulk lookup of webhook URLs keyed by principal_id. Used by
   * NotificationsService.enqueue alongside loadByRecipients() so the
   * snapshotted target on each outbox row reflects the URL on file at
   * trigger time (ADR-009 §3 — recipients snapshotted at trigger time).
   */
  async loadWebhookUrls(
    orgId: string,
    principalIds: string[],
  ): Promise<Map<string, string>> {
    if (principalIds.length === 0) {
      return new Map();
    }
    const rows = await this.settingsRepo.find({
      where: { orgId, principalId: In(principalIds) },
    });
    const out = new Map<string, string>();
    for (const r of rows) {
      if (r.webhookUrl) {
        out.set(r.principalId, r.webhookUrl);
      }
    }
    return out;
  }

  private toSettingsDto(
    row: PrincipalNotificationSettingsEntity,
  ): PrincipalNotificationSettings {
    return {
      orgId: row.orgId,
      principalId: row.principalId,
      webhookUrl: row.webhookUrl,
      updatedAt: row.updatedAt.toISOString(),
    };
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

const MAX_WEBHOOK_URL_LENGTH = 2000;

// Trims whitespace, normalizes empty string to null, and rejects anything
// other than https. The schema permits up to 2000 chars; we reject longer.
function normalizeWebhookUrl(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new BadRequestException(
      `Webhook URL exceeds maximum length of ${MAX_WEBHOOK_URL_LENGTH} characters`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('Webhook URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    // http: rejected — outbound notifications carry potentially sensitive
    // payload (e.g. SLO violation context, deep links into the platform).
    // Plaintext webhook delivery is not a credible threat model.
    throw new BadRequestException('Webhook URL must use https');
  }
  return trimmed;
}
