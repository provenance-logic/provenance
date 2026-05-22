# Resolved Bugs

Reference log of bugs that have been fixed. Kept so patterns and root causes are searchable without digging through git history. Each entry links to the fix commit.

Entries are ordered newest first. When opening a bug in [open.md](./open.md), check this file first — the same root cause may have already been diagnosed.

---

## B-005 — Decommissioned products hidden by default in domain dashboard

- **Resolved:** 2026-05-22
- **PR:** [#154](https://github.com/provenance-logic/provenance/pull/154)
- **Severity:** Low
- **Area:** `apps/web/src/features/publishing/DomainDashboard.tsx`

**What was wrong.** The domain dashboard's product grid called `productsApi.list(...)` without a status filter, so decommissioned products mixed in with active ones — cluttering the primary authoring workflow for domain owners. The marketplace path filters server-side to active lifecycle states only; the dashboard path did not.

**Fix.** Frontend-side filter: decommissioned products hidden by default. When the domain has at least one decommissioned product, a checkbox above the grid surfaces the count and lets the owner opt in to seeing them (e.g. for audit lookback). When all products in the domain are decommissioned, the empty state explains why and points at the toggle.

Chose the frontend-filter path over an API-side change because the dashboard already fetches all products in one call and the data volumes per domain are small. If an API-side `status_in` array filter becomes useful elsewhere (e.g. for paginated lookups against domains with thousands of decommissioned products), that's a separate generalization.

**Pattern.** Lifecycle states that signal "done, archive" should be hidden by default in workflow-primary surfaces but discoverable via opt-in. Same shape as PR #45's marketplace lifecycle-visibility fix (which handled the consumer-facing surface); this PR handles the producer-facing surface.

---

## B-063 Layer 4 — Databricks lineage projection from Unity Catalog → Neo4j

- **Resolved:** 2026-05-21 (partial — B-063 itself remains Open as the 9 other connector types are still register-only)
- **PR:** [#146](https://github.com/provenance-logic/provenance/pull/146)
- **Severity:** part of B-063 (Blocker)
- **Area:** `apps/api/src/connectors/probe/connector-probe.service.ts`, `apps/api/src/connectors/connectors.service.ts`

**What shipped.** `walkDatabricksLineage()` pulls upstream + downstream edges per discovered table from Unity Catalog's Lineage Tracking API (`GET /api/2.0/lineage-tracking/table-lineage?table_name=X`), deduplicates edges seen from both endpoints, and treats 404 ("no lineage tracked") as zero edges rather than an error. Network/5xx errors on individual table calls are collected in `tablesWithErrors` so the walk continues with partial coverage.

The orchestration in `crawlConnector` calls `walkDatabricksLineage` after sources + snapshots are persisted, then for each discovered edge emits via the existing `LineageService.emitEvent` with `source_node` / `target_node` as `Source` nodes keyed by Databricks full name (`catalog.schema.table`), `edge_type='DERIVES_FROM'`, `emitted_by='databricks-discovery-crawl'` (the `system-discovered` marker), and a deterministic `idempotency_key` so re-crawls don't duplicate. Counts persisted to `discovery_crawl_events.metadata`: `lineageEdgesEmitted`, `lineageEdgesSkipped`, `lineageEdgesFailed`, `tablesWithLineageErrors`.

**Live verification.** Against Matt's workspace: 9 lineage edges discovered, all synced to Neo4j, queryable via the existing `GET /lineage/products/.../downstream` endpoint with no new UI work. The discovered edges revealed two real patterns: gold-layer consolidation (multiple `workspace.gold.*` feeding `mro_work_enriched`) and cross-catalog publish (`workspace.gold.* → navy_readiness.*`). Idempotent re-crawl: 0 emitted, 9 skipped.

**What's still open within Layer 4.** Column-level lineage (Layer 4b) via `/api/2.0/lineage-tracking/column-lineage`. Lineage delta detection across crawls (today re-crawl is "skip if seen"). First-class `system-discovered` column on `emission_log` (we use `emitted_by` today).

**Pattern.** Reusing the existing `LineageService.emitEvent` for system-discovered lineage means discovered edges land alongside SDK-emitted edges with the same trust-score recompute + Neo4j sync + idempotency semantics. **No new graph code, no new UI code.** The right shape for the future connector types' lineage projection.

---

## B-063 Layer 3b — Capability manifests + auto-crawl on connector registration

- **Resolved:** 2026-05-21 (partial)
- **PR:** [#145](https://github.com/provenance-logic/provenance/pull/145)
- **Area:** `apps/api/migrations/V31__create_capability_manifests.sql`, `apps/api/src/connectors/capability-manifest.{service,controller}.ts`, `apps/api/src/connectors/connectors.service.ts`

**What shipped.** Migration V31 creates `connectors.capability_manifests` — the storage CLAUDE.md described as "immutable per version" but no migration ever created. Schema includes `supports_probe`, `supports_schema_inference`, `supports_discovery_crawl`, `supports_lineage_emission`, `supports_lineage_discovery`, `discovery_granularity` (`asset_level | column_level`), `re_crawl_interval_hours_default`, plus a `capabilities_doc` JSONB for richer per-category metadata (e.g. CLAUDE.md's metadata-category coverage levels). `GRANT SELECT, INSERT` only; `REVOKE UPDATE, DELETE` at the role level — that's the structural guarantee of the immutability rule. Seeded with the Databricks 1.0.0 manifest matching what Layers 1–3a actually ship.

`CapabilityManifestService` exposes `listManifests()`, `getLatestForType()`, `getLatestForTypeOrThrow()` and **nothing else**. A unit test pins this with a method-name regex (`expect(name).not.toMatch(/^(update|delete|remove|save|create)/i)`) so a future regression fails loudly. New manifests land via Flyway migrations only.

`GET /api/v1/connector-capability-manifests` and `GET .../:type` endpoints; mounted at platform level because manifests are facts about the platform, not per-tenant state.

**Auto-crawl on registration.** In `ConnectorsService.registerConnector`, after the probe completes with `validation_status='valid'`, look up the capability manifest. If `supportsDiscoveryCrawl` is true, `void this.crawlConnector(...).catch(log)` — fire-and-forget so the registration response returns immediately. Crawl outcomes land on the `discovery_crawl_events` history.

**Live verification.** Registration returned in 392ms; 4 seconds later the discovery_crawl_events table had 1 succeeded row, 10 source registrations, and 10 schema snapshots — all credited to the registering user. The "register a Databricks connector, watch your medallion architecture appear" demo moment works.

**Not Temporal yet.** Fire-and-forget is non-durable across api restarts. Layer 3c will replace it with a durable workflow.

---

## B-063 Layer 3a — Databricks discovery crawl

- **Resolved:** 2026-05-21 (partial)
- **PR:** [#144](https://github.com/provenance-logic/provenance/pull/144)
- **Area:** `apps/api/migrations/V30__create_discovery_crawl_events.sql`, `apps/api/src/connectors/entities/discovery-crawl-event.entity.ts`, `apps/api/src/connectors/connectors.service.ts`, `apps/api/src/connectors/probe/connector-probe.service.ts`

**What shipped.** `walkDatabricksWorkspace()` walks Unity Catalog three levels deep (catalogs → schemas → tables) with `next_page_token` pagination support and a 50-page safety cap. Optional `catalogScope` parameter limits the walk. `information_schema` schema explicitly skipped.

`ConnectorsService.crawlConnector()` orchestrates: walk the workspace, look up existing sources by `(connector_id, sourceRef)` for idempotency, create source registrations for new tables, capture a schema snapshot for each via Layer 2's `introspectDatabricks`, persist counts to the new `connectors.discovery_crawl_events` row.

New endpoints: `POST /connectors/:id/crawl` and `GET /connectors/:id/crawl-events`.

**Discovery_crawl_events table.** Per-row crawl audit: status (`running | succeeded | partial | failed`), counts (catalogs/schemas/tables walked, sources created/skipped, snapshots captured/failed), error message, JSONB metadata. RLS enabled.

**Live verification.** First crawl against Matt's workspace: 10 tables discovered across bronze/silver/gold + default schemas (information_schema correctly skipped), 10 source registrations + 10 schema snapshots created, 1.63s elapsed. Idempotent re-crawl: 0 created, 10 skipped.

**Caught while developing: a TypeORM gotcha.** Entity registered in `TypeOrmModule.forFeature` on the module isn't enough — the entity must ALSO be in `TypeOrmModule.forRoot`'s `entities[]` array in `DatabaseModule`. Otherwise `EntityMetadataNotFoundError` at first repository injection.

---

## B-063 Layer 2 — Databricks schema inference via Unity Catalog REST

- **Resolved:** 2026-05-21 (partial)
- **PR:** [#143](https://github.com/provenance-logic/provenance/pull/143)
- **Area:** `apps/api/src/connectors/probe/connector-probe.service.ts`

**What shipped.** `introspectDatabricks()` calls `GET /api/2.1/unity-catalog/tables/{catalog}.{schema}.{table}` with bearer auth. Source ref must be a three-part name; two-part (no catalog) is explicitly rejected at the boundary to avoid silently hiding misconfigured sources — that's the exact "phantom endpoint" anti-pattern B-060 caught the project doing previously.

Response is normalized: columns sorted by position, mapped to `{name, type, nullable, position, comment}`. Type sourced from `type_text` with fallback to `type_name`. Nullable defaults to true if absent (matches Databricks's own default). `schemaDefinition` also carries table-level metadata (`tableType`, `dataSourceFormat`, `comment`) from the top-level UC response. `rowEstimate: null` — UC doesn't expose row counts cheaply, deferred.

**Live verification.** `workspace.silver.mro_clean` → 27 columns (matched the direct UC API byte-for-byte). Bad source ref (`silver.mro_clean`, missing catalog) returned a clean error via the api logs.

---

## B-063 Layer 1 — Real Databricks connectivity probe + `local-env:` credential sentinel

- **Resolved:** 2026-05-21 (partial)
- **PR:** [#142](https://github.com/provenance-logic/provenance/pull/142)
- **Area:** `apps/api/src/connectors/probe/connector-probe.service.ts`, `apps/api/src/connectors/probe/secrets-manager.service.ts`, `apps/api/src/connectors/probe/raw-credential-guard.ts`

**What shipped (probe).** `probeDatabricks()` hits `GET /api/2.0/preview/scim/v2/Me` with bearer auth and a 5s AbortController timeout. Maps HTTP status to `HealthStatus`: 200 → `healthy`, 401/403 → `credential_error`, 504/408 → `timeout`, other 4xx/5xx → `unreachable`. Network errors → `unreachable`. AbortError → `timeout`.

**What shipped (sentinel — bonus scope, flagged in the PR body).** The `raw-credential-guard` correctly blocks plaintext credentials in `connectionConfig` (CLAUDE.md security rule), which meant before this PR there was no way to provide credentials for *any* connector in local dev without real AWS Secrets Manager. Added a `local-env:VARNAME` sentinel: when `credentialArn` matches that pattern, `SecretsManagerService.getSecretValue` reads `process.env[VARNAME]` and parses as JSON instead of calling AWS. Production deploys never hit this branch — env vars unset → fails closed. `isValidCredentialArn` extended to accept the sentinel alongside real AWS ARNs.

One example env var (`DATABRICKS_DEV_TOKEN`) wired through `docker-compose.ec2-dev.yml`'s api environment block; new connectors follow the same pattern. `.env.example` documents the workflow.

**Live verification against Matt's workspace.** Happy path: 200 + identity in ~300ms → `healthy`. Negative path: deliberately bad PAT → real workspace 403 → `credential_error`. Both confirmed.

**Pattern that unlocked the rest of B-063.** The `local-env:` sentinel is what makes the entire connector framework testable end-to-end on a laptop without AWS. Without it, every subsequent layer would have needed a real Secrets Manager secret to verify.

---

## B-063 filed — Connector framework is register-only beyond PG/S3; Databricks integration sketch written

- **Filed:** 2026-05-21
- **PR:** [#141](https://github.com/provenance-logic/provenance/pull/141)
- **Outcome:** elevated to **Blocker** at end of session after Matt's correction. Tracked as the central open item for the 2026-05-24 weekend PRD overhaul.

**What this PR did.** Filed B-063 in `open.md` documenting the gap surfaced by "how do I test registering a Databricks connector?": 12 connector types declared, 2 (postgresql, s3) had real implementations, the other 10 returned synthetic-healthy. Zero discovery crawlers existed. Capability manifest / discovery_crawl_events / discovery_coverage_scores tables CLAUDE.md referenced didn't exist in any migration. Phase 3 PRD claim of "✅ Complete" did not match the codebase.

Also wrote `documents/architecture/databricks-integration-sketch.md` — five-layer breakdown (probe → schema → discovery crawl → lineage projection → push side) with per-layer lift estimates (central: ~8–10 days for Databricks alone, ~8–16 weeks for all four PRD priority connectors).

**This filing teed up the Layers 1–4 implementation arc that landed in PRs #142–#146 the same night.** B-063 itself remains Open — the sketch covered Databricks only; the other 9 register-only connector types are unchanged.

---

## B-061 — Cross-org information leak: the JWT auth guard did not check the URL `:orgId` against the token's claim

- **Resolved:** 2026-05-21 — fix PR pending (commit hash on merge)
- **Severity:** was High (cross-tenant information leak, OSR-blocking)
- **Area:** `apps/api/src/auth/jwt-auth.guard.ts`

**Symptom.** Authenticated as `admin@acme.example.com` (JWT `provenance_org_id = <Acme>`), calling `/api/v1/organizations/<Beta>/...` returned HTTP 200 with **Beta's** data on three confirmed endpoints:

- `GET /governance/dashboard` — leaked counts (`totalPublished: 4` for Beta, vs Acme's 12)
- `GET /governance/effective-policies` — leaked actual rows (response items carried `orgId = <Beta>`)
- `GET /products/<beta-product>/trust-score` — leaked the score; a mismatched call (own orgId + foreign product UUID) appeared to commit a cross-org **write** (response payload claimed `org_id = <Acme>` for a Beta product, suggesting a new `observability.trust_score_history` row mis-attributed to the caller's tenant)

Other endpoints (`/access/grants`, `/access/requests`, `/marketplace/products`) handled the same swap correctly — they ignored the URL `:orgId` mismatch and returned the caller's own data — so the gap was per-controller, not platform-wide.

**Root cause.** Two controller patterns coexisted: safe controllers used `ctx.orgId` (resolved from the JWT) while leaky ones passed `@Param('orgId')` (the URL value) straight through to the service. The `JwtAuthGuard` enforced that the JWT carried a non-empty `provenance_org_id` claim, but not that it matched the URL. The `OrgContextMiddleware` set `provenance.current_org_id` for RLS, but it used `set_config(..., is_local=true)` on a transient pool connection that released before the service-layer query acquired a fresh one — so the RLS layer wasn't catching the gap either.

**Fix.** Extended `JwtAuthGuard.canActivate` with a final check: when `request.params.orgId` is present and `request.user.orgId` is non-empty, throw `ForbiddenException` on mismatch. One control point, applies to every route already protected by the guard (i.e. every tenant-scoped controller — they all use `@UseGuards(JwtAuthGuard)`). The MCP service-account bypass earlier in the same guard short-circuits before this check, preserving the privileged inter-service path. `@AllowNoOrg` routes don't carry `:orgId` in their URLs, so the check is a no-op there.

**Test added.** Five new unit tests in `apps/api/src/auth/jwt-auth.guard.spec.ts`:
- URL/JWT mismatch → 403
- URL/JWT match → pass
- Route without `:orgId` param → pass
- MCP service-account path with empty user.orgId → pass (privileged bypass preserved)
- Agent JWT targeting a different org — pinned as "currently passes" to document the boundary; the MCP key path returns true before the new check runs, so the cross-org enforcement on the agent-via-MCP path is part of the B-062 follow-up

Plus a new step in `infrastructure/scripts/demo-smoke-test.sh` layer 5 — picks a foreign org id from the marketplace listing and asserts `/governance/dashboard` and `/governance/effective-policies` return 403. Regression check that fails loud the next time someone introduces a guard bypass.

**Verification.** Restarted the API container with the change and re-ran the original B-061 probe against the local stack:

```
== B-061 cross-org probe after fix ==
-- own org (Acme) — should still PASS --
  /governance/dashboard:           HTTP 200
  /governance/effective-policies:  HTTP 200
-- foreign org (Beta) — should now 403 --
  /governance/dashboard:           HTTP 403
  /governance/effective-policies:  HTTP 403
  /products/<beta>/trust-score:    HTTP 403
-- previously safe endpoints (regression check) --
  /access/grants (own org):        HTTP 200
  /marketplace/products (global):  HTTP 200
```

Error body on the 403:

```
{"message":"Org scope mismatch: token is scoped to a different organization than the URL targets","error":"Forbidden","statusCode":403}
```

**What's still open.** The structural defense-in-depth — making RLS actually defend the surface, not just the controller-layer guard — is a separate, larger refactor tracked as [B-062](open.md#B-062). With the guard in place, the leak is closed and the platform is safe **as long as the guard is correct on every org-scoped route**. B-062 is the work that makes the platform safe even if the guard ever has a bypass.

**Pattern.** Same shape as the B-060 family: the affected surface (here, the URL parameter) was a security boundary the codebase wasn't treating like one. The fix is one extra line of comparison at the existing boundary check — it just had to be written down. Worth doing the same audit any time a new path parameter shows up in a controller: is it being checked against the token, or just used?

---

## B-060 (part 2) — `demo-smoke-test.sh` layers 3–6 targeted flat endpoints the API never exposed

- **Resolved:** 2026-05-21 — fix PR pending (commit hash on merge)
- **Severity:** was Medium (the pre-demo green-light gate was effectively unavailable at the layer that matters most — control plane, data plane, observability)
- **Area:** `infrastructure/scripts/demo-smoke-test.sh`

**Symptom.** Layers 3, 5, and 6 of the smoke test called endpoints that don't exist on the multi-tenant API. Every call returned 404 (or a NestJS-shaped JSON 404 for path-mismatched routes), the script's first `fail` exited non-zero, and an operator running it before a demo got no signal beyond "infrastructure and auth are up" (layers 1 and 2, the latter recently fixed by B-050).

**Endpoint-by-endpoint mapping.**

| Smoke test was calling | What actually exists | What the rewrite uses |
|---|---|---|
| `GET /api/v1/products?limit=50` | `/api/v1/organizations/:orgId/domains/:domainId/products`; or the global `/marketplace/products` | `/api/v1/marketplace/products?limit=50` (global, JWT-auth, also exercises the BM25 `provenance-products` index) |
| `GET /api/v1/products/:id` (assertions on `enrichment.schema`, `enrichment.ownership`, `enrichment.freshness`, `enrichment.accessStatus`) | `/api/v1/marketplace/products/:id` returns a flat shape — `columnSchema`, `owner`, `freshness`, `accessStatus` (no `enrichment.*` wrapper) | `/api/v1/marketplace/products/:id` with assertions remapped to the flat shape |
| `GET /api/v1/lineage/smoke?productSlug=customer-360` | `/api/v1/organizations/:orgId/lineage/products/:productNodeId/{upstream,downstream,impact}`; `productNodeId` is the postgres product UUID (verified by probing the cypher) | `/api/v1/organizations/:orgId/lineage/products/${first_product_id}/upstream`, asserting `.edges.length > 0` |
| `GET /api/v1/search/smoke?q=Customer%20360` (with `x-mcp-api-key`) | `POST /api/v1/internal/search/semantic`, JWT-auth, body `{query, org_id, limit}` | Same; asserts `.results.length > 0`. The BM25 index assertion was folded into the layer-3 marketplace listing — `listAllProducts` already queries OpenSearch `provenance-products`, so a non-empty marketplace response is implicit BM25 coverage |
| `GET /api/v1/governance/rls-probe?assumeOrg=...` (with `x-mcp-api-key`) | No such endpoint and no API-layer diagnostic of postgres RLS exists | Replaced with a *behavioral* tenant-isolation check: assert the global marketplace spans ≥ 2 distinct `orgId`s, AND that `/organizations/${ORG_ID}/access/grants` returns 0 rows where `orgId !== ${ORG_ID}` |
| `GET /api/v1/products/:id/trust-score` | `/api/v1/organizations/:orgId/products/:productId/trust-score` | Same |

Side cleanups:

- Picked the first product in layer 3 from the caller's *own* org (was unfiltered) — the lineage cypher matches on `(node_id, org_id)`, so a product from a different org would silently return zero edges and confuse layer-5 failure messages.
- Removed the `MCP_API_KEY` precondition; nothing in layers 3–6 uses it anymore (the original phantom `/smoke` and `/rls-probe` subpaths were the only consumers).

**Root cause.** Same shape as B-060 part 1 (`softReset`) and B-050 (`/organizations/me`): the smoke test was written against an earlier flat API design that was re-architected into the multi-tenant `/organizations/:orgId/...` shape (rationale obvious in hindsight — RLS, federation, ADR-001 control/data plane split). The test never followed. Nobody ran it end-to-end against the real product surface after the API moved, so the drift was invisible until the 2026-05-17 demo rehearsal.

**Decision: behavioral checks over phantom diagnostic endpoints.** The bug doc proposed an alternative — *add* `/smoke` and `/rls-probe` endpoints to the API and have the test call them. This would have worked, but it replicates the anti-pattern B-050 already pushed back on: adding permanent API surface for a single bash caller. Behavioral checks against existing endpoints are honest about what the platform actually does, won't decay quietly when an internal service is refactored, and don't grow a "test-only" appendix on the API. Same principle the B-050 fix applied to `/me`.

**Verification.** Direct curl-based execution of each layer-3/5/6 path against the local stack on `fix/b-060-smoke-test-layers`:

```
== LAYER 3 ==  marketplace lists 16 products (>= MIN_PRODUCTS=8); detail has all 4 fields
== LAYER 5 ==  lineage upstream: 25 edges; semantic search: 10 hits; marketplace spans 2 orgs; tenant filter holds (0 cross-org rows)
== LAYER 6 ==  trust score for first product: 0.8
```

End-to-end run via the script blocked on an unrelated environment issue on this dev box (`provenance_principal_id` user attribute missing from local Keycloak realm import — separate from B-060 scope; the realm-export *does* declare the mapper). Per-endpoint verification stands in.

**Pattern.** Operator tooling is part of the surface a phase ships. The smoke test is the operator's eyes — if it talks to a different platform than the one shipping, the operator is blind. Three pieces of demo-verification tooling have now been found dead in the last week (B-050 layer 2, B-060 part 1 softReset, B-060 part 2 smoke layers 3–6), all the same shape. The last open piece of B-060 — wire the smoke test into CI so the next API/schema move surfaces drift on the next merge — is the only structural fix that prevents this from happening a fourth time.

**Out-of-scope finding flagged during the rewrite.** When probing endpoints to choose a replacement for the `/rls-probe` step, calling `GET /api/v1/organizations/<other-org>/governance/dashboard` as a smoke user from a different org returned the *other org's* dashboard stats — not the caller's. Other org-scoped endpoints behave correctly (e.g. `/organizations/<other-org>/access/grants` returned the caller's grants, ignoring the URL mismatch). The dashboard appears to be reading the URL `:orgId` rather than the JWT claim, which is a cross-org information leak. Out of scope for B-060; flagged here so a future bug filing has the trail.

---

## B-060 (part 1) — `softReset` referenced columns and tables that don't exist in the live schema

- **Resolved:** 2026-05-21 — fix PR pending (commit hash on merge)
- **Severity:** was Medium (operator-facing tooling functionally broken since written; the *platform* worked but the script that freshens demo state could not run)
- **Area:** `packages/seed/src/reset.ts`

**Symptom.** `bash demo-reset.sh --soft` (which runs `pnpm --filter @provenance/seed seed:reset:soft`) had never completed successfully. The very first DELETE in the transaction threw `column "event_at" does not exist`, the transaction rolled back, and the operator was left with no working "freshen transactional state" path between rehearsals.

**Root cause.** `softReset` was written against an earlier snapshot of the platform and never end-to-end exercised after the underlying schema evolved. Four of five DELETE statements were wrong:

| `softReset` referenced | What actually exists |
|---|---|
| `audit.audit_log WHERE event_at` | column is `occurred_at` (V4) |
| `observability.observability_snapshots` | **table does not exist** in any migration; closest analogue `governance.compliance_snapshots` (V8) is a daily aggregate, not transactional state |
| `lineage.emission_events WHERE emitted_at` | table is `lineage.emission_log` (V9); column `emitted_at` is correct |
| `access.access_requests WHERE created_at` | column is `requested_at` (V7) |
| `observability.trust_score_history WHERE computed_at` | correct ✅ |

**Fix.** Rewrote `softReset` against the current schema. Dropped the `observability_snapshots` DELETE entirely since the table never existed and `compliance_snapshots` is the wrong shape for a 24h-window wipe (it's a date-keyed daily roll-up). The remaining four DELETEs now match V4 / V7 / V9 / V11.

**Test added.** New CLI subcommand `seed:verify:soft-reset` (`packages/seed/src/verify-soft-reset.ts`) that inserts paired sentinel rows in each of the four target tables — one inside the 24h window, one 48 hours old — then runs `softReset` and asserts that the recent rows were deleted and the older rows survived. Cleans up its own sentinels at start and end so re-runs are idempotent. Verified end-to-end against the EC2 dev stack: passes on back-to-back invocations. Intended for CI once the demo-smoke-test work lands; runnable on-demand by an operator with `pnpm --filter @provenance/seed seed:verify:soft-reset`.

**Pattern.** Operator tooling is part of the surface a phase ships. Scripts that exist without being run regularly are scripts that don't work. `softReset` is the second piece of demo-verification tooling found dead in the last week (B-050 was the smoke test's layer 2). Both fit the same shape: written against the API/schema as it was at the time, never re-exercised when the underlying surface evolved.

The companion smoke-test fix (`demo-smoke-test.sh` layers 3–6 reference phantom flat-top-level endpoints; the API is multi-tenant) and the CI integration ("run the smoke test against a freshly-bootstrapped demo on every merge to main") remain open as the rest of [B-060](open.md#B-060).

---

## B-050 — Smoke-test layer 2 step 3 hit a non-existent `/api/v1/organizations/me` route

- **Resolved:** 2026-05-18 — fix PR pending (commit hash on merge)
- **Severity:** was Low (smoke-test gap, not a product-surface bug; affected the operator pre-demo green-light check)
- **Area:** `infrastructure/scripts/demo-smoke-test.sh`

**Symptom.** Layer 2 step 3 of the smoke test called `GET /api/v1/organizations/me` with the user's JWT. The API has no `/me` route — `OrganizationsController` pattern-matches `me` as the `:orgId` path parameter, hands the literal string `"me"` to PostgreSQL as a UUID, and the DB throws `invalid input syntax for type uuid: "me"`. The exception bubbles up as a 500, the smoke test marks layer 2 failed, and layers 3–6 never run.

**Root cause.** The smoke test was written against an API endpoint that doesn't ship and never did. Nothing in the actual product calls `/organizations/me` — the frontend reads the org id straight from the JWT's `provenance_org_id` claim, and so do agents. The only consumer of the missing endpoint was this single bash script.

**Fix path chosen.** Path 1 from the bug doc: update the smoke test, not the API. The JWT already carries `provenance_org_id`; decoding it in bash and calling the existing `/api/v1/organizations/<orgId>` route is the smaller, more honest diff than adding a permanent API surface for a single bash caller.

**Changes:**
- Replaced the partial base64 decode + grep-based claim check with a padded base64 decode (JWT segments are base64url-encoded and may need padding to a multiple of 4 bytes) + jq-based `has(...)` claim check. Cleaner, fails loudly on a malformed token instead of silently passing.
- Extracted `provenance_org_id` from the decoded payload with `jq -r`.
- Replaced the `/organizations/me` curl with `/organizations/${ORG_ID}`.
- Renamed the temp file from `smoke-me.json` to `smoke-org.json` and updated the downstream control-plane step (layer 3 step 1) that reads `.slug` from it.

**Verification.** `bash -n` clean. End-to-end run pending against a live demo box.

**Pattern.** When a smoke test calls an endpoint that doesn't exist, the gap is in the test, not the API — unless that endpoint has independent product value. `/me` shorthand endpoints often look tidy but add a permanent maintenance surface, and the JWT typically carries the answer the caller wants anyway. Prefer "decode the JWT and call the canonical route" over "add a `/me` route to make callers feel better." Worth the same examination any time a new pre-flight check is added: does this need a new API surface, or does the JWT already carry the answer?

---

## B-056 — Logout from `/agents` returned a raw JSON 404 instead of redirecting to login

- **Resolved:** 2026-05-18 — fix PR pending (commit hash on merge)
- **Severity:** was Medium (UX + security-adjacent — exposed an internal API error shape on the worst possible page transition during a demo)
- **Area:** Frontend dev server config — `apps/web/vite.config.ts`

**Symptom.** Clicking "Sign out" from `/agents` or `/agents/:agentId` showed the user a raw NestJS-shaped JSON 404 (`{"message":"Cannot GET /agents","statusCode":404,"error":"Not Found"}`) instead of redirecting to the Keycloak login page. Logging out from any other page (`/products`, `/governance`, etc.) worked correctly.

**Root cause — not the hypothesis in the bug doc.** The bug doc suggested either a Keycloak `post_logout_redirect_uri` misconfiguration or a missing frontend route guard. Neither was the actual cause. The actual cause was a stale entry in the Vite dev server proxy:

```ts
proxy: {
  '/api':   { target: 'http://api:3001' },
  '/agent': { target: 'http://api:3001' },  // ← the culprit
}
```

Vite proxy keys are prefix matches. `/agent` matched `/agents` and silently forwarded the request to the NestJS API at `http://api:3001/agents` — but no controller is mounted at the top-level `/agents` path (the real agent endpoints all live under `/api/v1/agents/*`). Express returned its default 404 page (`Cannot GET /agents`), and Vite passed that response through to the browser.

**Why only after logout?** While the user is signed in, all navigation inside `/agents` is client-side React Router state changes — the browser never sends a fresh `GET /agents` to the server. When `keycloak.logout()` runs with no explicit `redirectUri`, keycloak-js defaults to redirecting back to `window.location.href` — `/agents`. That redirect is a real browser navigation, hits Vite, matches the `/agent` proxy prefix, and the 404 leaks out. Logging out from `/products` falls through to Vite's SPA index.html fallback, React boots, the `onLoad: 'login-required'` Keycloak init kicks the user to the login page — the flow that was supposed to happen everywhere.

The frontend route guard and Keycloak post-logout redirect were both already correct. The bug-doc hypothesis was a reasonable read of the symptom from outside; the actual cause was three lines of dev-server config nobody had touched in months.

**Fix.** Removed the `/agent` proxy entry. Added a comment in `vite.config.ts` explaining the constraint: only `/api` proxies to NestJS; agent endpoints all live under `/api/v1/agents/*` and are already covered by the `/api` rule; the MCP / agent-query layer is server-to-server and never reached from the browser.

**Demo asset inventory** updated: Section 11 rehearsal-blockers list flips B-056 to ✅, the Section 10B header note drops the "don't log out from /agents" warning.

**Pattern.** Vite proxy keys are *prefix matches*, not exact matches. A `/agent` entry catches `/agents`, `/agent-query`, `/agent/anything`, and so on. When you add a route to the frontend whose path overlaps with a Vite proxy key, the proxy wins — silently, with no error in the dev console, and the failure mode only shows up on a real browser navigation (not on client-side route changes). Worth a `grep proxy apps/web/vite.config.ts` whenever you add a top-level frontend route, especially a short one. More broadly: when a symptom involves an API-shaped error on what should be a frontend page, check the dev-server proxy before the auth flow.

---

## B-058 — Trust-score-drop notification missing from `governance@acme.example.com` inbox

- **Resolved:** 2026-05-18 — fix PR pending (commit hash on merge)
- **Severity:** was Low (seed data; affected one specific investor-demo beat)
- **Area:** Seed — `packages/seed/src/notifications/acme-corp-notifications.ts`; demo asset inventory

**Symptom.** As `governance@acme.example.com`, the Daily Revenue Recognition trust-score drop (0.91 → 0.78) — listed in the demo asset inventory's Section 6 as a governance signal — wasn't present in the inbox. The seed only placed it on `finance-lead@acme.example.com`.

**Fix.** Added a second seeded notification entry with the same payload and `recipientEmail: governance@acme.example.com`, distinct `seedKey: acme:governance:trust:revenue-daily` for idempotency. Material trust regressions are governance-relevant across the org, not just the owning domain, so this is the right answer on the merits — not a script accommodation.

Also updated `documents/demo-scripts/demo-asset-inventory.md`:
- Section 6 governance@acme list now includes the trust-score-drop signal.
- Section 10A Step 8 rewritten — no persona switch needed; both compliance drift and the trust-score drop are visible in one inbox.
- Section 11 rehearsal-blockers list flips B-058 to ✅ fixed.

**Verification.** `pnpm --filter @provenance/seed build` clean.

**Pattern.** Demo seed data is a real product surface — the demo IS the product for an investor audience. When a script step depends on a specific notification existing in a specific inbox, the script and the seed have to agree. Section 6 of the asset inventory had been the source-of-truth-by-accident; the seed and the script step had drifted from it. Lesson: any time a demo script names a signal in a specific inbox, that signal needs an explicit seed entry, not "it should be there because role X is interested."

---

## B-059 — Access-request approve/deny endpoints didn't verify the caller owns the product

- **Resolved:** 2026-05-18 — fix PR pending (commit hash on merge)
- **Severity:** was Medium (authorization gap inside `domain_owner` role — cross-domain authority wider than the federated data-mesh model intends)
- **Area:** Access service — `apps/api/src/access/access.service.ts`, `access.controller.ts`

**Symptom.** `POST /api/v1/organizations/:orgId/access/requests/:requestId/{approve,deny}` carried `@Roles('org_admin', 'domain_owner')` on the controller. The service then checked existence and pending status but never verified the caller owned the underlying product. Any `domain_owner` could resolve any pending request on any product in the org. The UI was scoped correctly via `forApprover=me`, but a direct API call bypassed that scope.

**Root cause.** The role guard answered "this principal is allowed to *act*"; nothing answered "*on this specific thing*." That's the federation half — it has to live in the service layer where the resource is resolvable.

**Fix.** Service-layer ownership check inside `approveRequest` / `denyRequest`, threading the caller's roles through from the controller's `RequestContext`:

- `org_admin` short-circuits the check — platform-wide authority preserved.
- Otherwise the product is loaded and `product.ownerPrincipalId === callerPrincipalId` is required.
- On failure, an audit row goes into `audit.audit_log` with action `access_request.{approve|deny}_blocked_scope_violation` (carries product id, owner, caller roles in metadata) before `ForbiddenException` is thrown — cross-domain authority probes are visible to governance review even when denied.

The bug doc suggested adding a `RoleAssignmentService.hasRole(...)` lookup. Not needed — `RolesGuard` reads roles off `RequestContext.roles` (already on the JWT-derived ctx), so the controller passes `ctx.roles` into the service. One less injection.

**Regression coverage.** Five new tests across `access.service.spec.ts` and `__tests__/access.service.spec.ts`:
- Domain owner who *owns* the product approves/denies successfully.
- `org_admin` resolves without an ownership lookup.
- Cross-domain `domain_owner` → 403 + scope-violation audit row written (asserts on the row).
- Same for `deny`.
- Idempotency / Temporal / notification tests updated to pass the new `callerRoles` arg.

All 71 tests green under `pnpm --filter @provenance/api test -- --testPathPattern=access.service`.

**Pattern.** Federation claims need two checks, in two layers: role guard at the controller ("you can act"), ownership check at the service ("on this thing"). When only one half lands, the other half stays silently open. The fix path generalizes: any future endpoint making a per-resource federation claim (per-domain, per-product, per-org-tenant) needs both. The controller decoration is necessary but not sufficient.

---

## B-057 — Agent registry had no detail page; access grants, connection references, and classification history were not surfaced in the UI

- **Resolved:** 2026-05-17 — fix PR pending (see commit hash on merge)
- **Severity:** was Medium (major demo gap — affected all three audience demo scripts; backend had the data, UI hadn't caught up)
- **Area:** Agent UI — `apps/web/src/features/agents/`

**Symptom.** As any persona, navigating to the agent registry showed a row per agent (display name, model, classification, oversight contact, registered date) but the rows weren't clickable and no detail page existed. The "agents are first-class participants" claim — central to all three audience demo scripts — had no visible anchor: every Domain 12 connection-reference record, every classification change, every product access grant for an agent was hidden from the UI even though the backend exposed all of it.

**Root cause.** Frontend simply hadn't been built. Backend endpoints all existed and were sufficient: `GET /agents/:agentId` (identity), `GET /agents/:agentId/classification/history` (trust-tier transitions), `GET /access/grants?granteePrincipalId=<agentId>` (product grants — note that an agent's `agentId` IS its `principalId` for access-grant joins per `jwt-auth.guard.ts:52`), `GET /consent/connection-references?agentId=<agentId>` (Domain 12 per-use-case consent records).

**Fix.** New page at `/agents/:agentId` with a four-tab strip:

1. **Overview** — identity fields including display name, classification badge, scope, last-change timestamp, reason, model, oversight contact, Keycloak client id, registered-by, registered-when.
2. **Access Grants** — every product the agent has access to, with active / revoked / expired badges, granted-at and expires-at timestamps, scope when present, and links into the product detail page.
3. **Connection References** — Domain 12 records with state badge, use-case category, purpose elaboration text, requested / approved / expires timestamps. The empty state explicitly explains the "no references = agent can't act against any product" semantic from ADR-006.
4. **Classification History** — full trust-tier transition log: classification, scope, who changed it, principal type, reason, effective-from and effective-until timestamps.

Frontend supporting work:
- New API client `apps/web/src/shared/api/consent.ts` for the connection-references list / get endpoints (first frontend consumer of Domain 12 endpoints).
- Extended `accessApi.grants` with a `list({ granteePrincipalId, productId, activeOnly, limit, offset })` method.
- Extended `agentsApi` with `classificationHistory(agentId)`.
- Agent registry rows on `AgentsPage` now link to the detail page.
- Route registered in `Router.tsx` as `/agents/:agentId`.

**No generic audit-trail tab** — there's no list endpoint for `audit.audit_log` today. Classification history covers the demo claim ("every agent action is provenanced") well enough until a queryable audit endpoint exists. Adding that endpoint is a clean follow-up.

**Verification.** Typecheck (`pnpm --filter @provenance/web typecheck`) passes under Node 22. Page handles loading, error, and empty states on all four tabs. Supplementary queries use `Promise.allSettled` so a partial failure on one tab doesn't block the others.

**Pattern.** When the backend ships the contracts (Phase 4 agent endpoints, Domain 12 connection-references) but the UI doesn't follow, the platform's claims become *theoretically true* — defensible in a code walkthrough, invisible in a UI walkthrough. The investor / technical / governance demo scripts kept tripping on this surface because the *story* depended on the UI making the contract visible. The lesson: at phase completion, audit *what's visible*, not just *what works at the API layer*.

---

## B-055 — Access-request notifications had no usable path to approval

- **Resolved:** 2026-05-17 — fix PR pending (see commit hash on merge)
- **Severity:** was Medium
- **Area:** Access requests UI + Notifications routing

**Symptom.** The `access_request_submitted` notification rendered with dismiss-only actions and a dead title link. The notification's seed-fixture `deepLink` was `/publishing/<product-slug>/access-requests`, which didn't match any frontend route; `resolve-destination.ts` fell through to `/notifications` (which is the page the viewer was usually already on, so the click felt like a no-op). Domain owners had no surface to act on pending requests directly from the notification.

**Root-cause framing.** Matt's pushback during the fix design reframed the problem: *"isn't it clunky that one cannot simply look at a list of pending requests instead of having to go through notifications?"* He was right. The original B-055 fix path (add inline Approve/Deny to the notification component) was a workaround for not having the proper page. The cleaner architecture is: notifications are alerts, a dedicated page is the workload management surface.

**Fix.** Three parts in one PR:

1. **Backend** (`apps/api/src/access/`): extended `GET /access/requests` with a `forApprover=me` query parameter. Service-level filter joins `data_products` and restricts to rows where `products.owner_principal_id = caller`. The "approver queue" — a domain owner can ask the API for "requests I can act on" without needing to know which products they own.
2. **Frontend** (`apps/web/src/features/access-requests/PendingAccessRequestsPage.tsx`): new page at `/access-requests`. Lists all pending requests the caller can approve, with inline Approve / Deny actions per row, justification visible, link to the product. Added to `NavShell` as "Access Requests."
3. **Wire-through** (`resolve-destination.ts`): rewrites both legacy notification deep-link patterns (`/publishing/<slug>/access-requests` from older seed fixtures, and `/access/requests/<id>` from the live trigger at `access.service.ts:477`) to land on the new `/access-requests` page. Notifications now alert; the page is where the workflow happens.

**Verification path.** As `analyst@acme.example.com`, submit a Campaign Attribution access request. As `marketing-lead@acme.example.com`, visit `/access-requests` directly (or click the notification — it now lands here). Approve. Audit log records the explicit action; the connection package is generated on the grant; the consumer sees the new grant on the product detail page.

**Pattern.** When a UX feels clunky in review, the right fix is often *to build the right primary surface*, not to bolt actions onto whatever surface the user happened to land on first. Notifications-as-action-surface was the local optimum (it's where the user was looking); pending-requests-as-workload-page was the global optimum (it's where the work actually lives). Saved by Matt's "isn't it clunky" check before shipping a workaround disguised as a fix.

**Bonus scope flagged in the PR.** Authorization on the *approve* and *deny* endpoints currently relies only on the controller-level `@Roles('org_admin', 'domain_owner')` decoration — it doesn't verify the caller actually owns the specific product. Any `domain_owner` in the org can approve any pending request. Not exploited in the seeded demo (all owners are friendly) but worth tightening in a follow-on PR; filed as a TODO in the service. The Pending Requests page itself is correctly scoped (only shows requests for products the caller owns).

---

## B-054 — *(MISDIAGNOSED — no code change)* — "Clicking access-request notification silently grants the access"

- **Resolved:** 2026-05-17 — no fix commit; the originally-filed bug does not exist as a code defect. Retraction PR documents the investigation.
- **Originally filed severity:** High (correctness + governance)
- **Actual severity:** Not a bug
- **Area:** Notifications / Access — investigated and cleared

**Original symptom (as filed).** "Maya clicks the access-request notification with the intent of opening / dismissing it. The notification is consumed (presumably marked read), and Aiden's access request is granted — without Maya ever reaching an approval UI or pressing an Approve button."

**Why it looked like a silent grant.** The investor-demo rehearsal walked the seeded Customer 360 path. The seed gives `analyst@acme.example.com` an active 30-day grant on Customer 360 already (granted 30 days ago, expires 30 days from now). During the rehearsal:

1. Aiden opened Customer 360. The page showed the "Request Access" button despite Aiden already having an active grant — frontend grant-check was either stale/loading or there's a separate UI gating bug there. **(This is a real but distinct issue — see follow-up note below.)**
2. Aiden clicked "Request Access" and submitted. The API correctly returned 409 (`access.service.ts:374-387` blocks duplicate-grant submissions) but the 409 was not clearly surfaced in the UI.
3. Maya saw the *pre-existing seeded notification* about Customer 360 (from 30 days ago, `readDaysAgo: 29` in the seed) in her inbox.
4. Maya clicked the notification. Per the click handler in `NotificationDrawer.tsx`, the click calls `markRead` (innocent — only updates `readAt`) and navigates to `resolveNotificationDestination(notification.deepLink)`, which falls through to `/notifications` because `/publishing/<product>/access-requests` is not a routable path. **No grant call. No state change to any access resource.**
5. Aiden checked Customer 360 and saw he now has access. Matt attributed this to Maya's click — but the grant being shown was the always-present seeded grant from 30 days ago.

**Empirical confirmation that retracted the bug.** 2026-05-17, with the demo box live in front of Matt:

1. As Aiden, opened Campaign Attribution (a marketing-owned product Aiden does *not* have a seeded grant on). Page correctly showed "Request Access."
2. Submitted a request. Page correctly updated to "Request Pending."
3. Switched to Maya. New `access_request_submitted` notification visible in her inbox.
4. Maya clicked the notification title. Notification got marked read; navigation went to `/notifications` fallback (no-op since already on that page).
5. Switched back to Aiden and refreshed Campaign Attribution. **Status was still "Request Pending"** — Maya's click did not trigger a grant. Confirmed: no silent-grant mechanism exists in the code.

**Real bugs surfaced by the investigation.** B-054 retracts but the rehearsal still exposed legitimate issues:

- **B-055** (still open, scope expanded in same PR as this retraction): the notification has no Approve/Deny inline action, and its title link is dead. Both halves now captured in one entry.
- **Possible follow-up** (not yet filed): the "Request Access" button on `ProductDetailPage` appears to render before the active-grant check resolves, or has a separate gating gap — Aiden saw "Request Access" on Customer 360 despite holding the seeded grant. Could be a load-state race. Lower priority; can be re-investigated against a fresh demo cycle.

**Lesson worth keeping.** Bug reports written from live demo observation are *invaluable* — they catch what an audience sees — but the reporter is inferring mechanism from outcome. The reported mechanism ("clicking the notification caused the grant") was wrong; the *outcome* ("Aiden ended up with access without an explicit approval gesture") was technically true but caused by pre-existing seed state, not by any code path on the click. When the code investigation contradicts the bug report, the right move is to reproduce on the live environment *before* fixing — not to write a fix for a mechanism that doesn't exist. That's the path that led to this retraction; the alternative would have been a meaningless code change to "prevent" a side effect that never occurred.

**Pattern for the bug ledger.** When a bug is filed and investigation shows the reported mechanism doesn't exist in code, retract with a full forensic note (like this one) rather than silently closing. The investigation is the value. Future contributors should be able to see what was checked, what was ruled out, and what *real* bugs surfaced alongside.

---

## B-053 — Keycloak `provenance-web` client rejects `https://demo.provenancelogic.com` redirect_uri

- **Fixed:** 2026-05-17 — [#118](https://github.com/provenance-logic/provenance/pull/118)
- **Severity:** was Medium (login was impossible from the demo URL; users landed on Keycloak's "We are sorry... Invalid parameter: redirect_uri" page; demo-environment-only)
- **Area:** Keycloak realm configuration / demo environment

**Symptom.** Clicking the login button on `https://demo.provenancelogic.com` redirected to Keycloak, which then returned the "Invalid parameter: redirect_uri" error page instead of the login form.

**Root cause.** `infrastructure/docker/scripts/configure-keycloak-ec2.sh` hardcoded the `provenance-web` client's `redirectUris` and `webOrigins` arrays with `https://dev.provenancelogic.com` but not the demo hostname. The script was written before the demo environment existed.

**Fix.** Added `https://demo.provenancelogic.com/*` to `redirectUris` and `https://demo.provenancelogic.com` to `webOrigins`. Idempotent — `configure-keycloak-ec2.sh` rewrites the full arrays each run, so re-running the script picks up the change.

Third sibling in the demo-environment paper-cut family caught during Matt's first demo browse (B-051 seed crash, B-052 vite host check, this one). All three share the same architectural smell: a dev-mode default (kcadm static array, vite `allowedHosts`, nest watch + missing `ps`) bites when the dev image is used to serve the demo URL.

**Pattern + deferred follow-up.** The right long-term answer is env-driven host configuration across vite + keycloak + any future ingress, so `dev` / `demo` / future environments don't each need a code change. Tracked in the status board's "Deferred to post-launch" section under "Demo production-mode images hardening." Not OSR-blocking.

---

## B-052 — Vite dev server rejects `demo.provenancelogic.com` Host header

- **Fixed:** 2026-05-17 — [#117](https://github.com/provenance-logic/provenance/pull/117)
- **Severity:** was Medium (web UI on the demo box returned Vite's "Blocked request" page for every URL; users could not log in or click around; demo-environment-only)
- **Area:** Web container / Vite dev-server configuration

**Symptom.** Every request to `https://demo.provenancelogic.com` returned Vite's `Blocked request. This host ("demo.provenancelogic.com") is not allowed. To allow this host, add "demo.provenancelogic.com" to server.allowedHosts in vite.config.js.` page, regardless of route or auth state.

**Root cause.** `apps/web/vite.config.ts` set `server.allowedHosts: ['dev.provenancelogic.com']` — only the dev hostname was in the list. Vite's dev server enforces Host header validation by default; only listed hosts (plus localhost) pass.

**Fix.** Added `'demo.provenancelogic.com'` to the `allowedHosts` array. Container had to be recreated for vite to re-read the config.

Sibling to B-051 and B-053 — same paper-cut family ("dev-mode defaults bite when the dev image serves a demo URL"). See B-053 for the deferred env-driven follow-up.

---

## B-051 — `demo-sync.sh` seed step crashes the api container (watch-mode + missing `procps`)

- **Fixed:** 2026-05-17 — [#116](https://github.com/provenance-logic/provenance/pull/116)
- **Severity:** was Medium (blocked `demo-sync.sh` end-to-end on every fresh demo cycle; demo-environment-only)
- **Area:** Demo environment / api container image

**Symptom.** `demo-sync.sh` reached "running seed package," printed `[INFO] seed: orgs`, then errored `[ERROR] other side closed`. The api container's restart count climbed by one on every demo-sync invocation. The api logs showed the previous process died with `errno: -2, code: 'ENOENT', syscall: 'spawn ps', path: 'ps', spawnargs: [ '-o', 'pid', '--no-headers', '--ppid', <pid> ]`.

**Root cause — chain of three.**

1. `apps/api/Dockerfile`'s `development` stage is `node:22-slim` (Debian, no `ps` by default — `agent-query`'s Alpine base has busybox `ps`, which is why this only bit the api).
2. The ec2-dev compose target runs the api with `pnpm dev` → `nest start --watch`. Nest's watcher spawns `ps -o pid --no-headers --ppid <pid>` to find child PIDs to terminate before restart.
3. `demo-sync.sh` runs `pnpm --filter @provenance/seed install --frozen-lockfile`. Even with `--filter`, pnpm fires the root postinstall (`pnpm --filter @provenance/types build`). `tsc` rewrites `packages/types/dist/*`, which is bind-mounted into the api container. Nest's watcher sees the change, tries to restart, `spawn ps` ENOENTs, the container dies mid-seed-call, and the seed CLI sees "other side closed."

`demo-bootstrap.sh` doesn't hit this because it runs the types build *before* bringing the api container up — the api watch never observes a change. Previous demo cycles probably succeeded on timing luck.

**Fix.** Defense in depth, two parts in one PR:

1. **api Dockerfile, `development` stage:** install `procps` so the watcher's child-PID lookup works.
2. **`demo-sync.sh`, seed-step install:** pass `--ignore-scripts` so no postinstall fires and no bind-mounted file changes during seed.

Verified on the live demo box before merge — first end-to-end `[INFO] seed complete` of today's cycle, with smoke-test layers 1 + 2.1 + 2.2 passing (B-048 verified) and only the pre-existing B-050 failing as expected.

**Pattern.** Watch-mode dev images and bind-mounted source trees are a footgun when paired with any host-side operation that touches the bind-mount path while the container is running. If a future feature touches the same surface, prefer (a) a production-mode image override for demo, (b) `--ignore-scripts` on any host-side install that doesn't need to rebuild, or (c) both. The same architectural smell surfaced as B-052 (vite host check) and B-053 (keycloak redirect URI) immediately after this fix landed — all three are flavors of "dev-mode defaults bite when the dev image is used to serve a demo URL."

---

## B-049 — Each demo cycle issues fresh Let's Encrypt certs, burning the 5/week rate limit

- **Fixed:** 2026-05-16 — [#113](https://github.com/provenance-logic/provenance/pull/113)
- **Severity:** was Medium (capped weekly demo throughput at ~5 cycles per identifier set; once exhausted, all external HTTPS access to the demo broke with `tls: internal error` until the rate-limit window rolled forward)
- **Area:** Infrastructure / demo environment

**Symptom.** During the post-B-048 verification cycle on 2026-05-16 (T+2 hours after merging #112), Caddy on the demo box could not obtain a TLS cert from Let's Encrypt and fell back to LE *staging* certs, which are signed by an untrusted CA. External `curl` against `https://demo.provenancelogic.com/api/v1/health` returned `TLS connect error: error:0A000438:SSL routines::tlsv1 alert internal error`; browsers showed a "Your connection is not private" warning. LE's response was `HTTP 429 urn:ietf:params:acme:error:rateLimited - too many certificates (5) already issued for this exact set of identifiers in the last 168h0m0s, retry after 2026-05-17 11:25:40 UTC`.

**Root cause.** Caddy's cert store lived in a Docker named volume on the demo instance's root EBS, which is destroyed with every `terraform destroy`. So every `terraform apply` started Caddy with no cert state and forced it to ask Let's Encrypt for a fresh cert. LE's "Certificates per Registered Domain (extended: per exact set of identifiers)" rate limit caps fresh issuances at 5 per rolling 168-hour window. Yesterday's marathon (#104–#110) plus today's B-048 verification cycle pushed past the 5th issuance for both `demo.provenancelogic.com` and `auth-demo.provenancelogic.com`. The next eligible issuance unlocks one slot at a time as old certs age out of the rolling window — first one at 2026-05-17 ~11:25 UTC.

This is structural — the demo's "on-demand teardown" model fundamentally fights LE's per-identifier rate limit if cert state isn't preserved. The week of yesterday's marathon plus today demonstrated the cap empirically: ~5 issuances exhausted the budget, and a dry-run / bug-fix / retry cycle can chew through cert slots fast.

**Fix.** Pre-allocated 1 GB EBS volume tagged `provenance-demo-caddy-data` (one-time `aws ec2 create-volume`, currently `vol-0fd2383ae142d2c95` in us-east-1c). Terraform looks it up via a `data` block — same pattern as the persistent EIP — so `terraform destroy` never removes it. `user-data.sh.tpl` mounts it at `/var/lib/caddy-data` with the `sync` option (to avoid losing recent writes if `force_detach` yanks the volume mid-buffer). A new `docker-compose.demo.yml` override redirects Caddy's `caddy_data` named volume to a host bind-mount on that path. Caddy's cert files now survive every cycle.

LE certs are valid 90 days and Caddy auto-renews ~30 days before expiry, so under normal demo cadence we hit LE about 4 times per year per hostname — nowhere near any rate limit.

**Why the persistent EIP didn't already cover this.** The EIP made DNS records stable across cycles but did nothing for cert state — DNS pointing at a fresh server still meant Caddy on that fresh server had no cert and had to ask LE for one. Persistent EIP + ephemeral cert store + rate limit = exactly the trap we hit. Now both DNS *and* cert state are persistent across cycles; only ephemeral compute changes.

**Pattern.** When an external API enforces a rate limit on a resource we mint (TLS certs, OAuth client credentials, etc.), the resource's storage must be at least as persistent as the rate-limit window. If it isn't, the rate limit eventually wins. Whenever a future Provenance feature integrates with a rate-limited external mint, check this constraint first.

---

## B-048 — Seed runner doesn't set `provenance_principal_id` on Keycloak users after `/seed/principals` returns

- **Fixed:** 2026-05-17 — [#112](https://github.com/provenance-logic/provenance/pull/112)
- **Severity:** was High (blocked smoke-test layer 2 and any flow that reads the `provenance_principal_id` JWT claim)
- **Area:** Seed / Keycloak / JWT claims

**Symptom.** Smoke-test layer 2 (auth) failed with `[smoke FAIL: auth] JWT missing claim: provenance_principal_id`. Decoding the seeded user's JWT showed `provenance_org_id` and `provenance_principal_type` populated but `provenance_principal_id` entirely absent. All three protocol mappers existed on the `provenance-web` Keycloak client, so the claim wasn't firing because the underlying user attribute wasn't set.

**Root cause.** `packages/seed/src/runner.ts` writes two of the three `provenance_*` attributes on the Keycloak user at user-create time, but cannot write `provenance_principal_id` then — the platform principal row doesn't exist yet at that moment; it's created on the next call (`POST /api/v1/seed/principals`). The runner never went back to backfill the third attribute, so seeded users booted with two of three claims, and the JWT strategy's downstream fallbacks (DB-lookup keyed on `sub`) covered for the gap only on routes that re-resolve principal id from the DB. Routes that read the claim directly — including the smoke test's layer-2 contract — saw a missing value and bailed.

**Fix.** Closed the gap server-side rather than in the runner, since the `/seed/principals` controller already receives `keycloakUserId` and returns `principal.id`. After the transactional upsert commits, the controller now calls `KeycloakAdminService.updateUserAttributes(keycloakUserId, { provenance_principal_id, provenance_org_id, provenance_principal_type: 'human_user' })` — mirroring the invitation-acceptance flow in `InvitationsService.acceptInvitation` (apps/api/src/organizations/invitations.service.ts:273). Always-write (not first-create-only) so a previous-run Keycloak hiccup is repaired on the next seed run. The Keycloak call sits outside the DB transaction so a Keycloak outage doesn't roll back the principal upsert; failures are logged at WARN and the endpoint still returns 200 (re-seeding repairs).

Bonus scope flagged in the PR body: the runner was writing `provenance_principal_type: 'human'` rather than the canonical `'human_user'` used everywhere else in the codebase (invitations.service, JwtStrategy default, seed.controller's own principal-row write). The server-side overwrite from the fix corrects that as a side effect — every seeded user now carries the canonical type value, regardless of what the runner sent.

**Pattern.** When a Keycloak attribute depends on a value the platform mints (a principal id, an agent id), bind that attribute server-side at the moment of creation rather than asking the client to make a second round-trip. It removes a "did the caller remember to follow up?" class of bug and centralizes the responsibility with the code that already has the data. `KeycloakAdminService.updateUserAttributes` follows the GET-merge-PUT discipline from R-004, so adding writes is safe.

---

## B-047 — Fresh `git clone` ships no `packages/types/dist/`, agent-query crash-loops on a fresh demo cycle

- **Fixed:** 2026-05-16 — [#110](https://github.com/provenance-logic/provenance/pull/110)
- **Severity:** was High (blocked demo-readiness end-to-end)
- **Area:** Infrastructure / Docker / workspace build

**Symptom.** First `terraform apply` of the demo terraform brought the stack up, but agent-query crash-looped with `TS2307: Cannot find module '@provenance/types'` on three caches/clients files. The earlier `kafkajs` resolution problem fixed in [B-045](#b-045) was gone — this was a different, deeper layer of the same class.

**Root cause.** Multiple compose services (notably agent-query) bind-mount `packages/types` into the container and `import` from `@provenance/types`. Its `package.json` declares `"main": "./dist/index.js"` — so consumers need `dist/` to exist at the bind-mount target. `dist/` is a build artifact and isn't checked into git. The container Dockerfiles use `pnpm install --ignore-scripts`, deliberately skipping the root `postinstall` that would build it. The live dev box had a `dist/` only by historical accident (an older session had run a local pnpm install). A fresh `git clone` followed immediately by `docker compose up -d` has no `dist/` anywhere on disk, the bind mount exposes a directory without it, and the container crashes.

**Fix.** `demo-bootstrap.sh` now runs `pnpm install --frozen-lockfile` at the workspace root *before* `docker compose up -d`. The root `postinstall` (`pnpm --filter @provenance/types build`) populates `dist/` on the host filesystem; the bind mount then exposes it to every service that needs it. Idempotent — pnpm short-circuits when the lockfile and node_modules are already in sync, so re-running bootstrap is cheap.

**Pattern.** Treat `packages/types/dist/` as a host-side build dependency of the compose stack, not as something the containers build for themselves. Any new host-pnpm-driven workflow that wants to bring the stack up from scratch must run `pnpm install` at the root first. This is also why the live dev box had been getting by — the historical artifact masked a real ordering bug in the bootstrap flow.

---

## B-046 — `EncryptionService › fails to decrypt a tampered ciphertext` test flaked ~1.5% of CI runs

- **Fixed:** 2026-05-16 — bonus-scope commit in [#109](https://github.com/provenance-logic/provenance/pull/109)
- **Severity:** was Low (CI flake)
- **Area:** API / encryption test

**Symptom.** PR #109's CI failed with `Received promise resolved instead of rejected` on the tampered-ciphertext test. Same code passed on every other recent run on main.

**Root cause.** The test built its "tampered" ciphertext as `envelope.ciphertext.replace(/.$/, '0')`. If the original ciphertext already ended in `'0'`, the replace was a no-op — the "tampered" envelope was byte-for-byte identical, decryption succeeded, and the assertion failed. With base64-ish ciphertexts, ~1/64 of runs trip this.

**Fix.** Flip the last character to a value *guaranteed* to differ from the original: `last === '0' ? '1' : '0'`, prepended to `slice(0, -1)`.

**Pattern.** A "make this distinct from X" test fixture must compute distinctness conditionally on X, not by replacing with a fixed value that might equal X.

---

## B-045 — Phase 4 MCP server silently broken on live dev for 4+ weeks

- **Fixed:** 2026-05-16 — [#109](https://github.com/provenance-logic/provenance/pull/109)
- **Severity:** was Blocker (a P0 deliverable was operationally down)
- **Area:** API / agent-query / compose

**Symptom.** While debugging an unrelated demo-cycle failure, ran `docker ps` on the live `dev.provenancelogic.com` EC2 and found `provenance-ec2-agent-query  Restarting (2) 39 seconds ago`. Container logs showed `TS2307: Cannot find module '@provenance/types'` on five distinct imports, plus `Cannot find module 'kafkajs'`. The 4-week-old image had been crash-looping silently the entire time. `https://dev.provenancelogic.com/mcp/*` had been non-functional for an unknown but non-trivial duration. `demo-bootstrap.sh` was reporting "Bootstrap complete" because it only waits for Keycloak readiness — never checked agent-query health.

**Root cause.** Multi-layered, root-caused in order:

1. The agent-query image was 4 weeks old. compose uses cached images and never rebuilt after `kafkajs` was added to `package.json`. The cached image's `node_modules` predated the dependency.
2. Even after `docker compose build --no-cache agent-query` produced a fresh image, the running container still failed — because the anonymous volume `- /app/apps/agent-query/node_modules` is not refreshed when the underlying image is rebuilt. Volumes persist across `compose up --force-recreate` and even survive `compose rm -fsv` when other compose actions intervene.
3. After explicit `docker volume rm <hash>`, the TypeScript errors disappeared — and were immediately replaced by a Zod env validation error: `MCP_API_KEY` and `DEFAULT_ORG_ID` are required non-empty strings (`z.string().min(1)`), but `.env.example` shipped both as bare `MCP_API_KEY=` / `DEFAULT_ORG_ID=`. With no `.env` file present, compose falls back to its `${VAR:-}` empty defaults and the container refuses to boot.

**Fix.** Two pieces in PR #109:

1. `.env.example`: give `MCP_API_KEY` and `DEFAULT_ORG_ID` non-empty placeholder values (`dev-mcp-key-change-me` and an all-zeros UUID). The JWT's `provenance_org_id` claim is the authoritative org for real traffic, so the fallback `DEFAULT_ORG_ID` just needs to parse.
2. `docker-compose.ec2-dev.yml`: add `- ../../packages/types:/app/packages/types:cached` to the agent-query service volumes, mirroring the api side. Defense in depth — ensures the container sees current packages/types source even if the image is stale.

Verified live: post-fix, agent-query is healthy on dev for the first time in weeks. Logs show `[MCP] Server initialized with 9 tools (Domain 12 enforcement: ENFORCING)`, kafkajs consumer joins the `connection_reference.state` topic, `curl http://localhost:3002/health` returns `{"status":"ok"}`.

**Pattern.** Multiple meta-lessons:

- "Phase X is complete" in the implementation status is a point-in-time claim, not a continuously-verified state. Without a live healthcheck somewhere that exercises the MCP path, a regression like this can hide for months.
- Anonymous docker volumes that shadow workspace `node_modules` are a known footgun when adding workspace deps. Operator-side mitigation: `docker compose down -v` (with `-v`) to refresh, OR explicit `docker volume rm <hash>` for the targeted volume. Both are destructive of named volumes too, so reach for them deliberately.
- `demo-bootstrap.sh` (and any future bootstrap-class script) should fail loudly when a critical service isn't healthy within a timeout, not silently report "Bootstrap complete" based on a single sentinel service. Tracked for follow-up.

---

## B-044 — `.env.example` had duplicate `SEED_API_KEY` / `SEED_ENABLED` entries

- **Fixed:** 2026-05-16 — [#108](https://github.com/provenance-logic/provenance/pull/108)
- **Severity:** was Low (foot-gun, not breakage)
- **Area:** Infrastructure / env config

**Symptom.** `grep -c SEED_API_KEY .env.example` returned 2. The original at line 58 (`dev-seed-token-change-me`) and a duplicate at line 103 (`seed-dev-service-token`) added by PR #107 without noticing the original. Both API container and seed CLI ended up using `seed-dev-service-token` by "last one wins" — functional, but confusing on read and a foot-gun for anyone editing one but not the other.

**Fix.** Removed the dupe lines; the original block at lines 49–58 stays canonical.

**Pattern.** When adding env documentation, grep first.

---

## B-043 — `demo-smoke-test.sh` used `/api/...` paths but the API mounts under `/api/v1`

- **Fixed:** 2026-05-16 — health endpoint in [#108](https://github.com/provenance-logic/provenance/pull/108), remaining seven call sites in [#110](https://github.com/provenance-logic/provenance/pull/110)
- **Severity:** was High (blocked every smoke-test layer 2+)
- **Area:** Infrastructure / smoke test

**Symptom.** Smoke test bailed at layer 1: `API health returned 404 (expected 200)`. Even after that one path was fixed in #108, the remaining seven call sites (`/api/organizations`, `/api/products`, `/api/lineage`, `/api/search`, `/api/governance`, `/api/products/.../trust-score`) would have 404'd at layer 3 once we got there.

**Root cause.** NestJS API mounts under global prefix `/api/v1`. The smoke test was written against the wrong prefix at every call site.

**Fix.** All eight `${BASE_URL}/api/...` repointed to `${BASE_URL}/api/v1/...`.

**Pattern.** Smoke tests are URL strings — they cannot be unit-tested. Any change to the API's global prefix must update them in lockstep. Worth a CI step that lints smoke-test URLs against the OpenAPI spec; tracked as future work.

---

## B-042 — `SEED_API_KEY` / `SEED_ENABLED` not documented in `.env.example` for demo path

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was Medium (blocked demo seed step)
- **Area:** Infrastructure / env config

**Symptom.** Seed CLI errored with `SEED_API_KEY: Required` even after sourcing `.env.ec2`. The variable wasn't in the env file because it wasn't in `.env.example`.

**Root cause.** Subsequently fixed twice — once added in #107 (then deduped in #108, see [B-044](#b-044)).

**Fix.** Document `SEED_API_KEY` and the gating `SEED_ENABLED` flag with the constant-time-compare context from `apps/api/src/config.ts`.

---

## B-041 — `demo-sync.sh` seed step didn't source `.env.ec2`

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was High
- **Area:** Infrastructure / demo sync

**Symptom.** Seed CLI bailed with `SEED_API_KEY / DATABASE_URL / KEYCLOAK_ADMIN_CLIENT_SECRET: Required`. The env file had all three values; the script just never sourced them into the subshell that ran `pnpm seed`.

**Fix.** Wrapped the seed run in `( cd $REPO_ROOT; set -a; source $ENV_FILE; set +a; pnpm --filter @provenance/seed run seed )`.

**Pattern.** Any host-side CLI in a compose-orchestrated workflow needs to source the same env file the containers read from.

---

## B-040 — `/opt/provenance/*/node_modules` root-owned after `docker compose build`, breaks host-side pnpm install

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was High
- **Area:** Infrastructure / file ownership

**Symptom.** Host-side `pnpm install` died with `EACCES: permission denied, symlink ... -> /opt/provenance/apps/agent-query/node_modules/jest`. The directory existed but was owned by root.

**Root cause.** `docker compose build` runs as root inside the build container, creating mount-point directories on the host as root. Subsequent host-side commands (running as `ec2-user`) can't write into them.

**Fix.** `sudo chown -R ec2-user:ec2-user $REPO_ROOT` immediately before the host-side pnpm install in demo-sync.sh.

**Pattern.** Whenever host-side and container-side processes both touch the same workspace tree, ownership has to be reconciled at handoff points.

---

## B-039 — Demo AL2023 AMI ships no Node/pnpm; `demo-sync.sh` seed step fails immediately

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was Blocker
- **Area:** Infrastructure / user-data

**Symptom.** `[demo-sync FAIL: seed-install] pnpm install for @provenance/seed failed — pnpm: command not found`.

**Root cause.** demo-sync.sh runs the seed CLI from the host (not inside a container). The Amazon Linux 2023 AMI's `dnf install -y docker git jq` step did not include Node. The project requires `engines.node >= 22.13`.

**Fix.** Added Node 22 install via NodeSource + `corepack enable` to `user-data.sh.tpl`. Mirrors the existing docker-compose-plugin install pattern.

---

## B-038 — Demo bootstrap only overrode 2 of 8 dev-defaulted env vars

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was Blocker
- **Area:** Infrastructure / demo bootstrap

**Symptom.** Keycloak realm came up configured for `auth.provenancelogic.com` (wrong frontend URL); API published dev URLs; Vite bundle pointed at the dev API host. End-to-end demo flow could not succeed because internal URLs didn't match the public hostnames.

**Root cause.** [B-036](#b-036) shipped `PRIMARY_DOMAIN` / `AUTH_DOMAIN` for Caddy, but the compose file has SIX more env vars defaulting to dev hostnames: `KC_HOSTNAME`, `KC_FRONTEND_URL`, `KEYCLOAK_ISSUER_URL`, `APP_BASE_URL`, `VITE_API_BASE_URL`, `VITE_KEYCLOAK_URL`. Only the first two were overridden.

**Fix.** demo-bootstrap.sh now writes all eight overrides to `.env.ec2`, idempotently (sed-strip then append).

**Pattern.** When parameterizing a multi-environment compose file, audit every env var with a hostname-shaped default — not just the obvious ones.

---

## B-037 — `demo-sync.sh` referenced compose service `flyway`, but it's `flyway-migrate`

- **Fixed:** 2026-05-16 — [#107](https://github.com/provenance-logic/provenance/pull/107)
- **Severity:** was Blocker
- **Area:** Infrastructure / demo sync

**Symptom.** `compose run --rm flyway migrate` failed with `no such service: flyway`.

**Root cause.** The compose service is named `flyway-migrate` (one-shot, runs migrations then exits). demo-sync.sh was written against a stale service name.

**Fix.** Service rename in demo-sync.sh: `flyway` → `flyway-migrate`. Drop the explicit `migrate` arg — the service's own command already runs `flyway migrate`.

---

## B-036 — Two Caddys fighting for `:80/:443` on a fresh demo cycle

- **Fixed:** 2026-05-16 — [#106](https://github.com/provenance-logic/provenance/pull/106)
- **Severity:** was Blocker
- **Area:** Infrastructure / TLS architecture

**Symptom.** Compose stack on a fresh demo instance failed to start `provenance-ec2-caddy`: `driver failed programming external connectivity ... listen tcp4 0.0.0.0:443: bind: address already in use`. A native systemd Caddy installed by `demo-bootstrap.sh` (per PR #105) was already bound.

**Root cause.** Two distinct Caddys both wanted port 443:
1. demo-bootstrap.sh installed a native Caddy via systemd, with a hand-written Caddyfile pointing at the demo domains.
2. docker-compose.ec2-dev.yml also defined a `caddy:2-alpine` container with its own Caddyfile (hardcoded to dev domains: `dev.provenancelogic.com`, `auth.provenancelogic.com`).

Direct inspection of the live dev EC2 (via `ss -tlnp` + `systemctl is-active caddy`) confirmed the **containerized Caddy** was the canonical path: dev's systemd unit was inactive, the container was serving `https://dev.provenancelogic.com`. PR #105's native-Caddy install was the wrong direction.

**Fix.** Removed the native Caddy install from `demo-bootstrap.sh` entirely (~50 lines deleted). Templatized `infrastructure/docker/config/caddy/Caddyfile` to use Caddy's `{$VAR:default}` env-var syntax (`{$PRIMARY_DOMAIN:dev.provenancelogic.com}` / `{$AUTH_DOMAIN:auth.provenancelogic.com}`). Defaults exactly match the prior hardcoded values, so the live dev box stays bit-identical when compose restarts. Added an `environment:` block to the caddy compose service passing the vars through; demo-bootstrap.sh writes demo-specific overrides into `.env.ec2`. One Caddyfile serves both dev and demo cleanly.

**Pattern.** When you find duplicate-architecture code, check what's actually running in prod/dev before deciding which side to keep. Don't assume the most recently-written code is the canonical path.

---

## B-035 — `dnf install docker` on AL2023 ships buildx 0.12; compose plugin needs 0.17+ for `compose build`

- **Fixed:** 2026-05-16 — [#105](https://github.com/provenance-logic/provenance/pull/105)
- **Severity:** was Blocker
- **Area:** Infrastructure / user-data

**Symptom.** `compose build` for the four custom-built images (api, web, agent-query, embedding) failed: `compose build requires buildx 0.17.0 or later`.

**Root cause.** Amazon Linux 2023's `dnf install docker` installs Docker plus a buildx binary at 0.12.x. Recent docker-compose-plugin versions require buildx >= 0.17 for `compose build`. The user-data installed a fresh docker-compose plugin but didn't refresh buildx.

**Fix.** user-data.sh.tpl now pulls the latest buildx release binary directly from `docker/buildx` releases, mirroring the existing compose-plugin install pattern.

---

## B-034 — `demo-bootstrap.sh` referenced `.env.ec2.example` template that does not exist

- **Fixed:** 2026-05-16 — [#105](https://github.com/provenance-logic/provenance/pull/105)
- **Severity:** was Blocker
- **Area:** Infrastructure / demo bootstrap

**Symptom.** `[demo-bootstrap FATAL] no env template at /opt/provenance/infrastructure/docker/.env.ec2.example`.

**Root cause.** Only `.env.example` exists in the repo. `.env.ec2.example` was a stale name in the script that was never created.

**Fix.** Point `ENV_TEMPLATE` at the real `.env.example`. Runtime copy is still `.env.ec2` for separation from local-dev `.env`.

---

## B-033 — Upstream Caddy systemd unit hardcoded `/usr/bin/caddy`, install put it at `/usr/local/bin`

- **Fixed:** 2026-05-16 — [#105](https://github.com/provenance-logic/provenance/pull/105) (later removed entirely by [#106](https://github.com/provenance-logic/provenance/pull/106))
- **Severity:** was High
- **Area:** Infrastructure (now obsolete — see [B-036](#b-036))

**Symptom.** `caddy.service` failed to start: `Failed to locate executable /usr/bin/caddy: No such file or directory`.

**Root cause.** The upstream `caddy.service` unit from `caddyserver/dist` hardcodes `ExecStart=/usr/bin/caddy`. PR #105's tarball extraction had put the binary at `/usr/local/bin/caddy`.

**Fix.** Install binary directly to `/usr/bin/caddy` in #105. The whole native Caddy install was then removed in #106 in favor of containerized Caddy.

---

## B-032 — Caddy install via `dnf copr enable @caddy/caddy` fails on Amazon Linux 2023

- **Fixed:** 2026-05-16 — [#105](https://github.com/provenance-logic/provenance/pull/105) (later removed entirely by [#106](https://github.com/provenance-logic/provenance/pull/106))
- **Severity:** was Blocker
- **Area:** Infrastructure (now obsolete)

**Symptom.** `dnf copr enable -y @caddy/caddy` errored: `Repository 'amazonlinux-2023-x86_64' does not exist in project '@caddy/caddy'. Available repositories: 'fedora-42-aarch64', ...`.

**Root cause.** The `@caddy/caddy` Copr project only publishes builds for Fedora and EPEL, not Amazon Linux 2023.

**Fix.** Switched in #105 to the GitHub release tarball install path with a manual systemd unit. Subsequently obsoleted by #106's move to containerized Caddy.

---

## B-031 — Em dash in security group description made `terraform apply` fail at AWS

- **Fixed:** 2026-05-16 — [#105](https://github.com/provenance-logic/provenance/pull/105)
- **Severity:** was Blocker
- **Area:** Infrastructure / terraform

**Symptom.** `terraform apply` failed at the security group: `InvalidParameterValue: Value (Provenance demo instance — HTTP/HTTPS public, SSH restricted) for parameter GroupDescription is invalid. Character sets beyond ASCII are not supported.`

**Root cause.** The terraform resource description contained an em dash (`—`, U+2014). AWS rejects non-ASCII in `GroupDescription`.

**Fix.** Replaced with an ASCII hyphen.

**Pattern.** The em-dash style used throughout this repo's docs and comments is fine in nearly all places EXCEPT AWS metadata fields. Worth a `grep -rn '—' infrastructure/terraform` pre-merge check for any future terraform changes.

---

## B-030 — Demo terraform assumed Route 53 ownership of `provenancelogic.com`; it's actually at Cloudflare

- **Fixed:** 2026-05-16 — [#103](https://github.com/provenance-logic/provenance/pull/103) closed and superseded by [#104](https://github.com/provenance-logic/provenance/pull/104)
- **Severity:** was Blocker (foundational design for the entire demo path)
- **Area:** Infrastructure / DNS

**Symptom.** During the very first end-to-end attempt at provisioning the demo environment, the planned approach (terraform manages an `aws_route53_record` pointing `demo.provenancelogic.com` at the new EIP) failed at `data "aws_route53_zone" "parent"` lookup. The IAM principal had Route 53 perms after a console fix, but `aws route53 list-hosted-zones` returned `[]` — there are no Route 53 zones in this AWS account.

**Root cause.** `dig +short NS provenancelogic.com` revealed authoritative nameservers `naya.ns.cloudflare.com` / `alfred.ns.cloudflare.com`. The zone has always been at Cloudflare; the IAM `Route53FullAccess` policy attached during setup was useless for this purpose.

**Fix.** PR #103 (terraform-managed Route 53 records) was closed without merging. Replacement PR #104 took a fundamentally different architectural shape: a **persistent Elastic IP** allocated once and tagged `Name=provenance-demo-eip`, paired with **Cloudflare A records** set once and never touched. Each demo cycle, terraform looks up the EIP by tag (`data "aws_eip"`) and attaches a fresh instance to it via `aws_eip_association`. DNS never has to change. Mirrors the same pattern the long-running `dev.provenancelogic.com` already uses.

**Pattern.** Before designing infrastructure that "manages DNS for X," verify which DNS provider X actually lives at. `dig NS <domain>` is a 1-second check that would have saved a whole PR.

---

## B-027 — F7.46 onboarding wizard: "Sample data" button not built

- **Fixed:** 2026-05-15 — [#100](https://github.com/provenance-logic/provenance/pull/100)
- **Severity:** was Low
- **Area:** Frontend / onboarding / seed

**Symptom.** The osr-roadmap Stage 4 scope listed a "Sample data" button so the wizard could populate the workspace with demo content for users (and especially investor-demo runs) who didn't want to start clean. The F7.46 v1 wizard shipped without it; the existing `/api/v1/seed/*` endpoints at `apps/api/src/seed/` were not safely callable from a browser session (constant-time `SEED_API_KEY` token gate — exposing the token to the frontend is the wrong shape).

**Fix.** New `apps/api/src/sample-data/` module, one endpoint `POST /organizations/:orgId/sample-data`, gated by `JwtAuthGuard + RolesGuard` with `@Roles('org_admin')` and an env-flag check (`DEMO_DATA_ENABLED=true`). The service throws `NotFoundException` when the flag is off, so production deploys can keep the flag false and probing attackers cannot detect the surface.

The service idempotently populates the calling org with:

- One domain (`Customer Data`)
- Two products (`Customer 360 View` published, `Marketing Segments` draft)
- One output port per product (SQL JDBC + file export, contract schemas filled in)
- One freshness SLO on the published product (max event age ≤ 4 hours)
- Two notifications to the calling principal (workspace-ready, product-published) so the notification bell shows non-zero state

Idempotency is via natural-key find-or-create — slug-scoped to the org for domain/product/port, principal+dedup-key for notifications. Re-running is a no-op. Bypasses the production publish flow's governance pre-checks and Kafka lifecycle events (the payload is authored, not user-supplied; same trade-off the `SeedController` makes for the dev-runner endpoints).

The OnboardingWizard's `confirm_org` step gains a `SampleDataAffordance` row: a one-line description and a "Populate sample data" button. Clicking shows a `window.confirm` dialog before submit. On success, the row is replaced with a green summary banner showing the created counts. On `404` (env flag off), the row hides itself silently — production users never see a feature that doesn't work for them.

**Scope deferrals.**

- **Access grant** was named in the bug entry's proposed scope. Skipped because grants need a non-owner principal to be meaningful (granting an org_admin access to their own org's product is a no-op in the policy engine) and seeding a second principal expands scope materially. The seed runner does this when populating a whole org; the in-app button focuses on what the wizard can show without secondary identities.
- **A "Start clean" button** was the second option named in the bug entry. The default state IS clean — no button needed for that path. Removed from the affordance to keep the surface tight.

---

## B-028 — EC2 dev box: containers don't pick up new compose env vars without `--force-recreate`

- **Fixed:** 2026-05-15 — three-stage close-out across [#95](https://github.com/provenance-logic/provenance/pull/95) (fix 1), [#96](https://github.com/provenance-logic/provenance/pull/96) (fix 2), and [#99](https://github.com/provenance-logic/provenance/pull/99) (fix 3)
- **Severity:** was Medium
- **Area:** Operations / EC2 dev box

**Symptom.** Every page on dev.provenancelogic.com rendered a pink error banner; every API request returned 502 Bad Gateway. Caddy, Postgres, Keycloak, OPA, Redpanda, OpenSearch, Neo4j, Temporal, and the embedding service all reported `(healthy)`; only `provenance-ec2-api` was `(unhealthy)`.

**Root cause.** The Domain 12 PRs (#79 / #82 / #83) added a new required env var `AQL_INTERNAL_TOKEN` to the api service's compose env block. The compose-file change was correct. But the api container on the dev box had been created BEFORE that line was added, and `docker compose restart api` only stops and starts the existing container — it does NOT re-read the compose YAML or inject new env. The running container's environment was missing `AQL_INTERNAL_TOKEN`, the api's zod config validator rejected the env on every boot attempt, the api entered a crash/restart loop, and every API call became a 502.

**Fix — three stages.**

1. **#95** — added the "When `restart` Isn't Enough — Use `--force-recreate`" subsection to `documents/runbooks/operations.md`. Documented the canonical `docker compose up -d --force-recreate api agent-query web` workflow after any `git pull` that may have touched env, and the parallel B-029 Vite-bind-mount-staleness motivation.

2. **#96** — added `infrastructure/scripts/refresh-ec2-dev.sh`, a one-command wrapper that runs `git pull` + `docker compose up -d --force-recreate api agent-query web` + a 30-second `/api/v1/health` poll. Reduces the three-step manual incantation to one sudo-able command and exits non-zero on failure so cron / scripted use catches breakage.

3. **[#99](https://github.com/provenance-logic/provenance/pull/99)** — added `infrastructure/scripts/validate-compose-env.mjs`, a Node script that scans `apps/api/src/**` and `apps/agent-query/src/**` for `process.env.X` references, `process.env['X']` bracket access, AND zod schema property declarations (the `KEY: z.string()...` pattern the AQL `config.ts` uses — the very pattern that hid `AQL_INTERNAL_TOKEN` from review the first time). Cross-references those keys against the `environment:` block of each service in `docker-compose.ec2-dev.yml`. Wired as a new `Validate Compose Env` job in `.github/workflows/ci.yml` so PRs that drift compose against code fail at review time, not at runtime.

   An `infrastructure/scripts/compose-env-allowlist.txt` companion file holds env vars referenced by code but legitimately absent from compose (NODE_ENV, AWS SDK conventions, OPENAPI_SPECS_DIR, tuning knobs whose schema defaults are correct for the dev box). Every allowlist entry carries an inline comment naming why.

**Latent drift the validator caught on first run.** The agent-query service's compose env block was missing three vars the AQL `config.ts` declared:

- `AQL_INTERNAL_TOKEN` (z.string().min(16), no schema default — would crash AQL startup the first time someone `--force-recreate`d the agent-query container)
- `KAFKA_BROKERS` (schema default `localhost:19092` — won't work in Docker networking; AQL needs `redpanda:9092`)
- `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED` (schema default 'true' — defaults OK, but operationally important enough to be explicit so an operator can flip to shadow mode without rebuilding)

Fixed in this PR alongside the validator wiring. The api service's three missing entries (`APPROVAL_TIMEOUT_HOURS`, `APPROVAL_ESCALATION_TIMEOUT_HOURS`, `INVITATION_DEFAULT_TTL_HOURS`) all have safe schema defaults and are tuning knobs without runtime dependencies on other services — allowlisted with `# schema default Xh` comments rather than added to compose.

---

## B-025 — F7.46 onboarding wizard: connector registration UI does not exist

- **Fixed:** 2026-05-15 — [#98](https://github.com/provenance-logic/provenance/pull/98)
- **Severity:** was Low
- **Area:** Frontend / onboarding

**Symptom.** PRD F7.46 + osr-roadmap Stage 4 list "register a connector" as one of the five guided onboarding steps. The backend at `apps/api/src/connectors/` was fully implemented (controller at `/organizations/:orgId/connectors`, 13 connector types, validation + health-event endpoints, nested source registrations and schema snapshots), but there was no frontend UI for a human to register a connector — the wizard rendered this step as a skip-only "Coming soon" panel.

**Fix.** New `ConnectorsPage` at `apps/web/src/features/connectors/ConnectorsPage.tsx` plus a `connectorsApi` shared client at `apps/web/src/shared/api/connectors.ts`. The page resolves the active org (same first-org pattern `DashboardRedirect` and the agents page use), fetches the org's domains so the form has a real domain picker, and lists every connector with name + description, type label, domain name, validation-status pill (pending / valid / invalid / stale, color-coded), and registration date. Registration form binds to `POST /organizations/:orgId/connectors` with name, domain picker, 13-option connector-type dropdown, optional credential ARN, optional description, and a JSON textarea for connection config (defaults to `{}`, client-side-parsed and rejected if it isn't a JSON object).

`NavShell` gains a "Connectors" nav item between Dashboard and Marketplace. The OnboardingWizard's `register_connector` step is rewritten from skip-only to PrimaryButton (→ `/connectors`) + SecondaryButton (Mark done) + SkipButton, mirroring the shape of `publish_product` and `invite_agent`.

**Scope deferrals.**

- **Per-connector-type config schemas.** The form exposes connection config as a generic JSON textarea rather than rendering 13 type-specific forms. Each connector type really has its own required-field schema (postgres wants host/port/database; s3 wants bucket/region; etc.), and a fully validated per-type form is a larger UX project. Deferred — operators currently paste a config object from their seed templates or platform docs.
- **Validation, source registration, and snapshot workflows.** The page does not yet expose "Validate now," "Register a source under this connector," or "Capture schema snapshot" — all three endpoints exist on the controller. Captured in the row's validation pill (read-only) for now; interactive workflows are a follow-on.
- **Secrets-manager picker.** The credential ARN field is a free-text input. A picker that lists ARNs the org's IAM role can read against would be nicer but requires an aws-sdk dependency we don't otherwise need on the frontend.

---

## B-026 — F7.46 onboarding wizard: agent registration UI does not exist

- **Fixed:** 2026-05-15 — [#97](https://github.com/provenance-logic/provenance/pull/97)
- **Severity:** was Low
- **Area:** Frontend / onboarding

**Symptom.** PRD F7.46 + osr-roadmap Stage 4 list "invite an AI agent" as one of the five guided onboarding steps. The `/agents` route in `apps/web/src/app/Router.tsx` was registered as `<ComingSoon title="Agents" />`. The backend in `apps/api/src/agents/` and the MCP `register_agent` tool were shipped, but there was no UI for a human to register an agent from the wizard, so the wizard rendered this step as a skip-only "Coming soon" panel.

**Fix.** New `AgentsPage` at `apps/web/src/features/agents/AgentsPage.tsx` plus an `agentsApi` shared client at `apps/web/src/shared/api/agents.ts`. The page resolves the current org (same first-org pattern `DashboardRedirect` uses), lists every agent in that org with display name, model, trust-classification pill, oversight contact, and registration date, and exposes a registration form binding to `POST /agents` (display name, model name, model provider dropdown, human oversight contact email).

The Keycloak client secret returned by the API is shown exactly once in a dismissable amber banner with a Copy button. The banner spells out that Provenance never stores the secret in plaintext and that the recovery path is `POST /agents/:agentId/rotate-secret`. This matches the backend reality — `agents.service.ts` only includes the secret in the create response.

The OnboardingWizard's `invite_agent` step body was rewritten to drop the "coming in a follow-on PR" hedging and now offers PrimaryButton (→ `/agents`) + SecondaryButton (Mark done) + SkipButton, mirroring `publish_product`. `ComingSoon` was the only consumer of that helper component in `Router.tsx` and was removed.

**Scope deferrals.**

- **Trust-classification mutations.** The PATCH `/agents/:agentId/classification` endpoint and its role gates (upgrades = governance only; downgrades = oversight contact OR governance) stay backend-only. The page surfaces the current classification but doesn't expose the upgrade/downgrade affordance — it lands in a follow-on once the policy UX is settled.
- **Last activity.** The bug entry's proposed scope mentioned "last activity" as a column. That data lives in `agent_audit` rows and isn't on the agent identity object; adding it would mean either a derived field on the agent response or a separate query per row. Deferred — current registration date covers v1.

---

## B-022 — `api` and `minio` healthchecks called HTTP tools the container images do not ship; both reported "unhealthy" forever

- **Fixed:** 2026-05-08 — commit `<pending>`
- **Severity:** was Medium
- **Area:** Infrastructure / developer experience

**Symptom.** After `docker compose up -d` from a fresh clone, both `provenance-api` and `provenance-minio` showed `(unhealthy)` indefinitely while their endpoints responded normally to host-side `curl`. Functionally harmless today (nothing in the running stack `depends_on` either of them with `condition: service_healthy`), but it alarmed first-time contributors reading `docker compose ps`, and any future health-gated dependent (agent-query, kong-routes-bootstrap, smoke-test sidecar) would never have started.

**Root cause.** Each healthcheck invoked a tool not in the container image:

- `api` (development stage = `node:20-slim`): `wget -qO- http://localhost:3001/api/v1/health`. Debian-slim does not ship `wget`. Probe logs read `/bin/sh: 1: wget: not found`.
- `minio` (`quay.io/minio/minio:RELEASE.2024-04-06T05-26-02Z`): `curl -sf http://localhost:9000/minio/health/live`. The minio image ships only `mc` (no curl/wget/nc).

Same class of bug as B-010 (OPA distroless image had no `wget`). Both PR #66 (which fixed the *path* of the api healthcheck) and the original authors missed that the *tool* was wrong for the chosen base image.

**Fix.** Two healthcheck changes, no Dockerfile changes.

1. **`api` healthcheck** (three compose files): replaced the `wget` test with `["CMD", "node", "-e", "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`. Node 20 ships a stable global `fetch`; `node` is by definition the api container's primary binary. CMD-array form, no shell required, no extra install. Existing `interval`/`timeout`/`retries`/`start_period` left unchanged — diff is one line per file.

2. **`minio` healthcheck** (`docker-compose.yml` only): added `MC_HOST_local: http://${MINIO_ROOT_USER:-provenance}:${MINIO_ROOT_PASSWORD:-provenance_dev_password}@localhost:9000` to the `minio` service's environment, and replaced the `curl` healthcheck with `["CMD", "mc", "ready", "local"]`. The `MC_HOST_<alias>` env var is MinIO's documented alias-via-environment pattern — `mc` reads it on every invocation, so the alias is effectively pre-configured at container start. The env-var names and defaults align with the existing `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` so no parallel credential pair is introduced.

**Bonus scope: `docker-compose.ec2-dev.yml` api healthcheck.** The bug entry's proposed-fix patch named only `docker-compose.yml` and `docker-compose.dev.yml`, but `docker-compose.ec2-dev.yml` had the same broken `wget` test against the same `node:20-slim` image. Same logical change, sibling file. Patched in this PR alongside the other two; flagging here because the bug entry missed it. The pattern in B-014 (B-021-item-4 fix in PR #66 missed `docker-compose.dev.yml`) just repeated itself one compose file deeper.

**Considered but rejected.**

- **CMD-SHELL `mc alias set local ... ; mc ready local`** as the minio healthcheck (the bug entry's hedged fallback). Three downsides: (a) re-runs `mc alias set` on every probe (~4× per minute), (b) embeds the password literally in the healthcheck command line on every probe, (c) requires `/bin/sh` to be present in the minio image — variable across releases and not something the compose should depend on. The `MC_HOST_<alias>` env-var approach has none of these downsides.
- **Adding `curl` / `wget` to the api or minio image via Dockerfile** to preserve the existing test commands. Rejected: the OSR target is "function properly without weird workarounds" — bloating an image to fit a probe command is the wrong direction. Use a binary the image already ships.
- **Preemptive audit / rewrite of every other healthcheck in the compose files** (the bug entry suggested auditing neo4j / opensearch / kong / etc.). Rejected as speculation. The empirical audit IS the strict fresh-clone simulation: anything else silently broken would surface as `(unhealthy)` in `docker compose ps` during validation. Passive scan confirmed every other service uses a binary shipped by its image (postgres `pg_isready`, redpanda `rpk`, kong `kong health`, opa `/opa eval`, keycloak `/dev/tcp` bash builtin, temporal `temporal` CLI, web busybox `wget` from `node:20-alpine`). Fresh-clone validation found no further `(unhealthy)` services, so none were touched.

**Verified.** Strict fresh-clone simulation on macOS (Darwin 25.4.0, Docker 29.4.0). Cloned the branch into `/tmp/provenance-b022-test`, ran `pnpm install` (which produced `packages/types/dist/` via the postinstall hook), then `docker compose -f docker-compose.yml up -d` with `COMPOSE_PROJECT_NAME=provenance-b022-test` for volume isolation against the existing live `provenance` stack on the same host.

Two test-only modifications were made to the cloned compose to allow it to run *side-by-side* with the existing live stack on the same host (not committed, not part of the PR): (a) `container_name:` directives stripped from each service (the compose pins fixed names like `provenance-api` that conflict across projects), (b) host-side port bindings replaced with ephemeral mappings (e.g. `"5432:5432"` → `"5432"`). Neither modification affects healthcheck behavior — every probe runs on container-internal `localhost`. The bug-fix portion (the new `test:` commands and the new `MC_HOST_local` env var) was tested verbatim.

After full convergence, `docker compose ps` showed every service `(healthy)`, with the two B-022 services specifically:

```
api      Up 18 seconds (healthy)
minio    Up 34 seconds (healthy)
```

Direct before/after on the same machine: the existing live `provenance` stack (running unmodified `main` compose) continues to show `provenance-api (unhealthy)` and `provenance-minio (unhealthy)` after 42+ minutes uptime, confirming the change is what makes the difference.

Direct probe verification inside the test containers (orthogonal to Compose's own healthcheck loop):

- `docker exec ... node -e "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` → exits 0.
- `docker exec ... mc ready local` → prints `The cluster is ready`, exits 0.

Every other service in the stack also reported `(healthy)` — empirical confirmation that no other healthcheck in `docker-compose.yml` is silently broken (the basis for rejecting the preemptive-audit alternative). Test stack torn down with `docker compose down -v`; tmp clone retained for reference.

Validation focused on `docker-compose.yml` (the OSR fresh-clone target). The same one-line `test:` change in `docker-compose.dev.yml` and `docker-compose.ec2-dev.yml` is mechanically identical (same probe command, same `node:20-slim` image, same in-container `localhost` semantics) and was not re-booted separately under fresh volumes — call out explicitly in case anyone wants belt-and-braces coverage of those compose targets in a follow-up.

**Pattern.** Healthcheck commands must use a tool that is provably present in the container image. Distroless and `-slim` base images strip standard utilities; minio, postgres, redpanda, and similar images ship purpose-specific binaries (`mc`, `pg_isready`, `rpk`) that should be preferred over generic curl/wget. When adding a healthcheck:

1. Identify the image's base layer (alpine, debian-slim, distroless, custom).
2. Confirm the chosen tool is present — run the probe command inside a fresh container before trusting it in compose.
3. Prefer the image's primary binary over generic shell utilities; it will never be missing.

Multi-compose corollary: when a service has multiple compose targets (default / dev / ec2-dev / demo), audit *all* of them when fixing the healthcheck. B-022's entry missing the ec2-dev file (and B-014 missing `docker-compose.dev.yml`'s healthcheck path before it) are the in-tree examples of this trap. Grep all `docker-compose*.yml` files for the service name when fixing infrastructure paper cuts.

**Related (resolved).** B-010 — OPA distroless image had no shell or `wget`. Same class of bug; fixed by switching to `["CMD", "/opa", "eval", "true"]`.

---

## B-021 — README onboarding paper cuts: stale Node version, npm/pnpm mismatch, wrong frontend port, broken healthcheck path, sparse seed instructions

- **Fixed:** 2026-05-07 — items 4 and (dev compose healthcheck) shipped in `d8f73c4` (PR #66) and `<pending>` (PR B); items 1, 2, 3, 5 shipped in commit `<pending>` (this PR).
- **Severity:** was Medium (cumulative impact on first-time developer experience)
- **Area:** Documentation / developer experience

**Symptom.** Several small, independent inaccuracies in the README "Getting Started" section that, together, made the first ten minutes of contribution materially harder than they should have been. None on its own was a blocker; collectively they were a thousand paper cuts:

1. **Stale Node version.** README said "Node.js 20+ and pnpm." Homebrew's current `pnpm` formula requires Node 22.13+ as of early 2026 — installing `pnpm` via `brew` on Node 20 fails at first invocation.
2. **npm vs pnpm mismatch.** README steps 3 and 4 instructed the user to run `cd apps/api && npm install && npm run start:dev` and `cd apps/web && npm install && npm run dev`. Two problems: (a) the repo is a `pnpm` workspace, and `npm install` inside an app directory created a divergent tree that ignored the workspace lockfile; (b) the same `docker compose up -d` from step 2 already ran `provenance-api` and `provenance-web` containers — `npm run start:dev` in step 3 then tried to bind to port 3001 on top of the running container.
3. **Wrong frontend port.** README pointed users at `http://localhost:5173` (Vite default). The containerized Vite dev server is bound to `:3000` (which is what the Keycloak `provenance-web` client lists in its redirect URIs).
4. **Broken healthcheck path** in `docker-compose.yml` (and `docker-compose.dev.yml`) — `wget -qO- http://localhost:3001/health` versus the actual `/api/v1/health` route.
5. **Sparse seed instructions** — an 8-line `ENV=value … pnpm --filter @provenance/seed seed` block with no surrounding explanation. The dev credentials it expected were baked into the compose but never explained, and a user couldn't tell which of the eight env vars were required vs. derivable.

**Fix.** Shipped across three PRs:

- **PR #66 (`d8f73c4`):** item 4 in `docker-compose.yml`.
- **PR B (`<pending>`):** item 4 in the sibling `docker-compose.dev.yml` (folded into the B-014 fix as bonus scope).
- **PR C (this PR):** items 1, 2, 3, 5 — README rewrite plus `infrastructure/docker/.env.example` and `package.json#engines`.

This-PR-specific changes:

1. **Node version** — README prereqs now read "Node.js 22.13+ and pnpm 9+" with a one-line explanation tying the floor to Homebrew's `pnpm` formula. `package.json#engines.node` bumped from `>=20.0.0` to `>=22.13.0` so `pnpm` itself rejects out-of-range Node versions at install time (`engine-strict=true` is set in `.npmrc`).
2. **npm/pnpm mismatch** — deleted README steps 3 (`apps/api && npm install && npm run start:dev`) and 4 (`apps/web && npm install && npm run dev`) entirely, and added a proper `pnpm install` step at the workspace root between clone and `docker compose up`. Replaced the deleted blocks with one inline note in the (renumbered) Access step: "The Compose stack already runs the API and frontend in dev mode with hot-reload — source files in `apps/api/` and `apps/web/` are volume-mounted, so edits trigger an in-container rebuild without restarting anything. There is no separate 'install dependencies and run dev server' step on the host." Did not add a separate "Hot-reload outside Docker" section — it was optional in the writeup, and adding it now without a verified workflow would shift the paper-cut elsewhere. Defer to a follow-up if anyone actually wants that path.

   **Note on `pnpm install` placement.** The cumulative fresh-clone simulation (see Verified, below) caught that the seed step in step 5 fails on a fresh clone with `sh: tsx: command not found` — because the seed CLI runs from the host and needs host `node_modules`. The first revision of this PR forgot the install step entirely (the deleted `npm install` blocks were inadvertently providing it via wrong-package-manager invocations). The install also has to land *before* `docker compose up` so that the host postinstall's `packages/types/dist` build doesn't trigger an `nest start --watch` hot-reload mid-seed (observed during testing).
3. **Frontend port** — `http://localhost:5173` → `http://localhost:3000` everywhere.
5. **Seed instructions** — rewritten as a `cp .env.example .env && set -a; source .env; set +a` flow followed by `pnpm --filter @provenance/seed seed`. The two missing defaults (`DATABASE_URL` and `KEYCLOAK_ADMIN_CLIENT_SECRET`) added to `infrastructure/docker/.env.example` with comments explaining what each is and warning they are throwaway dev values. The seed CLI's `min(1)` requirements on `SEED_API_KEY`, `DATABASE_URL`, and `KEYCLOAK_ADMIN_CLIENT_SECRET` were intentionally **not** softened to `.default()` — that would be a code change to `packages/seed/src/config.ts` outside B-021's documentation/dev-experience scope, and it would remove the safety net that surfaces misconfiguration when the CLI is pointed at the wrong stack.

**Verified (cumulative fresh-clone).** Cloned `fix/osr-readme-rewrite` (= main + this PR) into an isolated tmp dir, ran the full README literally with `COMPOSE_PROJECT_NAME=provenance-osr-test` for volume isolation. Findings: every URL in step 4 responds (frontend 200, api 200, api/v1/docs 200, Keycloak 302, Neo4j 200); flyway-migrate applied V1–V27 against the fresh DB and exited cleanly; the seed step ran end-to-end (orgs → trust score, 13 phases) and the password-grant token for `admin@acme.example.com` correctly carries `provenance_org_id`. The only paper cut found was the missing `pnpm install` step described under item 2 above — fixed in this PR before merge. Two pre-existing healthcheck-tool bugs surfaced (api uses `wget` not present in `node:20-slim`; minio uses `curl` not present in its image) — out of B-021's scope, filed separately.

**Pattern.** Daily-workflow drift is the largest source of README rot. The team that ships features never re-reads the onboarding doc because their daily workflow is somewhere else (here: the EC2 dev box). The fix is procedural, not documentary: walk the README on a fresh laptop on a regular cadence and log every paper cut as a bug, even one-line ones. Items 1, 3, and 4 of B-021 each cost a contributor 5–15 minutes; item 2 cost ~30; item 5 cost ~45 to derive the right env values from compose. Cumulatively the first 90 minutes of contribution turned mostly into yak-shaving.

---

## B-014 — Default `docker-compose.yml` had no migration service; fresh DB had no schema

- **Fixed:** 2026-05-07 — commit `<pending>`
- **Severity:** was Blocker
- **Area:** Infrastructure / database

**Symptom.** A user following the README ("clone → `cd infrastructure/docker && docker compose up -d` → run seed") hit an opaque 500 from the seed CLI on the very first call: API logs revealed `relation "organizations.orgs" does not exist`. The Postgres container was healthy and accepting connections, but no platform schema had ever been applied.

**Root cause.** `infrastructure/docker/docker-compose.yml` (the file the README directs users to) declared no migration service. `infrastructure/docker/docker-compose.ec2-dev.yml` did have a `flyway-migrate` service, but the EC2 file is not what the README points to. The default compose was authored on the assumption that schema would be in place "somehow," and on the EC2 dev box it always was.

**Fix.** Added a one-shot `flyway-migrate` service to both `infrastructure/docker/docker-compose.yml` and `infrastructure/docker/docker-compose.dev.yml`. The service uses `flyway/flyway:10-alpine`, `restart: "no"`, depends on `postgres: service_healthy`, and runs `flyway migrate` (only — no `baseline` step) against the same `flyway.conf` and `migrations/` directory the API uses. The `api` service in both files now depends on `flyway-migrate: condition: service_completed_successfully` in addition to its existing healthchecks, so the API container does not start until V1–V27 have applied to the empty DB.

**Why no `baseline` command.** The EC2 compose's command was `flyway baseline && flyway migrate`. After PR #66 dropped `baselineVersion` and `baselineOnMigrate` from `flyway.conf` (B-015 fix), running `flyway baseline` on a fresh DB would stamp `flyway_schema_history` at version 1 by default, causing the subsequent `migrate` to skip V1 — V2 would then fail because V1's tables don't exist. `flyway migrate` alone is correct on a fresh DB (applies V1–V27 in order) and idempotent on a populated DB (no-op).

**Bonus scope: docker-compose.dev.yml API healthcheck.** Found that the dev (lite) compose still had the broken `/health` healthcheck path that PR #66 fixed in `docker-compose.yml`. Patched in this PR alongside the migration service since the file was already being edited; same root cause (B-021 item 4) but a separate file the original PR did not touch.

**Verified.** YAML structure parsed and validated for both files: `flyway-migrate` service defined correctly, `api.depends_on` includes the new condition, dev healthcheck path now reads `/api/v1/health`. End-to-end migration run (drop volumes → up → V1–V27 apply → api comes up only after) is part of the cumulative fresh-clone simulation across PRs A+B+C.

**Pattern.** A default compose file is the contract with first-time contributors. If the EC2 / production compose has a service that the default doesn't, that's a bug — not "an EC2 thing." Audit pairs of compose files (default vs. EC2 vs. demo) for divergence whenever schema initialization, post-import config, or other "first boot" steps live in only one of them.

---

## B-013 — `packages/types/dist/` not pre-built; workspace package resolution falls through to broken path mapping

- **Fixed:** 2026-05-07 — commit `<pending>`
- **Severity:** was Blocker
- **Area:** Build / monorepo

**Symptom.** On a fresh clone, after `pnpm install`, `apps/api/node_modules/@provenance/types/dist/` did not exist. The package's `package.json` declares `"main": "./dist/index.js"`, so any consumer doing `require('@provenance/types')` got a missing-module error from Node's package resolver. Combined with B-012, this surfaced as a confusing `.ts` path in the require.

**Root cause.** `pnpm install` from the repo root does not run a recursive `build` — it only installs and links workspace packages. `packages/types` has its own `build` script (`tsc`) that generates `dist/`, but nothing invoked it before the API tried to consume the package. The README did not mention building shared packages either.

**Fix.** Two coordinated changes:

1. **Root `package.json`:** added `"postinstall": "pnpm --filter @provenance/types build"`. Pnpm runs the project's own `postinstall` script after every install, so the host's `pnpm install` (the step the README directs the user to before `docker compose up -d`) now produces `packages/types/dist/`. Containers volume-mount `packages/types/` from the host, so the freshly-built dist is visible to `apps/api`'s `nest start --watch` and `apps/web`'s Vite dev server at runtime.

2. **`apps/{api,web,agent-query}/Dockerfile` deps stages:** added `--ignore-scripts` to `pnpm install --frozen-lockfile`. The deps stages copy only the `package.json` files (not `packages/types/src`), so a postinstall that calls `tsc` would fail at docker build time. The flag suppresses lifecycle scripts during the deps stage; the install itself is unaffected.

Considered alternative: `predev` / `prebuild` scripts on each consumer (`apps/api`, `apps/web`) that build types before invoking the consumer's own build. Rejected because (a) it would need extra Dockerfile changes to put `pnpm-workspace.yaml` into the development stage so `pnpm --filter` can resolve, (b) it pushes per-package responsibility for a workspace-wide concern, and (c) the host postinstall is more robust against new consumers being added later.

Considered alternative: `infrastructure/scripts/dev-bootstrap.sh` that wraps `pnpm install` + types build + `docker compose up -d`. Rejected because the OSR target is "function properly without weird workarounds" — a wrapper script *is* a weird workaround when the workspace root's `package.json` can carry the responsibility. The B-013 writeup originally favored option 2 partly because it would also slot in B-016/B-018 fixes — both of those landed declaratively in PR #66 and no longer motivate a bootstrap script.

**Verified.** Removed `packages/types/dist/`, ran `pnpm install` from root, confirmed dist reappeared in 1.2s with `index.js` and `index.d.ts` resolvable through the `apps/api/node_modules/@provenance/types` symlink.

**Pattern.** Pnpm workspaces do not auto-build shared packages on install. If a workspace package emits artifacts that consumers import via the package's `main` field (rather than via TypeScript path mappings to source), the workspace root must build that package after install — either via `postinstall`, an explicit `bootstrap` script, or a turbo task that runs at install time. Path mappings to `src/` work only at type-check time and break at runtime once the consumer is bundled or compiled.

**Related (still open).** None — fresh-clone build resolution for `@provenance/types` is now complete with PR #66 (B-012, the `.ts`-extension path mapping) plus this fix.

---

## B-020 — `VITE_API_BASE_URL` defaults to Kong (`localhost:8000`), but Kong has no API routes provisioned in default compose

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / frontend

**Symptom.** Frontend at `http://localhost:3000` loaded but every API call from the browser failed with a Kong 404. `curl http://localhost:8000/api/v1/health` confirmed Kong returned 404 for every path. `curl http://localhost:8001/services` showed Kong had zero services configured.

**Root cause.** `infrastructure/docker/docker-compose.yml:593` set `VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:8000/api/v1}` — pointing the frontend at Kong. Kong was up and healthy (its own DB migration ran), but no routes had been declared for the Provenance API. On the EC2 stack Kong has Caddy in front of it and a separately-provisioned route table; on the default compose Kong was effectively decorative — it accepted connections but routed nothing.

**Fix.** Repointed the frontend at the API directly — changed the default to `http://localhost:3001/api/v1`. The API container already exposes 3001 to the host and CORS is already permissive in dev (the `provenance-web` Keycloak client lists `http://localhost:3000` as an allowed origin). Kong is now inert in the local stack. Considered alternative: provision Kong routes at startup via a `kong-routes-bootstrap` one-shot service (preserves the production-shaped frontend → Kong → API topology). Deferred — if production-shape rehearsal is needed locally, a `docker-compose.kong-local.yml` overlay is the appropriate place rather than the default compose.

**Pattern.** A default that points at infrastructure with no provisioning is worse than a default that points at the actual service. If a layer (Kong, a load balancer, a sidecar) only earns its keep with additional configuration, do not wire the default through it — wire the default to the canonical underlying service and add the layer as an explicit overlay when needed.

---

## B-019 — `KEYCLOAK_ISSUER_URL` default in `docker-compose.yml` lacks `/realms/{realm}` path; API rejects every JWT with 401

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / API

**Symptom.** With B-018 fixed and a JWT now correctly carrying `provenance_org_id`, every authenticated API call returned 401. Nothing in the API logs at warn or above — the rejection happened silently inside passport-jwt's issuer validation.

**Root cause.** `infrastructure/docker/docker-compose.yml:442` set `KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080}`. The matching JWT issuer claim is `http://localhost:8080/realms/provenance` (Keycloak always issues with the full realm path). `apps/api/src/auth/jwt.strategy.ts:25-31` documents that `KEYCLOAK_ISSUER_URL` must be the *full* issuer including `/realms/{realm}`. The EC2 compose had it correct; the local default and `docker-compose.dev.yml` did not.

**Fix.** Patched the default in both `docker-compose.yml` and `docker-compose.dev.yml` to include the realm path: `KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080/realms/provenance}`.

**Follow-up not yet shipped.** A Zod check in `apps/api/src/config.ts` that rejects a `KEYCLOAK_ISSUER_URL` lacking `/realms/` would prevent this exact bug recurring. Currently the config validates the value as `z.string().url().optional()` only — no realm-path assertion. File a small follow-up if recurrence is a concern.

**Pattern.** Per CLAUDE.md, "A new env var must land in every config layer at once." This is the inverse — an existing env var with inconsistent defaults across compose files. Same root cause: the EC2 compose drifted ahead and the local defaults were not kept in sync.

---

## B-018 — Realm `unmanagedAttributePolicy` not enabled in import; `provenance_*` user attributes silently dropped

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Identity / Keycloak

**Symptom.** With B-016 fixed, the seed CLI ran to completion and apparently wrote `provenance_org_id` and `provenance_principal_type` as user attributes on each seeded principal. But a subsequent password-grant token contained neither claim. The frontend's `RequireOrg` guard reads `keycloak.tokenParsed.provenance_org_id` to decide if a user has joined an org — without this claim every login landed on `/onboarding/org` regardless of seeded state. The API's tenant-isolation middleware also rejected every request for missing `provenance_org_id`.

**Root cause.** Keycloak 24's User Profile feature (enabled by default for new realms) refuses to persist any attribute not declared in the realm's user-profile schema — unless `unmanagedAttributePolicy` is set. The realm JSON did not set this, so Keycloak silently dropped the seed's `provenance_org_id` write on user create. The protocol mappers on the `provenance-web` client were correctly defined, but they mapped from an attribute that did not exist on the user. The EC2 dev box `configure-keycloak-ec2.sh` (line 124) sets `unmanagedAttributePolicy=ADMIN_EDIT` after import; no equivalent ran for the local Compose stack. CLAUDE.md notes this Keycloak-24 quirk for the EC2 setup but it was never propagated to the local realm import.

**Fix.** Added `unmanagedAttributePolicy: "ADMIN_EDIT"` to the realm JSON top-level (`infrastructure/docker/config/keycloak/realms/provenance-realm.json`). Keycloak's RealmRepresentation accepts the field at import time. Considered alternative: declaring each `provenance_*` attribute explicitly in a `userProfile.attributes` block — more declarative but more verbose. Chose the lighter-weight policy setting because the attribute set is still evolving.

**Pattern.** Keycloak silently drops unknown user attributes by default in v24+. Any feature that writes custom attributes (`provenance_*`, future namespaces) must verify the realm's `unmanagedAttributePolicy` is set, or declare the attributes in the user-profile schema. Test this end-to-end on a fresh realm import — the bug is invisible in unit tests because they don't exercise the import path.

---

## B-017 — Seed data uses `interface_type: 'semantic_query'` but DB CHECK constraint expects `'semantic_query_endpoint'`

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker (for the seed flow specifically)
- **Area:** Seed / data product schema

**Symptom.** Once Keycloak admin worked (B-016 fixed), the seed CLI failed at the products step with `QueryFailedError: new row for relation "port_declarations" violates check constraint "port_declarations_interface_type_check"`. The offending insert had `"interface_type": "semantic_query"`. The DB CHECK constraint (defined in V3) accepts `'sql_jdbc' | 'rest_api' | 'graphql' | 'streaming_topic' | 'file_object_export' | 'semantic_query_endpoint'` — note the `_endpoint` suffix.

**Root cause.** Two code locations in the seed package used the short form `'semantic_query'` instead of the canonical `'semantic_query_endpoint'`:

- `packages/seed/src/types.ts:52` — the `PortInterfaceType` union
- `packages/seed/src/products/acme-corp-products.ts:45,54` — two output port declarations on the customer-360 product

Nothing else in the codebase used the short form (CLAUDE.md and the architecture document use `Semantic query endpoint`). Typo introduced when the seed package was authored and never caught because the seed CLI was added late in Phase 5.6 and never ran end-to-end against a fresh DB (the EC2 dev DB had its products manually inserted before the seed package existed).

**Fix.** Renamed `'semantic_query'` to `'semantic_query_endpoint'` at both locations in the seed.

**Pattern.** Any seed value that lands in a CHECK-constrained column should be derived from the same TypeScript union the API uses, not redeclared in the seed package. Worth a follow-up: have `packages/seed/src/types.ts` import `PortInterfaceType` from `@provenance/types` rather than maintaining its own copy.

---

## B-016 — `provenance-admin` Keycloak service account had no realm-management roles in realm import

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Identity / Keycloak

**Symptom.** With migrations applied and the API up, the seed CLI failed at the second step with `Keycloak admin GET /users?email=... -> 403`. Any platform code path that called Keycloak Admin REST as the `provenance-admin` client (seed user creation, invitation acceptance, agent client provisioning per ADR-002) hit the same 403.

**Root cause.** `infrastructure/docker/config/keycloak/realms/provenance-realm.json` declared the `provenance-admin` confidential client with `serviceAccountsEnabled: true` and the correct secret, but did not assign any `realm-management` client roles to its service account user. Keycloak by default gives a service account zero admin permissions. The EC2 dev box `infrastructure/docker/scripts/configure-keycloak-ec2.sh` (lines 222–226) granted the required roles via `kcadm add-roles` after import, but no equivalent ran for the local Compose stack. The roles required (per the EC2 script) are `manage-users`, `query-users`, `manage-clients`, `query-clients`, `view-users`, `view-realm`.

**Fix.** Encoded the role grants directly in the realm JSON. Keycloak's RealmRepresentation supports a top-level `users` array entry for `service-account-provenance-admin` with `clientRoles: { "realm-management": ["manage-users", "query-users", ...] }`. Considered alternative: a one-shot `keycloak-bootstrap` compose service that depends on `keycloak: service_healthy` and runs the relevant subset of `configure-keycloak-ec2.sh`. Chose the in-realm-JSON approach because (a) it keeps the local stack declarative with no extra moving parts, and (b) Keycloak 24.0.3's import handles the ordering correctly when `serviceAccountsEnabled: true` and the service-account user are co-declared.

**Pattern.** Service accounts in Keycloak start with zero admin permissions. Any client with `serviceAccountsEnabled: true` that needs to call the Admin REST API must have explicit `realm-management` role grants in the same realm artifact that defines it. Don't rely on a post-import script to bootstrap permissions for the default stack — the script will exist for prod and someone will forget local.

---

## B-015 — `flyway.conf` `baselineVersion=8` causes V9 to fail on a fresh database

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / database

**Symptom.** Even when Flyway was run against a fresh, empty Postgres, migration failed at V9: `ERROR: Migration of schema "organizations" to version "9 - create lineage schema" failed! SQL State : 42P01 — relation "organizations.orgs" does not exist`. V1–V8 were reported as "skipped" — Flyway saw the empty `flyway_schema_history` table, stamped it at version 8 per `flyway.baselineVersion=8` in the conf, then jumped straight to V9 which depended on tables created in V1.

**Root cause.** `apps/api/flyway.conf` set `flyway.baselineVersion=8` and `flyway.baselineOnMigrate=true`. The intent (presumably) was to handle a one-time historical migration where an existing database had V1–V8 applied via some other path and Flyway was bolted on starting at V9. That assumption did not hold for any new install — on a fresh DB the baseline was wrong by definition.

**Fix.** Dropped the baseline configuration entirely from `apps/api/flyway.conf` (removed `flyway.baselineVersion=8` and `flyway.baselineOnMigrate=true`). V1–V27 now apply in order from a fresh DB. Existing EC2 / demo databases that already have the V1–V8 schema applied will need a one-time `DELETE FROM organizations.flyway_schema_history WHERE version <= 8` and re-run, or an explicit Flyway `repair` — verify carefully against any live database before reapplying. The dev-EC2 box was confirmed unaffected (its history is already populated through V27).

**Pattern.** `flyway.baselineVersion` is a production-migration tool, not a default. Setting it as the default in `flyway.conf` poisons every fresh install. If a baseline is needed for a one-time historical migration, do it via the Flyway CLI invocation for that specific run, not in the persistent conf file.

---

## B-012 — `apps/api/tsconfig.json` path mapping has literal `.ts` extension; API container crashes on startup

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Build / API
- **Discovered:** 2026-05-07, during the first external-developer onboarding test on a fresh Apple Silicon MacBook.

**Symptom.** Following the README "Getting Started" path on a fresh clone, the `provenance-api` container crashed immediately after `docker compose up -d` with `Error: Cannot find module '../../../../packages/types/src/index.ts'`. Container went into a restart loop. Every authenticated path was unreachable; the frontend rendered its login page but couldn't reach the backend.

**Root cause.** `apps/api/tsconfig.json:10` declared the path mapping with a literal `.ts` extension: `"paths": { "@provenance/types": ["../../packages/types/src/index.ts"] }`. `nest build` (which the dev container runs via `pnpm dev` → `nest start --watch`) inlines this path verbatim into emitted requires — so `import { ... } from '@provenance/types'` in `notifications.service.ts` became `require("../../../../packages/types/src/index.ts")` in `dist/.../notifications.service.js`. Node's CommonJS resolver does not load `.ts` files; the require threw `MODULE_NOT_FOUND` and the entire module graph failed to load.

The reason this was not caught on the EC2 dev box is that EC2 also has `packages/types/dist/` pre-built on disk (from a prior `pnpm -r build` or similar), so the symlink at `apps/api/node_modules/@provenance/types/dist/index.js` resolves and Node's normal package resolution kicks in — masking the path-mapping bug. On a fresh clone the dist is missing (B-013, still open) and the path-mapping bug surfaces.

**Fix.** Dropped the `.ts` extension from the paths mapping: `"paths": { "@provenance/types": ["../../packages/types/src/index"] }`. The emitted require is now the unmangled `require("@provenance/types")`, which Node resolves through `node_modules` via the package's own `main` field.

**Pattern.** TypeScript path mappings should never carry file extensions. Even when the mapping resolves correctly at type-check time, Nest's webpack-mode build inlines the literal string at emit time, and a `.ts` extension means the dist is unloadable. Applies to any future workspace package mapping in any tsconfig file.

**Related (still open).** B-013 — `packages/types/dist/` not pre-built on a fresh clone. Even with the path mapping fixed, the package needs a built `dist/` for Node to resolve via the package's `main` field. Tracked separately.

---

## B-010 — `docker-compose.yml` OPA healthcheck unrunnable in distroless image

- **Fixed:** 2026-05-07 — commit `<pending>`
- **Area:** Infrastructure / developer experience
- **Severity:** was Blocker (every dependent service blocked on OPA `service_healthy`)
- **Discovered:** During the first external-developer onboarding test on a fresh Apple Silicon MacBook (2026-05-07).

**Symptom.** Following the README "Getting Started" path on a fresh machine — `git clone` → `pnpm install` → `cd infrastructure/docker && docker compose up -d` — the stack failed to come up with `dependency failed to start: container provenance-opa is unhealthy`. Every service that declared `depends_on: opa: { condition: service_healthy }` (api, agent-query, etc.) blocked behind it, so the whole stack was unusable on a fresh clone.

**Root cause.** `infrastructure/docker/docker-compose.yml:285` declared the OPA healthcheck as `["CMD-SHELL", "wget -qO- http://localhost:8181/health || exit 1"]`. The `openpolicyagent/opa:0.63.0` image is built on a distroless base — it has **no shell, no busybox, no wget, no curl**. The healthcheck command therefore cannot execute on any platform. The reason this was not noticed on the EC2 dev box is that the EC2 stack runs from `docker-compose.ec2-dev.yml`, which uses a different (working) healthcheck `["CMD", "/opa", "eval", "true"]`. No one had ever exercised the main `docker-compose.yml` end-to-end, since the team's daily workflow is the EC2 deployment.

The bug was unmasked when an Apple Silicon contributor tried the README path — on arm64, `openpolicyagent/opa:0.63.0` is amd64-only and runs under emulation, which surfaces every latent issue immediately. The actual blocker is the healthcheck itself, not the architecture (the healthcheck would equally fail to execute on amd64 native).

**Fix.** Replace the healthcheck in `docker-compose.yml` with the same one used in `docker-compose.ec2-dev.yml` — invoking the OPA binary directly to evaluate a trivial Rego expression. The OPA binary is always present in the image (it's the entrypoint), so the check is reliable on every platform and adds negligible overhead.

```yaml
healthcheck:
  test: ["CMD", "/opa", "eval", "true"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

**Pattern.** When using a distroless image, healthchecks **cannot** rely on shell utilities (curl, wget, nc, bash). They must invoke the image's primary binary or a static binary baked into the image. If two compose variants disagree on a healthcheck for the same image, the discrepancy is a sign one of them is wrong — reconcile to the working version. Beyond OPA: any future move to distroless images for our own services (api, agent-query) requires auditing every healthcheck for shell dependencies before the cutover.

**Related (still open).** OPA 0.63.0's image is amd64-only — Apple Silicon Macs run it under emulation. Tracked separately as B-011.

---

## B-009 — OpenSearch `provenance-products` BM25 index empty; marketplace keyword search returns nothing

- **Fixed:** 2026-04-30 — commit `<pending>`
- **Area:** Search / discovery
- **Severity:** was Medium

**Symptom.** Marketplace keyword search (`MarketplaceService.searchProducts`, hitting `provenance-products` over BM25) returned zero results regardless of query, while marketplace browse (`listProducts`, hitting PostgreSQL) correctly showed 7 real products. The BM25 index had 0 documents while the kNN index (`data_products`) had 7. CLAUDE.md describes both indices as "active and complementary," so this was a real gap, not legacy code.

**Root cause.** BM25 indexing relied solely on `KafkaConsumerService` consuming `product.lifecycle` events from Redpanda and calling `ProductIndexService.indexProduct`. The kNN index, by contrast, gets a synchronous double-write from `ProductsService` itself (`searchIndexingService.indexProduct(...).catch(...)` at the publish/update sites). On every dev-stack rebuild the Redpanda queue resets, so the BM25 index started empty and stayed empty until a new product publish flowed through the broker — which essentially never happens in dev. There was no PostgreSQL→OpenSearch backfill path either.

**Fix.** Two parts:
1. **Synchronous double-write.** Added `ProductIndexService.indexProductById(productId, orgId)` mirroring `SearchIndexingService.indexProduct`'s lookup-and-index pattern. `ProductsService` now calls it alongside the existing kNN call at every publish, every update where searchable fields change, and every decommission (the latter as `removeProduct`). The Kafka consumer is unchanged and continues as a backup. Both writes are best-effort with `.catch(() => {})` — index failures must never block lifecycle ops.
2. **One-shot reindex script.** `apps/api/src/scripts/reindex-search.ts` walks `products.data_products` for every published or deprecated product and re-writes both OpenSearch indices via the same services. Runs as `pnpm --filter @provenance/api reindex:search` from inside the api container after `nest build`. Idempotent (uses upsert with stable IDs) — safe to re-run after every dev-stack rebuild or seed-data refresh.

End-to-end verified 2026-04-30: ran `pnpm reindex:search` in the dev container — log line `Done. BM25: 7/7 succeeded (0 failed). kNN: 7/7 succeeded (0 failed).` `curl /_cat/indices` now reports `provenance-products` with 7 docs (up from 0). A BM25 query for "revenue" returns the 2 expected products ("Customer Revenue Analytics" and "Daily Revenue Report").

**Pattern.** When OpenSearch (or any external store with non-durable propagation) sits behind a domain database, a single broker-only write path is fragile in dev — broker queues reset on rebuild, dev volumes drift, and the index silently loses sync with PostgreSQL. The fix is always (a) synchronous write on the operation that updates the source of truth, plus (b) an idempotent backfill command for after the inevitable drift event. Out-of-scope but adjacent: deprecate-on-product behavior diverges between the two indices (kNN deletes on deprecate via `searchIndexingService.deleteFromIndex`; BM25 keeps the doc per the Kafka consumer's deliberate "no index change" comment). The newly-shipped marketplace lifecycle visibility in PR #45 makes the kNN delete the wrong call — deprecated products should remain searchable in both — but fixing it is a separate change.

---

## R-011 — Access grant revocation fails at the database due to broken `updated_at` trigger

- **Fixed:** 2026-04-25 — commit `<pending>`
- **Area:** Access / governance
- **Severity:** was High
- **Discovered:** During F10.6 end-to-end disclosure verification

**Symptom.** Any UPDATE against `access.access_grants` failed with PostgreSQL `record "new" has no field "updated_at"` raised from the shared `update_updated_at()` trigger function. `AccessService.revokeGrant` (`apps/api/src/access/access.service.ts:142-157`) sets `revoked_at`/`revoked_by` and calls `grantRepo.save()`, generating an UPDATE — so the `POST /organizations/:orgId/access/grants/:grantId/revoke` endpoint was broken at the SQL level since the access schema was created. The Domain 12 grant-revoke cascade introduced in #26 also depends on `revokeGrant` succeeding, so this bug would have blocked F12.21 as well. The application unit tests passed because they mock the repo and never exercise a real UPDATE through the trigger.

**Root cause.** `apps/api/migrations/V7__create_access_schema.sql:131-133` created `CREATE TRIGGER access_grants_updated_at BEFORE UPDATE ON access.access_grants FOR EACH ROW EXECUTE FUNCTION update_updated_at();`, but the `access_grants` table definition (lines 16-29) was missing the `updated_at` column. The sibling `access_requests` table includes the column (line 59), so its symmetric trigger worked.

**Fix.** `V20__access_grants_add_updated_at.sql` adds the column with `NOT NULL DEFAULT NOW()` and backfills existing rows from `COALESCE(revoked_at, granted_at)`. End-to-end verified by inserting a grant, calling the marketplace product detail endpoint as the grantee (full credentials), revoking via `UPDATE`, calling again (preview only), re-activating, and revoking again.

**Pattern.** Any `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION update_updated_at()` trigger requires the target table to have an `updated_at TIMESTAMPTZ NOT NULL` column. Adding the trigger without the column lies dormant until the first UPDATE, and unit tests with mocked repos won't catch it. Audit all `BEFORE UPDATE` triggers against their tables before adding new mutable schemas.

---

## B-004 — .gitignore pattern silently ignores future realm JSONs

- **Fixed:** 2026-04-23 — commit `c0cd732`
- **Area:** Infrastructure / git hygiene
- **Severity:** was Low

**Symptom.** `.gitignore` contained `infrastructure/docker/config/keycloak/realms/*.json`, yet `provenance-realm.json` was tracked — it was added to the index before the ignore rule. A developer who adds a second realm file (e.g. a staging or demo realm) to the same directory will see it silently ignored with no warning. `git add` will succeed without tracking the file unless they force-add.

**Root cause.** The ignore pattern was intended to block environment-specific overrides (like `realms/local.json`) but was too broad — it also matched the canonical committed realm. The previous state relied on the accident that the canonical file was added first.

**Proposed fix.** Flip the pattern to an exclusion list. Either:
- Replace `*.json` + `!.gitkeep` with an explicit allowlist: `*.json` + `!provenance-realm.json` + `!.gitkeep`.
- Or rename the ignored pattern to a narrower convention, e.g. `realms/*.local.json`, and ignore only that.

Verify by trying `touch infrastructure/docker/config/keycloak/realms/demo.json && git status` — it must show the file as untracked (visible), not as ignored.

**Resolution.** Narrowed the pattern from `realms/*.json` to `realms/*.local.json`. New canonical realm files (staging, demo, test) now surface as untracked on `git status` — a loud failure mode instead of a silent one — while environment-specific overrides matching `*.local.json` stay ignored. The `!.gitkeep` negation line was removed because `.gitkeep` no longer matches the narrower ignore pattern; the file itself stays in place. Rejected the allowlist approach (`*.json` + `!provenance-realm.json` + `!.gitkeep`) because it would re-create the same silent-ignore trap the moment a second canonical realm is added — the next contributor would hit the identical bug. Verified by `touch realms/demo.json` (shows `??`) and `touch realms/dev.local.json` (shows `!!` under `git status --ignored`).

---

## R-010 — API container unhealthy after Workstream B deploy: EncryptionService missing key

- **Fixed:** 2026-04-19 — commit `fb387c3`
- **Area:** Infrastructure / docker-compose

**Symptom.** `provenance-ec2-api` stuck in `unhealthy` after merging PR #10 (Domain 10 Workstream B). `docker logs` shows NestFactory aborting during provider instantiation:
`Error: EncryptionService: one of CONNECTION_DETAILS_SECRET_ARN or CONNECTION_DETAILS_DEV_KEY must be set`.

**Root cause.** Workstream B added a required env pair to the API's Zod schema (`CONNECTION_DETAILS_SECRET_ARN` / `CONNECTION_DETAILS_DEV_KEY`) and wired it into `EncryptionService`, which throws at construction if neither is set. The test env (`apps/api/src/test.env.ts`) was updated, but none of the docker-compose files (`docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.ec2-dev.yml`) or `.env.example` propagate the vars to the running container. The API boots fine in `jest` and in any env that loads `.env` with these vars present, but a fresh `docker compose up` after the merge crashes at startup.

**Fix.** Pass both vars to the API service in all three compose files with a documented throwaway default for `CONNECTION_DETAILS_DEV_KEY` so the dev stack boots without cloud credentials. `CONNECTION_DETAILS_SECRET_ARN` stays optional — production stacks set it to an AWS Secrets Manager ARN and leave the dev key empty. Added the pair to `.env.example` with the same documentation.

**Pattern.** Any new required env var introduced in the API must be added to every layer that sources config: `apps/api/src/config.ts` (Zod), `apps/api/src/test.env.ts` (jest), all three `infrastructure/docker/docker-compose*.yml`, and `.env.example`. Missing one of the compose files silently breaks deployed environments the next time a stack is rebuilt.

---

## R-009 — testuser email-as-username lookup silently failing in configure-keycloak-ec2.sh

- **Fixed:** 2026-04-19 — commit `e287e58`
- **Area:** Infrastructure / Keycloak

**Symptom.** `configure-keycloak-ec2.sh`'s `kcadm get users -q username=testuser` returned empty results on every run after the first, and the testuser attribute seed block was silently skipped. The script's output said `testuser not found in Keycloak — skipping attribute seed`, which masked the fact that nothing was being configured.

**Root cause.** The script itself applies `registrationEmailAsUsername=true` to the realm. Once that flag is on, the next update to any user (including the attribute write the script does immediately after) causes Keycloak to rewrite the user's `username` field to match `email`. The legacy `testuser` handle stops resolving.

**Fix.** Look up the user by email (new `TESTUSER_EMAIL` variable, default `test@provenance.dev`) instead of by username. Email is the stable identifier. Docs updated to use email-as-username everywhere direct-grant examples appear.

---

## R-008 — testuser role_assignments seeding drift

- **Fixed:** 2026-04-19 — commit `e287e58`
- **Area:** Infrastructure / seed

**Symptom.** On a fresh EC2 environment, testuser had `realmRoles: ["org_admin"]` in the Keycloak realm import but no matching row in `identity.role_assignments`. `JwtStrategy` reads roles from the DB (not from Keycloak realm roles), so `RolesGuard` 403'd every `@Roles`-gated endpoint — invitations, member management, classification changes. Manually seeding a row unblocked invitation-flow testing during R-006/R-007.

**Root cause.** `configure-keycloak-ec2.sh` synced Keycloak attributes from `identity.principals` but never inserted a platform role_assignment. The realm import and the DB seed lived separate lives.

**Fix.** Added a SQL `INSERT ... WHERE NOT EXISTS` step inside the existing testuser attribute block. Idempotent. Filters psql's `INSERT 0 N` command tag from stdout with `awk` so `set -eo pipefail` doesn't abort the script on the no-op path.

---

## R-007 — `EntityMetadataNotFoundError` for InvitationEntity + GovernanceConfigEntity

- **Fixed:** 2026-04-19 — commit `be62daf`
- **Area:** API / TypeORM wiring

**Symptom.** Every invitation endpoint (`POST /organizations/:orgId/invitations`, `POST /invitations/:token/accept`) returned 500 with `EntityMetadataNotFoundError: No metadata for "InvitationEntity" was found`. The invitation row was persisted but the HTTP response was 500.

**Root cause.** `InvitationEntity` and `GovernanceConfigEntity` were registered via `TypeOrmModule.forFeature(...)` inside `OrganizationsModule` but never added to the root DataSource's `entities` array in `database.module.ts`. Repositories for both entities couldn't find metadata.

**Fix.** Added both entities to the root DataSource's `entities` list. The convention elsewhere in the codebase is that every entity is in both lists; these two were the outliers.

---

## R-006 — `z.coerce.boolean()` treats `"false"` as `true` for `SMTP_SECURE`

- **Fixed:** 2026-04-19 — commit `be62daf`
- **Area:** API / config

**Symptom.** With `SMTP_SECURE=false` in the env, nodemailer was configured with `secure: true` and initiated an immediate TLS handshake against plaintext Mailhog. The resulting `"SSL routines: ssl3_get_record: wrong version number"` caused invitation email sends to throw and the invitation-create endpoint to return 500 after persisting the row.

**Root cause.** Zod's `z.coerce.boolean()` uses JavaScript's `Boolean(value)`, and `Boolean("false") === true`. Any non-empty string coerces to `true`, making the Zod boolean coercion unsafe for env-var input.

**Fix.** Replaced with `z.string().default('false').transform(v => v.toLowerCase() === 'true')`. Explicit literal parse, no surprises.

**Pattern:** Never use `z.coerce.boolean()` on env vars. Parse the literal string.

---

## R-005 — nodemailer missing from the API container after volume reuse

- **Fixed:** Resolved operationally (no code change) — no commit reference
- **Area:** Infrastructure / Docker

**Symptom.** `require('nodemailer')` threw `MODULE_NOT_FOUND` at API startup on one particular EC2 instance, even though `package.json` declared the dep and `pnpm install` had completed. Affected only that host.

**Root cause.** The compose file mounts `node_modules` via an anonymous volume (`- /app/apps/api/node_modules`) to shadow the host bind mount. The volume was created from an earlier image build that predated the nodemailer dependency, and the dep wasn't reinstalled when the image was rebuilt — the anonymous volume preserved the stale node_modules.

**Fix.** `docker compose down -v` on the affected host (removes named + anonymous volumes) followed by `docker compose up --build`. Package-json state was already correct.

**Prevention.** Runbook entry explaining when to blow away volumes. If this repeats, consider flipping the node_modules strategy: install inside a named image layer rather than masking with an anonymous volume. Tracked for follow-up when it happens again.

---

## R-004 — `updateUserAttributes` PUT was a full-replace, destroying required Keycloak fields

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / Keycloak Admin integration

**Symptom.** After self-serve org creation, the post-transaction `keycloakAdmin.updateUserAttributes(...)` call to bind `provenance_org_id` / `provenance_principal_id` / `provenance_principal_type` returned 400 `error-user-attribute-required: email`. The attributes never made it onto the user, so refreshed tokens had no `provenance_*` claims and the next API call 401'd.

**Root cause.** Keycloak's `PUT /admin/realms/{realm}/users/{id}` is a full-replace operation, not a merge. Sending only `{ attributes: {...} }` in the body drops `email`, `username`, `firstName`, `lastName`, etc. The user-profile validator then rejects the payload because `email` is declared required.

**Fix.** `GET` the current user, merge incoming attributes into `user.attributes`, then `PUT` the complete object. Implemented in `apps/api/src/auth/keycloak-admin.service.ts`.

**Pattern:** Any Keycloak Admin-API PUT of a user must be GET-merge-PUT. Never send a partial body.

---

## R-003 — `SET LOCAL "param" = $1` is not parameterizable in PostgreSQL

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / PostgreSQL RLS

**Symptom.** First call that tried to set a per-transaction RLS context threw `syntax error at or near "$1"`. Hit `selfServeOrganization`, `jwt.strategy.seedPrincipal`, `invitations.service.acceptInvitation`, and the `org-context.middleware`.

**Root cause.** Postgres `SET LOCAL config_param = value` requires a literal constant. The `$1` placeholder is not expanded — Postgres treats it as a syntactic token and rejects the statement.

**Fix.** Replace every call site with `SELECT set_config('provenance.current_org_id', $1, true)` — `set_config(name, value, is_local)` is the parameterizable equivalent, and `is_local=true` scopes to the current transaction like `SET LOCAL`.

**Pattern:** Never use `SET LOCAL` with a bind parameter. Always use `set_config(...)`.

---

## R-002 — Issuer URL double-nested to `/realms/provenance/realms/provenance`

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / JWT validation

**Symptom.** Every Keycloak-issued token failed passport-jwt's `iss` check. The browser saw a 401 with no corresponding Nest-level log entry because passport rejects before `canActivate` runs. Even endpoints marked `@AllowNoOrg` (self-serve) returned 401.

**Root cause.** `jwt.strategy.ts` computed the expected issuer as `${KEYCLOAK_ISSUER_URL ?? KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}`. The ec2 `.env` already set `KEYCLOAK_ISSUER_URL=https://auth.provenancelogic.com/realms/provenance`, so the strategy appended `/realms/provenance` on top, producing a double-nested path that no real token matched.

**Fix.** Treat `KEYCLOAK_ISSUER_URL` as the FULL issuer (matches what Keycloak emits in the `iss` claim). Only construct the URL from `AUTH_SERVER_URL + realm` when `ISSUER_URL` is not set. Aligned the compose default accordingly.

**Pattern:** `KEYCLOAK_ISSUER_URL` is the literal `iss` claim value — including `/realms/{realm}`. See the operations runbook for the gotcha.

---

## R-001 — `GET /organizations` returned every tenant's orgs to any caller (tenant-isolation regression)

- **Fixed:** 2026-04-19 — commit `531b724`
- **Area:** API / tenant scoping
- **Severity:** was Blocker (security + onboarding)

**Symptom.** A newly registered user with no org was landing on the dashboard seeing Acme Corp's products instead of being routed to the onboarding flow. Investigation showed every authenticated caller received every org in the database from `GET /organizations`.

**Root cause.** `OrganizationsService.listOrganizations` ran `findAndCount({})` with no `where` clause scoping by the caller's `orgId`. `DashboardRedirect` used an empty-list response to decide whether to redirect to `/onboarding/org`; because the list was never empty, the redirect never fired, and the new user saw another tenant's data.

**Fix.** Pass `RequestContext` through from the controller into the service. Return `{ items: [], meta: { total: 0 } }` when `ctx.orgId` is falsy; otherwise filter by `where: { id: ctx.orgId }`. Service and controller both updated; tests cover both branches.

**Pattern:** Every endpoint that queries a tenant-scoped table must be scoped by `ctx.orgId`. No cross-tenant reads.
