# ADR-007: Connection Reference State Propagation

**Date:** April 21, 2026
**Status:** Proposed
**Author:** Provenance Platform Team

---

## Resolves

PRD Domain 12 Architectural Open Question **AQ2** — How is connection reference state replicated to enforcement points within the revocation propagation window?

---

## Context

ADR-006 established that runtime scope enforcement reads from an in-memory cache at the Agent Query Layer, with PostgreSQL as the authoritative store and an event channel keeping the cache aligned. This ADR decides how state transitions propagate through that channel and how the platform meets the associated non-functional requirements without new paid infrastructure.

The NFRs driving this decision:

| Requirement | Behavior |
| --- | --- |
| NF12.3 | Revocation propagates to all enforcement points within 10 seconds |
| NF12.4 | Automatic expiration takes effect within 60 seconds of the expiration timestamp |
| NF12.7 | Connection reference request notification reaches the owning principal within 30 seconds |
| NF12.8 | MAJOR version publication triggers automatic suspension of affected references within 60 seconds |

Three mechanisms are needed:

1. **Event propagation** for cache invalidation — a state change in PostgreSQL needs to reach every Agent Query Layer replica's cache fast enough to meet NF12.3.
2. **Scheduled state transitions** — automatic expiration (F12.22) and MAJOR-version-triggered suspension (F12.15) need to fire on time without requiring a human to initiate them.
3. **In-flight operation handling** — revocation during an in-flight agent operation must transition that operation to the frozen state per F12.19 and the existing frozen-state model (F8.1).

The platform already has Redpanda for event streaming and Temporal for workflow orchestration on the MVP infrastructure. The decision is whether those are sufficient for Domain 12 or whether additional infrastructure is warranted.

---

## Decision

Use the existing Redpanda broker for cache invalidation events and the existing Temporal deployment for scheduled state transitions. No new paid infrastructure is required for Domain 12 state propagation.

### Event Propagation via Redpanda

A new Redpanda topic `connection_reference.state` carries every state transition event. The Access Control API publishes events using the transactional outbox pattern: the PostgreSQL transaction that performs the state change also inserts a row into an outbox table in the same transaction, and a dedicated publisher process reads from the outbox and publishes to Redpanda.

**Event shape:**

| Field | Purpose |
| --- | --- |
| connection_reference_id | Identifier of the reference whose state changed |
| org_id | For consumer-side routing and RLS |
| agent_id | For cache key construction |
| product_id | For cache key construction |
| new_state | One of: Pending, Active, Suspended, Expired, Revoked |
| previous_state | For consumer validation and debugging |
| scope | Full approved scope snapshot; present when new_state is Active, null otherwise |
| use_case_category | For diagnostic and monitoring purposes |
| transitioned_at | Timestamp of the state change |
| caused_by | Enum: principal_action, governance_action, automatic_expiration, major_version_suspension, grant_revocation_cascade |

The payload is small (under 1 KB per event) and the event volume is bounded by the rate of state transitions, which is governance-scale, not query-scale. At MVP and expected early production scale, this is well under 100 events per day per org.

**Topic configuration:**

- Partitioning by `org_id` for ordered delivery per tenant
- Retention: 7 days (events only need to cover Agent Query Layer startup cold-load gap; cache is authoritative after cold-load)
- Replication factor: 1 at MVP (single-broker Redpanda), increased in production
- Consumer group: `agent-query-connection-reference-cache`

**Consumer behavior at the Agent Query Layer:**

On every event, the consumer updates the in-memory cache keyed by `(org_id, agent_id, product_id)`. For Active events, the reference is written to the cache. For Suspended, Expired, or Revoked events, the cache entry is removed. For Pending events, no cache action is taken (Pending references are not enforceable). The consumer commits offsets after successful cache update.

### Transactional Outbox for Publisher Reliability

The write path for a state transition is:

```
BEGIN;
  UPDATE consent.connection_references SET state = $new_state WHERE id = $ref_id;
  INSERT INTO consent.outbox (event_type, payload, created_at)
    VALUES ('connection_reference.state', $event_json, now());
  INSERT INTO audit.audit_log (...);
COMMIT;
```

A separate background publisher process (running as a NestJS module in the modular monolith) polls `consent.outbox` for unpublished events, publishes them to Redpanda, and marks them published. Published rows are retained 7 days for replay capability, then deleted by a nightly cleanup job.

This pattern guarantees that:

- A state transition is never committed to PostgreSQL without an event being queued.
- An event is never published without the corresponding state change being durable.
- If Redpanda is unavailable, state transitions still succeed; events accumulate in the outbox and publish when Redpanda recovers.
- If the publisher crashes mid-publish, events publish at-least-once on restart; consumers must be idempotent (the cache consumer is — setting the same active reference twice is a no-op).

The outbox is a standard pattern with established correctness properties and does not require new infrastructure.

### Scheduled State Transitions via Temporal

Two classes of automatic state transitions are needed: expiration (F12.22) and MAJOR-version suspension (F12.15). Both run as Temporal workflows.

**Expiration workflow:**

- Started when a connection reference transitions to Active.
- Sleeps until the expiration timestamp.
- On wake, calls the Access Control API to transition the reference to Expired.
- The API call goes through the same transactional outbox path as principal-initiated transitions, publishing the cache invalidation event.
- Self-terminates.

Temporal's workflow durability guarantees that the timer persists across platform restarts, satisfying NF8.2 (frozen operations remain durable across platform restarts) applied analogously to expiration timers.

**MAJOR version suspension workflow:**

- Started when a product publishes a new MAJOR version (event consumed from the existing product lifecycle event topic).
- Queries all Active connection references for the affected product.
- For each, calls the Access Control API to transition to Suspended with `caused_by = major_version_suspension`.
- Fans out notifications to owning principals and agent oversight contacts via the notification service (Domain 11).
- The workflow target is completion within 60 seconds (NF12.8); with the expected reference count per product (dozens, rarely hundreds), this is achievable with straightforward serial processing. Parallel processing can be added if future scale requires it.

Temporal's worker pool handles both workflow types with the existing infrastructure. The workflow definitions are added to `apps/api/src/workflows/` alongside existing grace period and deprecation workflows.

### Revocation and In-Flight Operations

F12.19 requires that principal-initiated revocation transitions in-flight operations to the frozen state (F8.1). The existing frozen-state mechanism (established in Phase 4) is reused directly:

1. Principal invokes revocation via the UI or API.
2. Access Control API marks the reference as Revoked in PostgreSQL within a transaction; publishes the event via the outbox.
3. Access Control API queries the operations registry for in-flight operations authorized by the revoked reference (identified by the reference ID carried in the operation's provenance context, F12.18).
4. For each in-flight operation, invoke the existing frozen-state transition path from F6.3c, passing the revocation event as the trigger.
5. Governance is notified of the frozen operations per existing Domain 8 behavior.

The Agent Query Layer's cache invalidates via the Redpanda event, preventing new operations under the revoked reference from being authorized. In-flight operations are frozen through the existing mechanism, not reinvented for Domain 12.

### Access Grant Cascade Revocation

F12.21 requires automatic revocation of connection references when certain upstream conditions occur — the underlying access grant is revoked, the product is deprecated or decommissioned, or the agent or owning principal is no longer active.

Each of these triggers is already an event in the platform (grant revocation event, product lifecycle event, principal lifecycle event). The Access Control API subscribes to these event streams and, on each relevant event, queries for affected connection references and transitions them to Revoked with the appropriate `caused_by` marker. Each transition flows through the same outbox/Redpanda path, invalidating caches and firing notifications.

This is a cascade, not a re-implementation. The Access Control API is the only component that writes connection reference state; upstream events are translated into state transitions at this single choke point, preserving a clean mental model and a complete audit trail.

---

## Meeting the NFRs

**NF12.3 (revocation propagates within 10 seconds):** PostgreSQL transaction commit plus outbox publisher poll interval (100ms) plus Redpanda delivery latency (sub-second at MVP scale) plus consumer cache update (sub-millisecond) sums to well under 2 seconds end-to-end. The 10-second budget has ample headroom for operational noise, broker rebalances, or network blips.

**NF12.4 (expiration within 60 seconds of timestamp):** Temporal timer resolution is within seconds. The expiration workflow wakes on the timer, issues the API call (sub-second at MVP scale), the state transition publishes via outbox, and caches update. Total latency is bounded by outbox publisher poll interval plus Redpanda delivery plus consumer update, same analysis as NF12.3.

**NF12.7 (notification within 30 seconds):** Request submission writes to PostgreSQL and publishes a notification event via the existing notification service path. The notification service consumes the event and dispatches via the configured channels. In-platform delivery is immediate; email depends on SMTP/SES; webhook depends on the receiver. The 30-second budget applies to in-platform and typical email; webhook SLAs are outside our control and documented as such.

**NF12.8 (MAJOR version suspension within 60 seconds):** Product lifecycle event publishes to the existing product event topic; the MAJOR version suspension workflow consumes it, queries affected references, and fans out transitions. With tens of references per product, serial processing completes within seconds. With hundreds, parallel fan-out within the workflow keeps completion well under the 60-second budget.

All four NFRs are met on existing MVP infrastructure. No new paid services are required for Domain 12 propagation.

---

## Consequences

### Positive

- **No new paid infrastructure at MVP.** Redpanda, Temporal, and PostgreSQL are already deployed and operational. Domain 12 adds topics, workflows, and a schema — not new services to pay for, secure, and monitor.
- **The propagation model is consistent with existing patterns.** Transactional outbox is used for other event publishing paths; Temporal is used for other scheduled workflows; the Redpanda consumer pattern matches the existing product lifecycle event consumer. Developers familiar with the codebase recognize the pattern immediately.
- **Durability guarantees are strong.** Every state transition is atomic with its event publication (transactional outbox) and with its audit log entry (same transaction). No state transition exists without a corresponding event and audit record.
- **In-flight operation handling reuses existing frozen-state mechanics.** No new state machine to design, no new governance disposition UI, no new audit category. F8.1 covers the mechanics; Domain 12 just extends the trigger list.
- **The MVP implementation maps cleanly to production.** Redpanda becomes MSK, Temporal self-hosted becomes Temporal Cloud, the outbox pattern continues to work unchanged. No throwaway code.

### Negative

- **Outbox publisher is a new background process.** It must be monitored, its polling interval tuned, and its failure modes understood. The alternative (synchronous publish from within the transaction) has weaker correctness guarantees and is rejected in Alternatives.
- **Cache consistency depends on event delivery.** If Redpanda is unavailable for an extended period and the cache TTL expires, enforcement falls back to PostgreSQL queries, elevating database load. Mitigated by the Redpanda single-broker being extremely reliable at MVP scale (uptime matches the EC2 instance itself) and by the fallback being correct if slow.
- **Two moving parts for every state transition.** The outbox publish and the workflow step (if any) must both succeed for correct behavior. Diagnostics tooling must expose both paths clearly for operators to reason about failures.

### Risks

- **Outbox table growth.** If the nightly cleanup job fails, the outbox accumulates rows. Mitigated by monitoring outbox size and by the cleanup job being idempotent and retryable.
- **Temporal workflow version drift.** Temporal workflows have versioning requirements — in-flight workflows must be compatible with the worker that resumes them. Mitigated by following Temporal's standard versioning conventions documented in the Temporal SDK.
- **Redpanda single-broker SPOF at MVP.** If the broker fails, new state transitions succeed but events queue in the outbox. On broker recovery, events publish and caches catch up. During the outage window, the Agent Query Layer's cache may serve stale data for references whose state changed during the outage. Mitigated by cache TTL (default 24 hours) bounding staleness and by the PostgreSQL fallback path. Production moves to multi-broker MSK.

---

## Scale Considerations

At current MVP scale (single EC2 monolith, single-broker Redpanda, self-hosted Temporal), the propagation model has significant headroom. The following trigger points would warrant revisiting:

- **Sustained state transition rate above 10/second per org.** This is roughly 100x the expected governance-scale rate. Would warrant dedicated partitioning and possibly a separate consumer group per Agent Query Layer replica.
- **Agent Query Layer replica count above 10.** Each replica maintains its own cache; cold-load fanout and event delivery to all replicas may need optimization. Redis-based shared cache (noted in ADR-006 scale considerations) addresses this.
- **MAJOR-version-suspension fan-out above 1000 references per product.** Serial processing in the Temporal workflow would exceed the 60-second NF budget. Parallel fan-out within the workflow is a straightforward extension.

None require action at MVP. All remain architecturally compatible with the decision in this ADR; they are tuning parameters, not structural changes.

---

## Alternatives Considered

### 1. Publish events directly from the transaction (no outbox)

The API handler commits the transaction and then publishes to Redpanda. Simpler, fewer moving parts.

**Rejected because:** this creates a dual-write problem. If the transaction commits but the Redpanda publish fails, the state change is visible in PostgreSQL but no invalidation event reaches caches — the cache serves stale data indefinitely until the TTL expires. At the 10-second NF12.3 budget, this is unacceptable. The outbox pattern eliminates this class of failure by making the event publication atomic with the state change.

### 2. Poll PostgreSQL from the Agent Query Layer

The Agent Query Layer polls PostgreSQL for state changes instead of consuming events. Polling interval set to 5 seconds to meet NF12.3.

**Rejected because:** every poll is a query load on PostgreSQL proportional to replica count times poll frequency times active reference count. At 10,000 active references and 5-second polling, this is sustained load for no correctness benefit over the event-driven model. The event-driven model scales with state change rate (low); the polling model scales with active reference count (higher) and replica count. The event-driven model is also more responsive — events propagate in sub-second time, not 5-second intervals.

### 3. Use Postgres LISTEN/NOTIFY instead of Redpanda

PostgreSQL's built-in pub/sub primitive replaces Redpanda for this use case.

**Rejected because:** LISTEN/NOTIFY is not durable. If a consumer is offline or restarting when a notification fires, the notification is lost. At the 10-second NF12.3 budget, brief consumer unavailability could miss events and leave caches inconsistent. Redpanda provides durable delivery with consumer group semantics and replay, which are exactly what cache invalidation needs. Redpanda is already deployed, so this is not an additional infrastructure burden.

### 4. Schedule expiration via PostgreSQL-based job runner instead of Temporal

A simple cron-like table with `run_at` timestamps and a worker that polls it.

**Rejected because:** Temporal is already deployed for other scheduled work (grace periods, deprecation workflows). Adding a second scheduler would create two places to debug scheduled work, two places to monitor, and two places to reason about durability. Temporal's workflow durability and visibility tooling are significantly better than a rolled-own PostgreSQL scheduler. The marginal cost of adding Temporal workflow definitions is low because the runtime is already operational.

### 5. Rely on Temporal exclusively and skip Redpanda for events

Every state transition starts a Temporal workflow that propagates the change. No separate event channel.

**Rejected because:** Temporal workflows have meaningful startup overhead (tens of milliseconds to hundreds, depending on cluster load) that would consume significant NF12.3 budget. Temporal is optimized for workflows that live for seconds to days, not for high-frequency low-latency event fan-out. Redpanda is optimized for exactly that. Using each tool for its strength keeps the design legible.

---

## Cost Analysis

Per the architectural constraint established in this review, infrastructure decisions that increase monthly cost by more than $20 require deferral to Phase 6 unless the cost can be justified at the MVP scope. This decision does not add cost:

| Item | MVP Cost Impact |
| --- | --- |
| Redpanda broker | $0 — already deployed on existing t3.xlarge |
| New topic `connection_reference.state` | $0 — storage under 1 MB per day per org at expected rates |
| Temporal worker | $0 — already deployed; new workflow definitions add negligible CPU |
| New schema `consent` in PostgreSQL | $0 — existing EBS volume has ample headroom |
| Outbox publisher process | $0 — runs in the existing NestJS monolith |

The Phase 6 upgrade path preserves this structure with managed equivalents (MSK, Temporal Cloud, Aurora). Those costs are accounted for in the existing production architecture cost range ($2,400-$8,000/month per Section 4 of the architecture document) and are not incremental to Domain 12.

---

## References

- PRD Domain 12: F12.15 (MAJOR version suspension), F12.19 (principal-initiated revocation), F12.21 (automatic revocation triggers), F12.22 (expiration behavior), NF12.3, NF12.4, NF12.7, NF12.8
- PRD Domain 8: F8.1 (frozen workflow state), NF8.2 (frozen state durability)
- ADR-006 (runtime enforcement, the cache invalidation target of this propagation model)
- Transactional outbox pattern: Chris Richardson, *Microservices Patterns*, Chapter 3
- Temporal workflow versioning: https://docs.temporal.io/workflows#workflow-versioning
- Existing Redpanda topic configuration: `infrastructure/docker/config/redpanda/`
- Existing Temporal workflow patterns: `apps/api/src/workflows/`
