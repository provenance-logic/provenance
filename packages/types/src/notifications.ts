import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';

// ---------------------------------------------------------------------------
// Notifications — Domain 11 (F11.1 through F11.27, plus F12.10 fan-out)
//
// A notification is a routed, deduplicated, deliverable record of a platform
// event that a human (or service principal) needs to know about. Categories
// correspond 1:1 with the trigger F-IDs in PRD Domain 11. Channel selection
// (in-platform / email / webhook) is resolved at delivery time and not
// represented on the notification record itself; the row in the notifications
// table IS the in-platform delivery.
//
// Architecture: ADR-009.
// ---------------------------------------------------------------------------

/**
 * Notification category. One per F-ID in Domain 11, plus connection_reference_request
 * for the Domain 12 F12.10 fan-out. The set is closed at the platform level —
 * organizations cannot extend categories at MVP.
 */
export type NotificationCategory =
  // Access (F11.6 – F11.11)
  | 'access_request_submitted'
  | 'access_request_approved'
  | 'access_request_denied'
  | 'access_request_sla_warning'
  | 'access_request_sla_breach'
  | 'access_grant_expiring'
  // Product lifecycle (F11.12 – F11.15)
  | 'product_deprecated'
  | 'product_decommissioned'
  | 'product_published'
  | 'schema_drift_detected'
  // Observability and quality (F11.16 – F11.18)
  | 'slo_violation'
  | 'trust_score_significant_change'
  | 'connector_health_degraded'
  // Governance (F11.19 – F11.22)
  | 'policy_change_impact'
  | 'compliance_drift_detected'
  | 'grace_period_expiring'
  | 'classification_changed'
  // Agents (F11.23 – F11.26)
  | 'agent_classification_changed'
  | 'agent_suspended'
  | 'human_review_required'
  | 'frozen_operation_disposition'
  // Connection package + Domain 12 fan-out
  | 'connection_package_refreshed'
  | 'connection_reference_request';

export interface Notification {
  id: Uuid;
  orgId: Uuid;
  /** Principal the notification is addressed to. */
  recipientPrincipalId: Uuid;
  category: NotificationCategory;
  /** Category-specific structured payload. Shape is the trigger module's contract. */
  payload: Record<string, unknown>;
  /** Route in the platform UI the notification deep-links to. */
  deepLink: string;
  /** Stable per-trigger key used for deduplication within the configured window. */
  dedupKey: string;
  /**
   * Number of times this notification has been suppressed by the dedup window.
   * Starts at 1 (the first delivery itself counts). Bumped when a duplicate
   * collapses into this row.
   */
  dedupCount: number;
  /** Set when the recipient marks the notification as read. */
  readAt: IsoTimestamp | null;
  /** Set when the recipient dismisses the notification from the inbox. */
  dismissedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

export type NotificationList = PaginatedList<Notification>;

/**
 * Filters supported on the notification list endpoint.
 * Caller may only list their own notifications — recipientPrincipalId is
 * derived from the JWT, not accepted as a query parameter.
 */
export interface NotificationListFilters {
  category?: NotificationCategory;
  /** When true, only notifications with readAt = null are returned. */
  unreadOnly?: boolean;
  /** When true, dismissed notifications are excluded (default true). */
  excludeDismissed?: boolean;
  limit: number;
  offset: number;
}

/**
 * Input contract for trigger modules calling NotificationsService.enqueue().
 * Recipients are snapshotted by the trigger module at trigger time
 * (ADR-009 §3) — the service does not run any policy lookups of its own.
 */
export interface EnqueueNotificationInput {
  orgId: Uuid;
  category: NotificationCategory;
  /**
   * Pre-resolved list of principal IDs the notification should reach.
   * The service writes one row per recipient.
   */
  recipients: Uuid[];
  payload: Record<string, unknown>;
  deepLink: string;
  /**
   * Stable key for dedup. Choose a key that is identical for events that
   * should collapse together within the dedup window. Examples:
   *   - `slo_violation:${productId}:${sloType}`  — collapse repeated breaches
   *   - `access_request_submitted:${requestId}`  — never collides; effectively no dedup
   */
  dedupKey: string;
}

/**
 * Default deduplication window per F11.5. Governance-configurable per-category
 * once F11.3 (preferences) lands; for PR #2 every category uses this default.
 */
export const DEFAULT_DEDUP_WINDOW_SECONDS = 15 * 60;

/**
 * Delivery channels supported by the notification service.
 * `in_platform` is satisfied by the notification row itself (no outbox row is
 * written for it); `email` and `webhook` are queued via
 * notifications.delivery_outbox and drained by NotificationDeliveryWorker.
 */
export type NotificationDeliveryChannel = 'in_platform' | 'email' | 'webhook';

/**
 * Status of a single delivery attempt for an out-of-band channel (email or webhook).
 *
 * - `pending`   — has not yet been attempted, or is scheduled for retry; the
 *                 worker picks it up when `next_attempt_at <= now()`
 * - `delivered` — successfully sent (delivered_at populated)
 * - `failed`    — exhausted retry budget (failed_at and last_error populated)
 */
export type NotificationDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface NotificationOutboxEntry {
  id: string;
  notificationId: Uuid;
  orgId: Uuid;
  channel: NotificationDeliveryChannel;
  /** Snapshot of the destination (email address or webhook URL) at enqueue time. */
  target: string;
  attemptCount: number;
  nextAttemptAt: IsoTimestamp;
  deliveredAt: IsoTimestamp | null;
  failedAt: IsoTimestamp | null;
  lastError: string | null;
  createdAt: IsoTimestamp;
}

/**
 * Hard-coded default channels per category for PR #3 (before per-principal
 * preferences land in PR #5). Every category routes to in-platform; the more
 * urgent categories also route to email by default. The set is conservative —
 * principals will always see the in-platform notification, and email is added
 * for events that typically require timely action outside the platform UI.
 *
 * This map is the platform-shipped default. Org-level overrides and
 * principal-level preferences land in PR #5.
 */
export const CATEGORY_DEFAULT_CHANNELS: Readonly<
  Record<NotificationCategory, ReadonlyArray<NotificationDeliveryChannel>>
> = {
  // Access — owners and consumers act on these out-of-band frequently
  access_request_submitted: ['in_platform', 'email'],
  access_request_approved: ['in_platform', 'email'],
  access_request_denied: ['in_platform', 'email'],
  access_request_sla_warning: ['in_platform', 'email'],
  access_request_sla_breach: ['in_platform', 'email'],
  access_grant_expiring: ['in_platform', 'email'],
  // Product lifecycle — high-impact for downstream consumers
  product_deprecated: ['in_platform', 'email'],
  product_decommissioned: ['in_platform', 'email'],
  product_published: ['in_platform'],
  schema_drift_detected: ['in_platform', 'email'],
  // Observability — incident-shaped; email by default
  slo_violation: ['in_platform', 'email'],
  trust_score_significant_change: ['in_platform'],
  connector_health_degraded: ['in_platform', 'email'],
  // Governance
  policy_change_impact: ['in_platform', 'email'],
  compliance_drift_detected: ['in_platform', 'email'],
  grace_period_expiring: ['in_platform', 'email'],
  classification_changed: ['in_platform', 'email'],
  // Agents — oversight contacts and governance act on these
  agent_classification_changed: ['in_platform', 'email'],
  agent_suspended: ['in_platform', 'email'],
  human_review_required: ['in_platform', 'email'],
  frozen_operation_disposition: ['in_platform', 'email'],
  // Connection package + Domain 12 fan-out
  connection_package_refreshed: ['in_platform'],
  connection_reference_request: ['in_platform', 'email'],
};

/**
 * Retry schedule for failed out-of-band deliveries (NF11.3: 3 attempts, exponential).
 * Index N is the delay between attempt N (0-indexed) and the next attempt.
 * After the third entry is consumed the row is marked failed.
 */
export const DELIVERY_RETRY_DELAYS_SECONDS: ReadonlyArray<number> = [
  60,    // 1 minute after first failure
  5 * 60, // 5 minutes after second failure
  25 * 60, // 25 minutes after third failure (the cap before marking failed)
];

/**
 * Maximum number of delivery attempts for an out-of-band channel. After this
 * many failures the outbox row is marked failed and is not retried further.
 */
export const MAX_DELIVERY_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Per-principal preferences (PR #5, F11.3)
// ---------------------------------------------------------------------------

export interface NotificationPreference {
  orgId: Uuid;
  /** Principal these preferences belong to. */
  principalId: Uuid;
  category: NotificationCategory;
  /**
   * When false, the principal opts out of this category. Governance-mandatory
   * categories (GOVERNANCE_MANDATORY_CATEGORIES) ignore enabled=false at
   * resolution time — they are always delivered to at least the in-platform
   * channel regardless of preference.
   */
  enabled: boolean;
  /**
   * Channel override. When non-empty, replaces the category's default channel
   * set for this principal. The in-platform channel is always added back at
   * resolution time so the notification reaches the inbox regardless of
   * override. Empty array means "no override; use the category default."
   */
  channels: NotificationDeliveryChannel[];
  updatedAt: IsoTimestamp;
}

export interface UpdateNotificationPreferenceRequest {
  enabled?: boolean;
  /**
   * Channel override; pass an empty array to clear an override and fall back
   * to the category default.
   */
  channels?: NotificationDeliveryChannel[];
}

export type NotificationPreferenceList = PaginatedList<NotificationPreference>;

/**
 * Categories that are governance-mandatory per F11.3. Principals may not opt
 * out of these. Channel overrides are still permitted, but the notification
 * will always be delivered through at least the in-platform channel.
 *
 * The exhaustive list is fixed by the PRD wording on each requirement:
 *   - Frozen operation disposition (F11.26) — governance must act
 *   - Human review required (F11.25) — oversight contact must act
 *   - Agent suspended (F11.24) — governance and prior oversight must know
 *   - Classification changed (F11.22) — affects access; downstream must know
 *   - Compliance drift detected (F11.20) — owner must remediate
 *   - SLA breach (F11.10) — escalation already breached
 */
export const GOVERNANCE_MANDATORY_CATEGORIES: ReadonlySet<NotificationCategory> =
  new Set<NotificationCategory>([
    'frozen_operation_disposition',
    'human_review_required',
    'agent_suspended',
    'classification_changed',
    'compliance_drift_detected',
    'access_request_sla_breach',
  ]);
