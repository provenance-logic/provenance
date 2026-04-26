# ADR-009: Notification Architecture

**Date:** April 26, 2026
**Status:** Proposed
**Author:** Provenance Platform Team

---

## Resolves

PRD Domain 11 (F11.1–F11.27) — the platform requires a notification capability covering routing, deduplication, delivery across multiple channels, and per-principal preferences. This ADR fixes the architecture for that capability before any code lands. It also unblocks Domain 12 F12.10 (request routing notification) and the deferred F11 wiring inside Domain 10 F10.10 / F10.7.

---

## Context

Provenance currently has no notification capability of any kind. Twenty-two distinct platform events (F11.6–F11.27) need to reach human recipients across multiple channels, and the trigger sources span every existing module: access, products, governance, observability, agents, consent, connectors. Without a single notification service, each module would need to know about email, webhooks, recipient resolution, deduplication, and preferences — a coupling problem.

The PRD is explicit on several constraints:

- F11.1: the service must be decoupled from event sources. Triggers fire events; the service routes and delivers.
- F11.2: three delivery channels — in-platform, email, webhook. Organizations configure defaults; principals configure preferences per category.
- F11.5: deduplication within a configurable window (default 15 minutes).
- NF11.2: email delivered within 5 minutes of triggering event.
- NF11.3: webhook retries with 3 attempts and exponential backoff.
- NF11.5: notification history retained for 90 days.

This ADR resolves the design questions implied by those requirements: how triggers reach the service, how delivery is fanned out across channels asynchronously, how recipients are resolved, how deduplication keys are formed, how email is transported, and how webhook retries are persisted.

---

## Decision

### 1. Service shape and module boundary

A new `notifications` NestJS module owns all routing and delivery. It exposes a single `NotificationsService` interface with one primary method:

```ts
notificationsService.enqueue({
  orgId,
  category,                     // F11 category enum (e.g. 'access_request_submitted')
  recipients,                   // resolved at trigger time, snapshot of principal IDs
  payload,                      // category-specific structured data
  deepLink,                     // route in the platform UI
  dedupKey,                     // category-stable key, e.g. `slo_violation:${productId}`
});
```

Trigger modules (access, products, governance, observability, agents, consent) inject this interface and call `enqueue` when a domain event occurs. They never know about email, webhooks, preferences, or dedup. Per the existing CLAUDE.md rule, cross-module calls go through the exported interface, not the implementation file.

### 2. Async pipeline: trigger → outbox → worker → channel

Delivery is asynchronous and uses the outbox pattern already established for connection references (ADR-007). The flow:

```
trigger module
  └─ NotificationsService.enqueue() inside the trigger's existing transaction
      └─ INSERT into notifications.notifications  (the canonical record, also the in-platform inbox)
      └─ INSERT into notifications.delivery_outbox  (one row per channel × recipient that is not in-platform-only)
[transaction commits]
  └─ NotificationDeliveryWorker (cron-driven, every 30s)
      └─ pull pending rows from delivery_outbox
      └─ resolve channel handler (email | webhook) and deliver
      └─ on success: mark delivered_at
      └─ on failure: schedule retry per channel-specific policy (see §6)
```

The notification record itself is the source of truth and is also what the in-platform notification center reads from — no separate worker is needed for in-platform delivery, because writing the row *is* the delivery for that channel. Only email and webhook need the outbox-and-worker pipeline.

This means we get exactly-once-or-more email/webhook delivery semantics with the standard outbox guarantees (commit the trigger and the outbox row in one transaction; deliver from the outbox; mark on success).

### 3. Recipient resolution: snapshot at trigger time

The trigger module is responsible for resolving recipient principal IDs at the moment of enqueue and passing them in. The notifications module does not run policy lookups like "who is the owner of product X" — that knowledge lives in the originating module (products module knows owners; access module knows requesters; etc.).

Rationale: ownership and oversight assignments change. If we resolve lazily at delivery time, we deliver to whoever holds the role *now*, which can be the wrong person if delivery is delayed or retried hours later. Snapshotting at trigger time means the notification reaches the principal who held the relevant role *when the event happened*, which is the correct semantic for an audit-grade system.

Where the recipient set changes over time (e.g. "all active consumers of product X" in F11.12), the trigger module enumerates that set once and the resulting list is what the notification fans out to. Late-joining consumers are explicitly out of scope per the PRD wording — F11.12 says "all consumers with active access grants for that product" at the moment of deprecation.

### 4. Categories, preferences, and channel selection

A notification has exactly one category (an enum corresponding to F11.6–F11.27). Categories are defined platform-side; organizations cannot extend the category set in MVP.

Channel selection follows a three-tier resolution:

1. **Hard-coded category default.** Each category ships with a default channel set (e.g. `slo_violation` defaults to email + in-platform; `access_request_submitted` defaults to in-platform + email).
2. **Org-level override.** Organizations can change the default channel set for a category for all their principals.
3. **Principal preference.** Individual principals can opt out of a category entirely or override the channel set for themselves, *unless* the category is marked `governance_mandatory: true` (e.g. governance review required, frozen operation requires disposition — these are non-opt-outable per F11.3).

The per-principal preference table is principal-scoped and read at delivery time (not at enqueue time). This means a preference change takes effect immediately for any not-yet-delivered notification, which is the user expectation. The recipient *list* is snapshotted at trigger time; the *channel* is resolved at delivery time. These two are different concerns.

### 5. Deduplication

Each notification carries a `dedup_key` chosen by the trigger module. Examples:

- `slo_violation:${productId}:${sloType}` — collapses repeated SLO breaches on the same SLO into one notification per window.
- `access_request_submitted:${requestId}` — never dedups (each request is unique), key is just for traceability.
- `connector_health_degraded:${connectorId}` — collapses flapping into one notification per window.

The dedup window is per-category, governance-configurable (NF11.6), platform default 15 minutes (F11.5). At enqueue time, the service checks for an existing notification with the same `(org_id, category, dedup_key)` triple created within the window. If one exists, the new notification is dropped (and a counter on the existing record is incremented for diagnostic visibility).

Crucially: dedup happens at the in-platform notification level, *before* the delivery outbox is populated. A deduped notification produces no outbox rows, so it never sends a duplicate email or webhook either.

### 6. Channel transports

#### In-platform

The `notifications.notifications` table is the inbox. The frontend reads from it via REST. No transport layer.

#### Email — SMTP pluggable

A single SMTP configuration per organization, stored in `notifications.org_email_config` (host, port, auth credentials reference, from address, reply-to). Credentials follow the same Secrets Manager ARN reference pattern as connector credentials — never raw values in the database.

The SMTP transport is a thin wrapper around `nodemailer`. Any SMTP-compatible provider works (SES, SendGrid, Mailgun, on-prem Postfix, etc.) without code changes — this is the open-source-friendly choice. Organizations that want SES specifically configure SES SMTP credentials in their SMTP config.

For local development and the demo environment, a default platform-level SMTP config (e.g. MailHog or similar) is used as a fallback when the org has not configured one. Production deployments must configure per-org SMTP.

#### Webhook

A per-principal webhook target URL configured via the preferences UI. The webhook payload is a stable JSON envelope:

```json
{
  "category": "slo_violation",
  "orgId": "...",
  "principalId": "...",
  "createdAt": "...",
  "payload": { ... },
  "deepLink": "https://platform.example.com/products/..."
}
```

Retries: per NF11.3, on HTTP failure (non-2xx response or connection error), the delivery row is scheduled for retry at 1 minute, 5 minutes, and 25 minutes (3 attempts, exponential). After the third failure, the row is marked `delivery_failed` and the failure is surfaced in the principal's notification preferences UI ("your webhook for category X is failing"). No further automatic retry — the principal must act.

The retry schedule is implemented as a `next_attempt_at` column on the outbox row. The worker only picks rows where `next_attempt_at <= now()`. No Temporal workflow involvement — Temporal is reserved for genuinely long-running multi-step orchestration, and webhook retry is too lightweight to justify it.

### 7. Schema

Three tables in a new `notifications` schema:

```
notifications.notifications
  id                    uuid PK
  org_id                uuid (RLS)
  recipient_principal_id uuid
  category              text
  payload               jsonb
  deep_link             text
  dedup_key             text
  dedup_count           int default 1     -- incremented when a duplicate is suppressed
  read_at               timestamptz null
  dismissed_at          timestamptz null
  created_at            timestamptz default now()
  index (org_id, recipient_principal_id, created_at desc)
  index (org_id, category, dedup_key, created_at desc)  -- for dedup lookup
  RLS: org_id = current setting

notifications.delivery_outbox
  id                    bigint PK
  notification_id       uuid FK → notifications.id
  org_id                uuid (RLS)
  channel               text  -- 'email' | 'webhook'
  target                text  -- email address or webhook URL, snapshotted
  attempt_count         int default 0
  next_attempt_at       timestamptz default now()
  delivered_at          timestamptz null
  failed_at             timestamptz null
  last_error            text null
  created_at            timestamptz default now()
  index (next_attempt_at) where delivered_at is null and failed_at is null
  RLS: org_id = current setting

notifications.principal_preferences
  principal_id          uuid PK part
  category              text  PK part
  enabled               bool default true
  channels              text[]  -- override; empty array means use org/category default
  webhook_url           text null
  updated_at            timestamptz
  RLS: org-scoped via principal lookup
```

Plus an org-scoped table for org-level configuration:

```
notifications.org_email_config
  org_id                uuid PK
  smtp_host             text
  smtp_port             int
  smtp_secret_arn       text  -- ARN reference to Secrets Manager
  from_address          text
  reply_to_address      text null

notifications.org_category_defaults
  org_id                uuid PK part
  category              text  PK part
  channels              text[]
```

Migration: V20 (next available; V19 was the per-reference `connection_package` column).

### 8. Retention

Per NF11.5: notification history retained for 90 days. A scheduled cleanup task (existing platform cron, not Temporal) deletes rows where `created_at < now() - interval '90 days'`. Outbox rows are deleted when their parent notification is deleted (FK cascade), or earlier once `delivered_at IS NOT NULL` and older than 7 days (no audit value beyond that).

Audit log entries for notification events (e.g. classification change notification sent, governance approval requested) live in the existing `audit.audit_log` table per the standard append-only audit pattern, *not* in the notifications tables. Notifications are operational; audit is the immutable record. They are separate.

### 9. Performance and scale assumptions

- A single org is expected to produce at most ~10k notifications/day in steady state (most products do not breach SLOs daily; access requests are sporadic).
- Delivery worker runs every 30 seconds; with email at NF11.2's 5-minute budget, this gives ample headroom.
- The in-platform notification center query (NF11.4: load within 1 second) is served by the indexed `(org_id, recipient_principal_id, created_at desc)` lookup. No caching layer needed at MVP.

If usage exceeds these assumptions, the worker can be parallelized by partitioning the outbox by `org_id % N`. Not built in at MVP.

---

## Consequences

### Positive

- **Trigger modules stay lean.** Each module knows what events it produces and who the recipients are. The notification module knows everything else. This is the right encapsulation.
- **Reuses the proven outbox pattern.** Same shape as `consent.connection_reference_outbox`, same delivery guarantees, same operational model. Less novel infrastructure.
- **SMTP-pluggable means no provider lock-in.** Open-source consumers can use any SMTP server. AWS deployments use SES via SMTP. Self-hosted dev uses MailHog. Same code path for all.
- **Dedup at enqueue time prevents duplicate side effects.** A deduped notification produces no email and no webhook call, not just no extra inbox row. This matches user expectation.
- **Snapshot recipients at trigger time gives audit-correct semantics.** Notification reaches the principal who held the role at the moment of the event, even if the role moves later.
- **Retry mechanics are simple and inspectable.** A SQL query against `delivery_outbox` shows what's pending, what's failing, and why. No black-box workflow runtime to debug.

### Negative

- **Per-org SMTP configuration adds operational surface.** Each org must configure SMTP before any email is sent. Mitigated by a platform-level fallback for dev and demo, and by clear UI in the org settings page.
- **Outbox table grows unbounded between cleanup runs.** With 10k notifications/day per org and ~3 channel rows per notification, that's ~900k rows/month per org. Bounded by the cleanup task; partitioning is a future option if it becomes a problem.
- **Recipient snapshot can deliver to an inactive principal.** If a principal is deactivated between trigger and delivery, the notification still goes out. Mitigated by checking principal active status at delivery time and skipping inactive principals (logged as a delivery skip, not a failure).

### Risks

- **Retry storms on a webhook outage.** If a principal's webhook is down, every notification for that principal accrues 3 retry attempts before being marked failed. With a category fan-out across many principals, the worker could spend its time on doomed retries. Mitigated by the per-target failure marker — once a target has failed N consecutive times, future deliveries to that target are short-circuited until the principal updates their config.
- **SMTP credential leakage.** Storing SMTP credentials only as Secrets Manager ARNs is the right pattern, but the worker must fetch them on each delivery. A bug that logs the resolved credentials would be a security incident. The transport layer must never log resolved credentials, and unit tests should verify a credential placeholder never appears in log output.
- **Under-dedup-ing or over-dedup-ing.** A category whose `dedup_key` is too coarse will collapse meaningful distinct events into one notification (loss of signal). A key too fine will fail to dedup at all (notification fatigue). Mitigated by reviewing the dedup_key choice for each trigger as it is wired; it is part of the trigger PR review checklist.

---

## Alternatives Considered

### 1. Synchronous delivery from the trigger

Each trigger module calls SMTP / webhook directly inside its own transaction.

**Rejected because:** SMTP and webhook latency are unbounded. Holding the trigger transaction open for the duration of a 5-second SMTP handshake plus a 30-second webhook timeout is unacceptable for the trigger module's own SLO. Also fails the F11.1 decoupling requirement.

### 2. Direct Redpanda topic per category, no outbox

Trigger modules publish directly to a per-category Redpanda topic; channel workers consume the topics and deliver.

**Rejected because:** breaks the transactional guarantee. A trigger that commits but fails to publish to Redpanda silently drops the notification. The outbox pattern preserves the "commit happened iff notification will be delivered" invariant. Also adds operational complexity for a load that does not require Redpanda's throughput.

### 3. Temporal workflow per delivery

Each notification spawns a Temporal workflow that owns retry, scheduling, and channel fan-out.

**Rejected because:** Temporal is overkill for a 3-attempt retry with fixed backoff. The retry mechanics are 4 lines of SQL. Temporal earns its keep when steps are long-running, branchy, or require human-in-the-loop — none of which apply here. A `next_attempt_at` column is sufficient.

### 4. Lazy recipient resolution at delivery time

Trigger modules pass a "recipient resolver" function or recipient query, not a list. The worker runs the resolver at delivery time.

**Rejected because:** breaks audit semantics. The right answer to "who should receive this notification" is "whoever held the role at the moment of the event," not "whoever holds it now, possibly hours later." Eager resolution is also dramatically simpler — no executable resolver embedded in the queue.

### 5. Per-principal notification preferences in Keycloak

Use Keycloak user attributes for notification preferences instead of a platform table.

**Rejected because:** Keycloak attribute updates require an admin API round trip per change, and the Keycloak Admin API user-update gotcha (full-replace, GET-merge-PUT pattern, see CLAUDE.md) makes this unnecessarily fragile. Notification preferences are platform data, not identity data. The platform table is the right home.

---

## References

- PRD Domain 11 (F11.1–F11.27) — full notification requirements
- PRD Domain 12 F12.10 — connection reference request notification fan-out (consumes this service)
- ADR-007 — connection reference state propagation, the outbox pattern this ADR reuses
- CLAUDE.md — module boundary rule, Secrets Manager ARN credential rule, Keycloak Admin API GET-merge-PUT pattern
- `apps/api/src/consent/entities/connection-reference-outbox.entity.ts` — reference implementation of the outbox pattern
