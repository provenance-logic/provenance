import type {
  Notification,
  NotificationCategory,
} from '@provenance/types';
import type { EmailMessage } from '../email/email.service.js';

// Generic notification → email rendering. PR #3 ships a fallback that works
// for every category; category-specific templates land alongside the trigger
// PRs (#7–12 in the Domain 11 phasing) by registering an entry in
// CATEGORY_TEMPLATES.
//
// Rendering happens at delivery time, not at enqueue time, so a future
// template improvement applies to already-queued notifications too.

export interface RenderContext {
  /** Absolute URL of the platform UI; deep links are rendered against this base. */
  appBaseUrl: string;
}

export type NotificationTemplate = (
  notification: Notification,
  ctx: RenderContext,
) => EmailMessage;

// Override map for category-specific templates. PRs #7–12 add entries here as
// triggers are wired. Anything not listed falls through to the generic
// renderer below.
const CATEGORY_TEMPLATES: Partial<Record<NotificationCategory, NotificationTemplate>> = {};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
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

export function renderEmail(
  notification: Notification,
  ctx: RenderContext,
): EmailMessage {
  const override = CATEGORY_TEMPLATES[notification.category];
  if (override) {
    return override(notification, ctx);
  }
  return renderGeneric(notification, ctx);
}

function renderGeneric(notification: Notification, ctx: RenderContext): EmailMessage {
  const label = CATEGORY_LABELS[notification.category] ?? notification.category;
  const url = absoluteUrl(ctx.appBaseUrl, notification.deepLink);
  const payloadLines = formatPayloadLines(notification.payload);

  const subject = `[Provenance] ${label}`;
  const text = [
    label,
    '',
    ...payloadLines,
    '',
    `View in Provenance: ${url}`,
  ].join('\n');
  const html = [
    `<p><strong>${escapeHtml(label)}</strong></p>`,
    payloadLines.length > 0
      ? `<ul>${payloadLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : '',
    `<p><a href="${escapeHtml(url)}">View in Provenance</a></p>`,
  ].join('\n');

  return { to: '', subject, html, text };
}

function absoluteUrl(base: string, path: string): string {
  // Tolerate trailing slash on base and leading slash on path.
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const prefixedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${prefixedPath}`;
}

function formatPayloadLines(payload: Record<string, unknown>): string[] {
  return Object.entries(payload).map(([key, value]) => {
    const formattedKey = humanizeKey(key);
    const formattedValue = formatValue(value);
    return `${formattedKey}: ${formattedValue}`;
  });
}

function humanizeKey(key: string): string {
  // camelCase / snake_case → Title Case With Spaces
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
  // Objects and arrays — JSON-stringify so the email is readable but lossless.
  return JSON.stringify(value);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
