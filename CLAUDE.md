# Provenance — Claude Code Context

This file is read automatically by Claude Code at the start of every session.
It provides the essential context needed to work effectively on this codebase.
For full detail, read `documents/prd/Provenance_PRD_v1.5.md` and `documents/architecture/Provenance_Architecture_v1.5.md`.

> **In progress (2026-04-30):** Phase 5 (Open Source Ready) continues. **Domain 11 (Notifications) is fully shipped** — all 12 trigger-bundle PRs merged plus PR #6 (notification center frontend, merged as #42) and F11.17 trust-score-significant-change (#50). All 27 PRD trigger requirements wired or explicitly deferred (remaining deferrals: F11.14 subscription model, F11.15 schema-drift detection, F11.19 re-eval-on-publish, F11.22 classification post-publish mutability, F11.24/25/26 auto-suspension / human review queue / frozen-state machine). **F5.15 Lineage Visualization shipped (#55)** — React Flow + Dagre per ADR-003 replaces the previous Cytoscape implementation; deterministic LR DAG layout with custom node cards (name, type, trust score) and humanized edge labels. **Domain 10 Workstream B** mostly shipped (F10.5, F10.6, F10.7 partial, F10.8, F10.9, F10.10). Remaining additive: per-driver SQL probes, per-storage file probes, schema authoring F10.11–F10.13. **Domain 12 (Connection References and Per-Use-Case Consent)** — partial. Shipped: data primitives (V18/V19), state machine (`ConsentService` — request, approve, deny, principal-revoke, grant-revoke cascade), REST surface at `/organizations/:orgId/consent/connection-references`, connection package emission at activation per ADR-008, F12.10 notification fan-out (in Domain 11 PR #12). Remaining: runtime scope enforcement at Agent Query Layer (F12.16+, ADR-006), automatic expiration (F12.22), MAJOR-version suspension (F12.15), governance override (F12.14, F12.20), legacy-agent migration (F12.25), Supervised oversight-hold sub-state, rest of F12.21 cascade triggers (product lifecycle, owner deactivation), per-reference scope filtering on package (ADR-008 scope inheritance). **Phase 5.6 (Developer Experience) progressing** — B-009 OpenSearch BM25 fix (#52), in-product `/api/v1/docs` OpenAPI reference (#53), and a working seed CLI (#54) all shipped. Remaining: local-setup-time measurement and comprehensive seed-data richness (SLOs / access grants / sample notifications). **Phase 5.5 (Anomaly Detection) and 5.7 (SOC 2 Foundations)** remain. **Domain 9 walkthrough gaps from the April 18 review — all six closed.** See `documents/prd/implementation-status.md` for the authoritative per-feature status and the 6-item OSR blocker list (down from 10 at the start of this push).

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

| Schema | Key Tables | Notes |
| --- | --- | --- |
| organizations | orgs, domains, domain_extensions, governance_configs | org_id on all tables for tenant isolation |
| identity | principals, roles, role_assignments, agent_identities, agent_trust_classifications | Keycloak is auth source; PostgreSQL stores platform-specific metadata |
| products | data_products, product_versions, port_declarations, port_contracts, lifecycle_events | Versions are immutable records |
| connectors | connectors, connector_health_events, source_registrations, schema_snapshots, **capability_manifests, discovery_crawl_events, discovery_coverage_scores** | Credentials stored as Secrets Manager ARN only — never raw values |
| governance | policy_schemas, policy_versions, effective_policies, compliance_states, exceptions, grace_periods | Policy artifacts stored as JSONB |
| access | access_grants, access_requests, approval_events | Consumer-product access with expiration tracking |
| consent | connection_references, use_case_declarations, consent_records, connection_reference_outbox | org_id on every table for tenant isolation. Per-use-case consent layer composing with (not replacing) access grants. Outbox table drives Redpanda `connection_reference.state` publication for cache invalidation at the Agent Query Layer. See ADR-005 through ADR-008. |
| observability | slo_declarations, slo_evaluations, trust_score_history, observability_snapshots | Partitioned by org_id and time |
| audit | audit_log | Append-only. Never updated or deleted. Partitioned by month. |

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

**Priority connectors with discovery mode at MVP:**

| Connector | Discovery Sources | Lineage Granularity | Metadata Coverage |
| --- | --- | --- | --- |
| Databricks | Unity Catalog API | Column-level | High (where Unity Catalog adopted) |
| dbt | manifest.json + catalog.json | Column-level | High |
| Snowflake | Information Schema + Access History | Asset-level (column best-effort) | Medium |
| Fivetran | Metadata API | Asset-level (best-effort upstream) | Low-Medium |

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

**Domain 12 (Connection References and Per-Use-Case Consent)** is cross-cutting work rather than a build phase. Its requirements (F12.1–F12.25, NF12.1–NF12.8, PRD v1.5) and architecture (Architecture v1.5 Section 3, ADR-005 through ADR-008) are complete; it is implemented within Phase 5 as the last open OSR blocker, sequenced after Domain 11 Notifications and Domain 10 Workstream B. **Partial as of 2026-04-30** — data layer, service-layer state machine, REST surface, package-at-activation, and F12.10 notification fan-out (in Domain 11 PR #12) have all landed; runtime enforcement at the Agent Query Layer and the rest of the cascade-trigger work remain.

**Active phase: 5 (Open Source Ready).** Phases 1–4 complete as of April 13, 2026. Phase 5 progress as of April 30, 2026 (see `documents/prd/implementation-status.md` for the authoritative 6-item Open Source Readiness blocker list — down from 10 at the start of the April 30 push):

- ✅ **5.1 — Stability and Reliability** complete
- ✅ **5.2 — Security Essentials** complete as of April 18, 2026: HTTPS live at https://dev.provenancelogic.com and https://auth.provenancelogic.com (Caddy + Let's Encrypt); Keycloak domain wiring done (KC_HOSTNAME, KC_PROXY=edge, realm frontendUrl, client redirectUris/webOrigins, unmanagedAttributePolicy); NestJS API issuer validation fixed; `provenance_*` protocol mappers on the `provenance-web` client populate `provenance_principal_id`/`provenance_org_id`/`provenance_principal_type` claims; full browser login flow working end-to-end. Security group audit and MCP API key rotation previously completed.
- ✅ **5.3 — JWT Agent Authentication** (ADR-002) complete as of April 16, 2026
- ✅ **5.4 — Data Product Completeness P1** complete
- ✅ **F5.15 — Lineage Visualization** complete as of April 30, 2026 (PR #55). React Flow + Dagre per ADR-003 replaces the Cytoscape implementation. Deterministic LR DAG layout, custom node cards, humanized edge labels, built-in pan/zoom/minimap. Read-only graph (`nodesDraggable=false`). ADR-003 follow-ups (expand/collapse, PNG/SVG export, F5.17 time-travel) remain.
- 🔄 **Domain 10 Workstream B — Port connection details and connection packages** — mostly shipped (last verified 2026-04-25). F10.5 (per-interface-type schemas + frontend dynamic fields), F10.6 (encryption + access-gated disclosure, end-to-end verified), F10.8 (ConnectionPackageService), F10.9 (agent integration guide), F10.10 (refresh on connection-detail edit, end-to-end verified), and F10.7 (real probes for REST/GraphQL/Kafka, typed `unsupported` response for SQL/JDBC and file_object_export, frontend `ProbeStatusBadge`) all implemented and deployed. Remaining: per-driver SQL probes (postgres/mysql/snowflake), per-storage file probes (s3/gcs/adls), schema authoring items F10.11–F10.13. See `documents/prd/implementation-status.md` for per-requirement status.
- 🔲 **5.5 — Agent Anomaly Detection** — not started
- 🔄 **5.6 — Developer Experience** — partial. Shipped: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, README; B-009 OpenSearch BM25 reliability fix (#52, synchronous double-write + `pnpm reindex:search`); in-product `/api/v1/docs` OpenAPI reference (#53); working `pnpm --filter @provenance/seed seed` CLI (#54, eight idempotent seed endpoints behind `SEED_ENABLED` + service-token guard). Remaining: local-setup-time measurement (clone → working stack on a fresh machine), comprehensive seed-data richness (SLO declarations / access grants / sample notifications), lineage emit idempotency on re-seed.
- 🔲 **5.7 — SOC 2 Foundations** — not started
- 🔄 **Domain 12 — Connection References and Per-Use-Case Consent** — partial as of 2026-04-30. Shipped: V18/V19 schema (`consent.connection_references` + outbox + connection package column), `ConsentService` state machine (request / approve / deny / principal-revoke / grant-revoke cascade), REST controller at `/organizations/{orgId}/consent/connection-references` with OpenAPI spec, connection package emission at activation (ADR-008), F12.10 notification fan-out (in Domain 11 PR #12). Remaining: Supervised oversight-hold sub-state, governance override (F12.14, F12.20), MAJOR-version suspension (F12.15), runtime scope enforcement at Agent Query Layer (F12.16+, ADR-006), automatic expiration (F12.22), legacy-agent migration (F12.25), rest of the F12.21 cascade triggers (product lifecycle, owner deactivation), per-reference scope filtering on the package (ADR-008 scope inheritance).

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

**`RequireOrg` gates every authenticated frontend route.** `apps/web/src/auth/AuthProvider.tsx` exports `RequireOrg`, which reads `keycloak.tokenParsed.provenance_org_id` and redirects to `/onboarding/org` when empty (except for `/onboarding/*` paths). All authenticated routes inside `AppRouter` go through it. The JWT claim is the source of truth — never resolve "does this user have an org?" by calling a tenant-scoped API endpoint (the API will reject no-org callers before that call succeeds).

**Keycloak Admin API user updates must be GET-merge-PUT.** `PUT /admin/realms/{realm}/users/{id}` is a full-replace operation, not a merge. Sending only `{ attributes: {...} }` drops the other required fields (`email`, `username`, `firstName`, `lastName`) and trips user-profile validation with a 400. Always GET the current user, merge changes into the full representation, then PUT. See `KeycloakAdminService.updateUserAttributes` for the pattern.

**`SET LOCAL config_param = $1` is NOT parameterizable in PostgreSQL.** The `$1` placeholder is not expanded — the statement throws `syntax error at or near "$1"`. Use `SELECT set_config('param_name', $1, true)` instead; the `is_local=true` flag scopes the change to the current transaction exactly like `SET LOCAL`. Applies everywhere we propagate `provenance.current_org_id` for row-level security.

**Keycloak users are identified by email for login, by ID for admin APIs.** The realm has `registrationEmailAsUsername=true`, which causes Keycloak to rewrite a user's `username` field to match `email` on the next update after the setting is applied. Legacy username handles (e.g. `testuser`) stop resolving. In direct-grant token exchange, pass the email as `username`. In admin-API lookups, prefer `kcadm get users -q email=<addr>` over `-q username=<handle>` — it survives the rewrite.

**Every bug fix lands an entry in the bug tracker.** Open issues live in `documents/bugs/open.md`; resolved ones move to `documents/bugs/resolved.md` with the fix commit. Before opening a new bug, grep `resolved.md` — the same root cause may have been diagnosed before.

**Connection reference enforcement is an AND with access grants — never OR.** Every agent action requires both an active access grant AND an active connection reference. Never short-circuit one check because the other passed. The denial reason must distinguish: no grant, no active reference, reference scope violation, reference expired — these are four distinct error codes, not a generic "unauthorized."

**Connection reference scope violations are never silent.** Any action denied due to scope violation must write an audit log entry and fire a notification to the owning principal and governance team. Do not swallow scope violations.

**Connection reference state transitions are transactional with their audit log entries and outbox events.** All three (state update, audit log insert, outbox insert) land in the same PostgreSQL transaction. Never commit a state change without the corresponding audit entry. Never publish a Redpanda event without going through the outbox — direct publish without the outbox breaks at-least-once delivery guarantees.

**Legacy compatibility references are visually distinct and non-renewable.** The auto-provisioned 30-day legacy-compatibility references created at Domain 12 enforcement activation must be rendered differently in the UI from properly requested references. They may not be renewed — on expiry the agent must submit a proper connection reference request.

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

* `org_id` on every PostgreSQL table with row-level security enforced at database level
* Credentials stored as ARN references only — never logged, never cached beyond connection lifetime
* Audit log is append-only — no UPDATE or DELETE at any level
* Agent access scope enforced at infrastructure level, not application policy check only
* TLS 1.3 enforced at Kong for all external traffic
* All agent tokens carry `principal_type=agent` and `agent_id` claims validated on every request
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
