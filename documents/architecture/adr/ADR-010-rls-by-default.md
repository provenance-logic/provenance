# ADR-010: Row-Level Security as Backstop; Explicit-OrgId-Filter as Load-Bearing Tenant Isolation

**Date:** May 22, 2026
**Status:** Accepted (2026-05-23) — design adopted; implementation step 2 (`agents.service.ts` load-bearing fix) landed via the B-062 first-implementation PR. Steps 1 (ESLint rule), 3 (URL-param convention check), and 5 (smoke-test cross-tenant layer) still TBD; see [B-062](../../bugs/open.md#B-062) for the remaining-work checklist.
**Author:** Provenance Platform Team

---

## Resolves

[B-062](../../bugs/open.md#B-062) — Postgres row-level security policies were designed to be the load-bearing tenant-isolation layer, but the `provenance.current_org_id` session variable that the policies read is not reliably set on the connections that service-layer queries actually run on. The policies exist; the variable doesn't persist; the database-layer isolation guarantee the platform claims in CLAUDE.md is not in force on most service-layer queries today.

This ADR fixes the architectural question of *which layer carries the load* for tenant isolation, so that B-062's implementation work can begin without re-litigating the design.

---

## Context

The platform inherited a layered tenant-isolation design:

1. **JWT auth (Keycloak)** — every request carries `provenance_org_id` and `provenance_principal_id` claims, validated on every call.
2. **Controller-layer URL guard (B-061 fix, PR #140)** — `JwtAuthGuard` asserts `request.params.orgId === request.user.orgId`. Mismatched requests return 403 before reaching the service.
3. **Service-layer org filtering** — most service queries filter `WHERE org_id = ctx.orgId` explicitly, but coverage is not uniform.
4. **Database-layer RLS** — every tenant-scoped table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus a `CREATE POLICY ... USING (org_id = current_setting('provenance.current_org_id', true)::UUID)` policy.

Layer 4 is broken in a non-obvious way. `OrgContextMiddleware` (`apps/api/src/database/org-context.middleware.ts:15-25`) calls `dataSource.query("SELECT set_config('provenance.current_org_id', $1, true)", [orgId])`. The `true` is `is_local`, scoping the variable to the current transaction. But `dataSource.query` acquires a fresh pool connection, runs the `SET LOCAL` in an auto-commit transaction, and releases the connection back to the pool. The next service-layer query acquires a **different** pool connection, where the variable is unset. `current_setting('provenance.current_org_id', true)` returns NULL inside the RLS policy, and the policy's `USING (org_id = NULL::UUID)` evaluates to false — except that several service-layer queries go through TypeORM running as the table owner (`provenance`), which carries `BYPASSRLS` and skips the policy entirely.

Net: RLS is enabled, the session variable is set somewhere, neither end-to-end works.

The B-061 controller-layer guard closes the actual cross-org leak surface that mattered as of 2026-05-21. The platform is safe **as long as the guard is correct on every org-scoped route**. That's a reasonable invariant for the Open Source Ready milestone — but it's structural debt the project should be honest about.

### Survey of current service-layer behavior (2026-05-22)

Sampled the largest services and counted queries that explicitly include `orgId` in their `where` clause:

| Service | Org-filtered | Total queries | Coverage |
|---|---|---|---|
| `products.service.ts` | 13 | 13 | 100% |
| `governance.service.ts` | 17 | 20 | 85% |
| `access.service.ts` | 10 | 13 | 77% |
| `agents.service.ts` | 2 | 13 | 15% |
| `search/marketplace.service.ts` | n/a (intentionally cross-tenant by design; uses `resolvedOrgId` pattern) | — | — |

`products`, `governance`, and `access` already follow the explicit-filter pattern with high coverage. `agents.service.ts` is the outlier — most queries look up an agent by its globally-unique `agentId` without filtering on org. Most agent routes also do NOT carry `:orgId` in the URL (e.g. `PATCH /agents/:agentId/classification`), so the B-061 controller guard does not fire for them. The mitigation today is role-based authz at the controller (only agent operators in the agent's org should be calling these endpoints), but a forged or replayed JWT could lookup a foreign agent's record because the service-layer filter is absent.

So the platform-wide pattern of "explicit org filter at the service layer" is already nearly universal except in agents, where it isn't, and where RLS *would* catch it if RLS actually worked.

---

## Decision

### 1. Formalize the explicit-orgId-filter pattern as the load-bearing isolation layer

Every service-layer query against a tenant-scoped table MUST include `orgId = ctx.orgId` in its `where` clause. The org id is sourced from the request context (the JWT-validated claim, plumbed through to the service via the existing `RequestContext` pattern). Cross-tenant queries (marketplace, federation, platform-admin paths) MUST be explicitly named as such and use a different code path that does not extend the request's `ctx.orgId`.

This includes:

- **TypeORM repository calls:** `findOne`, `find`, `count`, `update`, `delete` — all where-clauses on tenant-scoped tables include `orgId`.
- **QueryBuilder calls:** `.where('org_id = :orgId', { orgId: ctx.orgId })` is required, not optional.
- **Raw SQL:** any `dataSource.query(...)` against a tenant-scoped table includes `org_id = $1` with the request's orgId as a parameter.

### 2. RLS stays in place, but is documented as a backstop — not load-bearing

`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and the existing `CREATE POLICY ...` statements remain. The CLAUDE.md security rule is updated to describe RLS as **defense in depth, contingent on per-request sticky-connection landing** (Phase 6 hardening, not MVP). Removing RLS now would lose an option for future hardening; leaving it in place without honesty about its current load-bearing status was the original B-062 issue.

### 3. Add CI enforcement of the explicit-filter pattern

A CI check (lint rule or grep) flags PRs that:

- Add new `findOne` / `find` / `count` / `update` / `delete` calls against tenant-scoped entities without an `orgId` field in the where clause.
- Add new `@Param('orgId')` references where the param name is NOT `orgId` (catches the "future controller declares `:tenantId` and the B-061 guard silently passes" failure mode).
- Use `current_setting('provenance.current_org_id'...)` in raw SQL, which is the RLS signal that B-062 says doesn't reliably work.

The CI check is the structural defense; the convention plus the existing high coverage is what makes the rule cheap to enforce going forward.

### 4. Fix `agents.service.ts` as the highest-impact closure

Refactor the ~11 `findOne({ where: { agentId } })` patterns in `agents.service.ts` to `findOne({ where: { agentId, orgId: ctx.orgId } })`. Also tighten the routes that today don't carry org in the URL — either add the org to the URL (`/organizations/:orgId/agents/:agentId/...`, the platform's standard tenant-scoped shape) so the B-061 guard fires, OR add a service-layer guard that asserts `agent.orgId === ctx.orgId` after the lookup. Recommend the URL change as the consistent pattern; the alternative is a per-method add.

### 5. Standardize the URL-param name to `orgId` repo-wide

The B-061 guard reads `request.params.orgId`. A future controller that uses `:organizationId` or `:tenantId` would silently bypass the check. Either:

- (a) Convention: every tenant-scoped route uses `:orgId` exactly. CI grep enforces it.
- (b) Defense: the guard inspects every `:*Id`-shaped UUID param against the JWT.

Recommend (a) for clarity and (b) as a follow-on for paranoia. Both are cheap.

---

## Why not the alternatives

### Option 1 — Per-request sticky connection (TypeORM `QueryRunner` for request lifetime)

**Sketch.** A Nest interceptor or middleware acquires a `QueryRunner` at request start, sets `SET LOCAL provenance.current_org_id = $1` on its connection, attaches the runner to the request context, and forces every repository / service-layer query to use that runner. Released back to the pool at request end.

**Cost.** Big refactor. Every repository injection point would need to accept a runner or operate inside a request-scoped data source. Touches dozens of files. Changes the testing surface (test setup would need to provision and inject runners). High change-blast-radius for a defense-in-depth layer that the controller guard already covers in practice.

**Benefit.** RLS becomes the durable load-bearing isolation layer. Future controller-guard regressions don't expose data.

**Verdict.** Too invasive for the marginal gain at this stage. Right answer for Phase 6 (production EKS hardening), wrong answer for now. Keep RLS policies in place so this option remains reachable later.

### Option 2 — Transactional wrapper around every request

**Sketch.** A Nest interceptor opens a transaction at request start, sets `SET LOCAL` inside it, commits at end. Queries inside the transaction inherit the session variable. Smaller per-call diff than Option 1.

**Cost.**

- **Performance.** Every request, including reads, now runs in an explicit transaction. Affects connection-pool sizing under load; adds round-trips.
- **Failure-mode shape.** Today, a service-layer error rolls back only what's in its own transaction; notifications, outbox events, and idempotent writes that should survive a partial failure can do so. Wrapping the whole request in a transaction means any service-layer throw rolls back the entire request — including writes the API would prefer to keep (e.g. audit log entries that should land even when the operation fails).
- **Existing transactional patterns conflict.** Domain 12 (`ConsentService`), notification outbox (ADR-009), and lineage emission already manage their own transactions. Wrapping them in an outer transaction either nests or interferes — both have subtle bugs.

**Benefit.** RLS becomes reliable without per-repository changes.

**Verdict.** The failure-mode change is structurally bad. Any service that today decides "this write should survive a partial failure" loses that contract.

### Option 3 — Drop RLS, formalize the explicit-filter pattern (THIS ADR)

See above. The pattern this ADR picks.

---

## Consequences

### Positive

- **Honest documentation.** CLAUDE.md's security rule "org_id on every PostgreSQL table with row-level security enforced at database level" becomes accurate after this ADR ships, by being narrower: "org_id on every tenant-scoped table; tenant isolation enforced at the service layer via explicit `orgId = ctx.orgId` filtering; RLS policies present as a backstop, contingent on per-request sticky-connection (Phase 6 hardening)."
- **Cheap enforcement.** The CI check is a one-time setup. Pattern violations fail PR review.
- **No performance regression.** No new transactions, no new connection-pool pressure.
- **Pairs cleanly with B-061.** Controller layer enforces URL-vs-JWT match; service layer enforces resource-org match. Two independent checks at different layers.
- **Future-compatible.** RLS policies stay; the per-request-sticky-connection option is reachable later without a re-design.

### Negative

- **Service-layer responsibility.** Every new service-layer query is a place a contributor could forget the org filter. The CI check is the structural mitigation, but it's not zero risk.
- **agents.service.ts refactor required.** ~11 query call sites need the filter added. Plus deciding whether agent routes change shape to `/organizations/:orgId/agents/...` (recommended) or whether each service method asserts post-lookup.
- **RLS stays as code-debt-with-purpose.** The policies exist but don't load-bear. A future maintainer might be confused about why. The CLAUDE.md update + this ADR are the documentation answer.

### Neutral

- The platform's tenant isolation story shifts from "enforced at the database" to "enforced at the service, defended at the controller, backstopped at the database." More layers, but only one is load-bearing today.

---

## Implementation notes (for the follow-up session)

1. **Lint rule design first.** Pick the lightest enforcement mechanism that actually catches violations. Options: an ESLint custom rule, a CI grep script, a TypeScript compiler plugin. Recommend ESLint custom rule against AST so we get accurate detection (grep would have false positives on test data and string comparisons).
2. **`agents.service.ts` refactor + route move.** Add `orgId: ctx.orgId` to every where clause; move agent routes under `/organizations/:orgId/agents/:agentId/...`. Update controllers, frontend API client, MCP tools that resolve agent IDs.
3. **URL-param convention check.** Grep CI rule: every `@Param('orgId')` is allowed; every `@Param` that ends in `Id` and is NOT `orgId` is flagged for human review (most will be other resource IDs which are fine, but the rule forces a moment of thought).
4. **CLAUDE.md update.** "Security Rules (Never Violate)" section's RLS bullet rewritten to match the layered model this ADR establishes.
5. **Smoke-test layer extension.** When B-060's smoke-test CI piece (the deferred half) lands, add a layer that asserts cross-tenant isolation by simulating a forged-context call against a tenant-scoped service method, expecting zero rows.
6. **B-062 stays open** until items 2-5 land. The CI rule alone doesn't close the bug — `agents.service.ts` is the load-bearing fix.

---

## Open questions deferred to implementation

- **What about service methods that do NOT yet receive `ctx.orgId`?** Some legacy paths plumb `orgId` as a positional arg without a `RequestContext`. Decision: standardize on `RequestContext` everywhere; positional `orgId` is the old shape and should be replaced as touched.
- **Cross-tenant queries that ARE legitimate** (marketplace global, federation, platform admin): how do they signal "I'm intentionally cross-tenant"? Recommend an explicit `CrossTenantContext` type that the CI lint rule recognizes as the safe escape hatch — the type signature documents intent, and reviewers know to look for it.
- **`current_setting('provenance.current_org_id'...)` in any remaining raw SQL:** is there any left after `OrgContextMiddleware`? Audit during implementation; if any exist, they're using the same broken plumbing and should be replaced.
- **Migration order for the agents route move.** Frontend, MCP tools, and any external integration code reference the current `/agents/:agentId` paths. The change needs a coordinated frontend + backend + (possibly) versioned-API window.

---

## References

- [B-062](../../bugs/open.md#B-062) — RLS-by-default bug entry; root-cause analysis.
- [B-061 (resolved)](../../bugs/resolved.md#B-061-cross-org-information-leak-the-jwt-auth-guard-did-not-check-the-url-orgid-against-the-tokens-claim) — the controller-layer cross-org leak that surfaced B-062's deeper exposure.
- `apps/api/src/database/org-context.middleware.ts` — the current middleware that doesn't actually work end-to-end.
- `apps/api/src/auth/jwt-auth.guard.ts` — the B-061 controller-layer guard.
- Migrations V1, V10, V12, V15, V18, V21, V23, V24 — the RLS policy definitions that exist but don't load-bear.
- `documents/architecture/Provenance_Architecture_v1.5.md` — Section on tenant isolation (will need a v1.6 update reflecting the layered model this ADR establishes).
- `documents/audits/claim-vs-code-2026-05-22.md` — the audit that flagged the security-rule wording about RLS as misleading; B-064/B-065/B-067 closed the wording side, B-062 is the underlying technical fix.
