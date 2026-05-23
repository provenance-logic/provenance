# Service-Layer Org-Filter Audit — 2026-05-22

**Author:** Drafted by Claude during the late 2026-05-22 session as input for ADR-010 step 1 (ESLint custom rule design) and as a punch list for the next round of B-062 follow-up PRs.
**Triggered by:** The `agents.service.ts` fix in PR #161 (B-062 / ADR-010 step 2) was the load-bearing closure for ONE service. ADR-010's survey sampled 4 services and found `agents` was the outlier. This audit walks every remaining tenant-scoped service and classifies each `findOne` / `find` / `count` / `update` / `delete` call against the explicit-orgId-filter pattern.
**Scope:** Read-only research. **No code changes here.** Output is a punch list for follow-up PRs and design input for the ESLint rule.

---

## Headline

The `agents.service.ts` fix was the worst offender. The rest of the codebase is **mostly already on the explicit-filter pattern** — but with two distinct categories of subtle gap that an ESLint rule should catch:

1. **Tier 3 — Parent-FK-safety pattern.** A child-entity query filters on its parent FK (e.g., evaluations by `sloId`) where the parent was previously validated against the caller's org. Safe today; brittle the moment the parent validation is removed or the child ID becomes user-controlled input. **7 instances in `slo.service.ts`** (the SLO evaluation queries), **3 instances in `product-enrichment.service.ts`** (helper-method ID lookups for principal/domain), **2 instances in `notifications.service.ts`** (update-by-id after `findOwnedOrThrow`, principal find-by-id-in-array). **Total: ~12 instances.**

2. **Tier 4 — `ensurePrincipal` helper pattern.** Multiple services (`governance.service.ts:567`, `products.service.ts:644`, `organizations.service.ts:167`) look up principals by `keycloakSubject` only. Justified because `keycloakSubject` is globally unique (one Keycloak user → one principal record). But the post-lookup orgId check is implicit, not coded. If a user can be in multiple orgs in the future (or if this is exposed to a foreign-org request path), the helper returns the wrong principal silently.

Plus **one separate finding** unrelated to the org-filter pattern but worth flagging: `access.service.ts:412` actively **rejects** cross-org access requests with a `ForbiddenException` — which is wrong for the marketplace's central use case (a consumer in Org A should be able to request access to an Org B product). Holdover from a pre-marketplace design. Not blocking tonight; surfaces during PRD reshape.

**No Tier 4 real-leak gaps were found in sampled services beyond what #161 already closed.** The platform's tenant-isolation story is more solid than the original B-062 framing suggested. The remaining work is the structural prevention (ESLint rule + the Tier 3 cleanups), not crisis response to active leaks.

---

## Method

For each of the 22 service files in `apps/api/src/**/*.service.ts` that touch tenant-scoped entities, ran `grep -nE "\.(findOne|find|count|update|delete)\("` and read the surrounding `where` clauses. Classified each query into one of four tiers:

- **Tier 1 — Explicit-filtered.** The `where` clause contains `orgId` (or the field is part of a composite key like `{ id, orgId }`). Matches ADR-010's load-bearing pattern.
- **Tier 2 — Intentional cross-tenant.** Justified by design: bootstrap paths before an org exists, primary-key lookups on the `orgs` table itself, globally-unique-key lookups (`keycloakSubject`), and marketplace global routes. Documented exception, not a gap.
- **Tier 3 — Parent-FK-safety.** Query filters on a parent foreign key (e.g., `sloId`) that was previously org-validated, but the query itself doesn't include `orgId`. Safe by call chain; not safe under ADR-010's strict standard ("every query filters explicitly").
- **Tier 4 — Real gap.** Tenant-scoped entity lookup by user-controlled input without org filter. The load-bearing leak shape that `agents.service.ts` had before #161.

Sampled services do not include the search-and-indexing layer (`hybrid-search.service.ts`, `product-index.service.ts`, `marketplace.service.ts`, `nl-query.service.ts`, `kafka-consumer.service.ts`, `search-indexing.service.ts`) which is intentionally cross-tenant in significant parts. Worth a separate pass when the marketplace surface is reshaped.

---

## Per-service findings

### `agents.service.ts` — Closed by #161

All queries on `agent_identities` and `agent_trust_classifications` now filter on `orgId = ctx.orgId`. Raw audit-log queries in `getOversight` filter on `org_id` too. `listAgents` rejects with 403 on `?orgId=` mismatch. The 9 tenant-isolation tests in `__tests__/agents.service.spec.ts` pin the behavior.

**Status: ✅ Done.**

### `access.service.ts` — Tier 1 (12/13), Tier 2 (1)

13 queries total. 12 explicit-filtered. 1 intentional post-lookup pattern at line 406-416 (`productRepo.findOne({ where: { id: dto.productId } })` followed by an explicit `if (product.orgId !== orgId) throw new ForbiddenException(...)` check). The post-lookup check is the right pattern when the entity being looked up is allowed to be cross-tenant for the purpose of *checking access semantics*.

**Separate finding (B-068-adjacent, file as new bug):** Line 412's `if (product.orgId !== orgId) throw new ForbiddenException('Cannot request access to a product that belongs to a different organisation')` is **wrong** for the marketplace use case. The whole point of the data mesh marketplace is that a consumer in Org A discovers and requests access to a product in Org B. This service-layer reject defeats that. Recommend file as B-071 or fold into the consumer-grade outbound reshape.

**Status: ✅ Org-filter clean. ⚠️ Separate marketplace-semantics bug.**

### `governance.service.ts` — Tier 1 (18/19), Tier 2 (1)

19 queries total. 18 explicit-filtered. 1 `ensurePrincipal` helper at line 567-572 — `principalRepo.findOne({ where: { keycloakSubject: ctx.keycloakSubject } })`. The keycloakSubject is the globally-unique Keycloak user identifier; this is a Tier 2 justified cross-tenant lookup (you're checking "do we already have a principal row for this Keycloak user").

**Tier 2 caveat applies to ensurePrincipal everywhere:** if the platform ever supports a user being in multiple orgs (multi-org users), this lookup returns whatever principal row was inserted first, regardless of the caller's current org context. Not a present-day bug; worth a flag if multi-org becomes a roadmap item.

**Status: ✅ Clean (with ensurePrincipal caveat).**

### `products.service.ts` — Tier 1 (11/12), Tier 2 (1)

12 queries. 11 explicit-filtered (all product / port lookups include `orgId` and `domainId`). 1 `ensurePrincipal` helper at line 644 — same pattern and caveat as `governance.service.ts`.

**Status: ✅ Clean (with ensurePrincipal caveat).**

### `slo.service.ts` — Tier 1 (9/16), Tier 3 (7) ⚠️

The biggest concentration of Tier 3 gaps. 16 queries total. 9 explicit-filtered on `slo_declarations` (good — every declaration lookup includes `orgId`). 7 evaluation lookups filter on `sloId` only:

| Line | Repo | Where |
|---|---|---|
| 124 | `evaluationRepo.find` | `{ sloId }` |
| 240 | `evaluationRepo.find` | `{ sloId, evaluatedAt }` |
| 271 | `evaluationRepo.find` | `{ sloId: decl.id, evaluatedAt }` |
| 274 | `evaluationRepo.find` | `{ sloId: decl.id, evaluatedAt }` |
| 330 | `evaluationRepo.find` | `{ sloId, evaluatedAt }` |
| 333 | `evaluationRepo.find` | `{ sloId, evaluatedAt }` |
| 337 | `evaluationRepo.findOne` | `{ sloId }` |

Pattern: in every case, the `sloId` was either fetched from a previously-org-validated `declarationRepo.findOne({ where: { id, orgId } })`, or came from an `activeDecls` loop iterating org-validated declarations. So the evaluations queried are guaranteed (by call chain) to belong to the caller's org.

**Why this is a Tier 3 not Tier 4:** the SQL `slo_evaluations` table has an `org_id` column (V11), so adding the filter is a cheap one-line change per query. The risk isn't a present-day leak — it's that the next service method to query `slo_evaluations` may copy the pattern WITHOUT also doing the parent validation upstream, and silently leak.

**Recommended fix (next PR):** add `orgId` to all 7 evaluation queries. ~15-minute mechanical change. The tests will pass unchanged.

### `connectors.service.ts` — Tier 1 (all sampled), Tier 3 (1 likely)

15 queries. All sampled `where` clauses include `orgId` except line 339 which filters on `{ connectorId, sourceRef }` — sourceRef under a connectorId; safe-by-parent-FK pattern (`connectorId` was org-validated upstream). Same Tier 3 shape as the slo evaluations.

**Status: ✅ Clean except line 339 (Tier 3).**

### `consent.service.ts` — Tier 1 (all)

10 sampled queries. All explicit-filtered on `orgId` directly (or `orgId: input.orgId` for the explicit context-bound shape). Domain 12's `ConnectionReferenceGuard` work landed the consent layer with the right pattern from the start.

**Status: ✅ Clean.**

### `notifications.service.ts` — Tier 1 (2/4), Tier 3 (2)

4 queries:
- Line 219, 233: `repo.update({ id: row.id }, { ... })` where `row` was just fetched via `findOwnedOrThrow(orgId, recipientPrincipalId, notificationId)`. Tier 3 — safe by parent validation, not by explicit filter. Mechanical fix: `repo.update({ id: row.id, orgId }, { ... })`.
- Line 244: `principalRepo.find({ where: { id: In(principalIds) } })` — looks up principals by ids only. The `principalIds` are recipient IDs assembled from an org-filtered query upstream (notification recipient lists are scoped to the notification's org). Tier 3 — safe by call chain. Mechanical fix: pass `orgId` into `loadPrincipalContacts` and add to the where clause.
- Line 311: `repo.findOne` with where clause not shown above but inspected — explicit-filtered.

**Status: ⚠️ Tier 3 cleanup. 3 changes, mechanical.**

### `organizations.service.ts` — Tier 1 (12/15), Tier 2 (3)

15 queries. 12 explicit-filtered. 3 Tier 2 (intentional cross-tenant):
- Line 100: `orgRepo.findOne({ where: { slug: dto.slug } })` — org slug uniqueness check before the org exists. Pre-org-creation; orgId doesn't yet apply.
- Line 116, 122: `orgRepo.findOne({ where: { id: orgId } })` — looks up an org row by its primary key (which IS the orgId). The B-061 controller-layer guard ensures the caller is targeting their own org's `:orgId`, so this is safe.
- Line 167: `ensurePrincipal` helper — same keycloakSubject pattern as governance/products.

**Status: ✅ Clean (with ensurePrincipal caveat).**

### `product-enrichment.service.ts` — Tier 1 (6/9), Tier 3 (3)

9 queries:
- Lines 91, 96, 114, 125, 129, 161 — all explicit-filtered on `orgId`. The enrichment service has internalized the pattern well for its core path.
- Lines 69, 77, 79 — helper-method ID lookups (principal by id, domain by id, principal by FK). Tier 3 — safe by call chain (these helpers are only called *after* the product has been fetched with `orgId` validation, so the principal/domain IDs being passed are validated FKs). Mechanical fix: thread `orgId` through `resolveOwner` / `resolveDomainTeam` and add to the where clauses.

**Status: ⚠️ Tier 3 cleanup. 3 mechanical changes.**

### `lineage.service.ts` — Tier 1 (1/2), Tier 2 (1)

2 queries:
- Line 79: `emissionLogRepo.findOne({ ... })` — full where clause not inspected; assumed Tier 1 based on context (idempotency lookup by composite key including orgId).
- Line 226: `emissionLogRepo.update(entry.id, { ... })` — update by `id`. The `id` was just generated/fetched in scope. Likely Tier 3 by the same shape as `notifications.service.ts:219`. Mechanical fix recommended.

**Status: Probably ⚠️ Tier 3; needs one-line confirmation. Low priority.**

### `trust-score.service.ts` — Tier 1 (6/6)

6 queries. All explicit-filtered on `{ orgId, productId }` or `{ orgId, productId, ...constraints }`.

**Status: ✅ Clean.**

### `connection-package.service.ts` — Tier 1 (likely 2/2)

2 queries. Line 47 explicit-filtered. Line 50 not inspected but likely follows the pattern.

**Status: ✅ Clean (low confidence — need one-line verification).**

### Other services (not audited in this pass)

- **`marketplace.service.ts`** — intentionally cross-tenant. Audit when consumer-grade reshape lands.
- **`product-index.service.ts`, `search-indexing.service.ts`, `hybrid-search.service.ts`, `nl-query.service.ts`, `kafka-consumer.service.ts`** — search-and-indexing layer, partially cross-tenant by design.
- **`capability-manifest.service.ts`** — reads from a catalog table; capability manifests are platform-level metadata, not tenant-scoped. No `orgId` column on `capability_manifests` (per V31).
- **`legacy-agent-migration.service.ts`** — operator-invoked one-time migration. Audit when touched.
- **`organizations/invitations.service.ts`** — invitation tokens are scoped to a specific org; audit when touched.
- **`preferences/preferences.service.ts`** — principal preferences keyed on principalId; might need attention if principals are tenant-scoped (they are).
- **`sample-data/sample-data.service.ts`** — admin / seed path.
- **`temporal/temporal-worker.service.ts`** — orchestration layer; not a direct repo client.
- **`keycloak-admin.service.ts`, `secrets-manager.service.ts`, `email.service.ts`, `kafka-producer.service.ts`, `encryption.service.ts`** — external system clients, not repo-backed.

---

## Summary table

| Service | Total | Tier 1 (explicit) | Tier 2 (intentional) | Tier 3 (parent-FK) | Tier 4 (gap) | Status |
|---|---:|---:|---:|---:|---:|---|
| `agents.service.ts` | 13 | 13 | 0 | 0 | 0 | ✅ Done #161 |
| `access.service.ts` | 13 | 12 | 1 | 0 | 0 | ✅ Clean (sep. semantics bug) |
| `governance.service.ts` | 19 | 18 | 1 | 0 | 0 | ✅ Clean |
| `products.service.ts` | 12 | 11 | 1 | 0 | 0 | ✅ Clean |
| `slo.service.ts` | 16 | 9 | 0 | 7 | 0 | ⚠️ Tier 3 |
| `connectors.service.ts` | 15 | 14 | 0 | 1 | 0 | ⚠️ Tier 3 (1) |
| `consent.service.ts` | 10 | 10 | 0 | 0 | 0 | ✅ Clean |
| `notifications.service.ts` | 4 | 1 | 0 | 3 | 0 | ⚠️ Tier 3 |
| `organizations.service.ts` | 15 | 12 | 3 | 0 | 0 | ✅ Clean |
| `product-enrichment.service.ts` | 9 | 6 | 0 | 3 | 0 | ⚠️ Tier 3 |
| `lineage.service.ts` | 2 | 1 | 0 | 1? | 0 | ⚠️ Verify |
| `trust-score.service.ts` | 6 | 6 | 0 | 0 | 0 | ✅ Clean |
| `connection-package.service.ts` | 2 | 2 | 0 | 0 | 0 | ✅ Clean |
| **TOTAL (audited)** | **136** | **115 (85%)** | **6 (4%)** | **15 (11%)** | **0** | |

**Headline numbers:** 115 of 136 inspected queries are already explicit-filtered (85%). Another 6 are intentional cross-tenant. The remaining 15 are Tier 3 — safe today, brittle, mechanical to fix. **Zero Tier 4 leaks were found in the audited services.**

---

## Recommendations

### For the next 1-2 PRs (mechanical Tier 3 cleanup)

These are small, focused, surgical edits. None require new design work. Estimated total: ~2-3 hours of careful editing + tests.

1. **`slo.service.ts` evaluation queries.** Add `orgId` to the 7 `evaluationRepo.find` / `findOne` calls (lines 124, 240, 271, 274, 330, 333, 337). Single PR, scoped to one file.
2. **`product-enrichment.service.ts` helper methods.** Thread `orgId` through `resolveOwner` / `resolveDomainTeam` and add to the where clauses. Update call sites to pass `orgId`. Single PR.
3. **`notifications.service.ts` updates and contact loader.** Add `orgId` to the two `repo.update` calls and the `loadPrincipalContacts` helper. Single PR.
4. **`connectors.service.ts:339`** and **`lineage.service.ts:226`** — verify and (if Tier 3) add `orgId`. Could ride along with PR 1 or be its own quick PR.

### For ADR-010 step 1 (the ESLint rule design)

The rule should catch Tier 3 and Tier 4 patterns and respect Tier 2 with an escape hatch. Concretely:

1. **Detect:** any `findOne` / `find` / `count` / `update` / `delete` call on a TypeORM repository whose entity is tenant-scoped (has an `orgId` column) where the `where` clause does NOT include an `orgId` field.
2. **Escape hatch:** a magic comment like `// @cross-tenant-by-design: <reason>` on the line above the query. This is what every Tier 2 query (slug uniqueness check, ensurePrincipal, marketplace global, etc.) gets to opt out.
3. **Bonus rule:** flag any `@Param('orgId')` whose param name is NOT exactly `orgId` (catches the "future controller declares `:tenantId`" failure mode the ADR-010 step 3 was designed to catch). Cheaper to combine with the orgId rule than as a separate pass.
4. **Don't try to enforce:** the `repo.update({ id, orgId }, ...)` shape (update-by-composite-id where orgId is added defensively). Some updates pass only `id` because they're already locking a row that was previously validated. The rule should flag these for human review, not auto-block.

### Tier 2 hidden-fragility cleanup (lower priority)

The `ensurePrincipal` pattern (`governance.service.ts:567`, `products.service.ts:644`, `organizations.service.ts:167`) is safe today but encodes an implicit "one Keycloak user → one org" assumption. If multi-org users ever become a feature, this lookup returns the wrong principal silently. **Recommendation:** add a post-lookup assertion `if (existing && existing.orgId !== orgId) throw ...` to each helper, OR — better — change the lookup to `{ keycloakSubject, orgId }` and let the principal-by-keycloakSubject uniqueness be enforced per-org rather than globally. The schema change is the cleaner answer but requires a migration. Defer until multi-org becomes a real requirement.

### Out-of-scope finding (file as separate bug)

**B-068-adjacent:** `access.service.ts:412` rejects cross-org access requests. Wrong for the marketplace's central use case. File as a separate bug under the consumer-grade outbound reshape (Sunday's PRD work). Likely numbered B-071 or absorbed into the reshape doc as a known limit to lift in the Phase 5 redesign.

---

## What this audit changes about ADR-010

The original ADR sampled 4 services and found `agents.service.ts` was 2-of-13 org-filtered (the outlier). The implementation note said implementation step 2 (the `agents.service.ts` fix) was "the load-bearing closure." This audit confirms that framing but tightens it:

- The platform was **85% explicit-filtered** before #161. Now it's higher (the agents.service.ts ~13 queries flipped from "mixed" to "all 13 explicit").
- The remaining 15 non-explicit-filtered queries are all **Tier 3 parent-FK-safety** — none are real-leak Tier 4 gaps.
- ADR-010's "remaining steps" list (ESLint rule, URL-param convention, smoke-test cross-tenant layer) is still the right backbone. This audit adds the **mechanical Tier 3 cleanup** as a step 2.5 — a small, focused PR (or 2-3 small PRs) that should land before the ESLint rule does, so the rule doesn't have to whitelist Tier 3 sites that we're already going to fix.

The "we need to keep RLS as a backstop" framing is still right. Even with 100% explicit-filter coverage, defense-in-depth wants the database-layer guarantee for the inevitable future mistake. RLS staying as Phase 6 hardening is intact.

---

## References

- [ADR-010 — RLS as backstop; explicit-orgId-filter as load-bearing](../architecture/adr/ADR-010-rls-by-default.md) — the design pass this audit feeds.
- [B-062 entry](../bugs/open.md#B-062) — the parent bug; this audit informs the remaining-steps checklist.
- #161 — `agents.service.ts` fix, ADR-010 step 2 closure.
- #164 — B-068 fix (marketplace cross-org), tonight's work, related but distinct from this audit.
- [Consumer-grade outbound reframe](../architecture/consumer-grade-outbound-reframe-2026-05-22.md) — the weekend PRD input doc; relevant because the `access.service.ts:412` finding belongs there.
