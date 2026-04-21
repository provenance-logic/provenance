# Provenance

**The Data 3.0 Self-Service Data Mesh Platform**

Provenance is an open-source, cloud-native platform that makes data mesh real — not as a philosophy, but as working software. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![PRD](https://img.shields.io/badge/docs-PRD%20v1.4-teal.svg)](./documents/prd)
[![Architecture](https://img.shields.io/badge/docs-Architecture%20v1.4-teal.svg)](./documents/architecture)
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

> **Current infrastructure is a pre-revenue development environment, not the target production state.** Provenance is currently deployed as a NestJS modular monolith and React frontend running on two EC2 instances via Docker Compose. This setup is deliberately lean — it is the MVP build, not the shape the platform will take at scale. The target production architecture (Kubernetes on EKS, managed AWS services, SOC 2 hardening) is scoped as Phase 6 and is documented in [documents/architecture/Provenance_Architecture_v1.4.md](./documents/architecture/Provenance_Architecture_v1.4.md). Phase 6 is planned but not funded and will be triggered by enterprise customer engagement or funding, not by a calendar date.

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

Provenance is in active development. Phases 1–4 are complete; Phase 5 (Open Source Ready) is active. **Domain 10 Workstream A (self-serve registration, org creation, invitations) is complete**; **Workstream B (port connection details and connection packages) is in progress** as of 2026-04-19.

**Development environment:** An internal development deployment is served via Caddy with automatic HTTPS at a `*.provenancelogic.com` hostname for hands-on work by the core team. It is not a persistent public endpoint — the underlying EC2 instance is shut down most of the time, so the URL is not suitable for inclusion in user-facing documentation, blog posts, or link-outs, and no uptime is implied. To try Provenance, follow the [Getting Started](#getting-started) steps below to run the stack locally via Docker Compose. A reproducible demo environment (provisioned per demo from git with curated seed data) is documented in [documents/runbooks/demo-environment.md](./documents/runbooks/demo-environment.md).

| Phase | Scope | Status |
|---|---|---|
| **Phase 1 — Foundation** | Organization model, domain management, data product authoring, identity (Keycloak) | ✅ Complete |
| **Phase 2 — Governance & Publishing** | OPA governance engine, marketplace, access control, Policy Authoring Studio, Compliance Monitor | ✅ Complete |
| **Phase 3 — Lineage & Observability** | Lineage graph (Neo4j), emission API, TypeScript SDK, SLOs, trust score engine, Lineage Explorer UI, Observability Dashboard | ✅ Complete |
| **Phase 4 — Agent Integration** | MCP server (9 tools, SSE), agent query layer, agent identity, semantic search, trust classification | ✅ Complete |
| **Phase 5 — Open Source Ready** | JWT agent auth, stability, security essentials, data product completeness, Domain 10 self-serve infrastructure, developer experience | 🔄 Active — 5.1–5.4 complete; Domain 10 Workstream A complete; Workstream B in progress; 5.5–5.7 remaining |
| **Phase 6 — Production Scale** | Kubernetes, managed AWS services, security hardening, SOC 2 Type II audit | 🔲 When Funded |

### Verification Status (Phase 3)

- **API tests:** 15/15 passing (health, domains, products, SLOs, trust scores, lineage, governance, marketplace)
- **Browser checks:** 8/8 passing (auth, navigation, domain dashboard, product detail, marketplace, governance, lineage, observability)
- **Known gaps:** Marketplace full-text search requires OpenSearch (disabled in dev stack); lineage chart visual polish pending

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
- **Workstream B — in progress (2026-04-19):** every output port now carries an encrypted-at-rest connection-details payload keyed by interface type (SQL/JDBC, REST, GraphQL, Kafka, file export), and every access grant emits a ready-to-use connection package (JDBC URLs, curl + Postman, Python snippets, data dictionaries, MCP agent integration guide). Full detail disclosure is gated by active access grant. Automated connectivity validation (F10.7) and connection-package refresh on edit (F10.10) remain open. See [implementation-status.md](./documents/prd/implementation-status.md) for per-feature status.

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
- Node.js 20+ and npm
- Git

### Running Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/provenance-logic/provenance.git
   cd provenance
   ```

2. **Start the infrastructure stack:**
   ```bash
   cd infrastructure/docker
   docker compose up -d
   ```
   This starts PostgreSQL, Neo4j, Redpanda, OpenSearch, OPA, Keycloak, and Kong.

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
   - Keycloak admin: `http://localhost:8080`
   - Neo4j browser: `http://localhost:7474`

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
| [Product Requirements Document](./documents/prd/Provenance_PRD_v1.4.md) | Complete requirements across all seven platform domains |
| [Implementation Status](./documents/prd/implementation-status.md) | Per-requirement implementation status vs. PRD v1.4 and remaining Open Source Readiness blockers |
| [Architecture Document](./documents/architecture/Provenance_Architecture_v1.4.md) | MVP and production architecture, technology decisions, build sequence |
| [Architecture Decision Records](./documents/architecture/adr/) | Individual decision records for significant technology choices |
| [OpenAPI Specifications](./packages/openapi/) | OpenAPI specifications for all platform APIs |
| [TypeScript Lineage SDK](./packages/sdk-ts/) | TypeScript SDK for pipeline lineage emission |

---

## Contributing

Provenance is Apache 2.0 licensed and welcomes contributions. Before contributing, please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution guidelines and development setup
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — community standards
- [Architecture Document](./documents/architecture/Provenance_Architecture_v1.4.md) — understand the system before contributing

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
