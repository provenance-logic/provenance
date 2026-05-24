# Snowflake integration — sketch and lift estimate (Phase 5.14)

**Created:** 2026-05-24
**Author:** Drafted by the architect agent during the post-overhaul housekeeping session.
**Status:** Planning sketch, not an ADR. Models the proven layer decomposition from
[`databricks-integration-sketch.md`](databricks-integration-sketch.md) and adapts it for Snowflake
**and** for the consumer-grade OSR bar (ADR-011) that the Databricks sketch predates.

**Why this document exists.** Snowflake is the sole remaining OSR blocker — [B-063](../bugs/open.md#B-063),
the next-scheduled connector under [F3.2a](../prd/Provenance_PRD_v1.5.md)'s tranche cadence
([anchor decision 5](prd-overhaul-anchor-decisions-2026-05-23.md)). The PRD sizes it at ~6-8 weeks
at the consumer-grade bar (F3.2 / F3.26 / PRD §5.14). This sketch breaks that estimate into
buildable layers and reconciles a bottom-up number against it.

**What changed since Databricks.** The Databricks sketch was written 2026-05-21, *before* the
2026-05-22/23 consumer-grade reframe and [ADR-011](adr/ADR-011-configuration-brokerage.md). Databricks
shipped inbound Layers 1-4 only; it never did the outbound/consumer-grade half. Snowflake is the
**first connector that must ship both halves end-to-end** to meet the F3.2 bar. So this sketch is
deliberately bigger than the Databricks one: it has the same inbound Layers 1-4, **plus** a Part B
that the Databricks sketch never had.

**F-IDs this implements.** Inbound: F3.2 (first-class bar), F3.2a (tranche discipline), F3.26
(Snowflake discovery scope), F3.4 (probe), F3.9 (schema inference), F3.3 (capability manifest),
F3.23/F3.23a (discovery mode). Outbound: F10.14 (catalog name), F10.15 (situation detection),
F10.16 (cross-org primitives), F10.17 (destination snippets), F10.18 (connection test),
F10.19 (credential lifespan UX — already source-type-agnostic, no Snowflake-specific work).

---

## The biggest constraint, stated up front

Read this before anything else. The OSR bar is "actually works end-to-end"
([`feedback_osr_means_every_connector_real`](../../.claude/projects/-home-ec2-user-provenance/memory/feedback_osr_means_every_connector_real.md)).
The Databricks integration shipped in ~8 hours against the sketch's 6.5-13.5-day estimate *because
Matt had a real Databricks workspace to verify against*. Without a live Snowflake account, we can
write code but cannot prove any of it works — which fails the bar by definition. See
[Part C — Prerequisites](#part-c--prerequisites-and-open-questions); the account question is #1
and gates the whole tranche.

---

## How Snowflake differs from Databricks (the divergences that drive the lift)

| Dimension | Databricks (shipped) | Snowflake (this sketch) | Impact |
|---|---|---|---|
| Wire protocol | Pure REST (`fetch`, no npm dep) | SQL over a driver **or** SQL REST API | Biggest divergence. Drives Layers 1-3. See [Layer 1](#layer-1--connectivity-probe). |
| Auth | PAT bearer token (one string) | key-pair JWT / OAuth / user-pass / PAT | More auth surface; recommend key-pair for first cut. |
| Schema source | Unity Catalog REST endpoints | `INFORMATION_SCHEMA` / `SHOW` (SQL queries) | Schema inference becomes "run a query," not "GET an endpoint." |
| Discovery walk | UC catalogs→schemas→tables REST | `SHOW DATABASES` / `SHOW SCHEMAS` / `SHOW TABLES` (or `INFORMATION_SCHEMA`) | Same shape, SQL instead of REST. |
| Lineage | UC Lineage Tracking API (synchronous) | `ACCOUNT_USAGE.ACCESS_HISTORY` + `OBJECT_DEPENDENCIES` (Enterprise-gated, ~3h lag) | Edition gating + latency are net-new failure modes. |
| Cross-org | Delta Sharing (deferred for DBX) | **Secure Data Sharing / listings** | Genuinely new, no precedent. See [Part B5](#b5-cross-org-via-snowflake-shares-the-net-new-piece). |
| Naming | three-part `catalog.schema.table` | three-part `database.schema.object` | Identical shape — existing `source-view-ddl` works as-is. |

The single load-bearing divergence is the **driver question** in Layer 1. Everything in Layers 1-3
depends on whether the connector talks to Snowflake via the `snowflake-sdk` npm driver or the
Snowflake SQL REST API. Resolve that first.

---

# Part A — Inbound layers (Provenance ← Snowflake)

Modeled directly on Databricks Layers 1-4. Each lands independently; the first three are the
minimum discovery-able set.

## Layer 1 — Connectivity probe — "can Provenance reach this account?"

**What it does.** When an operator clicks "Validate" on a Snowflake connector, the platform makes a
live authenticated call against the Snowflake account and returns
`healthy` / `unreachable` / `credential_error` / `timeout`. This is the Snowflake branch of
`ConnectorProbeService.probe()` — the `never` exhaustiveness check at
`apps/api/src/connectors/probe/connector-probe.service.ts:71` will fail the build the moment
`'snowflake'` is added to `ConnectorType` without a `probeSnowflake` branch. (Databricks's probe
hits `GET /api/2.0/preview/scim/v2/Me`; the Snowflake equivalent is `SELECT 1` or
`SELECT CURRENT_USER()`.)

**Connection config.** Connector record stores `connection_config.account` (the account identifier,
e.g. `xy12345.us-east-1`), optionally `connection_config.warehouse` / `database` / `role`, and a
`credentialArn` (real Secrets Manager ARN in prod, or the `local-env:VARNAME` sentinel for laptop
dev — the same pattern `resolveDatabricksToken` already uses at
`connector-probe.service.ts:356`). Raw credentials in `connection_config` are blocked at
registration by `detectRawCredentialKey` (`connectors.service.ts:121`) — unchanged, reuse as-is.

### The driver question (resolve before any code)

Two ways to issue `SELECT 1` against Snowflake:

**Option A — `snowflake-sdk` npm driver.**
- Pro: official, handles key-pair JWT signing / OAuth / session keep-alive / result chunking natively.
- Con: a **real new runtime dependency** with native-ish concerns. Mirrors the
  `@temporalio/core-bridge` Node-22 worry already flagged in CLAUDE.md §5.6 (containers still ship
  Node 20; engines.node is `>=22.13.0`; native-addon prebuild compatibility needs verification on the
  bump). `snowflake-sdk` is mostly pure JS but pulls a sizable transitive tree (it bundles its own
  result parsing, OCSP, proxy handling). First dependency added to the connector path since
  Databricks was pure `fetch`.
- Con: connection-pool lifecycle to manage (connect / destroy) — heavier than a stateless `fetch`.

**Option B — Snowflake SQL REST API** (`POST https://<account>.snowflakecomputing.com/api/v2/statements`).
- Pro: zero new npm dependency — same `fetch` shape as the Databricks probe. Keeps the connector path
  dependency-free, which is its own architectural value.
- Pro: stateless request/response; no pool to manage.
- Con: **the SQL REST API only supports key-pair (JWT) and OAuth auth — not username/password.**
  This actually *aligns* with the recommended first-cut auth (below), so it's not a real con for v1.
- Con: result-set pagination and type coercion are hand-rolled (the REST API returns a `resultSetMetaData`
  + `data` array of stringly-typed cells; we parse types ourselves). For `INFORMATION_SCHEMA` queries
  this is tractable; for large discovery walks it's more handling code than the driver gives for free.
- Con: JWT generation for key-pair auth (RS256 sign of `account.user` with the private key,
  `iss`/`sub`/`iat`/`exp` claims) is ours to implement — ~30 lines, but it's crypto we own.

**Recommendation: Option B (SQL REST API) for the first cut.** Rationale: it keeps the connector path
free of a heavy new dependency (preserving the clean `fetch`-only shape that made Databricks fast),
it sidesteps the Node-22 native-addon question entirely, and its key-pair-only auth constraint
matches the recommended first-cut auth mode anyway. The hand-rolled result parsing is bounded — our
queries are all `INFORMATION_SCHEMA` / `SHOW` shapes with known column sets, not arbitrary user SQL.
If discovery-walk result handling or OAuth refresh becomes painful, switching to `snowflake-sdk` is a
contained follow-up (it's behind the `probeSnowflake` / `inferSchemaSnowflake` / `walkSnowflake`
boundary, same as the Databricks helpers are). **This is a reversible decision and worth an ADR**
since it adds (or deliberately declines to add) a dependency to a published path — recommend
ADR-012 if Option A is chosen, or a one-paragraph note in this sketch if Option B holds.

### Auth mode for first cut

Snowflake offers key-pair (JWT), OAuth, username/password, and PAT (newer). Recommend **key-pair (JWT)
only** for the first cut:
- It's Snowflake's recommended programmatic-auth mode and works with the SQL REST API.
- The credential stored in Secrets Manager is the RSA private key (PEM); the public key is registered
  on the Snowflake user by the operator out-of-band. Secret shape:
  `{"privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...", "user": "PROVENANCE_SVC", "account": "xy12345"}`.
- Username/password is easier for a 5-minute dev test but the SQL REST API doesn't accept it, and
  storing a password is a worse security posture. OAuth and PAT are follow-ups; the capability
  manifest declares which auth modes the connector supports (same pattern Databricks used for PAT-only).

**Probe error mapping.** Reuse the `HealthStatus` enum and the classifier pattern from
`classifyDatabricksHttpStatus` (`connector-probe.service.ts:728`). Snowflake SQL REST returns 401/403
for bad JWT → `credential_error`; 408/504 / `AbortError` → `timeout`; everything else → `unreachable`.
SQL-level errors (e.g. warehouse suspended) come back 200-with-error-body — classify those by the
`code`/`message` in the response, analogous to `classifyPgError` reading the message string.

**Lift:** **2-4 days.** Higher than Databricks's ~2 hours because: (a) JWT key-pair signing is net-new
crypto we own; (b) the SQL REST statement-submit + result-parse round-trip is more code than a bare
`GET /Me`; (c) no prior Snowflake REST shape in the codebase to copy byte-for-byte the way Databricks
copied the UC sketch. If Option A (driver) is chosen instead, subtract the JWT-signing work but add
dependency-vetting + pool-lifecycle + Node-22 prebuild verification — roughly a wash, maybe slightly
more.

## Layer 2 — Schema inference — "what columns are in this table?"

**What it does.** Given a `source_registration` like `database.schema.table`, introspect column list,
types, nullability. Stored as a `schema_snapshot` via `ConnectorsService.captureSchemaSnapshot`
(`connectors.service.ts:430`) — **unchanged orchestration**; only the `inferSchemaSnowflake` branch is
net-new. Same `never` exhaustiveness contract as the probe (`connector-probe.service.ts:93`).

**How it works.** Run against the consumer-... no — against the *connector's own* service identity:

```sql
SELECT column_name, data_type, is_nullable, comment, ordinal_position
FROM <db>.INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = '<schema>' AND table_name = '<table>'
ORDER BY ordinal_position;
```

`SHOW COLUMNS IN TABLE <db>.<schema>.<table>` is the alternative — no warehouse required (metadata
command), but returns a less-clean shape. `INFORMATION_SCHEMA.COLUMNS` is per-database and **requires
a running warehouse** (it's a query, billed). Recommend `INFORMATION_SCHEMA.COLUMNS` for the rich
shape; if the no-warehouse property matters for dev, fall back to `SHOW COLUMNS`.

**Map to the existing `schema_snapshot` shape.** Map onto the exact structure
`introspectDatabricks` produces (`connector-probe.service.ts:435`): `{ columns: [{ name, type,
nullable, position, comment }], tableType, comment }`. Same `SchemaInferenceResult` interface
(`connector-probe.service.ts:15`); same downstream consumers (the F2.8a port-binding schema-resolution
path, the product-detail PortsTab). Row estimates: like Databricks, return `null` unless we want to
run `SELECT COUNT(*)` (billed, heavyweight) — Snowflake exposes `ROW_COUNT` cheaply in
`INFORMATION_SCHEMA.TABLES`, so we *can* populate it here where Databricks couldn't. Minor win.

`sourceRef` must be three-part `database.schema.object` (mirror the Databricks three-part validation at
`connector-probe.service.ts:403` — reject two-part to avoid silently hiding a misconfigured source).

**Lift:** **1-2 days.** Once Layer 1's REST-statement round-trip exists, this is "run one known query,
map the result rows." The mapping target is already proven by Databricks. The `ROW_COUNT` bonus is
trivial.

## Layer 3 — Discovery crawl — "what tables does this account have?"

**What it does.** The defining capability of discovery-mode connectors. On registration (and on a
schedule per the capability manifest), walk the account to find tables and pre-populate source
registrations + schema snapshots. **Reuses the entire `ConnectorsService.crawlConnector` orchestration**
(`connectors.service.ts:476`) — the idempotent source-creation loop, the `discovery_crawl_events` row,
the per-table snapshot capture, the partial/succeeded/failed status logic. Only two things are net-new:
a `walkSnowflakeAccount` walker (parallel to `walkDatabricksWorkspace` at
`connector-probe.service.ts:460`) and lifting the hardcoded connector-type gate.

**The gate to remove.** `crawlConnector` currently hard-rejects everything except Databricks at
`connectors.service.ts:485`:
```ts
if (connector.connectorType !== 'databricks') { throw new BadRequestException(...) }
```
This becomes a dispatch on connector type (or a capability-manifest `supportsDiscoveryCrawl` check,
which already gates the *auto-crawl-on-registration* path at `connectors.service.ts:182`). The walker
call at `connectors.service.ts:504` (`walkDatabricksWorkspace`) becomes a branch.

**How the walk works (SQL, not REST endpoints).**
- `SHOW DATABASES` → database names the role can see (or scope via `connection_config.databases`,
  mirroring the Databricks `catalogScope` at `connectors.service.ts:501`).
- Per database: `SHOW SCHEMAS IN DATABASE <db>` (skip `INFORMATION_SCHEMA` — same skip Databricks does
  at `connector-probe.service.ts:483`).
- Per schema: `SHOW TABLES IN SCHEMA <db>.<schema>` (and optionally `SHOW VIEWS`).
- Emit `DiscoveredTable { catalog: db, schema, name, fullName: "db.schema.name" }` — the existing
  `DiscoveredTable` interface (`connector-probe.service.ts:21`) already calls the top level `catalog`;
  for Snowflake that slot holds the database. No interface change needed.

`SHOW` commands are metadata operations (cheap, no/low warehouse cost) and paginate via `LIMIT` +
`FROM '<last>'` cursors rather than Databricks's `next_page_token` — the walker handles that, but the
orchestration above it is identical.

**Capability manifest (F3.3).** Ship a new immutable manifest row via Flyway migration (the
`CapabilityManifestService` is read-only by design — `capability-manifest.service.ts:24`; new manifests
land as migrations, never in-place mutation). The Snowflake row sets `supports_probe=true`,
`supports_schema_inference=true`, `supports_discovery_crawl=true`, `supports_lineage_discovery=true`
(Enterprise-gated — see Layer 4), `discovery_granularity='asset_level'`,
`re_crawl_interval_hours_default=24`. Put the Enterprise-edition + ~3h-lineage-lag caveats in
`capabilities_doc` JSONB (the manifest's free-form notes slot per CLAUDE.md's connectors-schema note).

**Auto-crawl on registration** already fires for any connector whose manifest says
`supportsDiscoveryCrawl` (`connectors.service.ts:178`) — Snowflake inherits this for free once the
manifest row exists and the crawl gate is lifted. Temporal scheduled re-crawls (Layer 3c) stay
deferred, same as Databricks.

**Lift:** **2-4 days.** The walker (SQL `SHOW` traversal + Snowflake's cursor pagination) is the bulk;
the orchestration is pure reuse. Conflict resolution (domain-declared beats discovered) is inherited
from the existing crawl loop — no new code.

## Layer 4 — Lineage projection — "what feeds into what?"

**What it does.** Pull lineage edges from Snowflake and project them into Neo4j via the existing
`LineageService.emitEvent` — the *exact same path* the Databricks crawl uses
(`connectors.service.ts:574`), so edges land in PostgreSQL `emission_log` + Neo4j with the same
idempotency, trust-score-recompute, and `system-discovered` marker semantics. Deterministic
idempotency key (`snowflake-lineage:<connectorId>:<src>-><tgt>`) so re-crawls don't duplicate.

**Two Snowflake lineage sources, both in `SNOWFLAKE` shared DB:**

1. **`SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES`** — static dependency graph (view → underlying
   table, etc.). The cleaner, lower-latency signal. Available without ACCESS_HISTORY. Good for the
   declared structural lineage of views over tables — which is *exactly* the catalog-name-view
   relationship (F10.14) the producer creates. Recommend this as the primary Layer 4 source.

2. **`SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY`** — query-derived lineage (what read what, what wrote
   what). Richer (captures pipeline DML, not just static dependencies) but:
   - **Enterprise Edition gated.** ACCESS_HISTORY does not exist on Standard. The walker must detect
     this (query fails with a specific error, or pre-check `SHOW PARAMETERS` / edition) and **degrade
     gracefully to OBJECT_DEPENDENCIES-only**, not crash. This is the per-connector-instance edition
     warning the lift survey flagged (line 94).
   - **Latency.** ACCOUNT_USAGE views lag up to ~3 hours (Snowflake's documented refresh). A freshly
     written table won't show lineage immediately. Like Databricks's "empty workspace has no lineage,"
     the walker treats absent lineage as normal, not an error (mirror the 404-is-fine handling at
     `connector-probe.service.ts:594`).

**Walker shape.** A `walkSnowflakeLineage(connector, tableFullNames)` parallel to
`walkDatabricksLineage` (`connector-probe.service.ts:569`), returning the same
`{ edges: DiscoveredLineageEdge[], tablesWithErrors: string[] }` shape. Instead of N per-table REST
calls, it's one (or a few) SQL queries against ACCOUNT_USAGE filtered to the discovered table set, then
parse rows into edges. The parse is more involved than Databricks (ACCESS_HISTORY columns are
semi-structured JSON arrays of `objects_accessed` / `objects_modified`), but it's a known shape.

**Edge mapping.** Same `DiscoveredLineageEdge { sourceFullName, targetFullName }` → `DERIVES_FROM`
emission. No Neo4j-side code; reuses `emitEvent`. Column-level lineage (ACCESS_HISTORY does expose
column-granular access) is deferred exactly as Databricks's 4b was — same reasoning (product/port-level
edges today; column-aware edges are a separate granularity).

**Lift:** **3-5 days.** Higher than Databricks's ~1.5 hours because: (a) two sources to reconcile
(OBJECT_DEPENDENCIES + ACCESS_HISTORY) with edition-detection branching; (b) ACCESS_HISTORY's
semi-structured JSON parse is real work; (c) the ~3h-lag behavior needs deliberate handling and a
documented "lineage may be delayed" note in the UI. The Neo4j projection is free (reused).

---

# Part B — Outbound / consumer-grade layers (the half Databricks never did)

This is the part the Databricks sketch predates. Under ADR-011 / F3.2, Snowflake must ship the
consumer-grade outbound surface to meet the bar. The good news: **most of it already exists** and
already branches on Snowflake. The work is filling gaps, not building from scratch.

## B1. Destination snippets (F10.17) — Snowflake as a target

**Already done.** `apps/api/src/access/connection-package.service.ts` already detects Snowflake by host
(`d.host.includes('snowflakecomputing.com')`) in every relevant builder:
- `inferJdbcDriver` (line 550) → `'snowflake'`
- `buildSqlJdbcDbt` (line 810) → dbt `type: snowflake`
- `buildSqlJdbcUrl` (line 851) → `jdbc:snowflake://...`
- `pickPowerBiProtocol` (line 901) → `.pbids` `protocol: 'snowflake'`
- `pickTableauClass` (line 962) → `.tds` `class: 'snowflake'`
- `python` snippet via `buildSqlJdbcPython` (line 580) — generic, works.

So for a Snowflake `sql_jdbc` port, all six destinations (python / dbt / sql_client / jdbc / power_bi /
tableau) *already generate*. The snippet machinery is source-type-agnostic by host detection.

**The one real gap: the `warehouse` field.** Snowflake connections need a **warehouse** (compute) that
the consumer's tool must specify — and `SqlJdbcConnectionDetails` (`packages/types/src/products.ts:30`)
has `host / port / database / schema / authMethod / sslMode / jdbcUrlTemplate` but **no `warehouse`**.
Consequences today:
- The dbt profile (line 804) omits `warehouse:` — a Snowflake dbt profile is incomplete without it.
- The `.pbids` omits warehouse — Power BI's Snowflake connector needs it (it'll prompt, but that
  breaks the "lands connected" click-through bar).
- The python `snowflake-connector` snippet (currently rendered as the generic psycopg2 shape) is
  wrong for Snowflake — it should use `snowflake.connector.connect(...)` with `account` + `warehouse`,
  not `psycopg2`.

**Recommendation.** Add an optional `warehouse?: string` (and arguably `role?: string`) to
`SqlJdbcConnectionDetails`, and add a Snowflake-specific python snippet branch
(`snowflake.connector` instead of `psycopg2`). This is a **published-contract change** to a shared
type → spec-first per CLAUDE.md (update `packages/openapi/` + `packages/types/`), and worth an ADR
note since it touches a published interface. The `.pbids` follow-up the Databricks code already
flagged (line 874, "warehousePath that isn't in the contract today") is the same gap — close it
once for both. **This is the single concrete net-new outbound code item.**

## B2. Catalog-name views + source-view-ddl (F10.14)

**Already works as-is.** `resolveSourceViewDdl` (`connection-package.service.ts:301`) emits
`CREATE OR REPLACE VIEW <catalogName> AS SELECT * FROM <sourceObjectPath>;` and its own comment block
(line 287) states this "parses across PG / Snowflake / Databricks." Snowflake's three-part naming
(`db.schema.object`) is identical in shape to Databricks's `catalog.schema.table`, and `CREATE OR
REPLACE VIEW` is valid Snowflake DDL. **No Snowflake-specific DDL work** — the producer pastes the
generated DDL into a Snowflake worksheet; the platform never executes it (Constraint 3 / ADR-011).

One refinement worth a line: Snowflake views can be created as **`CREATE OR REPLACE SECURE VIEW`** when
the view backs a cross-org share (secure views are required for sharing). That ties into B5 — the
DDL generator could offer a "secure view" variant when the port is share-backed. Minor, deferrable.

## B3. Situation detection (F10.15)

**Layer-1 (producer declaration) already works.** `resolveSituationForPort`
(`connection-package.service.ts:236`) reads `port.situationAEligibility` and returns A/B with
`recommendedNext`. Source-type-agnostic — Snowflake inherits it. A Snowflake port is Situation-A when
the producer has granted access to a broad Snowflake role (e.g. `PUBLIC` or an account-wide role every
consumer's identity already holds), so the consumer connects with their existing account and no
per-product grant is needed.

**Layer-2 (probe verification) is the Snowflake-specific add, and it's deferred at OSR.** Anchor
decision 6c's layer 2 — "try `SELECT 1` against the catalog name with the *consumer's* identity" —
cannot run under configuration brokerage because the platform doesn't hold the consumer's credential
(ADR-011). It would run from the consumer's tool, not the platform. So at OSR, Snowflake situation
detection is **producer-declaration-only**, same as PG/S3/Databricks. No net-new code for the OSR bar;
the layer-2 probe is post-OSR (and tied to the connection-test path B6, which *does* run as the
consumer).

## B4. Connection test (F10.18 / Phase 5.12)

**The consumer-identity test.** Per ADR-011, this runs **as the consumer's own identity, never
persisting credentials**. For Snowflake the test is "can *you* (the consumer) reach this catalog name?"
— a `SELECT 1 FROM <catalogName> LIMIT 1` (or `SELECT COUNT(*)` against the view) issued with the
consumer's credentials.

Architecturally important: this is **not** the same code path as the Layer-1 *connector* probe (which
uses the connector's *service* identity stored in Secrets Manager). The connection test must execute
with credentials the platform never sees. Two shapes:
- **Client-side:** the platform hands the consumer a ready snippet (the python `snowflake.connector`
  one from B1) and "run this; tell us if it worked" — purest configuration-brokerage form, zero
  platform credential handling.
- **Ephemeral server-side:** the consumer supplies credentials for a single in-memory test call that
  is never stored (the F10.18 / Phase 5.12 "connection test layer"). If this path is chosen, it MUST
  use the same `local-env`/no-persist discipline and explicitly never write to Secrets Manager or
  `connection_config`.

The connection-test *layer* (5.12) is being built source-type-agnostically; Snowflake's contribution
is the `SELECT 1`-against-catalog-name probe shape. **Lift is small if 5.12's framework exists** —
just the Snowflake test query. Flag dependency: if 5.12 is not yet built, that framework is a
prerequisite, not Snowflake-specific work.

## B5. Cross-org via Snowflake shares (the net-new piece)

This is the genuinely new, genuinely hard part with no Databricks precedent (Delta Sharing was deferred
for DBX). It's named by [anchor decision 6b](prd-overhaul-anchor-decisions-2026-05-23.md) and F10.16:
**Snowflake Secure Data Sharing** is the cross-org consumption primitive for Snowflake products.

**The scenario.** Producer in Org B publishes a Snowflake-backed product. Consumer in Org A wants it.
Org A and Org B have *different Snowflake accounts*. There is no shared credential (ADR-011). The
bridge is Snowflake's native share mechanism:

1. **Producer side (Org B), one-time, manual in Snowflake — the platform brokers the *instructions*,
   not the action.** The producer creates a share and grants the catalog-name (secure) view to it:
   ```sql
   CREATE SHARE customer_360_share;
   GRANT USAGE ON DATABASE prod_db TO SHARE customer_360_share;
   GRANT USAGE ON SCHEMA prod_db.sales TO SHARE customer_360_share;
   GRANT SELECT ON VIEW prod_db.sales.customer_360 TO SHARE customer_360_share;  -- the catalog-name secure view
   ALTER SHARE customer_360_share ADD ACCOUNTS = <org_a_account_locator>;
   ```
   Or, for the marketplace-listing model, publishes a **private listing** scoped to Org A's account.
   Per Constraint 3 / ADR-011 the platform **does not run this** — it generates the DDL/instructions
   (extending the `source-view-ddl` generator) for the producer to paste. The producer adding the
   consumer's account is the Snowflake-native analog of the F10.16 "manual GRANT" Situation-B step —
   honest, acknowledged friction.

2. **Platform brokers the share metadata into the connection package.** Per ADR-011 §3, the package
   carries "share name for native-share sources." So the Snowflake connection package gains:
   `shareName`, `providerAccountLocator` (Org B's account), and the catalog-name view path. This is
   **new connection-package content** — a Snowflake-cross-org variant of the artifacts. It rides on
   the existing `ConnectionPackage` shape (`generateForProduct` at `connection-package.service.ts:353`)
   as an additional artifact set, not a new primitive (composition, per the platform's ADR-005/008
   pattern).

3. **Consumer side (Org A), in their own Snowflake account.** The consumer mounts the share as a
   database and queries it with *their own* Snowflake identity:
   ```sql
   CREATE DATABASE customer_360_from_provenance FROM SHARE <org_b_locator>.customer_360_share;
   SELECT * FROM customer_360_from_provenance.sales.customer_360 LIMIT 10;
   ```
   The platform generates these mount instructions as a Snowflake-specific snippet destination
   (a new `snowflake_share` destination, or folded into the existing per-tool snippets with a share
   preamble).

**Why this is hard / what to watch.**
- It's a **two-account dance** with a manual producer step and a manual consumer mount step. Neither
  side's credentials touch the platform — which is correct (ADR-011) but means the platform can't
  verify the share end-to-end; it can only generate correct instructions and let the situation
  detection / connection test confirm.
- **Same-region / same-cloud constraint.** Classic Snowflake Secure Data Sharing requires provider and
  consumer accounts in the same region + cloud. Cross-region/cross-cloud needs *listings* (Snowflake
  Marketplace/private listings) or replication. The platform must surface this constraint honestly
  (a Situation-C-style "this share requires your account to be in <region>" message) rather than
  generate instructions that silently fail.
- **Reader accounts** (for consumers with no Snowflake account at all) are a provider-pays escape
  hatch — explicitly out of scope; that's Situation C "contact the owner."
- This is **new connection-package content + new DDL generation + new consumer-mount snippet**, and it
  has cross-org-namespace implications (the share metadata is Org B's, surfaced to an Org A consumer —
  rides the same `@AllowCrossOrgRead` marketplace-metadata pattern the platform already uses).

**Lift:** **1.5-2.5 weeks** on its own. This is the single largest net-new outbound chunk and the part
most likely to expand once tested against two real Snowflake accounts (which we may not have — see
Part C).

## B6. Credential lifespan UX (F10.19)

**No Snowflake-specific work.** F10.19 (grant-side TTL warnings, renewal) is source-type-agnostic and
already shipped end-to-end (CLAUDE.md status: "5.13 F10.19 credential lifespan end-to-end"). It refers
to *grant* expiry, not credential expiry (ADR-011). Snowflake inherits it. Listed for completeness only.

---

# Part C — Prerequisites and open questions

Lead with these. They gate everything.

### 1. Do we have a Snowflake account to develop and verify against? (THE #1 PREREQUISITE)

The Databricks integration shipped in ~8 hours *because Matt had a real workspace*. The OSR standard is
"actually works end-to-end" — without a live Snowflake account we can write plausible code but cannot
verify probe, schema inference, discovery, lineage, or (critically) the two-account share dance. That
fails the bar by definition.

- **Snowflake offers a 30-day free trial** (~$400 credits), and **trial accounts default to Enterprise
  Edition for 30 days** — which conveniently gives us ACCESS_HISTORY (Layer 4) for free during the
  build window. After 30 days a trial drops to whatever tier; lineage verification must happen inside
  that window.
- **Cross-org shares (B5) need TWO accounts** in the same region/cloud to verify the producer→consumer
  mount end-to-end. One trial account proves inbound + single-account outbound; the share dance needs a
  second. Flag this explicitly — B5 may ship "code-complete, instructions-verified-by-docs" rather than
  "verified end-to-end" if a second account isn't available, and that gap must be named honestly per the
  truth bar.

**This is the gating decision. Resolve it before scheduling the tranche.**

### 2. The npm driver dependency decision

Recommended Option B (SQL REST API, no new dependency) in Layer 1. If Option A (`snowflake-sdk`) is
chosen instead: it adds a transitive dependency tree to the connector path (first since the pure-`fetch`
Databricks work) and reintroduces the Node-22 / native-addon-prebuild verification concern flagged in
CLAUDE.md §5.6 for `@temporalio/core-bridge`. Either way the decision touches a published path and
warrants an ADR (ADR-012) or at minimum a recorded rationale.

### 3. Snowflake edition gating (Layer 4)

ACCESS_HISTORY requires Enterprise Edition. The lineage walker must detect edition and degrade to
OBJECT_DEPENDENCIES-only rather than crash on Standard. Trial accounts are Enterprise for 30 days, so
development is unblocked; production deployments against customer Standard accounts get structural
lineage (OBJECT_DEPENDENCIES) but not query-derived lineage. Document in the capability manifest
`capabilities_doc` and surface as a per-connector-instance note.

### 4. Auth mode for first cut

Recommended key-pair (JWT) only — aligns with the SQL REST API, is Snowflake's recommended programmatic
auth, and stores an RSA private key (not a password) in Secrets Manager. OAuth, username/password, and
PAT are follow-ups declared in the capability manifest.

### 5. The `warehouse` contract gap (B1)

`SqlJdbcConnectionDetails` has no `warehouse` field, which Snowflake snippets need for a true
click-through. Adding it is a published-contract change (spec-first, shared type) and should also close
the pre-existing `.pbids` warehouse-path gap the Databricks code flagged. Small but it touches a
published interface.

### 6. Does the connection-test framework (Phase 5.12) exist yet? (B4 dependency)

B4's lift is small *if* the source-type-agnostic 5.12 connection-test layer is built. If not, that
framework is a prerequisite to Snowflake's connection test, not Snowflake-specific work — verify before
sizing B4.

### 7. Cross-org region/cloud constraint surfacing (B5)

Classic Secure Data Sharing requires same-region/same-cloud provider+consumer accounts; cross-region
needs listings or replication. The connect flow must detect and surface this honestly rather than
generate silently-failing mount instructions. Needs a small situation-detection refinement.

---

# Part D — Lift estimate

Modeled on the Databricks sketch's table. Separated into inbound (probe/schema/discovery/lineage),
outbound (mostly reuse), and cross-org-shares (genuinely new), per the task framing.

| Layer | This sketch's lift | Notes |
|---|---|---|
| **INBOUND** | | |
| 1. Connectivity probe (SQL REST + JWT key-pair signing) | **2-4 days** | Net-new crypto (JWT sign) + statement round-trip; no prior Snowflake shape to copy. The driver decision lives here. |
| 2. Schema inference (`INFORMATION_SCHEMA.COLUMNS`) | **1-2 days** | Maps onto the proven Databricks `schema_snapshot` shape; `ROW_COUNT` is a free bonus. |
| 3. Discovery crawl (`SHOW` walk + manifest + auto-crawl) | **2-4 days** | Walker is net-new; `crawlConnector` orchestration + capability manifest scaffolding + auto-crawl are pure reuse. |
| 4. Lineage projection (OBJECT_DEPENDENCIES + ACCESS_HISTORY) | **3-5 days** | Two sources, edition detection, semi-structured JSON parse, ~3h-lag handling. Neo4j projection reused (free). |
| **Inbound subtotal** | **8-15 days (~1.5-3 weeks)** | |
| **OUTBOUND (mostly reuse)** | | |
| B1. Destination snippets + `warehouse` contract field | **2-4 days** | Host detection already done in all 6 builders; net-new = `warehouse?` field (spec-first) + Snowflake python `snowflake.connector` branch + `.pbids`/dbt warehouse plumbing. |
| B2. Catalog-name view DDL | **~0 (reuse)** | `resolveSourceViewDdl` already parses for Snowflake. Optional secure-view variant is minor. |
| B3. Situation detection (producer declaration) | **~0 (reuse)** | `resolveSituationForPort` is source-agnostic; layer-2 probe is post-OSR. |
| B4. Connection test (consumer-identity `SELECT 1`) | **1-3 days** | Small *if* 5.12 framework exists; the Snowflake test query is trivial. Prereq risk noted. |
| B6. Credential lifespan UX | **0 (shipped)** | Source-agnostic, already done. |
| **Outbound subtotal** | **3-7 days (~1-1.5 weeks)** | |
| **CROSS-ORG SHARES (net-new)** | | |
| B5. Secure Data Sharing brokerage (DDL gen + package metadata + mount snippet + region constraint) | **1.5-2.5 weeks** | No precedent; two-account dance; most likely to expand under real testing. |
| **Cross-org subtotal** | **~1.5-2.5 weeks** | |
| **Integration, tests, UI surfacing, live verification, docs** | **~1 week** | Per CLAUDE.md "API-complete ≠ phase-complete": registration UI dropdown re-add, persona walkthrough, capability-manifest migration, CHANGELOG, README. |

**Bottom-up total: ~5-8 weeks.**
- Inbound ~1.5-3 wk + outbound ~1-1.5 wk + cross-org ~1.5-2.5 wk + integration/verification ~1 wk.

**Reconciliation against the PRD's ~6-8 weeks.** The bottom-up number lands **at the low end of, and
consistent with, the PRD's ~6-8-week estimate** (F10.16 / PRD §5.14 / anchor decision 5). The bottom of
my range (~5 wk) assumes: a live account available day one, the 5.12 connection-test framework already
built, and the SQL-REST-API driver path holding (no mid-stream switch to `snowflake-sdk`). The top
(~8 wk) absorbs: the cross-org share dance expanding under real two-account testing, a driver-path
reversal, or the connection-test framework needing to be built first. **I would plan to 6-8 weeks**,
not 5 — because the two assumptions most likely to break (live account availability and the second
account for share verification) are exactly the ones outside engineering control, and the Databricks
"~8 hours vs 6.5-13.5 days" compression was a *best case* that relied on a clean REST API and a ready
workspace. Snowflake has neither guarantee: the wire path is SQL-over-REST (more handling than UC's
clean REST), and the share dance has no precedent to copy. The lift survey's own line (line 26) sized
Snowflake at "~1× Databricks" for *inbound only* — but that survey predates the consumer-grade bar; the
outbound + cross-org half is the genuinely new weight that pushes this to a multi-week tranche.

**The estimate is dominated by risk, not raw code.** A large fraction of the inbound work and almost
all of the outbound work is reuse of machinery Databricks and the 5.8-5.13 consumer-grade workstreams
already proved. The real cost centers are (a) the cross-org share dance (net-new, untested), and
(b) the verification gap if no live account(s) exist. Those two are where a 6-week plan becomes an
8-week plan.
