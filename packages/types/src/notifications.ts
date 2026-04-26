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
