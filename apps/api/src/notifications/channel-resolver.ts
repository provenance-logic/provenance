import {
  type NotificationCategory,
  type NotificationDeliveryChannel,
  type NotificationPreference,
  CATEGORY_DEFAULT_CHANNELS,
  GOVERNANCE_MANDATORY_CATEGORIES,
} from '@provenance/types';

// Resolves the channel set for a given (category, principal preference) pair
// per F11.3. Precedence:
//
//   1. Start with CATEGORY_DEFAULT_CHANNELS[category] — the platform default.
//   2. If a preference exists and `enabled === false`:
//      - Governance-mandatory categories ignore the opt-out — they always
//        retain at least the in-platform channel (F11.3 — "Governance-
//        mandated notifications cannot be opted out of").
//      - Non-mandatory categories collapse to ['in_platform']; the principal
//        still sees the inbox row but no out-of-band delivery happens.
//   3. If a preference exists and `channels` is non-empty, the override
//      replaces the default set. The in-platform channel is always re-added
//      so the notification reaches the inbox regardless of override.
//
// Per ADR-009 Implementation Note: channel resolution currently happens at
// enqueue time, not delivery time. A preference change therefore takes effect
// for future enqueue calls only — already-queued outbox rows are unaffected.
// This is a deviation from the original ADR §4 wording and is documented
// alongside the per-org SMTP deferral.
export function resolveChannels(
  category: NotificationCategory,
  preference: NotificationPreference | null,
): NotificationDeliveryChannel[] {
  const defaults = CATEGORY_DEFAULT_CHANNELS[category];
  const isGovernanceMandatory = GOVERNANCE_MANDATORY_CATEGORIES.has(category);

  if (!preference) {
    return [...defaults];
  }

  if (!preference.enabled) {
    if (isGovernanceMandatory) {
      // Strip out-of-band channels but keep in_platform — the principal
      // cannot fully suppress a governance-mandatory category.
      return forceInPlatform([]);
    }
    return ['in_platform'];
  }

  if (preference.channels.length > 0) {
    return forceInPlatform(preference.channels);
  }

  return [...defaults];
}

function forceInPlatform(
  channels: NotificationDeliveryChannel[],
): NotificationDeliveryChannel[] {
  if (channels.includes('in_platform')) {
    return [...channels];
  }
  return ['in_platform', ...channels];
}
