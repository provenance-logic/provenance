import {
  type NotificationCategory,
  type NotificationDeliveryChannel,
  type NotificationPreference,
} from '@provenance/types';
import { resolveChannels } from '../channel-resolver.js';

function makePref(
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
  return {
    orgId: 'org-1',
    principalId: 'principal-a',
    category: 'slo_violation',
    enabled: true,
    channels: [],
    updatedAt: '2026-04-26T12:00:00Z',
    ...overrides,
  };
}

describe('resolveChannels', () => {
  it('returns the platform default when no preference is supplied', () => {
    const channels = resolveChannels('slo_violation', null);
    // slo_violation defaults to in_platform + email.
    expect(channels).toEqual(['in_platform', 'email']);
  });

  it('returns only in_platform when a non-mandatory category is opted out', () => {
    const channels = resolveChannels(
      'slo_violation',
      makePref({ enabled: false }),
    );
    expect(channels).toEqual(['in_platform']);
  });

  it('keeps in_platform for governance-mandatory categories even when opted out', () => {
    const channels = resolveChannels(
      'frozen_operation_disposition',
      makePref({ category: 'frozen_operation_disposition', enabled: false }),
    );
    expect(channels).toContain('in_platform');
    // Out-of-band channels are stripped — opt-out partially honored.
    expect(channels).not.toContain('email');
  });

  it('uses the channel override when one is supplied', () => {
    const channels = resolveChannels(
      'slo_violation',
      makePref({ channels: ['email'] }),
    );
    // Override was just ['email'] but in_platform is always re-added.
    expect(channels.sort()).toEqual(['email', 'in_platform']);
  });

  it('respects an override that already includes in_platform', () => {
    const channels = resolveChannels(
      'slo_violation',
      makePref({ channels: ['in_platform', 'email'] }),
    );
    expect(channels).toEqual(['in_platform', 'email']);
  });

  it('treats an empty channels array as "no override" and falls back to default', () => {
    const channels = resolveChannels(
      'slo_violation',
      makePref({ channels: [] }),
    );
    expect(channels).toEqual(['in_platform', 'email']);
  });

  it('returns the in_platform-only default for product_published when no override', () => {
    // product_published defaults to in_platform-only — confirm it stays that way.
    const channels = resolveChannels('product_published', null);
    expect(channels).toEqual(['in_platform']);
  });

  it('respects a webhook override on a default-in-platform-only category', () => {
    const channels = resolveChannels(
      'product_published',
      makePref({ category: 'product_published', channels: ['webhook'] }),
    );
    expect(channels.sort()).toEqual(['in_platform', 'webhook'] as NotificationDeliveryChannel[]);
  });

  it('does not add a duplicate in_platform when both override and default include it', () => {
    const category: NotificationCategory = 'product_published';
    const channels = resolveChannels(
      category,
      makePref({ category, channels: ['in_platform', 'email'] }),
    );
    expect(channels.filter((c) => c === 'in_platform')).toHaveLength(1);
  });
});
