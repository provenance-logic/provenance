MeshOS
The Data 3.0 Self-Service Data Mesh Platform
MeshOS is an open source, cloud-native platform that makes data mesh real — not as a philosophy, but as working software. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

What Is MeshOS?
MeshOS is a coordination and contract platform for organizational data. It does not store your data, run your pipelines, or replace your data warehouse. It does something more fundamental: it makes data trustworthy enough to depend on — for humans and AI agents alike.
Built on the data mesh principles articulated by Zhamak Dehghani and extended for the agentic AI era, MeshOS gives every domain team the infrastructure to publish data as a product, every consumer the confidence to know what they are depending on, and every governance team the computational tools to enforce policy without becoming a bottleneck.

Why MeshOS?
Most organizations attempting data mesh hit the same wall: the philosophy is clear, the tooling is not. Existing data catalogs rebrand as data mesh platforms. Data warehouses add lineage features. None of them implement the actual principles.
MeshOS is different in four ways:
1. Data products are first-class entities — not catalog entries.
A MeshOS data product has an owner, a contract, a lifecycle, ports, SLOs, lineage, and a governance compliance state. It is not a metadata record. It is a governed, versioned, observable artifact with real enforcement behind it.
2. Governance is computational — not a process.
The federated governance team configures policy through a declarative UI. MeshOS enforces it automatically at publication time and continuously thereafter. No tickets. No approval queues. No governance bottleneck.
3. AI agents are first-class participants.
MeshOS exposes the data mesh as a semantic, policy-aware query surface for AI agents via a fully compliant Model Context Protocol (MCP) server. Agents discover data products, query across them, and produce new ones — all under the same governance model as human consumers. This is Data 3.0.
4. The data stays where it lives.
MeshOS holds metadata, contracts, lineage, and governance records. Your data never transits the platform. Domain teams own their infrastructure. MeshOS owns the contracts between them.

Project Status
MeshOS is in pre-alpha. Requirements and architecture are complete. Active development begins with Phase 1.
Phase 1 — Foundation: Organization model, domain management, basic data product authoring — Not started
Phase 2 — Governance and Publishing: Governance engine, OPA integration, marketplace, access control — Not started
Phase 3 — Lineage and Observability: Lineage graph, emission API, trust score, observability dashboard — Not started
Phase 4 — Agent Integration: MCP server, federated query layer, agent identity, semantic search — Not started
Phase 5 — Production Hardening: Microservices split, managed services migration, security hardening — Not started

Design Philosophy
The right thing is the easy thing.
For every persona — domain teams, consumers, governance teams, AI agents — the compliant, correct path through MeshOS should always be the path of least resistance.
Governance is computation, not process.
Policy rules configured through MeshOS’s declarative UI are compiled to machine-enforceable artifacts and evaluated automatically. There are no approval queues, no human checkpoints, no governance bottlenecks.
Agents are participants, not consumers.
AI agents in MeshOS are first-class principals with their own identity model, governance tier, query interface, and production capability. MeshOS is designed for a world where AI agents are as natural a participant in organizational data as human analysts.

Relationship to Data Mesh
MeshOS implements all four data mesh principles defined by Zhamak Dehghani:
Domain ownership — domains are first-class entities; every data product has an owner
Data as a product — the port model, SLOs, versioning, and trust score make product thinking operational
Self-serve data infrastructure — domain teams publish without central team involvement
Federated computational governance — the governance engine enforces policy automatically; the floor/extension model implements true federation
MeshOS extends the framework in one direction Zhamak’s original work did not address: AI agents as first-class mesh participants. We believe this extension is consistent with the framework’s intent and necessary for the Data 3.0 era.

License
Apache License 2.0

Acknowledgments
MeshOS is built on the intellectual foundation laid by Zhamak Dehghani’s data mesh framework and the open source projects that make it possible — including Neo4j, Open Policy Agent, OpenLineage, Temporal, and the Model Context Protocol.

The badges, tables, and full feature sections from the file version won’t render perfectly on mobile paste — but this gives you everything that matters for a first commit. You can paste the full downloaded README.md file once you’re back at a desktop. The content is identical.
Go claim that repo. Good night.​​​​​​​​​​​​​​​​-
