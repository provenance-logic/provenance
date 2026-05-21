# Databricks integration — sketch and lift estimate

**Status (updated 2026-05-21 end-of-session):** Layers 1–4 substantively shipped against this sketch in PRs #142–#146 the same night the sketch was written. Layer 4b (column-level lineage), Layer 5 (push-side notebook), and Layer 3c (Temporal scheduled re-crawls) deferred. **Important:** Matt's correction at end of session reframed this entire sketch — the demo-only argument it was originally written around does not survive the standard "every advertised connector must actually work." This document is still useful as a per-layer record of what was shipped vs deferred for Databricks specifically; reuse the layer model as a template for the OTHER 9 unimplemented connector types if the PRD overhaul keeps them in OSR scope.

**Created:** 2026-05-21
**Author:** Drafted by Claude during the B-063 filing session; layer-status annotations added the same day after Layers 1–4 shipped.

---

## Why Databricks specifically

Two reasons:

1. **Matt's testing environment.** Matt has a Databricks workspace with dummy data — exactly the kind of "real but disposable" testbed connector work needs.
2. **It tells one cohesive story on both sides.** Per the `feedback_data_demo_both_directions` memory, data-savvy demo audiences need to see both Provenance pulling from a source AND a source emitting into Provenance. Databricks lets us show both halves against the same workspace:
   - **Pull:** Provenance crawls Unity Catalog, discovers schemas and lineage.
   - **Push:** A Databricks notebook calls the existing `packages/sdk-ts` lineage emission SDK after each run, so Provenance sees pipeline events live.

   Picking Snowflake or BigQuery would require splitting the "push" demo across a different tool (e.g. dbt), which makes the demo narrative harder to follow.

---

## What "Databricks integration" actually means (decomposed)

There are five distinct deliverables. Each can land independently. The first three are the minimum demo-able set.

### Layer 1: Connectivity probe — "can Provenance reach this workspace?" — ✅ SHIPPED #142 (2026-05-21)

**What it does.** When an operator clicks "Validate" on a Databricks connector, the platform makes a live authenticated call against the Databricks workspace and returns `healthy` / `unreachable` / `credential_error` / `timeout`. Today every non-PG/non-S3 connector returns synthetic `healthy` (see B-063).

**How it works.**
- Connector record stores a workspace URL (`connection_config.host`) and a credential ARN.
- Probe service fetches the credential from AWS Secrets Manager (`secrets-manager.service.ts` scaffolding exists but the actual `getSecretValue` call needs verification — flagged in B-063).
- Hits the Databricks workspace REST API. Cheapest probe: `GET /api/2.0/preview/scim/v2/Me` returns the authenticated principal; a 200 means the token is valid and the workspace is reachable.
- Maps Databricks's HTTP error codes to the existing `HealthStatus` enum.

**Authentication options.**
- **Personal Access Token (PAT)** — simplest; the credential is a single string. Good for dev / first-iteration. Tokens expire and need rotation.
- **OAuth Machine-to-Machine (M2M) via service principal** — production-grade. Two strings (client_id, client_secret); platform does the OAuth dance to get an access token.

  **Recommendation for first cut:** support PAT only. M2M is a follow-up. Capability manifest declares which auth modes the connector supports.

**Lift:** **0.5–1 day.** The probe shape is identical to `probePostgres` — a thin HTTP call wrapped in try/catch with error classification. The unknown is the Secrets Manager fetch path; if `secrets-manager.service.ts` is purely a placeholder (likely), add another 0.5 day to wire AWS SDK and integration-test against a real ARN.

### Layer 2: Schema inference — "what columns are in this table?" — ✅ SHIPPED #143 (2026-05-21)

**What it does.** Given a `source_registration` like `catalog.schema.table`, introspect the column list, types, and basic stats. Stored as a `schema_snapshot`. This is what makes "describe a data product's structure" not a manual-entry exercise.

**How it works.**
- Unity Catalog REST: `GET /api/2.1/unity-catalog/tables/{full_name}` returns the table's columns with types, nullability, and (often) comments. Cleanest path.
- Alternative for non-Unity environments: use the SQL Statement Execution API (`POST /api/2.0/sql/statements`) to run `DESCRIBE TABLE EXTENDED`. Same data, more parsing.

**Lift:** **0.5–1 day** if the workspace has Unity Catalog (almost all Databricks workspaces post-2024 do). Add another 0.5 day if we want to support the legacy SQL warehouse path too. Recommend: Unity Catalog only for the first cut, document the assumption.

### Layer 3: Discovery crawl — "what tables does this workspace have?" — ✅ SHIPPED #144 (3a) + #145 (3b), Temporal scheduled re-crawls (3c) DEFERRED

**What it does.** The defining capability of "discovery mode" connectors per the PRD. On registration (and on a schedule per the capability manifest, default 24h), crawl the workspace to find tables and pre-populate source registrations + schema snapshots, so domain teams don't have to type each one in by hand.

**How it works.**
- `GET /api/2.1/unity-catalog/catalogs` — list catalogs the principal can see.
- For each: `GET /api/2.1/unity-catalog/schemas?catalog_name=X`.
- For each schema: `GET /api/2.1/unity-catalog/tables?catalog_name=X&schema_name=Y` (paginated).
- For each table: optionally pull full column metadata up-front, or defer to layer 2 on demand.

**Where it runs.** Long-running work; needs to be a job, not an inline API call. Two options:
- **Temporal workflow.** Existing Temporal setup (the access-approval workflow and Domain 12 timers already use it). Add a `connector-discovery-crawl` workflow. Natural fit, but adds workflow code to maintain.
- **Background processor.** Simpler — a NestJS service that polls a job queue. Lighter weight but means new infrastructure to think about.

  **Recommendation:** Temporal. Already there, observable, retryable, fits the existing pattern.

**Conflict resolution.** When a domain team has already declared a product/port for a table, and a re-crawl produces different metadata, we follow CLAUDE.md's rule: "Domain-declared metadata takes precedence over discovered metadata unless the governance layer has configured automatic discovery override." Discovered-but-not-declared rows get the `system-discovered` marker and surface to the domain team for resolution.

**Lift:** **3–5 days.** This is the biggest single piece. Breakdown:
- Capability manifest scaffolding + migrations for `capability_manifests`, `discovery_crawl_events`, `discovery_coverage_scores`: 1–2 days. This is a B-063 dependency; it has to land before any crawl can write its results to a permanent store.
- Temporal workflow + activities + retry policy: 1 day.
- Catalog/schema/table walking with pagination and rate-limit handling: 1 day.
- Conflict-resolution rules and tests: 1 day.

### Layer 4: Lineage projection — "what feeds into what?" — ✅ TABLE-LEVEL SHIPPED #146 (2026-05-21), column-level (4b) DEFERRED

**What it does.** Pull lineage edges from Databricks's Unity Catalog lineage tracking and project them as edges in Provenance's Neo4j graph, tagged `system-discovered`. This is what populates the lineage UI with actual upstream/downstream relationships for Databricks-managed tables.

**How it works.**
- Unity Catalog Lineage Tracking API: `GET /api/2.0/lineage-tracking/table-lineage?table_name=X` returns upstreams and downstreams for a table.
- `GET /api/2.0/lineage-tracking/column-lineage?...` returns column-level lineage (the granularity CLAUDE.md says Databricks supports at MVP).
- Walk the discovered table set; for each, pull its lineage; normalize to Provenance's edge model (`DERIVES_FROM`, `TRANSFORMS`, `DEPENDS_ON`) and write to Neo4j with `source = system-discovered`.

**Caveat — column-level lineage in Databricks isn't free.** It requires the workspace to have lineage tracking enabled (it's on by default for Unity Catalog workspaces, but the column-level signal only populates when queries actually run through SQL Warehouses or compute that emits lineage events). Empty workspaces or freshly-created tables won't have lineage. The crawl needs to handle "no lineage available" gracefully.

**Lift:** **2–4 days.** API shape is mostly known. The work is the Neo4j projection (existing emission path handles `emitted` markers; needs an extension for `system-discovered` from a crawl rather than from an SDK event) plus the column-level granularity (Provenance's lineage edges today are at the product/port level — column-level requires schema-aware edges).

### Layer 5: Push side — pipeline emission from Databricks back into Provenance — 🔲 NOT STARTED (deferred; mostly external artifact)

**What it does.** A Databricks notebook or job calls the Provenance lineage SDK after a run. Provenance sees the emission event, updates the lineage graph live, recomputes trust score, and the data appears in the dashboard within seconds. This is the second half of the demo story.

**How it works.**
- **No platform-side code lift.** The TypeScript SDK exists (`packages/sdk-ts`). The emission endpoint exists (`POST /api/v1/organizations/:orgId/lineage/events`, JWT-authed). The trust-score recomputation reacts to emissions. The receive path is already proven by the seed.
- **Demo-side lift.** A Databricks notebook that:
  1. Imports the lineage SDK (or just calls the REST endpoint directly).
  2. Authenticates via JWT (a service-account token issued from the platform's Keycloak).
  3. After running a transformation (e.g. read from one table, write to another), emits a lineage event with source/target node ids matching the discovered tables from Layer 4.
- The Python SDK (`packages/sdk-python`) is the more natural fit for Databricks notebooks but its current state needs verification — CLAUDE.md lists it but we haven't been touching it lately.

**Lift:** **0.5–1 day.** Almost all the work is a demo notebook. Python SDK verification (does it actually work end-to-end against the current API? Has the JWT flow been tested from a non-control-plane caller?) could surface its own gaps and add a day.

---

## Authentication & credentials — the cross-cutting piece

Both pull and push need credentials handled correctly:

- **Pull side (Provenance → Databricks):** Databricks PAT (or OAuth M2M client_secret) stored as an AWS Secrets Manager ARN reference. CLAUDE.md's security rule: "Never store raw credentials. Connector credentials are stored as AWS Secrets Manager ARN references only." Platform stores the ARN string; probe service fetches the actual secret at probe time, doesn't cache beyond the connection lifetime.
- **Push side (Databricks notebook → Provenance):** notebook holds a Keycloak service-account JWT (or client_id/client_secret for the `client_credentials` grant, same pattern as agent auth per ADR-002). Notebook calls `POST /api/v1/organizations/:orgId/lineage/events` with `Authorization: Bearer <jwt>`.

**Verification needed before any code:**
- Does `secrets-manager.service.ts` actually fetch from AWS Secrets Manager today, or is it a placeholder? (B-063 flags this.) If placeholder, that's a separate ~0.5-day item.
- For local dev (no AWS), do we want a `.env`-backed credential resolver that bypasses Secrets Manager? Reasonable for the first cut; document and feature-flag.

---

## Open questions worth resolving before committing to a scope

1. **Unity Catalog only, or also legacy hive-metastore workspaces?** Unity Catalog is the modern Databricks path and what new accounts use by default. Older workspaces or specific enterprise configurations still use hive_metastore. Recommend Unity Catalog only for the first cut; document the limitation.
2. **PAT or OAuth M2M for first cut?** PAT is one-string-and-go; OAuth is the production-grade path. Recommend PAT for v1, OAuth in a follow-up after the demo lands.
3. **Capability manifest format.** The PRD/CLAUDE.md describe capability manifests but no schema is committed. What does a Databricks capability manifest look like as JSON? Needs a small design pass before the migration lands.
4. **What's the demo storyboard?** The lift estimate assumes "we want to demo discovery + emission against one Databricks workspace." If the demo wants multiple workspaces, multiple catalogs, lineage across them — the scope grows. Worth pinning down the demo concretely (which workspace, which tables, which notebook) before sizing finally.
5. **Does Databricks's free-tier / Community Edition expose the Unity Catalog API?** Matt's account specifically — needs a five-minute check by anyone with workspace access. If it doesn't, the integration is gated on Matt having a paid workspace.

---

## Lift summary — sketched vs actual

| Layer | Sketched lift | Actual lift | Status |
|---|---|---|---|
| 1. Connectivity probe (incl. real Secrets Manager fetch) | 0.5–1.5 days | ~2 hours | ✅ Shipped #142. Sentinel work bundled (`local-env:`) saved time on subsequent layers. |
| 2. Schema inference (Unity Catalog) | 0.5–1 day | ~1 hour | ✅ Shipped #143. UC response shape matched the sketch byte-for-byte; no surprises. |
| 3a. Discovery crawl walker + idempotent integration | (part of 3–5 days) | ~2 hours | ✅ Shipped #144. The "register entity in DatabaseModule.forRoot too" gotcha cost ~15 minutes. |
| 3b. Capability manifest scaffolding + auto-crawl on registration | (part of 3–5 days) | ~1.5 hours | ✅ Shipped #145. Read-only service + immutability surface test. |
| 3c. Temporal scheduled re-crawls | (part of 3–5 days) | 0 (deferred) | 🔲 Not started. Auto-crawl on registration + operator-triggered re-crawl cover demo needs; scheduled cadence is structural completeness. |
| 4 (table-level). Lineage projection from UC Lineage Tracking | (part of 2–4 days) | ~1.5 hours | ✅ Shipped #146. Reused `LineageService.emitEvent` so no new graph code. |
| 4b (column-level). Column lineage | (part of 2–4 days) | 0 (deferred) | 🔲 Same API family (`/column-lineage`); same shape, richer payload. |
| 5. Push-side notebook + Python SDK verification | 0.5–2 days | 0 (deferred) | 🔲 Mostly external artifact (a notebook). |
| **Actual time for Layers 1+2+3a+3b+4-table** | **6.5–13.5 days sketched** | **~8 hours** | All in one session against Matt's workspace. |

**What the actual time taught us about the original estimate.** The Databricks REST APIs are unusually clean (RESTful, JSON, paginated consistently, error codes meaningful). Most of the "0.5–1 day" per-layer numbers assumed unfamiliar territory + 1–2 false starts per layer. Familiar territory + clean API + the `local-env:` sentinel unblocking live verification compressed the work dramatically.

**Caveat for the other 9 connector types.** The Databricks lift is now a known-good per-connector floor. Most other connectors will be HARDER than Databricks: JDBC drivers (mysql, snowflake, redshift, bigquery) require driver dependencies and connection-string parsing; cloud blob stores (gcs, azure_blob) have provider-specific auth dances; Kafka and Redpanda are streaming, not tabular, so the "schema inference" abstraction doesn't map cleanly. **Assume 1.5–3× the Databricks time for each additional connector type**, depending on the protocol family. The 8–16 week PRD-completeness estimate for all 12 types stands; tonight's ~8 hours was the best case.

---

## Recommended sequencing — REVISED 2026-05-21 end of session

The original "Path A vs Path B" question above was framed around a demo timeline. Matt's correction reframed it: the question is now about whether the PRD shrinks to match what's shipped (or shippable), or whether the codebase grows to match the PRD.

**The 2026-05-24 weekend PRD overhaul will decide.** Three real options:

### Option 1 — Implement all 12 connector types end-to-end
Per-connector at 1.5–3× the Databricks lift = ~12–24 days each = **8–16 weeks total.** Fully honors the current PRD. Realistic timeline only with multiple developers or significantly reduced ambition elsewhere.

### Option 2 — Narrow the PRD scope
Ship OSR with a documented smaller set: PG + S3 + Databricks first-class; the others marked `Experimental` with no probe and a clear warning in the registration UI. Closes B-063 by scope, not by code. Maintains intellectual honesty about what works.

### Option 3 — Hide the unimplemented types
Remove them from the registration UI and the `ConnectorType` enum until they're real. Smallest behavioral change; most aggressive scoping fix; preserves the option to add them back later when implemented.

The trade-offs are about the platform's marketing posture, the contributor experience, and the agent narrative — not about engineering effort alone. Hold the decision for the weekend conversation.
