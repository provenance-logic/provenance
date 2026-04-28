import type { NotificationCategory } from '@provenance/types';

/**
 * Display labels for notification categories. Mirrors the map in
 * apps/api/src/notifications/notification-renderer.ts so the in-platform
 * inbox and the email subjects use consistent wording.
 *
 * If a new category is added in @provenance/types, TypeScript will flag a
 * missing key here at compile time (the Record<NotificationCategory, ...>
 * constraint enforces exhaustiveness).
 */
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  access_request_submitted: 'Access Request Submitted',
  access_request_approved: 'Access Request Approved',
  access_request_denied: 'Access Request Denied',
  access_request_sla_warning: 'Access Request SLA Warning',
  access_request_sla_breach: 'Access Request SLA Breach',
  access_grant_expiring: 'Access Grant Expiring',
  product_deprecated: 'Product Deprecated',
  product_decommissioned: 'Product Decommissioned',
  product_published: 'Product Published',
  schema_drift_detected: 'Schema Drift Detected',
  slo_violation: 'SLO Violation',
  trust_score_significant_change: 'Trust Score Changed Significantly',
  connector_health_degraded: 'Connector Health Degraded',
  policy_change_impact: 'Policy Change Impact',
  compliance_drift_detected: 'Compliance Drift Detected',
  grace_period_expiring: 'Grace Period Expiring',
  classification_changed: 'Classification Changed',
  agent_classification_changed: 'Agent Classification Changed',
  agent_suspended: 'Agent Suspended',
  human_review_required: 'Human Review Required',
  frozen_operation_disposition: 'Frozen Operation Requires Disposition',
  connection_package_refreshed: 'Connection Package Refreshed',
  connection_reference_request: 'Connection Reference Request',
};

/**
 * Format a notification's payload as human-readable bullet entries for the
 * drawer/inbox preview. Best-effort: strings/numbers/booleans render directly,
 * objects are JSON-serialized.
 */
export function formatPayloadEntries(payload: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(payload).map(([key, value]) => ({
    key: humanizeKey(key),
    value: formatValue(value),
  }));
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Format a timestamp as a short relative phrase ("3m ago", "yesterday").
 * Falls back to the raw ISO date if anything goes wrong.
 */
export function formatRelativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
