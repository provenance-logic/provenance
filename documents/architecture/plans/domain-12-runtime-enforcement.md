# Domain 12 Runtime Scope Enforcement — Implementation Plan

**Status:** Scoping (no code yet)
**Authors:** Architect agent (scoping pass), Matt McGarvey (review)
**Date:** 2026-05-08
**Supersedes:** Inline notes in `documents/prd/implementation-status.md` only — this is the first detailed implementation plan for the runtime-enforcement piece of Domain 12.

## Summary

This document plans the runtime scope enforcement piece of Domain 12 (Connection References and Per-Use-Case Consent). It is the last big remaining Open Source Readiness blocker. The data layer, REST surface, state-machine service, and notification fan-out have all shipped. What remains is the read-side hot path at the Agent Query Layer: every MCP tool call must verify, in the request critical path, that the calling agent has both an active access grant and an active connection reference whose approved scope covers the requested action.

ADR-006 (runtime scope enforcement) and ADR-007 (state propagation via Redpanda) cover roughly 70% of what an implementer needs. This plan stays inside that frame and calls out the gaps the ADRs do not resolve — notably the connection-reference scope payload schema, the action-to-scope mapping for the 9 MCP tools, the cold-cache behavior on AQL boot, and whether `Suspended` is a distinct denial code.

The plan proposes a precursor PR (commit to the scope shape) plus a six-PR sequence, each independently reviewable by a non-developer. Implementation does not begin until decisions 1–4 below are locked.

## 1. Scope of this arc

**In scope.** The read-side hot path. Every MCP tool call at `apps/agent-query` must, after JWT validation, verify:

1. an active access grant exists for the agent-product pair;
2. an active connection reference exists for the agent-product pair;
3. the action falls within the connection reference's approved scope.

Denials must return one of four (or five — see decision 3) distinct error codes, write an audit entry, and fan out a notification on scope violation. The arc includes the in-memory cache, the Redpanda consumer for `connection_reference.state`, and a control-plane fallback endpoint for cache miss and cold load.

**Out of scope.** These are separable Domain 12 follow-ups, tracked in `documents/prd/implementation-status.md`:

- Automatic expiration via Temporal (F12.22)
- MAJOR-version suspension (F12.15)
- Governance override at activation (F12.14, F12.20)
- Legacy-agent migration (F12.25) — but a hard prerequisite for the flag flip in PR #6
- Supervised oversight-hold sub-state
- F12.21 cascade triggers other than grant-revoke (which already exists)
- Per-reference scope filtering on the package (ADR-008 scope inheritance)
- OPA policy bundle work for activation-time governance rules

## 2. Decisions required before implementation

### Decision 1: Connection reference scope payload schema

**Today:** `ConnectionReferenceScope` is typed as `Record<string, unknown>` in `packages/types/src/consent.ts`. The data layer accepts arbitrary shapes; the runtime-match function has nothing concrete to match against.

**Proposed:**

```typescript
type ConnectionReferenceScope = {
  ports: string[];                  // port names (or '*' for all output ports)
  data_categories: string[];        // PII, financial, operational, etc. (or '*')
  use_case_category: string;        // one of the 8 governance taxonomy categories
};
```

**Why this matters:** scope-match is meaningless without a committed shape. This blocks every PR in the sequence.

**Action:** lands as a precursor PR before the six-PR sequence. May warrant an ADR-006 amendment depending on review.

### Decision 2: Where access-grant enforcement lives

**Today:** there is no access-grant check in the Agent Query Layer. Every MCP tool delegates to a control-plane endpoint that already enforces row-level security and grant checks. ADR-005 mandates AND-not-OR composition; CLAUDE.md echoes that.

**Option (a) — recommended.** Both access grant AND connection reference checked at the AQL guard. Adds a second cache (`access-grant-cache`). Lets us return four distinct denial codes (`ACCESS_GRANT_NOT_FOUND`, `CONNECTION_REFERENCE_NOT_FOUND`, `CONNECTION_REFERENCE_EXPIRED`, `CONNECTION_REFERENCE_SCOPE_VIOLATION`) — which is what CLAUDE.md says we promise.

**Option (b).** AQL checks only the connection reference; access-grant enforcement remains the control plane's job. Simpler, single enforcement seam, but the AQL alone cannot distinguish "no grant" from "no reference" in its denial code.

**Recommendation:** option (a). The four-distinct-codes promise in CLAUDE.md is load-bearing for agent-developer experience.

### Decision 3: Should `Suspended` be a distinct denial code?

**Today's plan:** roll `Suspended` / `Expired` / `Revoked` into one code (`CONNECTION_REFERENCE_EXPIRED` — interpreted broadly as "no longer active").

**Alternative:** split out `CONNECTION_REFERENCE_SUSPENDED`, giving five denial codes total.

**Why split:** `Suspended` means "come back after the MAJOR-version re-consent lands." `Expired` and `Revoked` mean "you're done — submit a new request." These are different signals to an agent developer.

**Recommendation:** split. Cheap to add, much clearer for downstream agent code.

### Decision 4: Action-to-scope mapping for the 9 MCP tools

Each MCP tool needs a declared `actionScope` shape so the guard knows what to compare against. This is platform-defined.

| MCP tool | Bound to product? | Required scope |
|---|---|---|
| `list_products` | no (org-scoped discovery) | exempt |
| `get_product` | yes | `{port: discovery, action: read}` |
| `get_trust_score` | yes | `{port: observability, action: read}` |
| `get_lineage` | yes | `{port: discovery, action: read}` |
| `get_slo_summary` | yes | `{port: observability, action: read}` |
| `search_products` | no | exempt |
| `semantic_search` | no | exempt |
| `register_agent` | no (agent-self) | exempt |
| `get_agent_status` | no (agent-self) | exempt |

**Action:** review this table with Matt before PR #5 (the guard wiring) lands. Tweaks are cheap; the structure is what matters.

## 3. Components to add

All under `apps/agent-query/src/`:

- `auth/connection-reference.guard.ts` — runs after `auth.middleware` (JWT). Calls the cache, runs the scope match, decides allow/deny, emits the audit and notification on deny.
- `auth/scope-match.ts` — pure TypeScript subset check. No I/O. Heavily unit-tested.
- `auth/tool-scope-map.ts` — the action-to-scope mapping table from decision 4.
- `cache/connection-reference-cache.service.ts` — `Map<orgId, Map<\`${agentId}:${productId}\`, CachedReference>>`. `get`, `set`, `invalidate`, `coldLoad(orgId)`, `loadOne(orgId, agentId, productId)`. TTL per entry, default 24h per ADR-006.
- `cache/connection-reference-consumer.service.ts` — Kafka consumer subscribed to `connection_reference.state`, group `agent-query-connection-reference-cache`. Updates cache on every event.
- `cache/access-grant-cache.service.ts` — sibling cache for access grants (per decision 2 option a).

Under `apps/api/src/`:

- A control-plane endpoint pair the AQL calls on cache miss and cold load: `GET /internal/consent/connection-references/active?orgId&agentId&productId` (single) and `GET /internal/consent/connection-references/active?orgId` (cold load). Internal, service-token auth.
- An outbox publisher worker (`apps/api/src/consent/connection-reference-outbox.publisher.ts`) — already specified by ADR-007; the outbox table exists; the publisher does not yet.
- A Redpanda topic configuration entry for `connection_reference.state` in `infrastructure/docker/config/redpanda/`.

**No new tables.** `consent.connection_references` and `consent.connection_reference_outbox` cover this. An index `(org_id, agent_id, product_id, state)` may be added if explain plans show it's needed for the cold-load query — confirmed at implementation, not assumed.

## 4. Integration points and request flow

Order of checks per MCP tool call:

1. JWT validation (existing, ADR-002) → `(agentId, orgId)` attached to request.
2. Tool argument parse to extract `productId` (if applicable) and an `actionScope` derived from the tool name via `tool-scope-map.ts`. Exempt tools skip steps 3–5.
3. **Access grant check.** Cache lookup → control-plane fallback on miss. Deny code `ACCESS_GRANT_NOT_FOUND` if absent.
4. **Connection reference existence check.** Cache lookup → control-plane fallback on miss. Deny codes:
   - `CONNECTION_REFERENCE_NOT_FOUND` if absent
   - `CONNECTION_REFERENCE_EXPIRED` if state is `Expired` or `Revoked`
   - `CONNECTION_REFERENCE_SUSPENDED` if state is `Suspended` (per decision 3)
5. **Scope match.** Pure-function subset check. Deny code `CONNECTION_REFERENCE_SCOPE_VIOLATION` if action scope is not a subset of `approvedScope`.

Every deny path writes `audit.audit_log` with `action='connection_reference_denied'`, the deny code, the resolved scope, and the action scope. Per CLAUDE.md "never silent", scope-violation denials additionally call a control-plane endpoint that fans out a notification to the owning principal and the governance role. Other deny codes audit but do not notify.

## 5. Cache strategy

**Population.** Cold load on AQL startup pulls all currently-Active references for every org via the new internal endpoint. With single-process MVP, this is one query at boot.

**Invalidation.** Redpanda `connection_reference.state` consumer updates the cache on every event. `Active` events upsert; `Suspended` / `Expired` / `Revoked` events evict; `Pending` events are ignored.

**Cache miss.** The guard calls the control plane synchronously for that one `(agentId, productId)` pair, backfills the cache, proceeds. Bounded latency cost (5–20ms). This is the consistency safety net — it guarantees correctness even if Redpanda is silent.

**Consistency model.** PostgreSQL is authoritative; cache is eventually consistent with bounded staleness. Redpanda lag of seconds is tolerable per NF12.3 (10s revocation propagation budget). If lag exceeds the cache TTL (24h), the entry expires and the next request re-fetches. ADR-007 covers the durability story.

**Cold-cache MCP request.** If a tool call lands at second 0 of AQL boot before cold load completes, the guard treats the cache as empty and falls through to the control-plane fallback for that pair. Slower but correct. ADR-006 implies this but does not explicitly specify it — calling out here as the binding behavior.

**Multi-replica.** ADR-006 acknowledges thundering herd at scale but defers to Phase 6. MVP is single-replica AQL so non-issue. If we ever scale the AQL horizontally before Phase 6, this becomes urgent.

## 6. PR sequence

**Precursor (P0):** type `ConnectionReferenceScope` per decision 1, add Zod validator at request time. May include ADR-006 amendment. Reviewable as: types + tests, no behavioral change.

| # | PR | Depends on | Reviewable by non-dev? |
|---|---|---|---|
| 1 | Outbox publisher worker (ADR-007 Phase 3, step 9) — drains `consent.connection_reference_outbox` to Redpanda. Standalone; no AQL changes. | P0 | yes — observable: messages appear on the topic |
| 2 | Internal control-plane endpoints for `getActiveReference` and `coldLoad`, with service-token guard. OpenAPI updated. | P0 | yes — curl-able |
| 3 | AQL cache services (`connection-reference-cache`, `access-grant-cache`) + Redpanda consumer + cold-load on boot. No enforcement yet — purely populates a cache that nothing reads. Logged for observability. | 1, 2 | yes — log lines show population and invalidation |
| 4 | `scope-match.ts` + `tool-scope-map.ts` + unit tests. Pure function; comprehensive truth table. | P0 | yes — pure logic |
| 5 | `connection-reference.guard.ts` wired into MCP path with all denial codes, audit writes, and scope-violation notification fan-out. **Behind a feature flag** (`CONNECTION_REFERENCE_ENFORCEMENT_ENABLED`), default off. | 3, 4 | yes — flag flip is the demo |
| 6 | Flag flip after legacy-agent migration (F12.25) lands separately. | 5 + F12.25 | yes — observable behavior change |

PRs 1, 2, and 4 can land in any order after P0. PR 3 needs 1+2. PR 5 needs 3+4. PR 6 needs F12.25 to land first or it breaks every existing agent.

## 7. Test strategy

**Unit tests (PRs P0, 4, 3 in that order).**

- `scope-match` truth table: equal scope, action narrower, action broader (deny), action overlapping (deny), null approved scope (deny), unknown action type, action with no port. Target ≥95% branch coverage on the pure function.
- Cache service invariants: TTL eviction, idempotent Active upsert, no-op on Pending event, eviction on terminal states.

**Integration tests (PR 5).** In-process test harness spins API + AQL + a mock Keycloak + a real PostgreSQL + a real Redpanda. Scenarios:

- **AND-not-OR proof.** Four matrix cells (grant Y/N × reference Y/N). Three of four deny; one allows. Each denial returns the documented code.
- **Never-silent proof.** Induce a scope violation. Assert (a) audit log row exists with the violation marker, and (b) notification was enqueued. Both must hold or the test fails.
- **Transactional proof.** In `apps/api`, induce a transaction failure during a state transition (force the audit insert to throw); verify reference state, outbox row, and audit entry all roll back together. Re-run with a forced outbox-publisher crash; verify event publishes at-least-once on restart and consumer is idempotent.

**End-to-end (PR 5, behind flag).** Playwright run that registers an agent, submits a request, owner approves, agent calls a tool successfully; owner revokes, agent's next call denies with `CONNECTION_REFERENCE_NOT_FOUND` within 10s (NF12.3 budget proof).

**Latency proof (PR 5).** k6 or autocannon load test on a single tool, comparing baseline (flag off) vs. enforced (flag on). Assert delta p95 ≤ 50ms (NF12.2).

## 8. Open architectural questions deferred to implementation

These are not blockers for the precursor or the sequence to start, but should surface as the relevant PR opens:

- **Notification template for scope violations.** F12.10 covers request-time notifications; F12.16 implies notifications on violations but does not specify the recipient list or template. Recommend reusing the existing notification category with a new event type `connection_reference_scope_violation`, recipients = owning principal + governance role. Confirm with Matt at PR 5.
- **Service token rotation for the internal control-plane endpoints.** Same pattern as the existing seed token. Ensure rotation procedure is documented in `documents/runbooks/operations.md` when PR 2 lands.
- **Index on `consent.connection_references` for the cold-load query.** Add `(org_id, agent_id, product_id, state)` only if explain plans show it's needed at PR 2 or PR 3 implementation time. Do not pre-index speculatively.

## 9. Hard prerequisites and external dependencies

- **Decisions 1–4 locked** before P0 lands.
- **F12.25 (legacy-agent migration)** is a hard prerequisite for PR 6 (the flag flip). Without it, flipping the flag breaks every existing agent that has not yet been migrated to the connection-reference model. F12.25 is a separate arc tracked in `implementation-status.md`.
- **Redpanda topic** `connection_reference.state` must be configured before PR 1 publishes. Topic configuration lands as part of PR 1 itself.
