# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-063 — Connector framework is "register-only" for every connector type except PostgreSQL, S3, and (now) Databricks; Phase 3 PRD claim of "✅ Complete" does not match the codebase

- **Severity:** **Blocker** (elevated from High at end of 2026-05-21 session). The platform's whole differentiation is multi-tenant federated mesh of real connectors. Today 3 of 12 advertised types do something meaningful; the other 9 silently fake their probe results. A first-time contributor or evaluator who registers a Snowflake or Kafka connector gets a green checkmark that means nothing. By Matt's stated OSR bar — "every single one of those connectors needs to actually work, EVERY ONE" — this is the gating issue, not a category of partial-shipment.
- **Status:** Open — **Databricks half substantively shipped 2026-05-21** across PRs #142–#146 (Layers 1+2+3a+3b+4 of the sketch). Capability manifest + discovery-crawl schemas now exist for real (V30, V31). Nine other connector types still register-only.
- **Area:** `apps/api/src/connectors/`, the discovery-crawl orchestration (now exists for Databricks only), `packages/types/src/connectors.ts` (the 12-type enum that the platform promises to support).
- **Discovered:** 2026-05-21, while answering "how would I test registering a Databricks connector?" — the answer was "you can register a row, nothing else happens for any type except PG or S3." Elevated to Blocker the same day after Matt corrected the demo-framing the session had been operating under.

### What was true when this bug was filed (early 2026-05-21)

- 12 connector types declared. 2 (postgresql, s3) had real probe + schema. The other 10 fell to a default branch in `ConnectorProbeService.probe()` that returned synthetic `healthy` without doing anything.
- Zero discovery crawlers existed anywhere in `apps/api/src/`.
- `connectors.capability_manifests`, `discovery_crawl_events`, `discovery_coverage_scores` tables referenced by CLAUDE.md did not exist in any migration. The CLAUDE.md "capability manifests are immutable per version" rule was structurally unenforceable.

### What changed during the 2026-05-21 session (PRs #142–#146)

| Layer | PR | What shipped |
|---|---|---|
| 1 | #142 | `probeDatabricks()` against SCIM `/Me` with bearer auth, error classification, 5s timeout. Plus `local-env:` credential sentinel so any connector can be tested in local dev without AWS Secrets Manager. |
| 2 | #143 | `introspectDatabricks()` against Unity Catalog REST `/api/2.1/unity-catalog/tables/{full_name}`. Three-part name validation. |
| 3a | #144 | Discovery crawl: `walkDatabricksWorkspace()` walks catalogs→schemas→tables with pagination, integrates into `crawlConnector()` which idempotently registers sources and captures snapshots. `POST /connectors/:id/crawl`. New `connectors.discovery_crawl_events` table (V30). |
| 3b | #145 | `connectors.capability_manifests` table (V31), seeded Databricks 1.0.0 manifest, read-only `CapabilityManifestService`, `GET /connector-capability-manifests[/:type]` endpoints, **auto-crawl on connector registration** (fire-and-forget, gated on the manifest's `supports_discovery_crawl`). |
| 4 | #146 | `walkDatabricksLineage()` pulls upstream + downstream from Unity Catalog Lineage Tracking API, deduplicates, emits via the existing `LineageService.emitEvent` so the edges land in PostgreSQL `emission_log` AND Neo4j with the same idempotency + trust-score semantics as SDK-emitted lineage. Table-level only. |

Live-verified against Matt's actual Databricks workspace: 10 tables discovered across bronze/silver/gold, 10 schema snapshots, 9 lineage edges (gold-layer consolidation + cross-catalog publish pattern), all synced to Neo4j. Idempotent re-crawl confirmed.

### What is still open after tonight

**The 9 other connector types are unchanged.** mysql, snowflake, bigquery, redshift, gcs, azure_blob, kafka, redpanda, rest_api, custom — all still register with synthetic-healthy fakery, no schema inference, no discovery, no lineage. The default branch in `connector-probe.service.ts` still returns `{ status: 'healthy', responseTimeMs: null, errorMessage: null }` for every type that isn't in the explicit switch. **This is the bulk of B-063.** One workspace of one connector type doesn't move the platform out of "claims things it doesn't do" territory — it just makes ONE of the lies true.

Other remaining items within Databricks specifically (smaller scope):

- **Layer 4b — column-level lineage** via Unity Catalog `/api/2.0/lineage-tracking/column-lineage`. Table-level is the demo beat; column-level is richness on top.
- **Layer 5 — push-side notebook** demo (mostly external artifact, not platform code).
- **Layer 3c — Temporal scheduled re-crawls** (today crawl is operator-triggered + on-registration; no durable re-crawl schedule).
- **`discovery_coverage_scores` table + per-metadata-category scoring** (referenced in CLAUDE.md, never built).
- **Conflict resolution** between discovered and domain-declared metadata (CLAUDE.md describes the rule; no enforcement code exists).

### Strategic question for the 2026-05-24 weekend PRD overhaul

The fix path isn't a sprint plan — it's a scoping decision. Three real options:

1. **Implement all 12 connector types end-to-end.** Each is 3–8 days at Databricks's lift. ~8–16 weeks of focused work. Closes B-063 in the strict sense.
2. **Narrow the PRD scope.** Ship OSR with a documented smaller set (e.g. "PG + S3 + Databricks are first-class; others marked Experimental with no probe and a clear warning"). Honest about what works.
3. **Hide the unimplemented types.** Remove them from the registration UI and the enum until they're real. Smallest behavioral change; most aggressive scoping fix.

Each option has different consequences for the agent story, the demo story, the marketing posture, and the contributor experience. **Matt is taking this to the drawing board the 2026-05-24 weekend.** Don't act on B-063 before that conversation resolves the scope question.

### Pattern (preserved for the weekend re-audit)

B-060 was operator tooling that existed without ever being run. B-061 was a security guard that existed without ever being verified. B-063 is a product capability that was declared complete without ever being implemented. **Same family of bug at progressively larger scale.** The phase-exit checklist rule added to CLAUDE.md by PR #134 covers exactly this class of issue; B-063 is what catching it earlier would have looked like. Worth assuming other PRD "✅ Complete" entries — and CLAUDE.md architectural claims — have the same shape until proven otherwise. The weekend conversation should include a pass through every "Implemented" / "✅" claim against the actual code.

### Files of record from the 2026-05-21 session

- `documents/architecture/databricks-integration-sketch.md` — the five-layer plan with per-layer lift estimates. Updated 2026-05-21 to mark shipped vs deferred.
- `apps/api/migrations/V30__create_discovery_crawl_events.sql`
- `apps/api/migrations/V31__create_capability_manifests.sql`
- Memory: `feedback_osr_means_every_connector_real.md` — the OSR bar Matt set 2026-05-21.

---

## B-062 — RLS-by-default: the `provenance.current_org_id` session variable doesn't persist across the connections a request actually uses

- **Severity:** Medium (defense-in-depth gap; the immediate cross-org leak is closed at the controller boundary by [B-061](resolved.md#B-061-cross-org-information-leak-the-jwt-auth-guard-did-not-check-the-url-orgid-against-the-tokens-claim)'s fix, but the database-layer guarantee the platform's RLS policies were designed to provide is not actually in force on most service-layer queries today)
- **Status:** Open
- **Area:** `apps/api/src/database/org-context.middleware.ts`, TypeORM connection-pool interaction with `SET LOCAL`-style session config
- **Discovered:** 2026-05-21, surfaced during [B-061](resolved.md#B-061-cross-org-information-leak-the-jwt-auth-guard-did-not-check-the-url-orgid-against-the-tokens-claim) root-cause analysis.

**Symptom (subtle).** RLS policies on every tenant-scoped table read `current_setting('provenance.current_org_id', true)::UUID` to filter. With the B-061 guard in place, the cross-org leak is closed at the API layer — any URL/JWT mismatch is rejected before the service runs. But if the guard ever gets a bypass (e.g. a future controller declares its path parameter with a different name than `orgId`, or a new bootstrap path mounts under `/organizations/:foo/...`), the database layer will not catch it. RLS is the platform's last line of defense and right now it isn't actually defending most of the surface.

**Root cause.** `OrgContextMiddleware` (`apps/api/src/database/org-context.middleware.ts`) calls `SELECT set_config('provenance.current_org_id', $1, true)` on `this.dataSource.query(...)`. The `true` is `is_local`, which scopes the variable to the current transaction. But `dataSource.query` acquires a fresh connection from the pool, runs the `SET LOCAL` in an auto-commit transaction, releases the connection. The next query (from the actual service-layer call) acquires a **different** connection from the pool, where the variable is unset. `current_setting('...', true)` returns NULL, the RLS USING clause evaluates to `org_id = NULL` (false), and the policy returns zero rows — except that several controllers' service queries don't go through a path where RLS is enforced for the application role anyway (they run as the postgres owner via TypeORM, which inherits BYPASSRLS).

So: RLS exists, the middleware tries to set the session variable, neither actually works end-to-end.

**Confirmation method.** Easy live check: instrument the middleware to log the connection id it sets the variable on, instrument the relevant service queries to log the connection id they're running on, observe that they differ on most requests. Or: write a query that calls `pg_backend_pid()` from both contexts.

**Why we're not freaking out today.** The B-061 guard closes the actual data-leak surface that mattered to a multi-tenant deployment. Failure mode if RLS-by-default doesn't ship: a future regression in the controller-layer guard would re-expose data. The platform is safe **as long as the guard is correct on every org-scoped route**. That's a reasonable invariant for the OSR milestone — but it's a structural debt the project should be honest about.

**Fix paths (need a design pass, not a one-PR job).**

1. **Per-request, sticky connection.** Hold a single TypeORM `QueryRunner` for the lifetime of the request, set the session variable on it once, route every service-layer query through that runner. Big refactor — every repository would need to accept a runner or operate inside a request-scoped data source.
2. **Transactional wrapper around every request.** A Nest interceptor that opens a transaction at request start, sets `SET LOCAL` inside it, commits at end. Queries inside the transaction inherit the session variable. Smaller per-call diff but every request now runs in a transaction, which changes the failure-mode shape (a single service-layer error rolls back the whole request including the parts that wanted to side-effect on partial failure — e.g. notifications, outbox events).
3. **Move tenant filter into the query layer, drop reliance on RLS for the hot path.** Treat RLS as a backstop only, and require every service-layer query to filter explicitly on `orgId = ctx.orgId`. Pairs well with the B-061 guard since the guard already enforces `ctx.orgId === url.orgId`. RLS stays in place but is no longer the only check.

Option 3 is closest to what the platform actually does today on the safe controllers (B-061's "safe list" — they all filter on `ctx.orgId` explicitly). Formalizing that as a pattern and adding a lint rule (or just a CI grep) for `@Param('orgId')` flowing into a service call without an accompanying `ctx.orgId` check would catch the next B-061 at PR time.

**Also worth covering when this lands.** The B-061 guard checks `request.params.orgId` specifically. If a future controller mounts at `/organizations/:organizationId/...` or `/:tenantId/...`, the guard's `request.params.orgId` will be undefined and the check will silently pass. Either standardize the param name (lint rule / convention) or have the guard inspect every `:*Id`-shaped param that's a UUID against the JWT.

**Verification scaffold.** When this lands, extend `demo-smoke-test.sh` further: add a layer that simulates a guard bypass (e.g. directly inject a service-layer call with a mismatched orgId via a test-only endpoint behind `SEED_ENABLED`) and assert RLS returns zero rows. Without that, defense-in-depth is unverifiable.

**Pattern.** B-061 taught the project: "the URL is part of the security surface a phase ships." B-062 is the follow-up: "controller guards are the user-facing security surface; RLS is the durable security surface; both should be in force, and right now only one is." Until B-062 closes, every new org-scoped controller is leaning on one wall instead of two.

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

---

## B-064 — CLAUDE.md schema list names 7 tables that aren't actual tables

- **Severity:** Low (documentation-only; the data those tables would have stored is present, packaged differently — except 2 truly missing)
- **Status:** Open
- **Area:** `CLAUDE.md` "Database Schemas (PostgreSQL)" section
- **Discovered:** 2026-05-22, by the claim-vs-code audit (`documents/audits/claim-vs-code-2026-05-22.md`).

**Symptom.** CLAUDE.md lists 35 named tables across 9 schemas. Migrations create 32 of them. The other 7 are either documentation drift (data exists embedded in another table) or genuinely don't exist:

| Named in CLAUDE.md | Reality |
|---|---|
| `organizations.domain_extensions` | Not a table; `scope_type='domain_extension'` is a value within `governance.effective_policies` (V5:90). |
| `identity.roles` | Not a table; roles are enum-like values within `identity.role_assignments.role`. |
| `products.port_contracts` | Not a table; contract is a `contract_schema JSONB` column on `products.port_declarations` (V3). |
| `connectors.discovery_coverage_scores` | Not a table; not in any migration. CLAUDE.md's discovery coverage scoring claim has no storage backing. |
| `consent.use_case_declarations` | Not a table; use-case fields are columns on `consent.connection_references` (V18). |
| `consent.consent_records` | Not a table; V18 comment says "will add audit.consent_records table" — never created. Audit log substitutes per F12.11 in implementation-status.md. |
| `observability.observability_snapshots` | Not a table; not in any migration. No observability snapshot mechanism exists. |

**Impact.** A contributor reading CLAUDE.md to understand schema topology would be misled. Five of the seven are harmless (data exists, embedded differently). Two are real gaps:

- `discovery_coverage_scores` — the discovery coverage scoring framework that CLAUDE.md's "Connector Discovery Architecture" section relies on doesn't exist. Same B-063-family issue: declared but not implemented.
- `observability_snapshots` — no equivalent table or mechanism anywhere. Pure dead reference.

**Fix path.** Documentation pass on CLAUDE.md's schema list. Three real options:

1. Drop the misnamed tables; document where the data actually lives (e.g. "use-case declaration data is carried as columns on `connection_references`").
2. Annotate each misnamed entry with its real location inline.
3. Build the missing tables (only relevant for `discovery_coverage_scores` if the discovery scoring framework is kept in the PRD overhaul; `observability_snapshots` is unused and should just be removed from the doc).

Pick during the 2026-05-24 weekend overhaul — the right answer depends on whether those CLAUDE.md sections are restructured or trimmed.

**Pattern.** Schema-list drift is its own category of documentation rot: tables get renamed, data gets restructured into JSONB columns, projection tables planned but never built — and the doc lags. A periodic "diff CLAUDE.md schema list against `\dt` output" check would catch this class of drift earlier. Same family as B-063 / B-060 but at the documentation surface.

---

## B-065 — Security rule "TLS 1.3 enforced at Kong" is misleading for MVP

- **Severity:** Medium (security-doc claim doesn't match deployed reality; a contributor evaluating the platform's security posture would form a wrong mental model)
- **Status:** Open
- **Area:** `CLAUDE.md` "Security Rules (Never Violate)" section
- **Discovered:** 2026-05-22, by the claim-vs-code audit (`documents/audits/claim-vs-code-2026-05-22.md`).

**Symptom.** CLAUDE.md states as a security rule: *"TLS 1.3 enforced at Kong for all external traffic."* This is not what the MVP does today.

Verified from `infrastructure/docker/docker-compose.yml` and `docker-compose.ec2-dev.yml`:

- Kong is present in the compose file (ports 8000 proxy, 8001 admin, 8100 status), Postgres-backed, with `DISABLE_SECURITY_PLUGIN: "true"` set in dev.
- The web frontend's `VITE_API_BASE_URL` defaults to `http://localhost:3001/api/v1` — bypassing Kong entirely. The API is reached directly at the api container.
- TLS termination on hosted deployments (dev.provenancelogic.com, demo.provenancelogic.com) is done by **Caddy** with Let's Encrypt certs (per `docker-compose.ec2-dev.yml` and the status board "Demo environment" section). Kong sits beside Caddy, not in front of it.
- Local dev runs HTTP-only.

The claim is accurate ONLY for a hypothetical Phase 6 production EKS deployment where Kong is intended to be the gateway. For MVP, the truthful statement is "TLS 1.3 enforced at Caddy on hosted deployments; HTTP-only locally."

**Impact.** A contributor or security reviewer reading CLAUDE.md as documentation of what the platform does today would be misled about the TLS termination path. The claim also implies Kong is the authoritative gateway — which would mislead anyone trying to add a gateway plugin, rate-limiting rule, or auth middleware to Kong. Kong is structurally present but does not sit on the data path that user traffic uses.

**Fix path.** Documentation pass on CLAUDE.md's "Security Rules" section. Replace the Kong claim with a deployment-tier-aware statement:

- **MVP / dev / demo:** Caddy terminates TLS with Let's Encrypt certs on hosted deployments. Local dev is HTTP-only on `localhost:*` ports.
- **Phase 6 / production EKS:** Kong Gateway terminates TLS (aspirational target, not in force).

Either rewrite the security rule to distinguish tiers, or move the Kong claim to the Phase 6 production stack table (where it already lives separately, accurately).

**Pattern.** Same family as B-064: CLAUDE.md claims describe an aspirational future state rather than what the MVP actually does. The production-stack table in CLAUDE.md *does* list Kong honestly as "production" — the drift is in the security-rules section that doesn't qualify the claim with a deployment tier.

---

## B-066 — Legacy connection reference UI doesn't visually distinguish from properly requested references

- **Severity:** Low (no live legacy refs on most installs — only matters on installs that ran the F12.25 legacy-agent-migration endpoint; the rule is vacuously honored until then)
- **Status:** Open
- **Area:** `CLAUDE.md` "Claude Code Patterns" ("Legacy compatibility references are visually distinct and non-renewable"); `apps/web/src/features/agents/`
- **Discovered:** 2026-05-22, by the claim-vs-code audit (`documents/audits/claim-vs-code-2026-05-22.md`). Originally documented as a deferred Domain 12 item in `implementation-status.md`; the audit surfaced that the deferral conflicts with a CLAUDE.md operational rule.

**Symptom.** CLAUDE.md states as an operational rule: *"Legacy compatibility references are visually distinct and non-renewable. The auto-provisioned 30-day legacy-compatibility references created at Domain 12 enforcement activation must be rendered differently in the UI from properly requested references."*

The data carries the distinction (`caused_by='legacy_migration'` per V28; distinct notification category `connection_reference_legacy_provisioned`). The frontend does NOT render the distinction — both legacy and properly-requested refs render the same in the UI today. `implementation-status.md` Domain 12 explicitly lists this as a deferred item: *"Frontend UI distinguishing legacy refs from properly requested refs (the data carries `caused_by` and a distinctive use-case category; the UI renders them the same today)."*

The CLAUDE.md rule and the implementation-status.md deferral are inconsistent — one says "must be rendered differently" as a binding pattern; the other says "deferred, not OSR-blocking." Both can't be right.

**Impact today.** Limited — the F12.25 legacy-migration endpoint is operator-invoked, and most installs haven't run it. On an install that DID run it, an agent operator looking at the connection references list cannot tell at-a-glance which refs are 30-day legacy stubs (expiring, non-renewable) versus properly-approved refs. They would have to inspect the `caused_by` field individually.

**Fix paths.**

1. **Ship the UI distinction.** Add a `legacy` badge or distinctive styling + an explicit "legacy 30-day compatibility ref — non-renewable" label to legacy rows. Small frontend change. Closes the inconsistency by making the rule true.
2. **Move the rule out of CLAUDE.md.** If shipping the UI distinction isn't a near-term priority, demote the rule from "Claude Code Patterns" (which reads as in-force) to a deferred-features list or remove it entirely. Closes the inconsistency by removing the false rule.

Pick during the 2026-05-24 weekend overhaul, or whenever the Domain 12 deferred items get re-prioritized.

**Pattern.** Same family as B-064 / B-065: CLAUDE.md operational rules read as in-force invariants; when implementation-status.md explicitly defers an item, the two should be reconciled — either ship the rule or remove the claim.

---

## B-067 — Security rule "Agent access scope enforced at infrastructure level" doesn't match code

- **Severity:** Low (the layer that's actually enforcing — application-level — is real, verified, and doing the work; the misleading claim is in the doc only, not a security gap)
- **Status:** Open
- **Area:** `CLAUDE.md` "Security Rules (Never Violate)" section
- **Discovered:** 2026-05-22, by the claim-vs-code audit (`documents/audits/claim-vs-code-2026-05-22.md`).

**Symptom.** CLAUDE.md states as a security rule: *"Agent access scope enforced at infrastructure level, not application policy check only."*

Per `implementation-status.md` F6.8, the actual state is: *"Application-level enforcement; infrastructure-level not verified."*

What's actually shipping today:

- `ConnectionReferenceGuard` runs on every product-bound MCP tool call in the Agent Query Layer (`apps/agent-query/src/auth/connection-reference.guard.ts`). It enforces active grant AND active reference AND scope match.
- Five distinct denial codes plus a safety-belt for unknown tools. Tested and verified end-to-end across PRs #77–#86.
- This is **application-level** enforcement — the JS code in the AQL process decides whether to dispatch the tool.

What's NOT shipping (despite the CLAUDE.md claim):

- No Kong plugin enforcing scope at the gateway. (Kong isn't on the data path anyway — see [B-065](#b-065-security-rule-tls-13-enforced-at-kong-is-misleading-for-mvp).)
- No iptables / network-level scope enforcement.
- No infrastructure-layer guarantee that an agent can't reach scopes outside its grant if the AQL application code is bypassed.

**Impact.** Less severe than B-065's TLS misstatement — application-level enforcement IS real and IS doing the work, so there's no immediate security gap. But the claim sets up the wrong mental model: a contributor reading CLAUDE.md might assume infra-level enforcement is in place and rely on it (e.g. "the network blocks scope violations regardless of what the AQL does"). F6.8's "Application-level enforcement; infrastructure-level not verified" framing is more honest.

**Fix path.** Documentation pass on CLAUDE.md's "Security Rules" section. Replace the rule with an accurate framing:

> "Agent access scope enforced by the AQL `ConnectionReferenceGuard` on every product-bound MCP tool call. Infrastructure-level enforcement (Kong plugin / network policy) is a Phase 6 hardening item, not in force today."

OR commit to building infra-level enforcement (much bigger Phase 6 effort, doesn't belong in MVP scope).

**Pattern.** Same family as B-064 / B-065 / B-066: CLAUDE.md "Never Violate" rules read as enforced invariants; implementation-status.md flags some as partial or application-layer-only. The two source-of-truth docs should match. The 2026-05-22 audit caught three of these in the security-rules section alone (B-065, B-067, plus the partial RLS-by-default already tracked as B-062) — worth a section-by-section pass during the 2026-05-24 weekend overhaul.
