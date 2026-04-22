# ADR-006: Runtime Scope Enforcement Strategy

**Date:** April 21, 2026
**Status:** Proposed
**Author:** Provenance Platform Team

---

## Resolves

PRD Domain 12 Architectural Open Question **AQ1** — How does scope enforcement integrate with the existing OPA policy evaluation path?

---

## Context

F12.16 requires that at the time of every agent action against a product, the platform shall verify that an active connection reference exists for that agent-product pair and that the action falls within the declared and approved scope of that reference. Actions exceeding the declared scope are denied, logged with a scope-violation marker, and surfaced to the owning principal and governance team.

NF12.2 bounds the performance impact: runtime scope enforcement overhead shall not increase the agent query path p95 latency beyond 50ms above the baseline targets (single-product query under 2s p95, 10-product federated query under 10s p95). The existing policy evaluation overhead budget (NF6.4) is 200ms p99 across the board.

Three design questions need architectural answers:

1. **Where in the request path does enforcement run?** Options include the API gateway (Kong), the Agent Query Layer middleware, the OPA policy evaluator, or the control plane Access Control API.
2. **What is the data source for enforcement decisions?** Options include a PostgreSQL query per request, an OPA policy bundle rebuilt on every state change, or an in-memory cache with event-driven invalidation.
3. **How is scope matching expressed?** A declared scope names ports, data categories, and a use-case category. An incoming action names a port and operation. The scope match function must be well-defined, fast, and auditable.

The platform has an existing policy evaluation pattern (OPA sidecar, Rego policies, hot reload on policy publish). The temptation is to model everything as OPA policy. This ADR decides where that pattern applies and where it does not.

---

## Decision

Enforce runtime scope at the Agent Query Layer, using an in-memory cache as the primary data source, with OPA consulted only for governance-authored rules about the enforcement itself (not for per-reference evaluation).

### Enforcement Location: Agent Query Layer Middleware

Enforcement runs in a new NestJS guard in `apps/agent-query/src/auth/` placed in the request lifecycle after JWT validation (ADR-002) and before tool dispatch. Specifically:

1. JWT validation guard extracts verified `agent_id` and `org_id`.
2. Tool call payload is parsed to extract `product_id` and requested action scope.
3. Connection reference guard (new) verifies an active reference exists for the `(agent_id, product_id)` pair and that the action scope is a subset of the declared scope.
4. Existing trust classification guard (F6.3) handles the Observed/Supervised/Autonomous logic.
5. Tool dispatch.

Denials at step 3 return an MCP error with a distinct error code (`CONNECTION_REFERENCE_SCOPE_VIOLATION` vs `CONNECTION_REFERENCE_NOT_FOUND` vs `CONNECTION_REFERENCE_EXPIRED`) so that agent developers and audit tooling can distinguish failure modes.

### Data Source: In-Memory Cache with Event-Driven Invalidation

The Agent Query Layer maintains an in-memory map keyed by `(org_id, agent_id, product_id)` with the currently active connection reference as the value. Cache operations:

| Event | Action |
| --- | --- |
| Agent Query Layer startup | Cold load of all currently active references for the org from PostgreSQL via control plane |
| Enforcement check | Read-only lookup on the in-memory map; no PostgreSQL hit on the hot path |
| Cache miss on enforcement | Fall back to a single PostgreSQL query through the control plane, backfill the cache, proceed |
| Connection reference state transition (create, activate, suspend, revoke, expire) | Redpanda event on `connection_reference.state` triggers cache update |
| Agent Query Layer replica restart | Cold load repeats; briefly elevated PostgreSQL traffic but bounded |

The cache is authoritative for the hot path. PostgreSQL is authoritative for state. The Redpanda topic is the invalidation channel that keeps the two aligned. Full propagation analysis is in ADR-007.

### Scope Match Function

Scope matching is a structural subset check, not an OPA policy evaluation:

- **Declared scope** on an active connection reference contains: port identifiers authorized, data category identifiers authorized (if declared), and the approved use-case category.
- **Action scope** on an incoming tool call contains: the target port, the data categories the action will read, and the action type.
- **Match rule:** action.port ∈ declared.ports AND action.data_categories ⊆ declared.data_categories AND action.type compatible with declared.use_case_category (per governance-defined taxonomy).

The match function runs in under 1ms on the cached data structure. It is implemented as plain TypeScript in the guard, not as Rego. The rationale for keeping this out of OPA is in the Alternatives section.

### OPA's Role in Connection Reference Enforcement

OPA continues to be consulted for two classes of decisions, both of which are governance-authored rules rather than per-reference evaluation:

1. **Governance override rules at activation (F12.14):** when an owning principal approves a connection reference, OPA evaluates whether governance policy requires additional sign-off before the reference transitions to Active. This is a policy question (should this class of reference require governance review), not a per-reference data question.
2. **Request routing rules by classification (F12.9):** Observed agents may not initiate requests; Supervised agents must hold pending oversight acknowledgment; Autonomous agents proceed direct to owner. These are governance-extensible rules — an organization may add custom rules like "Model Training use cases always require governance review." OPA evaluates them at request submission time.

These evaluations happen at state transition time (creating, approving, or activating a reference), not on the hot path. Their latency budget is governed by NF12.1 (consent capture under 5 seconds) and NF6.4 (policy evaluation under 200ms p99), not NF12.2.

Per-reference, per-action enforcement on the hot path never goes through OPA. See Alternatives for why.

### Cache Sizing and Memory Budget

At MVP scale (hundreds of agents per org, under 10,000 active connection references per org in steady state), the cache is estimated at under 10 MB per org per Agent Query Layer replica. The t3.medium that hosts the Agent Query Layer in the MVP has 8 GB of RAM; headroom is ample.

At production scale (hundreds of thousands of active references per org), the cache design may need revisiting — options include partitioning by agent_id, lazy loading with a smaller warm cache, or offloading to a Redis sidecar. These are Phase 6 decisions tracked in "Scale Considerations" below; the MVP in-memory cache is correct for the MVP scale.

---

## Implementation Plan

### Phase 1: Guard skeleton and enforcement logic

1. **New NestJS guard** in `apps/agent-query/src/auth/connection-reference.guard.ts` applied to all MCP tool endpoints after the JWT guard and before the trust classification guard.
2. **Scope match function** in `apps/agent-query/src/auth/scope-match.ts` with unit tests covering subset checks, mismatch cases, and boundary conditions.
3. **Denial error codes** defined in `packages/types/src/errors.ts` for the three failure modes.
4. **Audit log writes** on every denial through the existing audit log service.

### Phase 2: In-memory cache

5. **Cache service** in `apps/agent-query/src/cache/connection-reference-cache.service.ts` with get, set, invalidate, and cold-load operations.
6. **Cold load on startup** pulling all active references for every org the Agent Query Layer serves, via the control plane API.
7. **Cache miss fallback** querying the control plane API for a single `(agent_id, product_id)` pair, with result backfilling.

### Phase 3: Event-driven invalidation

8. **Redpanda consumer** in `apps/agent-query/src/cache/connection-reference-consumer.service.ts` subscribing to `connection_reference.state` and updating the cache on every event.
9. **Control plane producer** in `apps/api/src/access/connection-reference/connection-reference-events.service.ts` publishing events on every state transition, within the same database transaction as the state change (transactional outbox pattern).
10. **Redpanda topic configuration** for `connection_reference.state` with 7-day retention (bounded because the cache cold-loads on startup — events only need to cover the gap).

### Phase 4: OPA integration for activation-time rules

11. **New OPA policy bundle** `connection_reference.rego` with rule stubs for governance override at activation and request routing by classification. Ships with default-allow rules; governance can override.
12. **OPA evaluation hook** in the connection reference creation and approval paths in the Access Control API.

---

## Consequences

### Positive

- **Hot path latency is under 1ms additional.** The in-memory cache lookup plus the scope match function do not materially affect the existing query path. NF12.2 (50ms budget) has ample headroom.
- **Enforcement is isolated in a guard.** Testing, observability, and future modifications are localized to one file.
- **Distinct denial codes enable better agent UX.** Agent developers can distinguish "I never had consent" from "my consent expired" from "I asked for something outside my consent" without additional API calls.
- **OPA is used for what OPA is good at.** Governance-authored rules about when to require governance review or how to route requests by classification are policy questions, which is OPA's native domain. Per-reference data lookups are not policy questions, and treating them as such would abuse the tool.
- **The model scales cleanly to production.** The cache becomes a Redis sidecar, the Redpanda topic becomes MSK, the Agent Query Layer scales horizontally. All service boundaries remain the same.

### Negative

- **Cache coherence complexity.** The cache is correct only if Redpanda events are delivered reliably and in order. Mitigated by the transactional outbox pattern (ADR-007) and by the PostgreSQL fallback on cache miss, which guarantees correctness even if events are lost (at a latency cost).
- **Cold start latency spike.** Agent Query Layer replicas perform a cold load on startup. At MVP scale this is under 100ms for the expected reference count; at production scale this will need attention.
- **Two data paths for state.** PostgreSQL is authoritative; Redpanda carries events; the cache is derived. Ensuring they stay consistent is an operational concern, not a correctness concern (the fallback preserves correctness), but divergence will show up as cache thrash and elevated PostgreSQL load, and must be monitored.
- **The rejection of OPA for per-reference evaluation creates an inconsistency.** Developers may expect every authorization decision to go through OPA because that is the pattern for access grants, policy compliance, and trust classification. This ADR documents the distinction so the inconsistency is legible.

### Risks

- **Cache staleness during Redpanda outage.** If the Redpanda broker is unavailable, new state transitions still land in PostgreSQL (via the transactional outbox), but the cache will not update. Mitigated by the control plane also exposing a force-invalidate endpoint that the admin can trigger, and by cache entries having a TTL (default 24 hours) so staleness is bounded even without event delivery.
- **Thundering herd on cold start.** If multiple Agent Query Layer replicas restart simultaneously (e.g., deployment), they all cold-load from the control plane at once. Mitigated by the cold load being a single query per org, not per reference, and by MVP running only one Agent Query Layer process. Production scale will need backoff.
- **Scope match function divergence from OPA semantics.** Governance teams expect authorization logic to be auditable via OPA decision logs. Moving scope match out of OPA means decisions are not in the OPA log. Mitigated by writing an audit log entry at denial time that captures the full inputs and outputs of the scope match, so audit completeness is preserved even though the evaluator is different.

---

## Scale Considerations (Phase 6 and Beyond)

This ADR describes the MVP implementation. At production scale, the following revisions are anticipated and should be tracked as Phase 6 work:

- **In-memory cache replaced by Redis.** A shared Redis cluster reduces cold-load fanout and allows multiple Agent Query Layer replicas to share cache state. Cost: ~$50-150/month for AWS ElastiCache.
- **Transactional outbox replaced by CDC from Aurora.** Debezium or AWS DMS captures state changes directly from the database write-ahead log, removing the need for application-level event publishing. Reduces the window of potential inconsistency.
- **Scope match function considered for OPA.** If governance teams demand scope match decisions appear in OPA decision logs for compliance, the function can be re-implemented in Rego with the cached reference data passed in as input. This is a reversible decision.
- **Cache partitioning by agent activity.** Hot-path cache limited to references active in the last N days; cold references loaded on demand.

None of these are required for MVP and none should be implemented speculatively.

---

## Alternatives Considered

### 1. Enforce at Kong (API gateway)

Kong evaluates the connection reference before the request reaches the Agent Query Layer.

**Rejected because:** Kong does not have cheap access to PostgreSQL or the in-memory cache maintained by the Agent Query Layer. Kong plugins for custom auth logic are possible but require either a Lua plugin (operational complexity) or a call out to a validator service (adds a network hop to the hot path). The Agent Query Layer is already stateful in the MCP protocol sense (SSE session) and already holds the authenticated identity context from the JWT guard, making it the natural place to add enforcement. Kong remains responsible for TLS termination, rate limiting, and JWT signature verification at the gateway layer; authorization decisions happen behind it.

### 2. Enforce purely via OPA on every action

Model connection references as OPA data, push the current set of active references into an OPA data bundle, and evaluate every action against an OPA policy that consults the bundle.

**Rejected because:** OPA's data bundle model is designed for policy data that is small and slow-changing (policy rules, classification taxonomies, compliance thresholds). Active connection references are large (scales with agents and products) and fast-changing (every create, approve, expire, revoke event). Pushing every state change into an OPA bundle rebuild would either require bundle rebuilds every few seconds (operationally expensive and defeats OPA's caching) or accept invalidation latency that violates NF12.3 (10-second revocation propagation). Additionally, OPA evaluation adds a network hop per decision (the OPA sidecar is an HTTP call), which consumes more of the NF12.2 budget than necessary for a decision that is structurally a map lookup plus a subset check.

### 3. Enforce via a synchronous PostgreSQL query on every action

Skip the cache. Every agent action performs a PostgreSQL query to verify the connection reference exists and matches the action scope.

**Rejected because:** at MVP scale this adds 5-20ms of latency per action (network round trip plus query time), which is acceptable. But the query load scales linearly with agent query volume. At 10,000 concurrent agent query sessions per org (NF6.3) and modest per-session activity, this produces sustained PostgreSQL load dedicated entirely to authorization lookups, which is avoidable with caching and will become a production scaling bottleneck. Building the caching infrastructure now, when the system is simple, is cheaper than retrofitting it later.

### 4. Enforce at the control plane Access Control API

The Agent Query Layer calls the Access Control API on every action to authorize.

**Rejected because:** this is the same latency profile as alternative 3 (PostgreSQL query) plus an additional HTTP hop. It also couples the Agent Query Layer's availability to the control plane's availability for the hot path, which violates NF6.2 (MCP endpoint 99.99% availability independent of control plane). The cache-plus-event model decouples them: the Agent Query Layer can continue serving requests from cache even if the control plane is briefly unavailable.

### 5. Store scope match logic in Rego but evaluate inline

Write the scope match function in Rego but run it in an embedded OPA evaluator inside the Agent Query Layer process rather than the sidecar.

**Rejected because:** this adds Rego as a dependency of the hot path without gaining the benefit of the sidecar's hot-reload and governance-authored policies. The scope match function is platform-defined behavior, not governance-authored policy — it is a subset check, not a policy decision. Expressing it in Rego makes it harder to unit-test and adds a runtime dependency with no corresponding benefit.

---

## References

- PRD Domain 12: F12.16 (scope enforcement), NF12.2 (latency budget), F12.14 (governance override at activation), F12.9 (request routing by classification)
- PRD Domain 6: NF6.2 (MCP availability independent of control plane), NF6.4 (policy evaluation under 200ms p99)
- ADR-002 (JWT authentication, the preceding guard)
- ADR-005 (connection reference composition primitive)
- ADR-007 (state propagation, the source of cache invalidation events)
- OPA policy evaluation documentation: `documents/architecture/Provenance_Architecture_v1.4.md` Section 3 (MVP Governance Architecture)
- Transactional outbox pattern: Chris Richardson, *Microservices Patterns*, Chapter 3
