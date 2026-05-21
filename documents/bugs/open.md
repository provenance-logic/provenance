# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-061 — Cross-org information leak: org-scoped endpoints serve other-org data when the caller passes a different `:orgId` in the URL

- **Severity:** High (cross-tenant information leak in production-shaped code paths; reproduced live on dev — not theoretical. Provenance's whole story is multi-tenant; this is OSR-blocking in spirit even if the marketing site doesn't say "we leak data across orgs.")
- **Status:** Open
- **Area:** `apps/api/src/governance/governance.controller.ts`, `apps/api/src/trust-score/trust-score.controller.ts`, and almost certainly the wider family of controllers that use `@Param('orgId')` directly (see Blast radius below).
- **Discovered:** 2026-05-21, while probing endpoints during the [B-060 part 2](resolved.md#B-060-part-2-demo-smoke-testsh-layers-3-6-targeted-flat-endpoints-the-api-never-exposed) smoke-test rewrite. Flagged in passing in that PR's resolved.md entry; deserves its own filing.

**Reproducible symptom.** Authenticate as `admin@acme.example.com` (JWT carries `provenance_org_id = <Acme>`). Call an org-scoped endpoint with **Beta Industries**' `orgId` in the URL. The API returns 200 with Beta's data.

```
# Acme JWT, Beta org id in URL — should be 403 (or at minimum return Acme data and ignore URL mismatch).
GET /api/v1/organizations/<Beta>/governance/dashboard
  → { "summary": { "totalPublished": 4, ... } }    # Beta's counts, not Acme's

GET /api/v1/organizations/<Beta>/governance/effective-policies
  → { "items": [ { "orgId": "<Beta>", ... }, ... ] }    # Actual Beta rows

GET /api/v1/organizations/<Beta>/products/<Beta-product>/trust-score
  → { "score": 0.66, "band": "fair", "org_id": "<Beta>", ... }    # Beta's trust score
```

The dashboard leaks aggregate counts. `/effective-policies` and `/trust-score` leak actual row content with the other org's UUID in the response.

**Write side effect (worse).** Calling `/organizations/<Acme>/products/<Beta-product>/trust-score` — Acme orgId in URL, Beta product UUID — returns HTTP 200 with a freshly computed score whose response payload claims `org_id = <Acme>` for `product_id = <Beta-product>`. The trust-score service appears to compute and persist a new `observability.trust_score_history` row attributing a Beta product to Acme's tenant. Cross-org write, not just cross-org read. Has not been verified yet against the table contents but the response shape strongly suggests it.

**Endpoints that handle correctly (also probed).** Same swap (Acme JWT, Beta orgId in URL) returned the caller's own data on:
- `/organizations/<Beta>/access/grants` → items have `orgId = <Acme>` (URL ignored, JWT respected)
- `/organizations/<Beta>/access/requests` → same
- `/organizations/<Beta>/marketplace/products` → same

So the gap is per-controller, not platform-wide.

**Root cause.** Two controller patterns coexist in the codebase. Compare:

```ts
// access.controller.ts:50 — SAFE. Uses ctx.orgId (resolved from JWT).
@Get('grants')
listGrants(@ReqContext() ctx: RequestContext, ...) {
  return this.accessService.listGrants(ctx.orgId, ...);
}
```

```ts
// governance.controller.ts:37 — LEAKY. Passes the URL :orgId straight through.
@Get('dashboard')
getDashboard(@Param('orgId') orgId: string) {
  return this.governanceService.getDashboard(orgId);
}
```

There is no controller-level check that `@Param('orgId') === ctx.orgId`. The `JwtAuthGuard` only verifies that the JWT carries a non-empty `provenance_org_id` claim — it does not compare it to the URL path parameter.

**Why RLS didn't catch it.** The `OrgContextMiddleware` (`apps/api/src/database/org-context.middleware.ts`) sets `provenance.current_org_id` from `req.user.orgId` — the JWT's value, so far so good. But it uses `SELECT set_config(..., $1, true)` with `is_local=true`, which scopes the variable to the **current transaction**. The middleware runs on a fresh connection from the pool, then releases that connection. The service layer's subsequent `repository.find(...)` / `dataSource.query(...)` calls each acquire **different** connections from the same pool, where the session variable is not set, so `current_setting('provenance.current_org_id', true)::UUID` evaluates to NULL inside the RLS USING clause and the policy effectively becomes `org_id = NULL` (no rows) — except that several governance/trust-score queries appear to bypass RLS entirely or run as a role exempt from the policy.

Either way, the *control-plane* tenancy invariant is currently leaning on application-layer authorization that some controllers honor and others don't, with no enforcement floor under it.

**Blast radius (needs explicit audit, not assumed).** Controllers mounted at `/organizations/:orgId/...` that use `@Param('orgId')` and pass it through to the service — every one is a candidate until proven otherwise:

- `governance/governance.controller.ts` — **confirmed leaky** (dashboard, effective-policies; assume all routes)
- `trust-score/trust-score.controller.ts` — **confirmed leaky** (with likely write side effect)
- `products/products.controller.ts`
- `connectors/connectors.controller.ts`
- `lineage/lineage.controller.ts`
- `observability/slo.controller.ts`
- `sample-data/sample-data.controller.ts`
- Possibly `consent/consent.controller.ts` and `notifications/notifications.controller.ts` if any of their routes use `@Param('orgId')` directly rather than `ctx.orgId`

`access`, `marketplace`, `governance/governance.controller.ts`'s ctx-using routes (if any), `products/products.controller.ts`'s ctx-using routes (if any) — the safe ones — use `ctx.orgId`. Mixed-mode is the worst case because the controller LOOKS safe at a glance.

**Fix paths (not commitments — needs design pass).** Three options, increasing in robustness:

1. **Guard at the controller boundary** — `JwtAuthGuard` (or a dedicated `OrgScopeGuard`) compares `request.params.orgId` to `request.user.orgId` for any route that has both, and returns 403 on mismatch. One place to enforce, no per-controller refactor. Doesn't fix the RLS gap below — but prevents cross-org calls from ever reaching the service layer.
2. **Repair RLS-by-default** — fix `OrgContextMiddleware` (or move it to a Nest interceptor / typeorm connection lifecycle hook) so the session variable persists across the connections the request actually uses, OR migrate to a pattern where every service-layer query goes through a runner that explicitly scopes the connection. Defense in depth — even if a controller leaks, the database refuses to serve cross-org rows.
3. **Both.** Almost certainly the right answer for OSR. Layer 1 is fast to ship and catches the wrong call before it touches the DB; layer 2 is the structural fix.

**Recommended sequencing.** (1) first, as a single PR — small diff, immediately stops the bleed, includes an integration test that the cross-org calls now 403. Then (2) as a follow-up — much larger refactor, deserves its own design pass.

**Verification scaffold for whichever fix lands.** Extend `infrastructure/scripts/demo-smoke-test.sh` layer 5 (or add a layer 5a) — call each `/organizations/<other-org>/...` endpoint with the smoke user's JWT and assert HTTP 403. This is the kind of test that's worth wiring into the planned CI job from the remaining open piece of B-060: regression on this exact bug is the highest-cost regression on the project.

**Impact today.**

- Provenance positions itself as a multi-tenant platform. This bug breaks that claim end-to-end on at least three confirmed endpoints — anyone authenticated as one org can read another org's governance posture, effective policies, and trust scores by typing a different UUID into the URL.
- No fix is shipped yet. Workaround for any operator: **only run the platform with one tenant** until B-061 is closed. The smoke-test fix from PR #138 does not make this worse — it just used to be invisible because the smoke test never reached the leaky endpoints.

**Pattern.** The `@Param('orgId')` controller pattern looks Type-Script-tidy ("explicit, typed param from the URL") but quietly bypasses the JWT identity that the whole tenant model depends on. Every new org-scoped controller is going to be tempted into this same pattern unless the platform makes the safe choice the easy one. Long-term fix is RLS-by-default plus a guard; short-term fix is the guard alone. The B-060 family of bugs taught the project that "operator tooling is part of the surface a phase ships" — B-061 is the analogue for tenant isolation: "the URL is part of the security surface a phase ships."

---

## B-060 — Demo verification tooling drifted from the API surface; `demo-smoke-test.sh` layers 3–6 reference endpoints that don't exist

- **Severity:** Medium (operator-facing tooling functionally broken; the *platform* works, but the scripts that verify it can't)
- **Status:** Open — **softReset half resolved 2026-05-21** (see [resolved.md](./resolved.md#B-060-part-1-softReset-referenced-columns-and-tables-that-dont-exist-in-the-live-schema)). The smoke-test layers 3–6 fix and the CI integration remain open.
- **Area:** `infrastructure/scripts/demo-smoke-test.sh`
- **Discovered:** 2026-05-18, during the Path 3 attempt to verify `demo-reset.sh --soft` after bringing the demo box to current main.

**Symptom.**

1. **`softReset` (`packages/seed/src/reset.ts`):** ~~the function references five tables/columns; only one is correct.~~ **RESOLVED 2026-05-21.** softReset now matches the live schema (V4 `occurred_at`, V7 `requested_at`, V9 `emission_log`, V11 `computed_at`); the phantom `observability_snapshots` DELETE was dropped (no such table exists). A new CLI verifier (`seed:verify:soft-reset`) inserts sentinel rows on both sides of the 24h cutoff, runs softReset, and asserts the right rows were deleted; verified end-to-end on back-to-back invocations.

2. **`demo-smoke-test.sh` layers 3–6:** ~~almost every authenticated API call references a flat top-level endpoint shape that the API doesn't expose.~~ **RESOLVED 2026-05-21.** Rewrote layers 3, 5, 6 against the real org-scoped routes — see [resolved.md](./resolved.md#B-060-part-2-demo-smoke-testsh-layers-3-6-targeted-flat-endpoints-the-api-never-exposed) for the full mapping. The `/smoke` and `/rls-probe` phantom subpaths were dropped in favor of behavioral checks against existing endpoints (B-050-style). Layer 4 (MCP) was untouched — it was already correct.

**Root cause.** Both scripts were written against an earlier snapshot of the platform that has since evolved:
- `softReset` against a planned-but-never-built schema (`observability_snapshots`, `emission_events`) with column names that were renamed before V4 / V25 shipped.
- The smoke test against an earlier flat API design that was re-architected into the multi-tenant `/organizations/:orgId/...` shape (rationale obvious — RLS, federation, ADR-001). The smoke test never followed.

Neither was ever end-to-end run after the underlying surfaces moved. This is the exact pattern the new CLAUDE.md rule **"a phase is not complete until every advertised capability has a user-visible surface"** is designed to catch — operator tooling is part of the surface a phase ships, and "the script exists" is not the same as "the script runs green."

**Fix path.**

1. **`softReset`** — ✅ **DONE 2026-05-21.** Fixed: `event_at`→`occurred_at`, `created_at`→`requested_at`, `emission_events`→`emission_log` (the table was renamed, not dropped — V9), and `observability_snapshots` DELETE removed entirely (table never existed). New `seed:verify:soft-reset` CLI command runs as the smoke test for `softReset` itself.

2. **`demo-smoke-test.sh` layers 3–6** — ✅ **DONE 2026-05-21.** Rewrote against real routes:
   - Layer 3 list → `GET /api/v1/marketplace/products` (global, JWT-auth, also exercises BM25 index).
   - Layer 3 detail → `GET /api/v1/marketplace/products/:id`; assertions remapped to the flat `columnSchema` / `owner` / `freshness` / `accessStatus` shape the response actually has (no `enrichment.*` wrapper).
   - Layer 5 lineage → `GET /api/v1/organizations/:orgId/lineage/products/:productId/upstream` (productNodeId = postgres product UUID; confirmed by probing the cypher).
   - Layer 5 search → `POST /api/v1/internal/search/semantic` with `{query, org_id, limit}` body, JWT-auth.
   - Layer 5 RLS probe → replaced with a behavioral tenant-isolation check (global marketplace returns multi-org list AND org-scoped `/access/grants` returns only caller's-org rows). The `/rls-probe` and `/smoke` phantom subpaths were not added to the API — adding them would have replicated the B-050 `/me` anti-pattern.
   - Layer 6 trust score → `GET /api/v1/organizations/:orgId/products/:productId/trust-score`.

3. **Independent of either:** add a CI job that runs `demo-smoke-test.sh` against a freshly-bootstrapped demo box. The only way to prevent re-drift is to actually run the script regularly. **Remaining as the last open piece of B-060.**

**Why split-able into multiple PRs.** softReset and the smoke test are different files with different fix approaches. Either can land independently. Both deserve resolved.md entries with the same "operator tooling drifted from the API surface; never end-to-end tested" pattern.

**Impact today.**

- The platform itself is functional. `demo.provenancelogic.com` is up on current main, all today's fixes deployed.
- `bash demo-reset.sh --soft` cannot be used to freshen demo state between rehearsals. The fallback is `demo-sync.sh main` (which re-runs the seed idempotently) — that *does* work, as verified tonight.
- The smoke test can verify layers 1–2 (infrastructure, auth — with B-050's fix). Layers 3–6 fail with 404s on phantom endpoints. The pre-demo green-light gate is still effectively broken at the layer that matters most.

**Pattern.** Operator tooling is part of the surface a phase ships. Scripts that *exist* without being *run* are scripts that don't work. Both `softReset` and `demo-smoke-test.sh` were written, committed, and forgotten — neither ever exercised end-to-end after the underlying API/schema evolved. Add a recurring run of every operator script (smoke test, reset, sync) to catch drift the next time the API or schema moves.

---

## B-029 — EC2 dev box: Vite HMR bind-mount staleness; `restart` not enough, `--force-recreate` needed

- **Severity:** Low
- **Status:** Open
- **Area:** Operations / EC2 dev box
- **Discovered:** 2026-05-14, immediately after B-028 was fixed and while verifying a frontend nav change.

**Symptom.** A source edit to `apps/web/src/shared/components/NavShell.tsx` was applied on the host (visible via `grep` from `/opt/provenance`), and Vite was running in dev mode inside the web container with a `:cached` bind mount of the source. Expected: Vite's HMR fires an `[vite] hmr update` log and the browser updates. Actual: no HMR update, the web container's view of the file was still the pre-edit content (confirmed by `docker exec provenance-ec2-web cat /app/apps/web/src/shared/components/NavShell.tsx`).

**Root cause.** Docker bind mounts on Linux can drop inotify events that Vite's file watcher relies on, particularly under certain combinations of host filesystem and Docker storage driver. `docker compose restart web` does NOT cure this — it stops and starts the same container with the same stale mount state. Only `docker compose up -d --force-recreate web` creates a fresh container with a fresh bind mount, which then reads the current host file.

**Why it matters.** Without `--force-recreate`, a frontend code change can appear deployed (file is on disk, branch is checked out) but the dev box's browser keeps serving the old version. Easy to think "my fix didn't work" and chase phantom bugs.

**Proposed fix.** Same as B-028 fix 1: a runbook paragraph noting that frontend code changes on the dev box require `docker compose up -d --force-recreate web`, not `restart web`. Pair with B-028 in `operations.md`.

A more invasive fix would be enabling Vite's `server.watch.usePolling` config, which works around inotify gaps at the cost of constant CPU polling. Not worth it for a dev environment that's shut down most of the time; skip unless this bites repeatedly.

---

## B-023 — F7.7 Role Assignment UI: `platform_admin` and `platform_observer` roles not modeled

- **Severity:** Low
- **Status:** Open
- **Area:** Identity / role model
- **Discovered:** 2026-05-14, during F7.7 implementation.

**Symptom.** PRD F7.7 names two role types — Platform Admin and Platform Observer — that do not exist in the `RoleType` enum (`packages/types/src/organizations.ts`). The current enum has `org_admin`, `domain_owner`, `data_product_owner`, `consumer`, `governance_member`.

**Resolution chosen for F7.7 v1.** Treat `org_admin` as the Platform Admin function; skip Platform Observer entirely. No migration, no Keycloak realm change, no RolesGuard update. The Roles UI shows the existing five roles only.

**When this matters.** If/when the platform grows a distinction between organization-scope administration (`org_admin`) and platform-instance-scope administration (a single principal who governs across all orgs on the deployment), we will need to:

1. Add `platform_admin` and `platform_observer` to the `RoleType` enum.
2. Migration extending the `identity.role_assignments` CHECK constraint.
3. Seed the new realm roles in `infrastructure/docker/config/keycloak/realm-export.json`.
4. RolesGuard checks at platform-level endpoints (cross-org listing, audit access).
5. Update the F7.7 UI to surface them.

**Impact today.** None — Provenance's MVP is single-tenant-per-deployment, and `org_admin` is functionally Platform Admin. This is a forward-compatibility seam, not a user-facing gap.

---

## B-024 — F7.7 Role Assignment UI: governance acknowledgment gate not implemented for `governance_member` assignment

- **Severity:** Low
- **Status:** Open
- **Area:** Governance / role assignment
- **Discovered:** 2026-05-14, during F7.7 implementation.

**Symptom.** PRD F7.7 states: "Governance role assignment requires governance layer acknowledgment." The F7.7 v1 UI allows any `org_admin` to assign `governance_member` immediately, without requiring sign-off from an existing governance member.

**Resolution chosen for F7.7 v1.** Defer. Per `documents/prd/osr-roadmap.md`'s "deferred with no shame" pattern, the acknowledgment gate is acceptable v1 — an org_admin who assigns governance is auditable through the existing `role_assigned` audit-log entry, so misuse is detectable even without preventive control.

**Proposed fix path.** When governance acknowledgment is built, the natural shape is a "pending governance approval" state on `identity.role_assignments` (new column or sibling table), with:

1. `addMember` for `role='governance_member'` creates a pending row + notification to existing governance members.
2. New endpoint for governance to approve/deny.
3. UI surface in the governance command center.
4. RolesGuard sees pending assignments as inactive until approval.

Composes naturally with Domain 11 notifications and Domain 4 governance flows; this is a Phase 6 follow-on, not OSR-blocking.

---

## B-011 — OPA 0.63.0 image is amd64-only; Apple Silicon contributors run under emulation

- **Severity:** Medium
- **Status:** Open
- **Area:** Infrastructure / developer experience
- **Discovered:** 2026-05-07, during the first external-developer onboarding test on a fresh Apple Silicon MacBook.

**Symptom.** On `arm64/v8` hosts (Apple Silicon — M1/M2/M3/M4 Macs), `docker compose up -d` emits the warning `The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8) and no specific platform was requested`. Docker pulls and runs the OPA container under amd64 emulation. With the B-010 healthcheck fix in place the stack does come up, but every OPA call carries emulation overhead.

**Root cause.** `openpolicyagent/opa:0.63.0`'s manifest contains only `linux/amd64`. OPA did not publish multi-arch (amd64 + arm64) images until the 1.16.x line — earlier 0.x and 1.0–1.15 tags are amd64-only. Confirmed via Docker Hub manifest inspection on 2026-05-07.

**Impact.** Functional: stack works. Performance: OPA is ~3–5× slower under emulation than native, which inflates policy-evaluation latency on contributor laptops. None of this affects the EC2 dev box or the production target (both amd64). The user-visible cost is slower local feedback for Apple Silicon contributors and a confusing-looking platform-mismatch warning during first run.

**Proposed fix.** Bump the OPA image to a multi-arch tag — `openpolicyagent/opa:1.16.x` or later. Two complications to investigate before merging:

1. **Rego v1 default.** OPA 1.x changed the default Rego language version from v0 to v1. Our bootstrap policy at `infrastructure/docker/config/opa/policies/health.rego` uses v0 syntax (`default ok = true` rather than `default ok := true`) and would need either a `import rego.v1` directive, a syntax migration, or invoking OPA with `--v0-compatible`. Any Rego that the platform compiles at runtime (governance policy compiler) needs the same audit.
2. **Behavioral compatibility.** A 0.63 → 1.16 jump skips ~3 years of OPA changes. We need to run the existing governance test suite against the new image before flipping the dev compose default, even if no Rego syntax errors surface.

**Workaround until fix.** Apple Silicon contributors can run the stack as-is once B-010 is fixed — emulation is slow but functional. No action required from contributors; the warning is cosmetic.

---

## B-001 — Mailhog dev email not surfaced in UI

- **Severity:** Medium
- **Status:** Open
- **Area:** Onboarding / developer experience
- **Environment:** EC2 dev (`https://dev.provenancelogic.com`)

**Symptom.** New users who trigger any flow that sends email (self-serve signup welcome email, invitation accept link, UPDATE_PASSWORD link) cannot see the email from the UI — they must have shell access on the EC2 host and `curl http://localhost:8025` to read Mailhog's inbox. Non-engineering stakeholders evaluating the platform cannot complete onboarding.

**Root cause.** `infrastructure/docker/docker-compose.ec2-dev.yml` runs Mailhog with port `8025` bound only to the host loopback; Caddy does not expose it on `dev.provenancelogic.com`. There is no in-app "dev inbox" viewer.

**Proposed fix.** Two options:
1. Add a Caddy route `/mailhog/*` (behind basic auth or a dev-only IP allowlist) that proxies to `mailhog:8025`. Lowest-effort.
2. Embed a minimal React inbox viewer in the frontend that queries Mailhog's `/api/v2/messages` endpoint. Better UX but more code.

Option 1 is acceptable for dev. Not an issue for production (real SES there).

---

## B-002 — Two-view inconsistency: dashboard vs marketplace product views

- **Severity:** Medium
- **Status:** Open
- **Area:** Discovery / publishing

**Symptom.** The same data product renders different information depending on which surface the user lands on:
- `apps/web/src/features/publishing/ProductDetail.tsx` (reached from `/dashboard/:orgId/domains/:domainId/products/:productId`) shows one set of fields.
- `apps/web/src/features/discovery/ProductDetailPage.tsx` (reached from `/marketplace/:orgId/:productId`) shows a different set.

Domain owners see one shape of truth while consumers see another, leading to confusion about what a product actually exposes (ownership, freshness, column schema, access status).

**Root cause.** The two pages grew independently — the publishing view was written first for domain teams; the marketplace view was written later and adopted a different get-product shape. Neither was consolidated when the 5.4 P1 enrichment work landed.

**Proposed fix.** Both pages should consume the same product-detail hook backed by a single `get_product` response shape. The PRD v1.5 "Domain 9 Priority 1 completeness" gap is adjacent — resolve together.

---

## B-003 — WCAG 2.1 AA compliance unverified

- **Severity:** Medium (Blocker for public open-source launch per the accessibility commitment)
- **Status:** Open

**Symptom.** The frontend has not been audited against WCAG 2.1 AA. Known gaps spotted casually: no skip-links, inconsistent focus outlines after Tailwind reset, some icon-only buttons without `aria-label`, form validation error text associated by proximity rather than `aria-describedby`.

**Proposed fix.** Run `axe-core` against every top-level route, fix hard failures, and add a lint-time a11y check (`eslint-plugin-jsx-a11y` is already pulled in; raise its rules from warn to error). Add a `documents/architecture/accessibility.md` that names the target, the audit tooling, and the sign-off criteria before a release can ship.

---

## B-005 — Decommissioned products still visible in domain dashboard

- **Severity:** Low
- **Status:** Open
- **Area:** Publishing / lifecycle
- **Environment:** EC2 dev (`https://dev.provenancelogic.com`)

**Symptom.** "Phase 4b Verification Product" was decommissioned but still appears in the domain dashboard product list. The marketplace correctly hides decommissioned products from consumers, but domain owners see the full lifecycle history (including decommissioned rows) in the authoring surface.

**Root cause (suspected).** `apps/web/src/features/publishing/DomainDashboard.tsx` calls `productsApi.list(...)` without passing a `status` filter, and the API returns every row regardless of lifecycle state. The marketplace path filters server-side to `published | deprecated` only.

**Proposed fix.** Either (a) hide decommissioned rows by default in the domain dashboard with an "Include decommissioned" toggle, or (b) visually demote decommissioned rows (greyed out, grouped at the bottom) so they remain discoverable for audit purposes without cluttering the primary workflow.

Related to the broader Domain 9 lifecycle-visibility gap noted in CLAUDE.md (Phase 5 walkthrough findings).

---

## B-006 — Add Port UI does not enforce contract schema on output ports

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / port authoring

**Symptom.** When adding an output port via the Add Port form in `apps/web/src/features/publishing/ProductDetail.tsx`, the contract schema textarea is not required. A user can save an output port with no contract schema, then only discover the gap at publish time when the API rejects with `Output ports must have a contract schema: <names>`. By that point the user has moved on from port authoring and the feedback is disconnected from the action that caused it.

**Root cause.** The Add Port form marks the contract schema field with a `required` label prop (cosmetic) but the submit handler does not enforce non-empty contract schema for output ports before calling `productsApi.ports.declare()`. Backend validation in `ProductsService.publishProduct()` is correct and authoritative — the frontend simply doesn't mirror it at authoring time.

**Proposed fix.** In the Add Port form submit handler, when `portType === 'output'`, reject submission (display inline error, keep the form open) if `contractSchemaRaw.trim() === ''` or the parsed schema lacks a `properties` / columns shape. Same check applies to any future Edit Port form. Consider refactoring the validation into a shared `validateOutputPortDraft(dto)` helper that both frontend and tests can share.

This is analogous to — and should share scaffolding with — the new connection-details field validation added in Workstream B.

---

## B-007 — Ports not editable after creation

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / port authoring

**Symptom.** Port cards in `apps/web/src/features/publishing/ProductDetail.tsx` only expose a Remove button. There is no Edit affordance, so a user who notices a typo in a port's name, description, contract schema, or (now) connection details has to delete the port and re-add it from scratch. The backend already supports port edits (`PATCH /organizations/:orgId/domains/:domainId/products/:productId/ports/:portId`) — this is a frontend-only gap.

**Root cause.** When the port card was built for Phase 1, ports were mostly declarative metadata and "remove + re-add" was acceptable friction. With Workstream B landing, ports now carry a non-trivial connection-details payload (host, port, database, credentials, etc.) — deleting and re-typing all of that to fix one field is a real papercut.

**Proposed fix.** Add an inline Edit mode to the port card that reuses the Add Port form's fields (including `ConnectionDetailsFields`). Submit via `productsApi.ports.update(...)`. Only author-surface state should be editable — generated artifacts like `connectionDetailsValidated` stay read-only. Consider also auto-resetting `connectionDetailsValidated` to false when any connection-details field changes (the backend already does this per `ProductsService.updatePort()`).

Blocks comfortable authoring now that connection details are required.

---

## B-008 — Request Access button shown to product owner in dashboard view

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / access
- **Related:** B-002

**Symptom.** On the dashboard product detail page (`apps/web/src/features/publishing/ProductDetail.tsx`), an authenticated product owner sees a "Request Access" button for their own product. The marketplace product detail page (`apps/web/src/features/discovery/ProductDetailPage.tsx`) handles the same case correctly — it shows "You own this product" and suppresses the access request affordance.

**Root cause.** Two independent ownership-detection code paths. The marketplace view derives effective access state from `product.ownerPrincipalId === ctx.principalId`. The dashboard view renders the access request CTA unconditionally once the product is published. This is a manifestation of the broader two-view inconsistency tracked in B-002 — neither page pulls ownership/access status from a shared hook.

**Proposed fix.** Fold both views onto the same `useProductAccessState(productDto, principal)` hook that returns an enum `{ owner | granted | pending | denied | not_requested }` and lets each page render the appropriate CTA. The hook should be the single source of truth for "can this principal act on this product?" Resolve together with B-002 when the shared product-detail hook lands.
