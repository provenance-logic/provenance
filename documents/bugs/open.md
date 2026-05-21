# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-063 — Connector framework is "register-only" for every type except PostgreSQL and S3; capability-manifest / discovery-crawl schema doesn't exist; Phase 3 PRD claim of "✅ Complete" does not match the codebase

- **Severity:** High (core product capability gap; the agent + lineage + trust-score story all assume real connectors with discovery, and the platform has neither. The PRD has been claiming this is done since at least the Phase 3 wrap.)
- **Status:** Open
- **Area:** `apps/api/src/connectors/`, `apps/api/migrations/` (missing migrations for `connectors.capability_manifests`, `connectors.discovery_crawl_events`, `connectors.discovery_coverage_scores`), and the discovery-crawl orchestration that doesn't have a file anywhere in the API
- **Discovered:** 2026-05-21, while answering "how would I test registering a Databricks connector?" — the answer turned out to be "you can register a row, nothing else happens for any type except PG or S3."

**Symptom.** Twelve connector types are declared in `packages/types/src/connectors.ts` (postgresql, mysql, snowflake, bigquery, redshift, databricks, s3, gcs, azure_blob, kafka, redpanda, rest_api, custom). The frontend at `/connectors` exposes a registration form that accepts all twelve. The API at `POST /api/v1/organizations/:orgId/connectors` accepts all twelve. But:

- `ConnectorProbeService.probe()` (`apps/api/src/connectors/probe/connector-probe.service.ts:31-39`) has cases for `postgresql` and `s3` only. The default branch returns a synthetic `{ status: 'healthy', responseTimeMs: null, errorMessage: null }`. So clicking "Validate" on any other connector type returns green without doing anything.
- `ConnectorProbeService.inferSchema()` (same file, lines 50-57) has the same shape: PG and S3 only; default returns an empty schema.
- **No discovery crawler exists** for any connector type. The PRD's Phase 3 lists four "priority connectors with discovery mode at MVP" — Databricks (Unity Catalog), dbt (manifest.json), Snowflake (information_schema), Fivetran (metadata API). A repo-wide search for `databricks`, `unity`, or `discovery` matching real implementation code returns nothing in `apps/api/src/`. The crawler code is not stubbed, not in-progress, not on a branch — it doesn't exist.
- **The `connectors.capability_manifests` table does not exist in any migration.** Same for `discovery_crawl_events` and `discovery_coverage_scores`. The CLAUDE.md "Database Schemas" table lists them under the `connectors` schema with the bold annotation `**capability_manifests, discovery_crawl_events, discovery_coverage_scores**`, but no Flyway migration in `apps/api/migrations/` creates them. Confirmed live: `\d connectors.capability_manifests` returns `relation does not exist`.

So the rules in CLAUDE.md that depend on this schema — "Connector capability manifests are immutable per version. Never mutate a capability manifest in place — create a new connector version" and "Coverage scoring: Each connector reports a discovery coverage score per metadata category after each crawl" — are unenforceable because the storage they reference is absent.

**Root cause.** The Phase 3 PRD entry shipped without the discovery-crawl half of its scope. The user-visible lineage emission (push side) was built — `packages/sdk-ts` and `packages/sdk-python` work, the `lineage.emission_log` table is wired, the trust-score recomputation reacts to emissions. The pull side (connector discovery / capability manifests / crawl orchestration / coverage scoring) was tabled and the PRD was marked ✅ anyway. Same shape as the gap B-061 surfaced for governance and B-060 surfaced for operator tooling — a phase declared complete on the basis of API surface and database tables that *named* the feature, without the actual implementation under them.

**Why this matters.**

- The agent story depends on real connectors. "An agent discovers a Snowflake data product, asks for access, runs a federated query" requires the platform to *know* that Snowflake table exists. Today, the only path to that knowledge is hand-seeding the database. That's fine for an investor demo with a curated story; it falls over the moment a contributor or evaluator says "I have a Databricks workspace, show me what this looks like."
- The trust-score and observability story leans on connector health. Today, every connector except PG/S3 is permanently "healthy" because the probe synthesizes it. That makes the trust score's "data source health" component theatre.
- The "first 30 minutes" experience for a new contributor cloning the repo and following the README will end at "I registered a connector, why doesn't anything happen?" The answer they'll arrive at is "this is half a platform." That's worse than B-060 or B-061 because it's *visible*, not buried in an admin endpoint.

**Out-of-scope but related.** On the product-output side (a data product's output port pointing TO Databricks), the situation is also partial — `apps/api/src/products/connection-probes/` has `kafka.probe.ts` only; the implementation-status note on F10.7 already calls out that per-driver SQL probes for postgres/mysql/snowflake are remaining. Databricks isn't there either.

**Fix scope.** This is not a single-PR bug. The right shape is a small program of work that the project should decide whether to take on now or defer. The Databricks-specific sketch is at [`documents/architecture/databricks-integration-sketch.md`](../architecture/databricks-integration-sketch.md) — read that before committing to a scope. Briefly, by layer:

1. **Capability-manifest scaffolding** — migration to add `connectors.capability_manifests`, `discovery_crawl_events`, `discovery_coverage_scores`. Service layer to read/write capability manifests. Validation that a connector's declared mode matches what its capability manifest claims. ~1-2 days.
2. **Per-connector probe implementations** — `probeDatabricks`, `probeSnowflake`, etc. Each is small individually (~½-1 day) but multiplied across the priority connector list. Each needs a credential-fetch path through `secrets-manager.service.ts` (the existing scaffolding only resolves ARN-shaped strings; the actual `getSecretValue` call against AWS Secrets Manager needs verification).
3. **Per-connector schema inference** — for connectors that support it (Databricks via Unity Catalog REST, Snowflake via information_schema, dbt via manifest.json). Same per-connector lift as probes (~1-2 days each).
4. **Discovery crawl orchestration** — Temporal workflow or background job that runs registration crawl + scheduled re-crawl per the capability manifest. Conflict resolution between domain-declared and discovered metadata. Coverage scoring. ~3-5 days, more if Temporal isn't already configured for this kind of long-running workflow (TBD by checking the existing temporal setup).
5. **Lineage projection from discovery** — pulling lineage edges from sources that expose it (Unity Catalog `lineage-tracking` endpoints, dbt manifest deps, Snowflake `account_usage.access_history`). Writing into Neo4j with the `system-discovered` source marker (the marker exists per CLAUDE.md's "Lineage source markers" list; the population path doesn't). ~2-4 days per source, depending on API completeness.

**Minimum viable shape for the next investor demo:** one priority connector real end-to-end (probe + schema + discovery + lineage), capability-manifest scaffolding in place, the existing emission SDK demonstrated calling from a notebook on that same connector's platform. Picking Databricks is the leading candidate because of [[feedback_data_demo_both_directions]] — data-savvy audiences will ask about both directions of integration, and Databricks lets us tell one cohesive story on both sides. Sketch in `documents/architecture/databricks-integration-sketch.md`.

**Pattern.** B-060 was operator tooling that existed without ever being run. B-061 was a security guard that existed without ever being verified. B-063 is a product capability that's been declared complete without ever being implemented. Same family of bug — the gap between "feature is named in the data model / PRD / type system" and "feature actually works end-to-end" — at progressively larger scale. The phase-exit checklist rule added to CLAUDE.md by PR #134 covers exactly this class of issue; B-063 is what catching it earlier would have looked like.

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
