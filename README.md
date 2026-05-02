# Provenance

**The Data 3.0 Self-Service Data Mesh Platform**

Provenance is an open-source, cloud-native platform that makes data mesh real — not as a philosophy, but as working software. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![PRD](https://img.shields.io/badge/docs-PRD%20v1.5-teal.svg)](./documents/prd)
[![Architecture](https://img.shields.io/badge/docs-Architecture%20v1.5-teal.svg)](./documents/architecture)
[![Status](https://img.shields.io/badge/status-Phase%205%20active-green.svg)]()

---

## What Is Provenance?

Provenance is a **coordination and contract platform** for organizational data. It does not store your data, run your pipelines, or replace your data warehouse. It does something more fundamental: it makes data trustworthy enough to depend on — for humans and AI agents alike.

Built on the data mesh principles articulated by [Zhamak Dehghani](https://www.oreilly.com/library/view/data-mesh/9781492092384/) and extended for the agentic AI era, Provenance gives every domain team the infrastructure to publish data as a product, every consumer the confidence to know what they are depending on, and every governance team the computational tools to enforce policy without becoming a bottleneck.

> *"A dataset without a contract is not a data product. Provenance makes the contract real."*

---

## Why Provenance?

Most organizations attempting data mesh hit the same wall: the philosophy is clear, the tooling is not. Existing data catalogs rebrand as "data mesh platforms." Data warehouses add lineage features. None of them implement the actual principles.

Provenance is different in four ways:

**1. Data products are first-class entities, not catalog entries.**
A Provenance data product has an owner, a contract, a lifecycle, ports, SLOs, lineage, and a governance compliance state. It is not a metadata record — it is a governed, versioned, observable artifact with real enforcement behind it.

**2. Governance is computational, not a process.**
The federated governance team configures policy through a declarative UI. Provenance enforces it automatically at publication time and continuously thereafter. No tickets. No approval queues. No governance bottleneck.

**3. AI agents are first-class participants.**
Provenance exposes the data mesh as a semantic, policy-aware query surface for AI agents via a fully compliant [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server. Agents discover data products, query across them, and produce new ones — all under the same governance model as human consumers.

**4. The data stays where it lives.**
Provenance holds metadata, contracts, lineage, and governance records. Your data never transits the platform. Domain teams own their infrastructure. Provenance owns the contracts between them.

---

## Architecture Overview

> **Current infrastructure is a pre-revenue development environment, not the target production state.** Provenance is currently deployed as a NestJS modular monolith and React frontend running on two EC2 instances via Docker Compose. This setup is deliberately lean — it is the MVP build, not the shape the platform will take at scale. The target production architecture (Kubernetes on EKS, managed AWS services, SOC 2 hardening) is scoped as Phase 6 and is documented in [documents/architecture/Provenance_Architecture_v1.5.md](./documents/architecture/Provenance_Architecture_v1.5.md). Phase 6 is planned but not funded and will be triggered by enterprise customer engagement or funding, not by a calendar date.

The control plane (metadata, contracts, governance) is architecturally separated from the data plane (domain infrastructure) from day one, and that boundary holds in both the current MVP and the target production architecture.

```
                    ┌─────────────────────────────────────┐
                    │           React Frontend             │
                    │   (Marketplace, Governance Studio,   │
                    │    Lineage Explorer, Dashboards)     │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │        NestJS API (Monolith)         │
                    │  ┌─────────┬──────────┬───────────┐ │
                    │  │  Orgs   │ Products │Governance │ │
                    │  │  Domains│ Lifecycle│ OPA Engine│ │
                    │  ├─────────┼──────────┼───────────┤ │
                    │  │ Lineage │  Access  │Observabil.│ │
                    │  │  Graph  │ Control  │Trust Score│ │
                    │  └─────────┴──────────┴───────────┘ │
                    └───┬──────────┬──────────┬───────────┘
                        │          │          │
              ┌─────────▼┐  ┌─────▼─────┐ ┌──▼──────────┐
              │PostgreSQL │  │   Neo4j   │ │     OPA     │
              │  (state)  │  │ (lineage) │ │  (policy)   │
              └───────────┘  └───────────┘ └─────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────▼────┐  ┌──────▼───┐  ┌──────▼────┐
    │Keycloak │  │ Redpanda │  │OpenSearch │
    │(identity)│  │(streaming)│  │ (search) │
    └─────────┘  └──────────┘  └───────────┘
```

---

## Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Backend API | TypeScript / NestJS | Modular monolith with domain-driven modules |
| Frontend | TypeScript / React + TailwindCSS | Single app, persona-adaptive UI |
| Graph Database | Neo4j Community | Lineage graph with arbitrary-depth traversal |
| Relational Database | PostgreSQL 16 | Control plane state, multi-tenant with RLS |
| Message Broker | Redpanda (Kafka-compatible) | Lineage and observability event streaming |
| Policy Engine | Open Policy Agent (OPA) | Hot-reloadable governance policy enforcement |
| Search | OpenSearch | Product discovery and semantic vector search |
| Identity | Keycloak | OIDC authentication and authorization |
| API Gateway | Kong OSS | External traffic routing and TLS termination |
| Visualization | React Flow + Dagre | Interactive lineage graph explorer with deterministic DAG layout (see ADR-003) |

---

## Project Status

Provenance is in active development. Phases 1–4 are complete; **Phase 5 (Open Source Ready) is active.** As of 2026-04-30, Domain 10 Workstream A (self-serve registration), Domain 10 Workstream B (port connection details and connection packages, mostly shipped), **Domain 11 (Notifications, fully shipped — in-platform, email, and webhook channels with all 27 trigger requirements wired or explicitly deferred)**, and **F5.15 Lineage Visualization (React Flow + Dagre per ADR-003)** are live. Domain 12 (Connection References and Per-Use-Case Consent) is partial — data layer, state machine, REST surface, and connection package emission shipped; runtime scope enforcement at the Agent Query Layer remains. Phase 5.6 (developer experience) is partial — OpenSearch BM25 reliability, in-product `/api/v1/docs` OpenAPI reference, and a working `pnpm seed` CLI all shipped; local-setup-time measurement and comprehensive seed-data richness remain. Phase 5.5 (anomaly detection) and 5.7 (SOC 2 foundations) remain. The Open Source Readiness blocker count is down from 10 to 6. See [implementation-status.md](./documents/prd/implementation-status.md) for the authoritative per-feature status.

**Development environment:** An internal development deployment is served via Caddy with automatic HTTPS at a `*.provenancelogic.com` hostname for hands-on work by the core team. It is not a persistent public endpoint — the underlying EC2 instance is shut down most of the time, so the URL is not suitable for inclusion in user-facing documentation, blog posts, or link-outs, and no uptime is implied. To try Provenance, follow the [Getting Started](#getting-started) steps below to run the stack locally via Docker Compose. A reproducible demo environment (provisioned per demo from git with curated seed data) is documented in [documents/runbooks/demo-environment.md](./documents/runbooks/demo-environment.md).

| Phase | Scope | Status |
|---|---|---|
| **Phase 1 — Foundation** | Organization model, domain management, data product authoring, identity (Keycloak) | ✅ Complete |
| **Phase 2 — Governance & Publishing** | OPA governance engine, marketplace, access control, Policy Authoring Studio, Compliance Monitor | ✅ Complete |
| **Phase 3 — Lineage & Observability** | Lineage graph (Neo4j), emission API, TypeScript SDK, SLOs, trust score engine, Lineage Explorer UI, Observability Dashboard | ✅ Complete |
| **Phase 4 — Agent Integration** | MCP server (9 tools, SSE), agent query layer, agent identity, semantic search, trust classification | ✅ Complete |
| **Phase 5 — Open Source Ready** | JWT agent auth, stability, security essentials, data product completeness, Domain 10 self-serve infrastructure, Domain 11 notifications, Domain 12 connection references, developer experience, lineage visualization | 🔄 Active — 5.1–5.4 complete; Domain 10 Workstreams A & B mostly complete; Domain 11 complete; F5.15 lineage viz complete; 5.6 partial (B-009 search fix, /api/v1/docs, working seed CLI shipped); Domain 12 partial; 5.5 / 5.7 remaining |
| **Phase 6 — Production Scale** | Kubernetes, managed AWS services, security hardening, SOC 2 Type II audit | 🔲 When Funded |

### What's Live Today

**Platform Foundation**
- Multi-tenant organization and domain management
- Data product authoring with full lifecycle (Draft, Published, Deprecated, Decommissioned)
- Keycloak-based authentication with OIDC
- Full infrastructure stack deployed on EC2 via Docker Compose

**Governance Engine**
- OPA-backed policy enforcement with hot-reloadable Rego policies
- Policy Authoring Studio with 8 independently configurable policy domains
- Governance Command Center dashboard with real-time compliance overview
- Compliance Monitor with drift detection and exception management
- Four compliance states: Compliant, Drift Detected, Grace Period, Non-Compliant

**Data Product Marketplace**
- Product discovery with filtering and search
- Product detail pages with full tab navigation (schema, lineage, SLOs, access)
- Access request workflow with approval tracking

**Lineage & Observability**
- Neo4j lineage graph with emission API and async Redpanda pipeline
- TypeScript SDK for lineage emission from external pipelines
- SLO declarations and evaluation engine
- Trust score engine with 5-component weighted formula (governance compliance, SLO pass rate, lineage completeness, usage activity, exception history)
- Trust score panel on product detail page with score badge, sparkline trend, component breakdown, and recompute
- Interactive Lineage Explorer UI built on React Flow with Dagre layout (deterministic left-to-right DAG; see [ADR-003](./documents/architecture/adr/ADR-003-lineage-visualization-react-flow.md))
- Observability Dashboard with SLO declarations, evaluation history, health summary, and inline SLO creation

**Agent Integration (Phase 4 + Phase 5 Auth)**
- MCP server (SSE transport, port 3002) with 9 tools: list_products, get_product, get_trust_score, get_lineage, get_slo_summary, search_products, semantic_search, register_agent, get_agent_status
- Semantic search with hybrid kNN + BM25 scoring via OpenSearch
- NL query translation via Claude API with graceful fallback
- Agent identity model with three trust tiers (Observed, Supervised, Autonomous) and governance-controlled transitions
- JWT-based agent authentication via Keycloak `client_credentials` grant (ADR-002) — agents receive dedicated Keycloak clients at registration, JWTs validated on every MCP request
- Complete audit trail of all agent activity with verified identity context

**Self-Serve Infrastructure (Domain 10 — Phase 5)**
- **Workstream A — complete:** self-serve user registration via Keycloak signup, first-org creation (`POST /organizations/self-serve` binds the registering user as the first platform admin and seeds the default governance layer), invitation flow with time-limited acceptance links, and the email service backing both onboarding and invitations. With the stack running locally (see [Getting Started](#getting-started)) a new user can sign up, create their org, and be authoring products in under 30 minutes with no platform operator involvement.
- **Workstream B — mostly shipped (2026-04-28):** every output port carries an encrypted-at-rest connection-details payload keyed by interface type (SQL/JDBC, REST, GraphQL, Kafka, file export). Disclosure is gated by active access grant — owners and grantees see the full payload, authenticated non-grantees see a host/endpoint preview, and unauthenticated callers see nothing. Every access grant emits a ready-to-use connection package (JDBC URLs, curl + Postman, Python snippets, data dictionaries, MCP agent integration guide). Connection packages auto-refresh when port details are edited. Connectivity validation runs real probes for REST, GraphQL, and Kafka with a typed `unsupported` response for SQL/JDBC and file export pending per-driver/per-storage probes. Schema authoring items (F10.11–F10.13) remain open.

**Notifications (Domain 11 — Phase 5)**
- **All 27 PRD trigger requirements wired or explicitly deferred** (deferrals tied to features that don't yet exist — subscription model, schema-drift detection, classification post-publish mutability, agent auto-suspension, human review queue, frozen-state machine).
- **Three delivery channels live:** in-platform inbox (the row itself), email (platform-wide `EmailService`, dev stack uses Mailhog), webhook (https-only, 10s timeout, stable `NotificationWebhookPayload` envelope). One outbox + cron worker drains all out-of-band channels with retries on a 1m / 5m / 25m schedule.
- **Per-(principal, category) preferences** with `enabled` opt-in/out and `channels[]` override; governance-mandatory categories keep the in-platform channel even when a user opts out.
- **Notification center frontend:** bell icon with unread badge in the sidebar, popover drawer with read/dismiss controls and deep links, full inbox at `/notifications` with category and read-state filters, per-category preferences page at `/notifications/preferences`. Polls every 30s to match the worker drain cadence.
- **Architecture decisions** captured in [ADR-009](./documents/architecture/adr/ADR-009-notification-architecture.md).

**Connection References and Per-Use-Case Consent (Domain 12 — partial)**
- New in PRD v1.5. Introduces universal per-use-case consent and runtime scope enforcement for all agent access. Connection references compose with (do not replace) access grants — both must be active for any agent action against any product.
- **Shipped:** data layer (V18/V19), state machine (`ConsentService` — request, approve, deny, principal-revoke, grant-revoke cascade), REST surface at `/organizations/:orgId/consent/connection-references`, and connection package emission at activation per [ADR-008](./documents/architecture/adr/ADR-008-connection-reference-and-package-relationship.md).
- **Remaining:** runtime scope enforcement at the Agent Query Layer (the in-memory cache + Redpanda consumer per [ADR-006](./documents/architecture/adr/ADR-006-runtime-scope-enforcement.md)), automatic expiration, MAJOR-version suspension, governance override, legacy-agent migration, and the rest of the cascade triggers. See [implementation-status.md](./documents/prd/implementation-status.md) for per-requirement status.

---

## Monorepo Structure

```
provenance/
├── apps/
│   ├── api/                  # NestJS modular monolith
│   │   └── src/
│   │       ├── organizations/    # Org and domain management
│   │       ├── products/         # Data product lifecycle
│   │       ├── governance/       # OPA policy engine integration
│   │       ├── lineage/          # Neo4j lineage graph service
│   │       ├── observability/    # SLOs, trust score computation
│   │       ├── access/           # Access grants and requests
│   │       ├── consent/          # Connection references and per-use-case consent (Domain 12)
│   │       ├── notifications/    # In-platform, email, and webhook delivery (Domain 11)
│   │       ├── agents/           # Agent identity and trust classification
│   │       ├── search/           # OpenSearch integration
│   │       └── trust-score/      # Trust score computation engine
│   ├── agent-query/          # MCP server and agent query layer
│   ├── embedding/            # Sentence-transformer embedding service
│   └── web/                  # React frontend
│       └── src/
│           └── features/
│               ├── governance/       # Policy Studio, Command Center, Compliance Monitor
│               ├── publishing/       # Product authoring, domain dashboard
│               ├── discovery/        # Marketplace, product detail
│               ├── lineage/          # Lineage Explorer (React Flow + Dagre)
│               ├── observability/    # SLO dashboard and evaluation history
│               ├── notifications/    # Notification bell, drawer, inbox, preferences
│               └── trust-score/      # Trust score panel and breakdown
├── packages/
│   ├── types/                # Shared TypeScript types
│   ├── openapi/              # OpenAPI specifications
│   └── sdk-ts/               # TypeScript lineage emission SDK
├── infrastructure/
│   ├── docker/               # Docker Compose (MVP deployment)
│   └── terraform/            # AWS EC2 provisioning
├── documents/
│   ├── prd/                  # Product Requirements Document
│   └── architecture/         # Architecture document and ADRs
├── CLAUDE.md
└── README.md
```

---

## Getting Started

### Prerequisites

- Docker and Docker Compose v2
- Node.js 20+ and pnpm
- Git

### Hardware Requirements

Provenance is a coordination platform with a multi-service stack (Postgres, Neo4j, OpenSearch, Keycloak, Redpanda, Temporal, an embedding service, and three application processes). Local resource needs land in the same range as DataHub or OpenMetadata.

| Profile | RAM floor | Disk | What you can run | Use it when |
| --- | --- | --- | --- | --- |
| **Lite** (`docker-compose.dev.yml`) | 8 GB | ~10 GB free | Postgres + Keycloak + OPA + API + web. Lineage, search, semantic queries, agent integration, access workflows, and notifications are explicitly disabled. | You want to sign up, click around, and see the UI. Good for a 30-minute first impression. |
| **Full** (`docker-compose.ec2-dev.yml`) | 16 GB | ~30 GB free | Everything: lineage graph, search, semantic queries, agent MCP layer, access approval workflows, notifications, HTTPS via Caddy. | You want to actually evaluate Provenance or contribute to it. The recommended development configuration. |

**32 GB+** is comfortable when you're running the stack alongside an IDE, a browser with several tabs, and the test suite at the same time.

8 GB machines (older MacBook Airs, base-model laptops) can run the lite profile and edit code, but should not attempt the full stack — the JVM-based services (OpenSearch, Keycloak, Neo4j) thrash heavily under that ceiling.

Architecture is x86_64 or ARM64 (Apple Silicon, modern Linux). The Compose stack runs on macOS, Linux, and Windows with WSL2.

### Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/provenance-logic/provenance.git
   cd provenance
   ```

2. **Start the infrastructure stack:**

   For the **full stack** (recommended, requires 16 GB RAM):
   ```bash
   cd infrastructure/docker
   docker compose up -d
   ```
   Starts PostgreSQL, Neo4j, Redpanda, OpenSearch, OPA, Keycloak, Temporal, the embedding service, and Kong.

   For the **lite stack** (8 GB laptops, basic UI exploration only):
   ```bash
   cd infrastructure/docker
   docker compose -f docker-compose.dev.yml up -d
   ```
   Starts only Postgres + Keycloak + OPA + API + web. Lineage, search, agent features, access workflows, and notifications are disabled.

3. **Install dependencies and start the API:**
   ```bash
   cd apps/api
   npm install
   npm run start:dev
   ```

4. **Start the frontend:**
   ```bash
   cd apps/web
   npm install
   npm run dev
   ```

5. **Access the application:**
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3001`
   - **API reference (rendered OpenAPI):** `http://localhost:3001/api/v1/docs`
   - Keycloak admin: `http://localhost:8080`
   - Neo4j browser: `http://localhost:7474`

6. **(Optional) Seed sample data:**
   ```bash
   API_BASE_URL=http://localhost:3001 \
   SEED_API_KEY=dev-seed-token-change-me \
   DATABASE_URL=postgres://provenance:provenance_dev_password@localhost:5432/provenance \
   KEYCLOAK_URL=http://localhost:8080 \
   KEYCLOAK_REALM=provenance \
   KEYCLOAK_ADMIN_CLIENT_ID=provenance-admin \
   KEYCLOAK_ADMIN_CLIENT_SECRET=provenance-admin-dev-secret \
   pnpm --filter @provenance/seed seed
   ```
   Populates two example orgs (Acme Corp, Beta Industries) with domains, principals, policies, products, agents, and lineage. Idempotent — safe to re-run. Login as `admin@acme.example.com` (password `DemoPass123!`) to explore.

### EC2 Deployment

For EC2 deployment, see the environment-specific compose files and start scripts in `infrastructure/docker/`. The Terraform configuration in `infrastructure/terraform/` provisions the required AWS resources.

---

## Core Concepts

| Concept | What It Means in Provenance |
|---|---|
| **Domain** | A bounded business context with a team that owns its data. Domains are the unit of ownership. |
| **Data Product** | A dataset published as a product with an explicit contract, SLOs, schema, lineage, and governance compliance. |
| **Port** | The typed interface of a data product — input, output, discovery, observability, and control ports. |
| **Governance Floor** | The minimum policy set defined by the federated governance team. Every domain must meet the floor. Domains may extend it. Nobody may weaken it. |
| **Trust Score** | A composite signal computed from lineage completeness, SLO compliance, governance compliance, schema conformance, and freshness consistency. |
| **Compliance State** | One of four states — Compliant, Drift Detected, Grace Period, Non-Compliant — continuously evaluated by the OPA governance engine. |

---

## Design Philosophy

**The right thing is the easy thing.**
For every persona — domain teams, consumers, governance teams, AI agents — the compliant, correct path through Provenance is the path of least resistance. If governance policy requires effort to comply with, the platform has failed, not the user.

**Governance is computation, not process.**
Policy rules configured through the declarative UI are compiled to machine-enforceable Rego artifacts and evaluated automatically. No approval queues. No human checkpoints. Compliance is automatic for compliant products. Non-compliance is visible, specific, and remediable.

**Agents are participants, not consumers.**
AI agents in Provenance are first-class principals with their own identity model, governance tier, query interface, and production capability. Provenance is designed for a world where AI agents are as natural a participant in organizational data as human analysts.

---

## Documentation

| Document | Description |
|---|---|
| [Product Requirements Document](./documents/prd/Provenance_PRD_v1.5.md) | Complete requirements across all twelve platform domains |
| [Implementation Status](./documents/prd/implementation-status.md) | Per-requirement implementation status vs. PRD v1.5 and remaining Open Source Readiness blockers |
| [Architecture Document](./documents/architecture/Provenance_Architecture_v1.5.md) | MVP and production architecture, technology decisions, build sequence |
| [Architecture Decision Records](./documents/architecture/adr/) | Nine ADRs covering MVP and JWT agent authentication, lineage visualization, demo strategy, connection reference composition / runtime scope enforcement / state propagation / package relationship, and notification architecture |
| [OpenAPI Specifications](./packages/openapi/) | OpenAPI 3.1 specs (source of truth) for all platform APIs — also rendered live by the API at `/api/v1/docs` once the stack is running |
| [TypeScript Lineage SDK](./packages/sdk-ts/) | TypeScript SDK for pipeline lineage emission |

---

## Contributing

Provenance is Apache 2.0 licensed and welcomes contributions. Before contributing, please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution guidelines and development setup
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — community standards
- [Architecture Document](./documents/architecture/Provenance_Architecture_v1.5.md) — understand the system before contributing

High-value contributions at this stage:
- Additional connector implementations
- SDK implementations for Python, Java, and Scala (lineage emission)
- Review and feedback on the PRD and architecture documents (open an issue)
- Domain expertise in data mesh, federated governance, or agentic AI systems

---

## Relationship to Data Mesh

Provenance is a technical implementation of the data mesh principles described by Zhamak Dehghani in [*Data Mesh: Delivering Data-Driven Value at Scale*](https://www.oreilly.com/library/view/data-mesh/9781492092384/) (O'Reilly, 2022). It implements all four principles:

- **Domain ownership** — domains are first-class entities; every data product has an owner
- **Data as a product** — the port model, SLOs, versioning, and trust score make product thinking operational
- **Self-serve data infrastructure** — the platform enables domain teams to publish without central team involvement
- **Federated computational governance** — the governance engine enforces policy automatically; the floor/extension model implements true federation

Provenance extends the framework in one significant direction: **AI agents as first-class mesh participants**. We believe this extension is consistent with the framework's intent and necessary for the Data 3.0 era.

---

## License

Provenance is licensed under the [Apache License 2.0](./LICENSE).

---

## Acknowledgments

Provenance is built on the intellectual foundation laid by Zhamak Dehghani's data mesh framework and the open-source projects listed in the architecture document. We are grateful to the communities behind Neo4j, Open Policy Agent, Keycloak, Temporal, the Model Context Protocol, and the many other projects that make Provenance possible.
