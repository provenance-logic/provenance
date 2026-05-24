# Provenance — Claude Code Context

This file is read automatically by Claude Code at the start of every session.
It provides the essential context needed to work effectively on this codebase.
For full detail, read `documents/prd/Provenance_PRD_v1.5.md` and `documents/architecture/Provenance_Architecture_v1.5.md`.

> **Current status:** Read `documents/status-board.md` first — that file is the single source of truth for where the project stands today. **Do not trust any "in progress" or status prose elsewhere in this file**; status content in CLAUDE.md goes stale between sessions and has misled in the past. CLAUDE.md carries architecture, patterns, and constraints — the stuff that doesn't change. Volatile state lives in the status board, `documents/prd/implementation-status.md` (per-feature detail), and `documents/prd/osr-roadmap.md` (stage plan).

---

## What Is Provenance

Provenance is an open source, cloud-native, multi-tenant self-service data mesh platform built for the Data 3.0 era. It is a **coordination and contract platform** — it does not store data, execute pipelines, or provide a centralized query engine for human consumers.

Provenance is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

**What it is not:**

* A data warehouse or data lake
* A pipeline orchestrator or ETL engine
* A centralized query engine for human consumers
* A traditional data catalog
* A data quality computation engine

---

## Four Personas (Priority Order)

1. **AI Agents** — autonomous consumers and potential producers of data products
2. **Domain Teams** — human owners and publishers of data products
3. **Data Consumers** — human discoverers and users of data products
4. **Governance Teams** — policy authors and compliance monitors

---

## Five Non-Negotiable Architectural Constraints

These are hard constraints. Do not work around them.

1. **The lineage graph must be a native graph database.** Neo4j for MVP. The query patterns (arbitrary depth traversal, impact analysis, path queries, time travel) are pathological for relational databases.
2. **The policy engine must be a hot-reloadable independent runtime.** Open Policy Agent (OPA). Policy changes cannot require platform redeployment.
3. **Control plane and data plane must be architecturally separated from day one.** The platform stores metadata and contracts. Data stays in domain infrastructure. This boundary is never blurred.
4. **The agent query layer is a distinct service.** Deployed as a separate NestJS process even in MVP. Latency, concurrency, and MCP protocol requirements are incompatible with the control plane monolith.
5. **MCP compliance is a native protocol implementation.** Use the official `@modelcontextprotocol/sdk` TypeScript package. Never wrap MCP around a REST API.

---

## Technology Stack

| Component | MVP | Production |
| --- | --- | --- |
| Backend API | TypeScript / NestJS (modular monolith) | NestJS microservices on EKS |
| Frontend | TypeScript / React + TailwindCSS | Same |
| Graph Database | Neo4j Community (self-hosted) | Amazon Neptune or Neo4j AuraDB |
| Relational Database | PostgreSQL 16 (self-hosted) | Amazon Aurora PostgreSQL Serverless v2 |
| Message Broker | Redpanda (Kafka-compatible, self-hosted) | Amazon MSK |
| Policy Engine | Open Policy Agent (OPA sidecar) | OPA on EKS (2 replicas) |
| Search | OpenSearch (single-node, self-hosted) | Amazon OpenSearch Service |
| Identity | Keycloak (self-hosted) | Keycloak on EKS (HA) or Auth0 |
| Workflow Engine | Temporal (self-hosted) | Temporal Cloud |
| API Gateway | Kong OSS | Kong Gateway on EKS |
| Agent Interface | MCP server (@modelcontextprotocol/sdk) + GraphQL | Same |
| Semantic Search | sentence-transformers + OpenSearch kNN | Same + managed embeddings API |
| NL Query Translation | Claude API (claude-sonnet-4-20250514) | Same |
| Embedding Service | Python / FastAPI | Same |

---

## Monorepo Structure

```
provenance-platform/
├── apps/
│   ├── api/                        # NestJS modular monolith (MVP)
│   │   └── src/
│   │       ├── organizations/      # Org and domain management
│   │       ├── products/           # Data product lifecycle
│   │       ├── connectors/         # Connector framework + discovery engine
│   │       ├── governance/         # Policy engine integration
│   │       ├── lineage/            # Lineage graph service
│   │       ├── observability/      # Metrics and trust score
│   │       ├── access/             # Access grants and requests
│   │       └── notifications/      # Notification service
│   ├── agent-query/                # Agent Query Layer (separate NestJS app)
│   │   └── src/
│   │       ├── mcp/                # MCP server implementation
│   │       ├── graphql/            # GraphQL schema exploration API
│   │       ├── semantic/           # NL + structured query engine
│   │       ├── federation/         # Cross-product query federation
│   │       └── provenance/         # Provenance envelope builder
│   ├── embedding/                  # Python FastAPI embedding service
│   └── web/                        # React frontend
│       └── src/
│           ├── features/
│           │   ├── governance/     # Policy studio, command center
│           │   ├── publishing/     # Product authoring, domain dashboard
│           │   ├── discovery/      # Marketplace, product detail
│           │   └── agents/         # Agent registry, activity monitor
│           └── shared/             # Design system, shared hooks, API clients
├── packages/
│   ├── types/                      # Shared TypeScript types (monorepo-wide)
│   ├── openapi/                    # OpenAPI specs (source of truth for all APIs)
│   ├── sdk-ts/                     # TypeScript lineage emission SDK
│   ├── sdk-python/                 # Python lineage emission SDK
│   └── policy/                     # OPA Rego policy templates and compiler
├── infrastructure/
│   ├── terraform/                  # AWS infrastructure as code
│   ├── k8s/                        # Kubernetes manifests
│   ├── docker/                     # Docker Compose (MVP)
│   └── scripts/                    # Deployment and operational scripts
├── documents/
│   ├── prd/                        # Product Requirements Document
│   ├── architecture/               # Architecture document and ADRs
│   ├── api/                        # Generated from OpenAPI specs
│   └── runbooks/                   # Operational runbooks
├── CLAUDE.md                       # This file
└── README.md
```

---

## Database Schemas (PostgreSQL)

> **Reconciled 2026-05-22 against actual migrations** (`apps/api/migrations/V1`–`V31`). Tables listed below match what `\dt` would show. Two earlier "planned" tables (`discovery_coverage_scores`, `observability_snapshots`) were removed pending the 2026-05-24 weekend overhaul: the discovery scoring framework that referenced the first is part of the B-063 conversation; no observability-snapshot mechanism was ever built. Four other names in earlier versions of this list (`domain_extensions`, `roles`, `port_contracts`, `use_case_declarations`) were never separate tables — the data is carried in JSONB columns or enum-like fields on existing tables; the inline annotations below name where. The `consent_records` projection table also doesn't exist; F12.11's audit-log-as-projection design covers it (see implementation-status.md Domain 12).
>
> Surfaced by `documents/audits/claim-vs-code-2026-05-22.md` (B-064).

| Schema | Key Tables | Notes |
| --- | --- | --- |
| organizations | orgs, domains, governance_configs | org_id on all tables for tenant isolation. Domain extensions are not a separate table; they're represented by `scope_type='domain_extension'` rows in `governance.effective_policies`. |
| identity | principals, role_assignments, agent_identities, agent_trust_classifications, invitations, principal_preferences | Keycloak is auth source; PostgreSQL stores platform-specific metadata. Roles are not a separate table; they're an enum-like value on `role_assignments.role`. |
| products | data_products, product_versions, port_declarations, lifecycle_events | Versions are immutable records. Port contracts are not a separate table; the contract is a `contract_schema JSONB` column on `port_declarations` (V3). Port-to-source binding (F2.8a / B-070, V33) is the nullable FK `port_declarations.source_registration_id` → `connectors.source_registrations(id)` plus the `source_object_path TEXT` column — when set, schema and freshness derive from the bound source's latest `schema_snapshot`. Situation-A eligibility (F10.15 layer 1, V34) is the `port_declarations.situation_a_eligibility BOOLEAN NOT NULL DEFAULT false` — when true, the port is open to all source-system principals (no per-product grant required at the consumer connect flow). |
| connectors | connectors, connector_health_events, source_registrations, schema_snapshots, **capability_manifests, discovery_crawl_events** | Credentials stored as Secrets Manager ARN only — never raw values. **No `discovery_coverage_scores` table today** — coverage levels live as labels inside `capability_manifests.capabilities_doc` JSONB; whether a per-crawl scoring table ships is part of the B-063 weekend overhaul. |
| governance | policy_schemas, policy_versions, effective_policies, compliance_states, compliance_snapshots, exceptions, grace_periods | Policy artifacts stored as JSONB. |
| access | access_grants, access_requests, approval_events | Consumer-product access with expiration tracking. |
| consent | connection_references, connection_reference_outbox | org_id on every table for tenant isolation. Per-use-case consent layer composing with (not replacing) access grants. Use-case declaration fields (`use_case_category`, `purpose_elaboration`, `scope`, `data_category_constraints`) are columns on `connection_references` — there's no separate `use_case_declarations` table. The immutable consent record projection (F12.11) is reconstructed from `audit.audit_log` rather than a separate `consent_records` table per implementation-status.md Domain 12. Outbox table drives Redpanda `connection_reference.state` publication for cache invalidation at the Agent Query Layer. See ADR-005 through ADR-008. |
| lineage | emission_log | SQL audit trail of every lineage emit event with idempotency key. The primary lineage store is **Neo4j** (per Constraint 1); this table is the durable record that drives Neo4j projection and emission deduplication. |
| observability | slo_declarations, slo_evaluations, trust_score_history | Tables partitioned by org_id and time where applicable. No `observability_snapshots` table exists today; the trust-score and SLO history tables together provide the snapshot-like read pattern. |
| notifications | notifications, delivery_outbox, principal_preferences, principal_settings | Domain 11 routing + per-channel delivery + per-(principal, category) preferences. Same outbox pattern as `consent`. |
| audit | audit_log | Append-only at the database role level (`REVOKE UPDATE, DELETE ON audit.audit_log FROM provenance_app`). Partitioned monthly through 2027-03. |

---

## Key Domain Model Concepts

**Data Product lifecycle states:** Draft, Published, Deprecated, Decommissioned

**Port types:** Input, Output, Discovery, Observability, Control

**Output port interface types:** SQL/JDBC, REST API, GraphQL, Streaming topic, File/object export, Semantic query endpoint (agents only)

**Compliance states:** Compliant, Drift Detected, Grace Period, Non-Compliant

**Agent trust classifications:** Observed (default — read-only, no side effects), Supervised (consequential actions held pending human approval), Autonomous (full operational capability, explicit governance grant required — never automated)

**Agent trust classification transitions:** Upgrades (toward Autonomous) require governance role only. Downgrades can be performed by human oversight contact OR governance role. Autonomous can never be set by automated process.

**Workflow states:** Draft, Published, Deprecated, Decommissioned (product states) + **Frozen** (platform-level Temporal state — in-flight operations suspended pending governance disposition, triggered by agent classification downgrade in Phase 4)

**Principal types:** Human user, Service account, AI agent, Platform administrator

**Lineage node types:** Source, DataProduct, Port, Transformation, Agent, Consumer

**Lineage edge types:** Derives From, Transforms, Consumes, Depends On, Supersedes

**Lineage source markers:** system-discovered (from connector crawl), declared (by domain team), emitted (by pipeline at runtime)

**Connector discovery modes:** Active discovery (crawls on registration + re-crawl schedule), Passive emission only (no discovery mode declared in capability manifest)

**Discovery metadata categories:** Structural, Descriptive, Operational, Quality, Governance

**MCP tools (Phase 4 complete — 9 tools):** list_products, get_product, get_trust_score, get_lineage, get_slo_summary, search_products, semantic_search, register_agent, get_agent_status

**OpenSearch indices:** `data_products` (kNN semantic, 384-dim, all-MiniLM-L6-v2) + `provenance-products` (BM25 keyword). Both active and complementary — do not merge.

**Agent authentication (ADR-002, Phase 5 complete):** JWT-based authentication via Keycloak `client_credentials` grant. Each registered agent receives a dedicated Keycloak client at registration time. Agent Query Layer validates JWT on every MCP request (RS256, JWKS, exp, iss, `principal_type=ai_agent`). Verified `agent_id` and `org_id` extracted from JWT claims — identity is cryptographically verified, not self-reported. Supersedes the Phase 4 `X-Agent-Id` header pattern. See `documents/architecture/adr/ADR-002-jwt-agent-authentication.md`.

**Lineage visualization (ADR-003):** Lineage graph rendering uses **React Flow** for the node/edge canvas with **Dagre** for automatic DAG layout. This supersedes the earlier D3-based approach. React Flow provides built-in pan/zoom, node selection, and custom node types; Dagre computes deterministic hierarchical positions for lineage DAGs. See `documents/architecture/adr/ADR-003-lineage-visualization.md`.

**Connection references (Domain 12, PRD v1.5 F12.1–F12.25, Architecture v1.5 Section 3, ADR-005 through ADR-008):** A connection reference is a first-class, owned, revocable entity that pairs an agent's access to a product with an explicit, human-consented use-case declaration. Both an active access grant AND an active connection reference are required for any agent action against any product — no exceptions. Connection reference lifecycle states: Pending, Active, Suspended, Expired, Revoked. Expired and Revoked are terminal and immutable. Use-case declaration structure: governance-defined taxonomy category (8 defaults: Reporting and Analytics, Model Training, Pipeline Input, Audit and Compliance, Product Development, Operational Monitoring, Research, Integration) plus required free-text elaboration (min 50 chars). Default expiration maximums by classification: Public 1 year, Internal 180 days, Confidential 90 days, Restricted 30 days. MAJOR product version publication auto-suspends all active connection references for that product — re-consent required. Autonomous agents may self-request; human must always approve. Observed agents require human proxy to request. Runtime scope enforcement runs as an in-memory cache lookup at the Agent Query Layer — not an OPA call on the hot path. OPA is consulted only for governance-authored rules at state transition time. Revocation propagates via Redpanda `connection_reference.state` topic within 10 seconds. Temporal handles scheduled expiration and MAJOR-version suspension. Each connection reference produces exactly one connection package scoped to the approved ports and data categories.

---

## Connector Discovery Architecture

Connectors that implement discovery mode perform two types of crawling:

**Registration crawl** — triggered automatically on successful connector registration. Crawls the connected system for all metadata and lineage the connector is capable of providing per its capability manifest. Results ingested into the metadata store and lineage graph immediately.

**Re-crawl (delta)** — runs on a governance-configurable schedule (platform default: 24 hours). Detects new objects, changed metadata, and updated lineage since the last crawl. Merges delta results without overwriting domain-declared metadata.

**First-class connectors at MVP** (per PRD F3.2 + F3.2a, reflecting the 2026-05-23 PRD v1.6 reshape that closed anchor decision 5 on B-063):

| Connector | Probe / Schema | Discovery | Lineage Granularity | Status |
| --- | --- | --- | --- | --- |
| PostgreSQL | Real | None natively | n/a | Shipped |
| Amazon S3 | Real | None natively | n/a | Shipped |
| Databricks | Real | Unity Catalog API | Table-level (column deferred) | Shipped (V31 capability manifest 1.0.0) |
| Snowflake | Real (key-pair JWT via SQL REST API) | INFORMATION_SCHEMA + OBJECT_DEPENDENCIES lineage | Asset-level + share-aware (native Secure Data Sharing) | Shipped (V37–V39; ACCESS_HISTORY query-derived lineage deferred to Layer 4b) |

Snowflake shipped end-to-end 2026-05-24 (inbound probe/schema/discovery/lineage + outbound destination snippets + cross-org native shares), closing B-063. Deferred to post-OSR per anchor-decisions doc decision 5 + OS3.6 / OS3.7: streaming connectors (Kafka, Redpanda) and REST API connectors (their A/B/C user-story shape isn't designed yet); dbt and Fivetran (planned re-framing as a separate "metadata source" category since they describe pipelines rather than host data products). BigQuery and MySQL are the next F3.2a tranches by demand. The `custom` connector type was retired; whether the platform exposes a generic catch-all is a separate design question.

**Conflict resolution:** Domain-declared metadata takes precedence over discovered metadata unless the governance layer has configured automatic discovery override. Conflicts surfaced to domain team for resolution. Discovered lineage that supplements (does not conflict with) declared lineage is merged automatically and flagged as system-discovered.

**Coverage scoring:** Each connector reports a discovery coverage score per metadata category after each crawl. Scores calculated only against fields the connector's capability manifest declares it can provide — not against the full governance-extended taxonomy.

---

## Build Phases

| Phase | Scope | Key Deliverable | Status |
| --- | --- | --- | --- |
| 1 | Organization model, domain management, basic product authoring, identity | Running platform — org onboarding, domain creation, product drafting | ✅ Complete |
| 2 | Governance engine, OPA integration, marketplace, access control | End-to-end data mesh workflow — publish, discover, request access | ✅ Complete |
| 3 | Lineage graph, emission API, trust score, observability dashboard, connector discovery | Trust infrastructure live — lineage, SLOs, trust score, auto-discovery | ✅ Complete |
| 4 | MCP server, federated query layer, agent identity, semantic search, trust classification, audit log query API | Data 3.0 milestone — agents as first-class participants (9 MCP tools, SSE port 3002) | ✅ Complete |
| 5 | Stability, security essentials, JWT agent auth, data product completeness P1, anomaly detection, developer experience, SOC 2 foundations | Open Source Ready — reliable, secure, contributor-friendly on existing infrastructure. Est. +$10-30/month. Workstreams 5.1–5.4 complete; 5.5 (anomaly detection), 5.6 (developer experience), 5.7 (SOC 2 foundations) remaining. | 🔄 Active |
| 6 | Kubernetes, managed AWS services, security hardening, SOC 2 Type II audit | Production Scale — triggered by enterprise customers or funding, not a calendar date | 🔲 When Funded |

**Domain 12 (Connection References and Per-Use-Case Consent)** is cross-cutting work rather than a build phase. Its requirements (F12.1–F12.25, NF12.1–NF12.8, PRD v1.5) and architecture (Architecture v1.5 Section 3, ADR-005 through ADR-008) are complete; it shipped within Phase 5 as the largest OSR blocker, closed 2026-05-13. Runtime enforcement now runs on every product-bound MCP tool call (`CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true` by default). See the Domain 12 section of `documents/prd/implementation-status.md` for the per-requirement status and the deliberately deferred items (Supervised oversight-hold sub-state, governance override, MAJOR-version suspension, automatic expiration, rest of the F12.21 cascade triggers, per-reference scope filtering on the package, agent self-discovery MCP tool, visually-distinct legacy-ref UI).

**Active phase: 5 (Open Source Ready).** Phases 1–4 complete as of April 13, 2026. **As of 2026-05-24 (late), B-063 — the sole remaining OSR blocker — is effectively closed: the Snowflake tranche shipped end-to-end and live-verified (inbound probe/schema/discovery/lineage + outbound destination snippets + cross-org Secure Data Sharing), so the first-class connector set PG/S3/Databricks/Snowflake all work.** Earlier in the day Phase 5 consumer-grade outbound also closed: 5.8 (B-070 bridge), 5.9 layer 1 (F10.15), 5.10 (all 6 sql_jdbc destinations), 5.11 (F10.14), 5.13 (F10.19), plus F7.48 Account Surface. Only Snowflake `ACCESS_HISTORY` lineage (Layer 4b, enrichment) remains. **`v0.1.0-osr` — the first tagged release — was cut on 2026-05-24** (annotated tag on commit `60565dc`; CHANGELOG entry in #207), after B-075 Surface 1 closed (#205 connector detail page + #206 create-product-from-source deep-link). Post-OSR work (5.5 anomaly detection, 5.7 SOC 2 foundations, B-075 Surface 2, Phase 6) is now strategic-priority, not blocker-shaped. The per-workstream bullets below are preserved from May 13 for context and may have drifted; read `documents/status-board.md` for the current truth.

Phase 5 progress as of May 13, 2026 (see `documents/prd/implementation-status.md` for the authoritative per-feature status):

- ✅ **5.1 — Stability and Reliability** complete
- ✅ **5.2 — Security Essentials** complete as of April 18, 2026: HTTPS live at https://dev.provenancelogic.com and https://auth.provenancelogic.com (Caddy + Let's Encrypt); Keycloak domain wiring done (KC_HOSTNAME, KC_PROXY=edge, realm frontendUrl, client redirectUris/webOrigins, unmanagedAttributePolicy); NestJS API issuer validation fixed; `provenance_*` protocol mappers on the `provenance-web` client populate `provenance_principal_id`/`provenance_org_id`/`provenance_principal_type` claims; full browser login flow working end-to-end. Security group audit and MCP API key rotation previously completed.
- ✅ **5.3 — JWT Agent Authentication** (ADR-002) complete as of April 16, 2026
- 🔄 **5.4 — Data Product Completeness P1** substantively shipped (PRs #43, #45, #46, #47). Ownership/stewardship and access status fully implemented end-to-end; column-level schema rendered via declared port contract schemas (real JSON Schema → fields table in `PortsTab`); freshness rendered from SLO declarations + evaluations. Two non-blocking stubs: `ProductEnrichmentService.resolveColumnSchema` returns null pending a product-to-source-registration FK (the connector-discovered column-schema path); `freshness.lastRefreshedAt` returns null pending a lineage/source-registration tie-in. Both have visible UI fallbacks. Verified 2026-05-22 against `apps/api/src/products/product-enrichment.service.ts` + `apps/web/src/features/discovery/ProductDetailPage.tsx`.
- ✅ **F5.15 — Lineage Visualization** complete as of April 30, 2026 (PR #55). React Flow + Dagre per ADR-003 replaces the Cytoscape implementation. Deterministic LR DAG layout, custom node cards, humanized edge labels, built-in pan/zoom/minimap. Read-only graph (`nodesDraggable=false`). ADR-003 follow-ups (expand/collapse, PNG/SVG export, F5.17 time-travel) remain.
- 🔄 **Domain 10 Workstream B — Port connection details and connection packages** — mostly shipped (last verified 2026-04-25). F10.5 (per-interface-type schemas + frontend dynamic fields), F10.6 (encryption + access-gated disclosure, end-to-end verified), F10.8 (ConnectionPackageService), F10.9 (agent integration guide), F10.10 (refresh on connection-detail edit, end-to-end verified), and F10.7 (real probes for REST/GraphQL/Kafka, typed `unsupported` response for SQL/JDBC and file_object_export, frontend `ProbeStatusBadge`) all implemented and deployed. Remaining: per-driver SQL probes (postgres/mysql/snowflake), per-storage file probes (s3/gcs/adls), schema authoring items F10.11–F10.13. See `documents/prd/implementation-status.md` for per-requirement status.
- 🔲 **5.5 — Agent Anomaly Detection** — not started
- 🔄 **5.6 — Developer Experience** — substantially shipped. LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, README; B-009 OpenSearch BM25 reliability fix (#52, synchronous double-write + `pnpm reindex:search`); in-product `/api/v1/docs` OpenAPI reference (#53); working `pnpm --filter @provenance/seed seed` CLI (#54, eight idempotent seed endpoints behind `SEED_ENABLED` + service-token guard); seed-data richness across SLO declarations / access requests + grants / notification inbox / SLO evaluations / lineage emit idempotency (#57–#61, all idempotent on natural keys, three back-to-back seed runs hold table counts stable); the **2026-05-07/08 fresh-laptop onboarding arc** across PRs #65–#72 closing 13 first-run blockers (B-010 OPA wget healthcheck, B-012 tsconfig `.ts` extension, B-013 packages/types prebuild, B-014 missing flyway-migrate service, B-015 flyway baseline=8 skip, B-016 missing realm-management roles in realm import, B-017 wrong port interface_type in seed, B-018 missing unmanagedAttributePolicy, B-019 incomplete KEYCLOAK_ISSUER_URL default, B-020 wrong VITE_API_BASE_URL default, B-021 README paper cuts, B-022 api/minio healthcheck-tool bugs); cumulative fresh-clone simulation passes end-to-end (clone → `pnpm install` → `docker compose up` → seed → JWT carries `provenance_org_id` → tenant API call returns 200). Remaining: local-setup-time measurement on a fresh contributor machine, container Node base-image bump from `node:20-slim`/`node:20-alpine` to a 22.x line (engines.node is `>=22.13.0` but containers still ship Node 20; CI failure currently hidden by Docker layer cache, will surface on next cache invalidation; native-addon prebuild compatibility e.g. `@temporalio/core-bridge` needs verification when bumping).
- 🔲 **5.7 — SOC 2 Foundations** — not started
- ✅ **Domain 12 — Connection References and Per-Use-Case Consent** — fully shipped 2026-05-13 across PRs #77–#86. Runtime enforcement default-on (`CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true`); `ConnectionReferenceGuard` runs on every product-bound MCP tool call (active grant AND active reference AND scope match); five distinct denial codes (`ACCESS_GRANT_NOT_FOUND`, `CONNECTION_REFERENCE_NOT_FOUND`, `CONNECTION_REFERENCE_SUSPENDED`, `CONNECTION_REFERENCE_EXPIRED`, `CONNECTION_REFERENCE_SCOPE_VIOLATION`) plus `UNKNOWN_TOOL` safety belt; audit row on every denial; scope-violation notification fans out to owning principal + every `governance_member` (governance-mandatory). Outbox publisher drains `consent.connection_reference_outbox` to Redpanda `connection_reference.state`; AQL keeps in-memory caches aligned via consumer + cold-load + control-plane cache-miss fallback. F12.25 legacy-agent migration endpoint provisions 30-day non-renewable legacy refs for upgrading existing installations (operator-invoked, idempotent). Deferred (not OSR blockers): Supervised oversight-hold sub-state, governance override (F12.14/F12.20), MAJOR-version suspension (F12.15), automatic expiration (F12.22), rest of F12.21 cascade triggers (product lifecycle, agent lifecycle, owner deactivation), per-reference scope filtering on the package (ADR-008 scope inheritance), agent self-discovery MCP tool (F12.8), visually-distinct legacy-ref UI.

**Gaps surfaced by the April 18 human walkthrough (PRD Domain 9) — all six closed:**

- ✅ Test/verification artifacts removed from seed (#44)
- ✅ Cross-org Request Access button hidden for owners (#43)
- ✅ Port contract schemas replaced with real JSON Schema definitions (#46)
- ✅ 5.4 P1 enrichment fields rendered in product detail UI (#47)
- ✅ Port display now surfaces connection details + endpoint URL + example client code (Domain 10 Workstream B, F10.5/F10.9)
- ✅ Lifecycle visibility — deprecated and decommissioned states surfaced in the marketplace (#45)

Internal dev deployment (not continuously reachable, EC2 shut down when not in active use): https://dev.provenancelogic.com

---

## Demo Environment

The demo environment is an on-demand clone provisioned per demo from git, with curated seed data. It is not a persistent staging tier. It spins up at T-24h before a demo and tears down after.

- Domain: https://demo.provenancelogic.com
- Keycloak: https://auth-demo.provenancelogic.com
- Terraform: `infrastructure/terraform/demo/`
- Seed package: `packages/seed/` (commands: `seed`, `seed:reset:soft`, `seed:reset:hard`, `seed:verify`)
- Demo scripts: `infrastructure/scripts/demo-*.sh` (bootstrap, sync, smoke-test, reset)
- Terraform state is local — back up `terraform.tfstate` after every apply

Always run `demo-smoke-test.sh` before a demo. Do not proceed if it exits non-zero.

For the full procedure see `documents/runbooks/demo-environment.md`.
For the decision rationale see `documents/architecture/adr/ADR-004-demo-environment-strategy.md`.

---

## Claude Code Patterns for This Project

**Always spec-first.** Define or update the OpenAPI spec in `packages/openapi/` before writing implementation code. Generate types from the spec.

**Always migration-first.** Write Flyway migration files as the authoritative schema definition before writing TypeORM entities.

**Always test-first.** Write failing tests before implementation. Test names describe behavior.

**Never hardcode configuration.** All configuration via environment variables. Use Zod for env validation at startup.

**A new env var must land in every config layer at once.** When adding a required env var to `apps/api/src/config.ts` (or any other service's Zod schema), in the same commit add it to: (a) `apps/api/src/test.env.ts` so jest boots; (b) all three `infrastructure/docker/docker-compose*.yml` files so every compose target boots; (c) `infrastructure/docker/.env.example` with documentation of what it does and how to generate a value. Missing any one of these silently breaks deployed environments the next time a stack is rebuilt (see R-010 in `documents/bugs/resolved.md`).

**Never import across module boundaries directly.** Cross-module calls use the exported TypeScript interface, not the implementation file.

**Always write an ADR for significant decisions.** Architecture Decision Records live in `documents/architecture/adr/`. Numbered, dated, with context, decision, and consequences.

**Never store raw credentials.** Connector credentials are stored as AWS Secrets Manager ARN references only.

**Audit log is append-only.** No UPDATE or DELETE permissions on the audit_log table at any level.

**Connector capability manifests are immutable per version.** Never mutate a capability manifest in place — create a new connector version.

**Discovery results never auto-override domain-declared metadata** unless governance has explicitly configured auto-override. Always check conflict resolution policy before merging discovered metadata.

**Autonomous trust classification can never be set by automated process.** Always require explicit human action by a governance role principal. Any code path that could programmatically assign Autonomous is a bug.

**Classification change audit entries require a non-null reason field.** Reject any classification change request where `reason` is null or empty string.

**Frozen operations require explicit governance disposition.** Never auto-complete or auto-cancel frozen operations — always require approve or cancel from a governance role principal.

**Agent authentication is JWT-based (ADR-002).** Agents authenticate via Keycloak `client_credentials` JWTs validated at the Agent Query Layer. The Phase 4 `X-Agent-Id` header pattern has been superseded. Do not use self-reported identity for any new features.

**`@AllowNoOrg` is reserved for bootstrap endpoints only.** The `JwtAuthGuard` enforces a non-empty `provenance_org_id` claim on every route. `@AllowNoOrg` waives that requirement — currently applied only to `POST /organizations/self-serve`, since a caller creating their first org by definition has no org yet. Do not apply `@AllowNoOrg` to any tenant-scoped data path.

**`@AllowCrossOrgRead` is reserved for marketplace-style cross-tenant reads.** The `JwtAuthGuard` enforces a same-org URL `:orgId === JWT orgId` check on every route (B-061 fix). `@AllowCrossOrgRead` waives that check while still requiring a valid JWT and a non-empty `provenance_org_id` claim — used on `GET` endpoints that legitimately expose product-level metadata to authenticated principals in any org (trust score, lineage, SLO summary, per-port snippet, access-request detail + events under B-071 Model A). Do not apply to mutations (`POST`/`PATCH`/`DELETE`), owner-only reads (raw credentials, audit history), or anything that hasn't been audited for cross-org leak shape. See `apps/api/src/auth/allow-cross-org-read.decorator.ts` and B-068 / B-071 in `documents/bugs/resolved.md` for the precedent.

**`@AllowCrossOrgWriteForApproval` is reserved for marketplace-approval writes.** Same shape as `@AllowCrossOrgRead` (waives the URL/JWT `:orgId` match) but on the write side and narrower. Used for endpoints where an owner in Org B mutates a request row that lives in the requester's (Org A's) namespace under [B-071 Model A](documents/bugs/resolved.md#B-071-cross-org-access-requests-structurally-broken-submitrequest-rejected-them-and-approverequest-could-not-find-them) — concretely, `approve` and `deny` on access requests today, and any future approval-shaped cross-org write (e.g., owner-initiated connection-reference activation). Always paired with: `@Roles('org_admin', 'domain_owner')` at the controller; a service-layer ownership check that confirms the caller's org owns the *product* the request targets (e.g., `assertCallerCanResolve` in `AccessService`); and an audit log entry on scope-violation attempts. The decorator only relaxes the URL/JWT check — the ownership second layer is non-negotiable. Do not apply to non-approval writes or anything where the caller's authority over the target resource isn't independently verifiable. See `apps/api/src/auth/allow-cross-org-write-for-approval.decorator.ts`.

**Every TypeORM repo call on a tenant-scoped entity must filter on `orgId` in its `where` clause.** ESLint rule `provenance/require-org-filter` enforces this at ERROR level — the next missing-orgId regression fails CI. Pattern-based detection of `findOne` / `find` / `count` / `update` / `delete` on `xxxRepo` shapes; magic-comment escape hatch `// @cross-tenant-by-design: <reason>` for legitimate cross-tenant lookups (slug uniqueness pre-creation, `ensurePrincipal` by globally-unique `keycloakSubject`, org-by-primary-key, capability-manifest platform metadata, etc.). Custom rule at `packages/eslint-plugin-provenance/`. See [ADR-010](documents/architecture/adr/ADR-010-rls-by-default.md) for the architectural framing and the service-org-filter audit at `documents/audits/service-org-filter-audit-2026-05-22.md` for the per-service classification.

**`RequireOrg` gates every authenticated frontend route.** `apps/web/src/auth/AuthProvider.tsx` exports `RequireOrg`, which reads `keycloak.tokenParsed.provenance_org_id` and redirects to `/onboarding/org` when empty (except for `/onboarding/*` paths). All authenticated routes inside `AppRouter` go through it. The JWT claim is the source of truth — never resolve "does this user have an org?" by calling a tenant-scoped API endpoint (the API will reject no-org callers before that call succeeds).

**Keycloak Admin API user updates must be GET-merge-PUT.** `PUT /admin/realms/{realm}/users/{id}` is a full-replace operation, not a merge. Sending only `{ attributes: {...} }` drops the other required fields (`email`, `username`, `firstName`, `lastName`) and trips user-profile validation with a 400. Always GET the current user, merge changes into the full representation, then PUT. See `KeycloakAdminService.updateUserAttributes` for the pattern.

**`SET LOCAL config_param = $1` is NOT parameterizable in PostgreSQL.** The `$1` placeholder is not expanded — the statement throws `syntax error at or near "$1"`. Use `SELECT set_config('param_name', $1, true)` instead; the `is_local=true` flag scopes the change to the current transaction exactly like `SET LOCAL`. Applies everywhere we propagate `provenance.current_org_id` for row-level security.

**Keycloak users are identified by email for login, by ID for admin APIs.** The realm has `registrationEmailAsUsername=true`, which causes Keycloak to rewrite a user's `username` field to match `email` on the next update after the setting is applied. Legacy username handles (e.g. `testuser`) stop resolving. In direct-grant token exchange, pass the email as `username`. In admin-API lookups, prefer `kcadm get users -q email=<addr>` over `-q username=<handle>` — it survives the rewrite.

**Every bug fix lands an entry in the bug tracker.** Open issues live in `documents/bugs/open.md`; resolved ones move to `documents/bugs/resolved.md` with the fix commit. Before opening a new bug, grep `resolved.md` — the same root cause may have been diagnosed before.

**Connection reference enforcement is an AND with access grants — never OR.** Every agent action requires both an active access grant AND an active connection reference. Never short-circuit one check because the other passed. The denial reason must distinguish five distinct codes per Decision 3 of the Domain 12 plan: `ACCESS_GRANT_NOT_FOUND`, `CONNECTION_REFERENCE_NOT_FOUND`, `CONNECTION_REFERENCE_SUSPENDED` ("wait, re-approval pending"), `CONNECTION_REFERENCE_EXPIRED` (umbrella for expired and revoked — both have the agent-developer action path of "submit fresh"), and `CONNECTION_REFERENCE_SCOPE_VIOLATION`. Plus `UNKNOWN_TOOL` as a safety belt — a newly added MCP tool not in `tool-scope-map.ts` denies by default.

**Connection reference scope violations are never silent.** Any action denied due to scope violation must write an audit log entry and fire a notification to the owning principal and governance team. Do not swallow scope violations.

**Connection reference state transitions are transactional with their audit log entries and outbox events.** All three (state update, audit log insert, outbox insert) land in the same PostgreSQL transaction. Never commit a state change without the corresponding audit entry. Never publish a Redpanda event without going through the outbox — direct publish without the outbox breaks at-least-once delivery guarantees.

**Legacy compatibility references are visually distinct and non-renewable.** The auto-provisioned 30-day legacy-compatibility references created at Domain 12 enforcement activation must be rendered differently in the UI from properly requested references. They may not be renewed — on expiry the agent must submit a proper connection reference request.

**A phase is not complete until every advertised capability has a user-visible surface.** "Backend endpoints respond correctly" is *API-complete*, not phase-complete. Before marking a build phase ✅ in the status board, walk each advertised capability and answer: where in the UI does a user see or interact with this? If the answer is "nowhere," the phase is API-complete, not done — track the two states distinctly. B-057 (the Phase 4 agent detail page) is the canonical miss: Phase 4 was ✅ for four-plus weeks while the agent detail surface didn't exist; backend endpoints had been live the entire time. The platform's claims become *theoretically true* — defensible in a code walkthrough, invisible in a UI walkthrough — until the surface ships.

**Adversarial review for consequential endpoints.** Any endpoint that mutates state, grants access, or makes a policy decision needs an explicit "what's the worst caller scenario?" pass before merging. The `@Roles(...)` decorator answers "is this caller allowed to act?" — it does not answer "is this caller allowed to act *on this specific resource?*" Federation claims (per-domain, per-product, per-tenant ownership) need a second check at the service layer where the resource identity is resolvable. Tests written from the success path will not catch this. See B-059 in `documents/bugs/resolved.md` for the canonical pattern: role guard at the controller + ownership check at the service, both required, single-layer authorization is silently incomplete.

**Persona walkthroughs are not demo walkthroughs.** A demo script is a curated path — it shows what's good. A persona walkthrough is open-ended: "you are Maya, marketing domain owner. You log in. What do you do?" Run one per persona (consumer, domain owner, governance member, agent operator) per build phase or significant release. The first kind catches obvious bugs; the second kind catches missing surfaces — primary workflows with no front door. B-055 (no standalone Pending Access Requests page existed until the 2026-05-17 rehearsal forced the question) is the canonical miss: every individual feature shipped, but no one had asked "where does the approver actually go?" Demo rehearsals partially substitute for this, but they walk the curated path; persona walkthroughs are deliberately uncurated.

---

## What to Build vs. What to Configure

**Build from scratch (this is our differentiation):**

* Governance policy UI (Policy Authoring Studio)
* Trust score computation algorithm
* Data product definition validation logic
* Port contract enforcement engine
* Semantic change declaration model
* Agent provenance envelope builder
* Provenance-specific MCP tools and prompts
* Federated query planner and executor
* Connector discovery engine (crawl orchestration, delta detection, conflict resolution)
* Capability manifest validation and enforcement
* Discovery coverage scoring per metadata category

**Configure from open source (do not reinvent):**

* OPA Rego policy evaluation
* Neo4j graph schema and Cypher queries
* Keycloak realm configuration and OIDC flows
* Temporal workflow definitions
* OpenSearch index mapping and query DSL
* Kong plugin configuration
* Redpanda topic configuration
* Docker Compose and Terraform infrastructure

---

## Performance Targets (Non-Functional Requirements)

| Operation | Target |
| --- | --- |
| Definition validation at publication | Under 2 seconds |
| Policy evaluation at publication | Under 3 seconds |
| Lineage emission p99 latency | Under 100ms |
| Lineage emission throughput | 10,000 events/sec per org |
| Lineage traversal (10 hops) | Under 5 seconds |
| Trust score recalculation | Within 10 minutes of material event |
| Observability metrics freshness | Within 5 minutes |
| Semantic index freshness | Within 5 minutes of product publish |
| Single-product agent query p95 | Under 2 seconds |
| 10-product federated agent query p95 | Under 10 seconds |
| MCP endpoint availability | 99.99% |
| Control plane availability | 99.99% |
| Discovery crawl completion (≤10k objects) | Within 30 minutes |
| Discovery coverage score availability | Within 60 seconds of crawl completion |

---

## Security Rules (Never Violate)

> **Reconciled 2026-05-22 against actual code.** Earlier wording on two rules (TLS termination layer + agent scope enforcement layer) described the Phase 6 production target rather than the MVP. The rules below describe what's actually in force today; the Phase 6 hardening targets are called out separately. Surfaced by `documents/audits/claim-vs-code-2026-05-22.md` (B-065, B-067).

* **Tenant isolation is enforced at the service layer via explicit `orgId = ctx.orgId` filtering on every query against a tenant-scoped table.** Per [ADR-010](documents/architecture/adr/ADR-010-rls-by-default.md), this is the **load-bearing** layer — not RLS. The B-061 controller-layer guard (`JwtAuthGuard` URL-vs-JWT `:orgId` match) is the second layer; RLS policies remain on every tenant-scoped table as a **Phase 6 backstop**, contingent on a per-request sticky-connection refactor that hasn't shipped yet. Every new service method that touches a tenant-scoped table MUST include `orgId` in its where clause; cross-tenant queries (marketplace, federation, platform admin) MUST be explicitly named and use a separate code path that does not inherit the request's `ctx.orgId`. **Enforcement is structural:** the custom ESLint rule `provenance/require-org-filter` fails CI at ERROR level on any missing-orgId repo call without a `// @cross-tenant-by-design: <reason>` magic-comment escape hatch. ADR-010 step 1 closed end-to-end as of 2026-05-22; remaining ADR-010 steps tracked in [`bugs/open.md`](documents/bugs/open.md#B-062) (URL-param convention CI check, cross-tenant smoke-test layer). The full B-062 RLS-by-default work (per-request sticky connection) is Phase 6 hardening.
* Credentials stored as ARN references only — never logged, never cached beyond connection lifetime
* Audit log is append-only — `REVOKE UPDATE, DELETE ON audit.audit_log` at the `provenance_app` role level (V4) plus `REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA audit FROM PUBLIC`. Not just convention.
* Agent access scope enforced by the AQL `ConnectionReferenceGuard` on every product-bound MCP tool call (`apps/agent-query/src/auth/connection-reference.guard.ts`). Application-level enforcement; the guard checks active grant AND active reference AND scope match, returning one of five distinct denial codes. **Infrastructure-level enforcement is a Phase 6 hardening item, not in force today** — there is no Kong plugin or network-policy layer enforcing scope.
* TLS 1.3 enforced **at Caddy on hosted deployments** (dev / demo / production EC2) with Let's Encrypt certs. Local dev runs HTTP-only on `localhost:*` ports. The compose file ships a Kong service but it does not sit on the user-traffic data path today; **Kong-as-gateway is the Phase 6 / production-EKS target**, not the MVP reality.
* All agent tokens carry `principal_type=agent` and `agent_id` claims validated on every request (`apps/agent-query/src/auth/auth.middleware.ts`)
* Discovery crawl credentials use the same secrets manager pattern as connector credentials — never stored raw

---

## Key Open Source Dependencies

```json
{
  "dependencies": {
    "@nestjs/core": "latest",
    "@nestjs/typeorm": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "neo4j-driver": "latest",
    "typeorm": "latest",
    "zod": "latest",
    "kafkajs": "latest",
    "@opensearch-project/opensearch": "latest",
    "keycloak-connect": "latest",
    "@temporalio/client": "latest",
    "@temporalio/worker": "latest",
    "@anthropic-ai/sdk": "latest"
  }
}
```

---

## Full Documentation

* Product Requirements Document: `documents/prd/Provenance_PRD_v1.5.md`
* Implementation Status (current gaps): `documents/prd/implementation-status.md`
* Architecture Document: `documents/architecture/Provenance_Architecture_v1.5.md`
* Architecture Decision Records: `documents/architecture/adr/` (ADR-001, ADR-002, ADR-003, ADR-004, ADR-005, ADR-006, ADR-007, ADR-008)
* API Reference: `documents/api/` (generated from OpenAPI specs)
* Operations Runbook: `documents/runbooks/operations.md`
* Demo Environment Runbook: `documents/runbooks/demo-environment.md`
* Open bugs: `documents/bugs/open.md`
* Resolved bugs (searchable log of past root causes): `documents/bugs/resolved.md`
