# MeshOS

**The Data 3.0 Self-Service Data Mesh Platform**

MeshOS is an open source, cloud-native platform that makes data mesh real not as a philosophy, but as working software. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![PRD](https://img.shields.io/badge/docs-PRD%20v1.0-teal.svg)](./docs/prd)
[![Architecture](https://img.shields.io/badge/docs-Architecture%20v1.0-teal.svg)](./docs/architecture)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)]()

---

## What Is MeshOS?

MeshOS is a **coordination and contract platform** for organizational data. It does not store your data, run your pipelines, or replace your data warehouse. It does something more fundamental: it makes data trustworthy enough to depend on for humans and AI agents alike.

Built on the data mesh principles articulated by [Zhamak Dehghani](https://www.oreilly.com/library/view/data-mesh/9781492092384/) and extended for the agentic AI era, MeshOS gives every domain team the infrastructure to publish data as a product, every consumer the confidence to know what they are depending on, and every governance team the computational tools to enforce policy without becoming a bottleneck.

> *"A dataset without a contract is not a data product. MeshOS makes the contract real."*

---

## Why MeshOS?

Most organizations attempting data mesh hit the same wall: the philosophy is clear, the tooling is not. Existing data catalogs rebrand as data mesh platforms. Data warehouses add lineage features. None of them implement the actual principles.

MeshOS is different in four ways:

**1. Data products are first-class entities not catalog entries.**
A MeshOS data product has an owner, a contract, a lifecycle, ports, SLOs, lineage, and a governance compliance state. It is not a metadata record. It is a governed, versioned, observable artifact with real enforcement behind it.

**2. Governance is computational not a process.**
The federated governance team configures policy through a declarative UI. MeshOS enforces it automatically at publication time and continuously thereafter. No tickets. No approval queues. No governance bottleneck.

**3. AI agents are first-class participants.**
MeshOS exposes the data mesh as a semantic, policy-aware query surface for AI agents via a fully compliant [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server. Agents discover data products, query across them, and produce new ones all under the same governance model as human consumers. This is Data 3.0.

**4. The data stays where it lives.**
MeshOS holds metadata, contracts, lineage, and governance records. Your data never transits the platform. Domain teams own their infrastructure. MeshOS owns the contracts between them.

---

## Core Concepts

If you are new to data mesh, these are the concepts MeshOS is built on. If you are already familiar, skip ahead to [Architecture](#architecture).

| Concept | What It Means in MeshOS |
|---|---|
| **Domain** | A bounded business context with a team that owns its data. Domains are the unit of ownership. |
| **Data Product** | A dataset published as a product with an explicit contract, SLOs, schema, lineage, and governance compliance. |
| **Port** | The typed interface of a data product. Every product has input ports (what it consumes), output ports (how consumers access it), discovery ports (how it is found), observability ports (its health signals), and control ports (governance interaction surface). |
| **Governance Floor** | The minimum viable policy set defined by the federated governance team. Every domain must meet the floor. Domains may extend it upward. Nobody may weaken it. |
| **Trust Score** | A composite, transparent signal computed by MeshOS from lineage completeness, SLO compliance history, governance compliance, schema conformance, and freshness consistency. The primary signal for consumers evaluating a data product. |
| **Agent Identity** | A first-class principal type representing an AI agent distinct from human users and service accounts. Carries model identity, trust classification, and a mandatory human oversight contact. |
| **Federated Query Layer** | The semantic query surface through which AI agents interact with the mesh. Presents the authorized data mesh as a single logical data surface. Policy-aware in real time. |

---

## Architecture

MeshOS is built on a lean, upgrade-path-conscious open source stack. The MVP runs on two EC2 instances. The production architecture runs on Kubernetes with managed cloud services. The application code is identical only the deployment topology changes.

### Technology Stack

| Component | Technology | Notes |
|---|---|---|
| Backend API | TypeScript / NestJS | Modular monolith (MVP) → microservices (production) |
| Frontend | TypeScript / React + TailwindCSS | Single app, persona-adaptive |
| Graph Database | Neo4j Community → Amazon Neptune | Lineage graph arbitrary depth traversal |
| Relational Database | PostgreSQL 16 → Amazon Aurora | Control plane state |
| Message Broker | Redpanda (Kafka-compatible) → Amazon MSK | Lineage and observability event streaming |
| Policy Engine | Open Policy Agent (OPA) | Hot-reloadable governance policy enforcement |
| Search | OpenSearch | Product discovery + semantic vector search |
| Identity | Keycloak | OIDC + SAML 2.0 federation |
| Workflow Engine | Temporal | Governance workflows deprecation timers, grace periods, exception expiry |
| Agent Interface | MCP (official TypeScript SDK) + GraphQL | Native MCP server not an API wrapper |
| Semantic Search | sentence-transformers + OpenSearch kNN | Agent data product discovery |
| NL Query | Claude API | Natural language query translation for agents |

For the complete architecture including the MVP infrastructure blueprint, production microservices decomposition, security architecture, and 26-week build sequence see the [Architecture Document](./docs/architecture/MeshOS_Architecture_v1.0.md).

---

## Feature Overview

### For Domain Teams
- Guided data product authoring with continuous governance validation
- Port-type-specific configuration SQL, REST, GraphQL, streaming, file, and semantic query output ports
- Schema editor with connector-inferred schema import and semantic annotation
- Full lifecycle management Draft → Published → Deprecated → Decommissioned
- Semantic versioning with enforced backward compatibility and semantic change declarations
- Lineage emission SDK (Python, TypeScript, Java) for pipeline integration
- CI/CD integration GitHub Actions and GitLab CI reference implementations

### For Data Consumers
- Data product marketplace with trust score, compliance state, and SLO filtering
- Transparent trust score breakdown not a black box
- Access request workflow with real-time approval status
- Deprecation impact management with replacement product comparison and migration checklist
- Consumer workspace active grants, consumption history, deprecation notices

### For Governance Teams
- Declarative policy authoring UI no coding required
- Eight independently configurable policy domains
- Real-time impact preview before publishing any policy change
- Global policy floor with domain-level extension model
- Continuous compliance monitoring with compliance drift detection
- Four compliance states: Compliant, Drift Detected, Grace Period, Non-Compliant
- Regulatory policy templates GDPR, CCPA, HIPAA, SOC 2, data mesh best practices

### For AI Agents
- Fully compliant MCP server Resources, Tools, and Prompts
- Semantic data product discovery via natural language or structured semantic query
- Policy-aware federated query layer cross-product joins with real-time governance enforcement
- Query result provenance envelopes every result carries trust scores, lineage completeness, and governance policy versions
- Agent identity model with trust classification (Observed / Supervised / Autonomous)
- Mandatory human oversight contact per agent identity
- Agent anomaly detection with automatic escalation
- Version-aware consumption structured compatibility assessment API for schema changes

### For Everyone
- Interactive lineage visualization arbitrary depth, time travel, impact analysis
- Trust score transparency composite algorithm, fully documented
- Real-time observability dashboard per data product
- WCAG 2.1 AA accessibility throughout
- Light and dark theme support

---

## Project Status

MeshOS is in pre-alpha. The requirements and architecture are complete. Active development begins with Phase 1 of the build sequence.

| Phase | Scope | Status |
|---|---|---|
| Phase 1 Foundation | Organization model, domain management, basic data product authoring, identity | 🔲 Not started |
| Phase 2 Governance & Publishing | Governance engine, OPA integration, marketplace, access control | 🔲 Not started |
| Phase 3 Lineage & Observability | Lineage graph, emission API, trust score, observability dashboard | 🔲 Not started |
| Phase 4 Agent Integration | MCP server, federated query layer, agent identity, semantic search | 🔲 Not started |
| Phase 5 Production Hardening | Microservices split, managed services migration, security hardening, SOC 2 readiness | 🔲 Not started |

---

## Documentation

| Document | Description |
|---|---|
| [Product Requirements Document](./docs/prd/MeshOS_PRD_v1.0.md) | Complete requirements across all seven platform domains |
| [Architecture Document](./docs/architecture/MeshOS_Architecture_v1.0.md) | MVP and production architecture, technology decisions, build sequence |
| [Architecture Decision Records](./docs/architecture/adr/) | Individual decision records for significant technology choices |
| [API Reference](./docs/api/) | OpenAPI specifications for all platform APIs |
| [Lineage Emission SDK Python](./packages/sdk-python/) | Python SDK for pipeline lineage emission |
| [Lineage Emission SDK TypeScript](./packages/sdk-ts/) | TypeScript SDK for pipeline lineage emission |

---

## Getting Started

> MeshOS is pre-alpha. The getting started guide will be published when Phase 1 is complete. Star or watch this repository to be notified.

For the technically curious: the full architecture and requirements documents in `./docs` describe exactly what is being built and how. Reading them is the best way to understand the project before the first code ships.

---

## Design Philosophy

MeshOS is opinionated in three specific ways that distinguish it from other data platforms:

**The right thing is the easy thing.**
For every persona domain teams, consumers, governance teams, AI agents the compliant, correct path through MeshOS should always be the path of least resistance. If governance policy requires effort to comply with, the platform has failed, not the user.

**Governance is computation, not process.**
Policy rules configured through MeshOS's declarative UI are compiled to machine-enforceable artifacts and evaluated automatically. There are no approval queues, no human checkpoints, no governance bottlenecks. Compliance is automatic for compliant products. Non-compliance is visible, specific, and remediable.

**Agents are participants, not consumers.**
AI agents in MeshOS are not a feature added on top of a human-facing platform. They are first-class principals with their own identity model, their own governance tier, their own query interface, and their own production capability. MeshOS is designed for a world where AI agents are as natural a participant in organizational data as human analysts.

---

## Contributing

MeshOS is Apache 2.0 licensed and welcomes contributions. Before contributing, please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) contribution guidelines and development setup
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) community standards
- [Architecture Document](./docs/architecture/MeshOS_Architecture_v1.0.md) understand the system before contributing to it

The highest-value contributions at this stage are:
- Additional connector implementations (the connector SDK is documented in the architecture)
- SDK implementations for Java and Scala (lineage emission)
- Review and feedback on the PRD and architecture documents (open an issue)
- Domain expertise in data mesh, federated governance, or agentic AI systems

---

## Relationship to Data Mesh

MeshOS is a technical implementation of the data mesh principles described by Zhamak Dehghani in [*Data Mesh: Delivering Data-Driven Value at Scale*](https://www.oreilly.com/library/view/data-mesh/9781492092384/) (O'Reilly, 2022). It implements all four data mesh principles:

- ✅ **Domain ownership** domains are first-class entities; every data product has an owner
- ✅ **Data as a product** the port model, SLOs, versioning, and trust score make product thinking operational
- ✅ **Self-serve data infrastructure** the platform enables domain teams to publish without central team involvement
- ✅ **Federated computational governance** the governance engine enforces policy automatically; the floor/extension model implements true federation

MeshOS extends the framework in one significant direction Zhamak's original work did not address: **AI agents as first-class mesh participants**. We believe this extension is consistent with the framework's intent and necessary for the Data 3.0 era.

---

## License

MeshOS is licensed under the [Apache License 2.0](./LICENSE).

---

## Acknowledgments

MeshOS is built on the intellectual foundation laid by Zhamak Dehghani's data mesh framework and the open source projects listed in the architecture document. We are grateful to the communities behind Neo4j, Open Policy Agent, OpenLineage, Temporal, the Model Context Protocol, and the many other projects that make MeshOS possible.
