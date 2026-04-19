# Provenance — Claude Code Context

This file is read automatically by Claude Code at the start of every session.
It provides the essential context needed to work effectively on this codebase.
For full detail, read `documents/prd/Provenance_PRD_v1.4.md` and `documents/architecture/Provenance_Architecture_v1.4.md`.

> **Development resumed (2026-04-19):** The halt in effect since 2026-04-18 was lifted after PRD v1.4 review completed. Feature work is active again — the in-progress workstream is Domain 10 Workstream B (port connection details, connection packages; F10.5–F10.10).

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

**Active phase: 5 (Open Source Ready).** Phases 1–4 complete as of April 13, 2026. Phase 5 progress as of April 18, 2026:

- ✅ **5.1 — Stability and Reliability** complete
- ✅ **5.2 — Security Essentials** complete as of April 18, 2026: HTTPS live at https://dev.provenancelogic.com and https://auth.provenancelogic.com (Caddy + Let's Encrypt); Keycloak domain wiring done (KC_HOSTNAME, KC_PROXY=edge, realm frontendUrl, client redirectUris/webOrigins, unmanagedAttributePolicy); NestJS API issuer validation fixed; `provenance_*` protocol mappers on the `provenance-web` client populate `provenance_principal_id`/`provenance_org_id`/`provenance_principal_type` claims; full browser login flow working end-to-end. Security group audit and MCP API key rotation previously completed.
- ✅ **5.3 — JWT Agent Authentication** (ADR-002) complete as of April 16, 2026
- ✅ **5.4 — Data Product Completeness P1** complete
- 🔲 **5.5 — Agent Anomaly Detection** — not started
- 🔲 **5.6 — Developer Experience** — partial (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, README landed; local setup time, OpenAPI docs publication, comprehensive seed data pending)
- 🔲 **5.7 — SOC 2 Foundations** — not started

**Gaps surfaced by the April 18 human walkthrough (tracked in PRD Domain 9):**

- Test/verification artifacts (e.g. "Phase 4b Verification Product", "A5 Index Freshness Test") visible in the marketplace alongside real seed data
- Access request button shown to all principals regardless of ownership — no hide-if-owner logic
- Port contract schemas on seed products are placeholder JSON, not real
- 5.4 P1 enrichment fields (column schema, ownership, freshness, access status) returned by `get_product` but not yet rendered in the product detail UI
- Port display lacks a "How to use this" section — no visible connection details, endpoint URL, or example client code
- Lifecycle enforcement gaps around deprecation/decommission visibility in marketplace

Live development environment: https://dev.provenancelogic.com

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

* Product Requirements Document: `documents/prd/Provenance_PRD_v1.4.md`
* Implementation Status (current gaps and halt rationale): `documents/prd/implementation-status.md`
* Architecture Document: `documents/architecture/Provenance_Architecture_v1.4.md`
* Architecture Decision Records: `documents/architecture/adr/` (ADR-001, ADR-002, ADR-003)
* API Reference: `documents/api/` (generated from OpenAPI specs)
* Operations Runbook: `documents/runbooks/operations.md`
* Open bugs: `documents/bugs/open.md`
* Resolved bugs (searchable log of past root causes): `documents/bugs/resolved.md`
