# Connector Lift Survey — 2026-05-22

**Author:** Drafted by Claude during the 2026-05-22 session as input for the **2026-05-24 weekend PRD overhaul** on B-063.
**Purpose:** Reframe the B-063 strategic options (1: implement all 12 / 2: narrow PRD scope / 3: hide unimplemented types) in concrete per-type lift numbers instead of the rough "8-16 weeks" estimate carried in the original [Databricks integration sketch](databricks-integration-sketch.md).
**Caveat upfront:** Estimates are extrapolations from Databricks's actual ~8-hour lift for Layers 1-4 (probe + schema + discovery + table-level lineage). Real-world should be padded **50-100% for the first connector in a new family** (driver bootstrap, auth-flow surprises, error-classification taxonomy), tightening once a family pattern is established. None of these estimates assume credentials in hand for testing — adding live-verify cycles per type adds ~1-3 hours each.

---

## Headline

**The original "8-16 weeks for all 12" estimate is probably 2-3× too pessimistic.** Best-case for all 12 connector types (probe + schema + discovery + table-level lineage where natively available) is closer to **40-60 hours of focused engineering**, or ~1-2 person-weeks. Even with the recommended 50-100% padding, that's **~2-4 person-weeks**, not 8-16.

**Why the delta:** The Databricks sketch projected 0.5-1 day per layer based on unfamiliar-territory pessimism + 1-2 false starts per layer. Actual execution compressed to ~8 hours total because the Databricks REST API was unusually clean and the `local-env:` credential sentinel unblocked live verification. The connectors below split into families with substantial pattern reuse, which compresses things further: mysql reuses pg patterns, redpanda is identical to kafka, redshift can reuse most of the pg driver, cloud blobs are largely S3 re-skinning with different auth.

**What this means for Sunday's conversation:** Option 1 (implement all 12) is plausibly a single focused sprint, not a quarter. The fork-in-the-road framing between Options 1 / 2 / 3 is less sharp than the original B-063 entry suggested. The choice is more about *what level of lineage capability* the platform commits to than *whether to ship all 12 types at all*.

---

## Per-type estimates

Hours are for **probe + schema introspection + discovery crawl + table-level lineage where natively available**, following the Databricks Layers 1-4 model. Padding multiplier for first-of-family is called out in the notes column.

| Type | Family | Best (hrs) | Realistic (hrs, padded) | Lineage available? | Notes |
|---|---|---|---|---|---|
| mysql | Relational DB | 3 | 5-7 | No (would require general_log/audit parsing — defer) | ~0.4× Databricks. SQL pattern is identical to PG; only the driver differs (mysql2). Probe is `SELECT 1`; schema via INFORMATION_SCHEMA.COLUMNS — already exactly what PG does. |
| snowflake | Relational DB | 8 | 12-15 | Yes (ACCESS_HISTORY view, **Enterprise Edition+ only**) | ~1× Databricks. New driver (snowflake-sdk) with non-trivial auth (key-pair preferred for prod, password for dev, optional OAuth). Lineage requires Enterprise Edition gracefully detected at runtime. |
| bigquery | Relational DB | 10 | 15-20 | Yes (INFORMATION_SCHEMA.JOBS query-history parsing) | ~1.5× Databricks. New driver (@google-cloud/bigquery), GCP service-account JSON auth (new auth shape). Lineage means parsing `referenced_tables` from query history JSON — non-trivial SQL identification. |
| redshift | Relational DB | 6 | 9-12 | Yes (STL_QUERY/STL_SCAN parsing, complex) | ~0.75× Databricks for probe+schema (pg-wire-compatible, reuses most pg code). Lineage via STL views is real work; alternative is Redshift Data API via aws-sdk. Auth choice (IAM vs username/password) affects lift. |
| gcs | Cloud blob | 4 | 6-9 | No (not native to object stores) | ~0.5× Databricks. Direct re-skin of S3 pattern with @google-cloud/storage. Main lift is GCP service-account auth (shared with bigquery). |
| azure_blob | Cloud blob | 4 | 6-9 | No (not native to object stores) | ~0.5× Databricks. Same shape as GCS; @azure/storage-blob driver. Azure auth has three real options (connection string, SAS, managed identity) — pick connection string for dev, document the rest. |
| kafka | Streaming | 3 | 5-7 | No (not natively; would have to derive from consumer/producer registrations) | ~0.4× Databricks. **kafkajs already in package** (used by streaming_topic port probe). Schema introspection is **conceptually different** — no "columns" in a topic; if a Confluent Schema Registry is configured, pull subject schema; otherwise return empty. Discovery is `listTopics()`, flat. |
| redpanda | Streaming | 1 | 1-2 | No | ~0.1× Databricks. **Kafka-wire-compatible** — same kafkajs code, different broker. Effectively free if kafka ships first; mainly an enum value to register. |
| rest_api | Generic HTTP | 2 | 3-5 | No (no concept of lineage for generic HTTP) | ~0.25× Databricks. Most of the "implementation" is admitting it can't do much — probe is an HTTP GET (the port-level `rest-api.probe.ts` already exists). Schema introspection requires an OpenAPI URL to be optionally configurable; without it, empty. No discovery. |
| **TOTAL** | | **41** | **62-86** | | Best case ~1 focused week; realistic ~1.5-2 weeks with normal padding. |

**custom** (the 12th type) is intentionally a meta-type — it exists in the enum as an escape hatch for future user-defined plugins. No probe / no schema / no discovery is the right behavior. Document it as such; it's not part of the lift count.

---

## Per-family discussion

### Relational DBs (mysql, snowflake, bigquery, redshift) — 27-54 hours

Highest individual lifts because:
- Each needs its own driver (mysql2, snowflake-sdk, @google-cloud/bigquery; redshift reuses pg).
- Lineage is non-trivial when available — query-history parsing (Snowflake ACCESS_HISTORY, BigQuery JOBS, Redshift STL_QUERY) needs to walk SQL to extract `referenced_tables`.
- Auth varies widely (mysql: username/password; snowflake: key-pair / password / OAuth; bigquery: GCP SA JSON; redshift: IAM or username/password).

**Pattern win:** Once one is done at the discovery-crawl + lineage-projection layer, the pattern (catalog → schema → table → query-history) transfers. The first new RDB after Databricks is the priciest; subsequent ones drop.

**Recommended order if Option 1:** mysql first (cheapest, most pg-pattern reuse), then redshift (also pg-pattern), then snowflake (new driver, real lineage), then bigquery (new driver + new auth + complex lineage).

### Cloud blob (gcs, azure_blob) — 8-18 hours

Both are S3 pattern re-skins:
- Probe = list buckets/containers.
- Schema = object listing.
- Discovery = list buckets → list objects.
- Lineage is **not native to object storage** — the lineage edges that exist are inferred elsewhere (in the analytics tool that reads/writes the blob, e.g. Databricks pointing at S3). Don't try to derive lineage from blob metadata.

**Pattern win:** The S3 code in `connector-probe.service.ts` is the template; both new connectors are largely "swap the SDK, swap the auth shape."

### Streaming (kafka, redpanda) — 4-9 hours

Substantively different from tabular sources:
- "Schema" doesn't mean columns. It means **message structure** — Avro / Protobuf / JSON Schema. Requires a separate Schema Registry to be configured to introspect; without it, the schema is opaque.
- "Discovery" is a flat list of topics — no nested catalog/schema hierarchy.
- "Lineage" isn't native — Kafka itself doesn't track who reads/writes which topic. Provenance's existing approach (lineage emitted by pipelines at runtime) is the right shape for streaming.

**Pattern win:** Redpanda is effectively free given Kafka.

**Honesty constraint:** A Kafka connector that can't introspect message schemas (no registry) is genuinely limited. Either document the schema-registry requirement clearly or include it as a registration field.

### Generic HTTP (rest_api) — 3-5 hours

The most-limited of the bunch:
- Probe: HTTP GET. Trivial.
- Schema: only meaningful if an OpenAPI URL is configurable. Without it, the connector can confirm reachability but knows nothing about the API's shape.
- Discovery: not applicable.
- Lineage: not applicable.

**Honest framing:** `rest_api` as a connector is mostly a registration row with a probe. That's what the bug entry called out — the platform shouldn't pretend it does more than that. Either:
- Document the limitation clearly and ship the thin version, OR
- Add optional OpenAPI URL support to make schema introspection real for APIs that document themselves.

The OpenAPI-import path is its own ~4-6 hours of work if pursued.

---

## Non-obvious traps

The "lift in hours" doesn't capture these. Each is a place where a connector implementation can go from "estimated 5 hours" to "actually 15 hours" if the trap surfaces:

1. **Snowflake lineage requires Enterprise Edition.** ACCESS_HISTORY view doesn't exist on Standard. The connector needs to detect edition and gracefully degrade — fall back to "no lineage" rather than crash. Document the edition requirement in the connector capability manifest's `notes` / a per-instance configuration warning.

2. **BigQuery lineage means parsing SQL.** `INFORMATION_SCHEMA.JOBS.referenced_tables` is structured JSON, but the lineage relationships embedded in CREATE TABLE AS SELECT / MERGE / INSERT statements still need to be normalized to Provenance's edge model. The simple cases are easy (single SELECT FROM); CTEs, window functions, and complex MERGE statements are not. **Recommend: start with statement-type filtering (only handle the simple cases), document what's skipped, treat richer parsing as Layer 4b for that connector.**

3. **Redshift's STL views are not durable** — they roll off after a few days. If a user crawls infrequently and lineage relies on STL_QUERY, lineage will be sparse. **Recommend: also support Redshift Data API for lineage, even if more expensive per call.**

4. **Azure has THREE legitimate auth modes** (connection string, SAS, managed identity) and they don't share code paths. Start with connection string for dev, document managed identity as Phase 6 territory.

5. **BigQuery's per-project quotas** can cause API calls to fail unpredictably under load. Discovery crawls need rate-limit-aware backoff. Same issue exists for Snowflake but its rate limits are more generous.

6. **Kafka schema introspection without a registry is a UX cliff.** A contributor registers a Kafka connector, sees `discovery_granularity: asset_level` in the manifest, runs discovery, gets a list of topics with empty schemas. This is honest but unsatisfying. **Either** require a schema-registry URL at connector registration, **or** clearly label the connector's capability as "topic listing only; schema discovery requires a Schema Registry."

7. **rest_api without OpenAPI is honest emptiness.** This is the connector type where "we register it, we probe it, we can't do much else" is structurally the right answer. The risk is users register one expecting more. Solve at the UI / docs level, not at the implementation level.

8. **All cloud connectors need credential rotation flows** that the Databricks PAT flow didn't fully exercise. The `local-env:` sentinel works for laptop dev but real production needs Secrets Manager rotation policies per type. Cross-cutting work, not per-type.

9. **The Databricks-discovered lineage edges are table-level only.** Other RDB connectors targeting query-history-based lineage are likewise table-level by default. Column-level lineage everywhere is a separate (and much larger) Layer 4b conversation.

10. **"Custom" needs documentation, not implementation.** It exists as a way for future user-defined connectors to register, but today it should produce a clear "this type is reserved for user-defined plugins; no built-in capability" message at registration time, not silent fake-healthy.

---

## Options 1 / 2 / 3 reframed in concrete numbers

### Option 1 — implement all 12 connector types end-to-end

- **Best-case lift:** ~41 hours focused work (~1 person-week).
- **Realistic lift (with 50-100% padding for first-of-family + auth surprises):** ~62-86 hours (~1.5-2.5 person-weeks).
- **What's in:** probe + schema introspection + discovery crawl + table-level lineage where natively available.
- **What's NOT in:** column-level lineage for any new type; OpenAPI import for rest_api; Phase 6 hardening (managed identities, rotation policies).
- **What this looks like in practice:** Two focused weeks. Land them in shipping order (mysql → redshift → kafka → redpanda → gcs → azure_blob → snowflake → bigquery → rest_api), each as its own PR with the Databricks-style live verification.
- **Bottleneck:** Credentials. Each connector wants a real account/cluster to test against. Without test accounts, lift extends because every implementation is code-review-only.
- **PRD framing:** The 12-type promise stays as-is; the "✅ Phase 3 Complete" claim becomes true.

### Option 2 — narrow the PRD scope

- **Scope choice:** "PG + S3 + Databricks first-class; others marked `Experimental` with no probe + clear warning at registration." 
- **Lift:** ~4-8 hours. Document the experimental status in the connector capability manifest framework + UI badge on the registration form + clear message in the registration response.
- **What this saves:** ~40-80 hours of implementation work.
- **What this costs:** Marketing posture. The platform shifts from "12 connectors" to "3 first-class + 9 experimental." Investors / evaluators may read this as scope-narrowing rather than honesty.
- **Best fit for:** OSR launch as a milestone, where shipping honestly matters more than the connector count.

### Option 3 — hide the unimplemented types entirely

- **Scope choice:** Remove unimplemented types from the `ConnectorType` enum and the registration UI. Reduce surface area to what's actually built.
- **Lift:** ~2-3 hours. Trim the enum, remove the options from the registration form, update tests.
- **What this saves:** ~40-80 hours of implementation work.
- **What this costs:** The platform's stated breadth shrinks visibly. Marketing impact more severe than Option 2 because there's no "coming soon" signal.
- **Best fit for:** A pivot where the platform's identity becomes "the federated mesh for PG + S3 + Databricks" with extensibility via the `custom` escape hatch.

### A possibly-better fourth option

Given the lift survey results, there's an Option 4 worth considering:

**Option 4 — implement in tranches, ship the tranches as they land.**

- Week 1: mysql, redpanda (~4 hours combined). Cheapest wins; high reuse of existing patterns.
- Week 2: gcs, azure_blob, kafka (~9-12 hours combined). Cloud + streaming tier.
- Week 3: snowflake, redshift, bigquery (~24-32 hours combined). Relational lineage tier.
- Week 4: rest_api + capability-manifest cleanup + documentation pass (~5-8 hours).
- "custom" stays as the documented user-extension type throughout.

Each tranche ships independently. After Week 1, the connector count goes from 3 to 5; Week 2 to 8; Week 3 to 11; Week 4 to 12. The platform's promise grows visibly week-over-week.

This is closer to how Databricks Layer 1-4 actually shipped — the marathon session ate them all in one push, but they were structurally independent PRs.

**Bottleneck reminder:** Credentials. If Matt has accounts / can borrow accounts for each, the tranches stick to the estimate. If not, each implementation is built code-blind and verified only at user-installation time — adds the ~50-100% padding the realistic numbers already include.

---

## Recommendation

I'd lean toward **Option 4 (incremental tranches)** going into Sunday's conversation, with this framing:

1. The original "8-16 weeks" estimate doesn't survive the connector-by-connector breakdown. It was based on the pre-Databricks pessimism that proved 4-8× off.
2. Option 1 in a 2-4 week sprint is genuinely on the table now. That changes the strategic conversation.
3. Option 4 lets the platform ship honestly week-over-week instead of waiting for a single big drop.
4. Option 2 / Option 3 are still defensible if the answer is "we'd rather focus elsewhere first" — but the cost of NOT implementing is now ~40-80 hours, not a quarter.

The actual decision Sunday should turn on:
- Are there 2-4 weeks of focused engineering bandwidth available against this work?
- Are credentials available (or borrowable) for each connector? (mysql is trivial — local docker; the cloud ones need real accounts.)
- Does shipping a "12 connectors, all working, lineage on the ones that support it natively" pitch matter more than shipping "3 first-class + extensibility" by the OSR milestone?
- Is the platform's identity "the universal federated mesh" or "the PG/S3/Databricks-first mesh that grew"?

None of those are engineering questions. They're product / market / brand questions. The engineering side just stopped being the gating factor at the cost reframing.

---

## Methodology notes

- Estimates are extrapolated from Databricks's Layers 1-4 ~8-hour actual execution.
- Padding multipliers are educated guesses, not measured. Padding for first-of-family is real (driver bootstrap, auth-flow surprises); padding for subsequent types in the same family is much smaller because pattern reuse compounds.
- None of the estimates include integration testing against real credentials — that's an additional 1-3 hours per type and requires accounts.
- The capability-manifest framework (V31) is already in place — adding new entries per type is a 5-minute migration each, not a real lift.
- The audit doc (`documents/audits/claim-vs-code-2026-05-22.md`) and the original [Databricks integration sketch](databricks-integration-sketch.md) are the inputs that inform these estimates.

---

## Files of record

- `apps/api/src/connectors/probe/connector-probe.service.ts` — the dispatch table and existing real implementations (postgresql, s3, databricks).
- `packages/types/src/connectors.ts` — the canonical 13-element `ConnectorType` enum (12 real + custom).
- `apps/api/migrations/V31__create_capability_manifests.sql` — the framework for declaring per-type capabilities.
- `documents/architecture/databricks-integration-sketch.md` — the source of the original "8-16 weeks" framing being revised here.
- Memory: `feedback_osr_means_every_connector_real.md` — the OSR bar.
