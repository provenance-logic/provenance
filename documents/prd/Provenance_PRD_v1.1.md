# Provenance Product Requirements Document

**Version 1.1 — MVP Release**
**Confidential — Not for Distribution**

> **Changelog — v1.0 → v1.1**
> - F3.3 amended: Connector Extensibility now requires a capability manifest for all connectors
> - F3.23 added: Connector Discovery Mode
> - F3.23a added: Discovery Metadata Taxonomy
> - F3.24 added: Discovery Scope — Databricks
> - F3.25 added: Discovery Scope — dbt
> - F3.26 added: Discovery Scope — Snowflake
> - F3.27 added: Discovery Scope — Fivetran
> - F3.28 added: Discovery Re-crawl
> - F3.29 added: Discovery Conflict Resolution
> - Domain 3 Summary Table updated
> - Post-MVP Registry updated: Reference Architecture Guidance added to Domain 7
> - Domain 7 Post-MVP: Reference Architecture Guidance added

---

## Executive Summary

Provenance is a cloud-native, multi-tenant self-service data mesh platform designed for the Data 3.0 era. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

The platform embodies the data mesh principles articulated by Zhamak Dehghani while extending them for the agentic AI era through a dual consumption model: human consumers connect directly to data product output ports; AI agents interact through a governed, policy-aware federated semantic query layer.

Provenance is a coordination and contract platform. It does not store data, execute pipelines, or provide a centralized query engine for human consumers. It owns the contracts between domains, the lineage graph that connects them, and the governance engine that makes the mesh trustworthy.

### Five Foundational Design Principles

1. **Domain sovereignty with interoperability contracts** — domains own their data and pipelines; the platform owns the contracts between them and the lineage graph that connects them
2. **Ports are definitional** — a dataset without explicit ports is not a data product on this platform
3. **Governance as a policy engine** — the federated governance team defines a minimum viable policy floor; domains extend upward; the platform enforces both computationally, never manually
4. **Dual consumption model** — humans discover and connect to output ports directly; AI agents interact through a semantic federated query layer that is policy-aware in real time
5. **Lineage by emission and discovery, not capture** — the platform assembles a complete lineage graph from active discovery at connector registration, events emitted by domain pipelines, and agent reasoning traces without owning pipeline execution

### Four Personas (Priority Order for Data 3.0)

1. AI Agents — autonomous consumers and potential producers of data products
2. Domain Teams — human owners and publishers of data products
3. Data Consumers — human discoverers and users of data products
4. Governance Teams — policy authors and compliance monitors

### Deployment Model

Cloud-native SaaS, multi-tenant. The control plane is fully managed SaaS. The data plane remains in each domain's own infrastructure regardless of cloud provider. No data ever transits the Provenance platform.

### MVP Scale Targets

| Dimension | MVP Target |
| --- | --- |
| Domains per organization | Up to 200 |
| Data products per organization | Up to 50,000 |
| Lineage graph nodes per organization | Up to 5,000,000 |
| Lineage graph edges per organization | Up to 20,000,000 |
| Concurrent agent query sessions per organization | 10,000 |
| Lineage emission throughput per organization | 10,000 events/second |

---

## Requirement Conventions

Requirements are organized across seven domains. Each domain contains Functional Requirements (F), Non-Functional Requirements (NF), and Out of Scope statements (OS).

| Prefix | Type | Description |
| --- | --- | --- |
| F | Functional | Capabilities the platform shall provide |
| NF | Non-Functional | Performance, scale, reliability, and quality attributes |
| OS | Out of Scope | Explicitly excluded from MVP scope |

Requirement IDs follow the format `{PREFIX}{DOMAIN}.{NUMBER}` — e.g., F2.3 is Functional Requirement 3 in Domain 2.

The word **shall** denotes a mandatory requirement. The word **should** denotes a strong recommendation. The word **may** denotes an optional capability.

---

## Domain 1: Multi-Tenancy and Organization Model

Defines the tenant structure, domain namespacing, identity model, and organizational hierarchy that form the foundation for all other platform capabilities.

### Functional Requirements

**F1.1 — Organization as Top-Level Tenant**
The platform shall support multiple organizations as fully isolated top-level tenants. No data, metadata, policy, or identity shall be shared across organization boundaries under any circumstance.

**F1.2 — Domain as First-Class Entity**
Within an organization, the platform shall support the creation and management of domains as first-class entities. A domain represents a bounded business context owned by a specific team and is the unit of data product ownership.

**F1.3 — Domain Namespacing**
Every domain shall have a globally unique, human-readable namespace within its organization. All data products, ports, and policies shall be addressable via a hierarchical namespace: `{org}/{domain}/{product}/{port}`.

**F1.4 — Governance Layer as Distinct Entity**
Each organization shall have exactly one federated governance layer — a distinct entity separate from all domains that holds authority to define and publish the minimum viable policy floor. The governance layer cannot own data products.

**F1.5 — Identity and Principal Model**
The platform shall support four distinct principal types: Human users, Service accounts (automated pipelines), AI agent identities (distinct from service accounts), and Platform administrators (strictly separated from org-level governance).

**F1.6 — Role Assignment**
The platform shall support role assignment at organization, domain, and data product level. Minimum roles: Governance Author, Domain Owner, Data Product Owner, Data Product Consumer, Platform Observer. Role definitions shall be configurable by the governance layer.

**F1.7 — Domain Autonomy Boundaries**
No domain shall read, write, or administer another domain's internal configuration, pipelines, or unpublished data products. Cross-domain interaction is permitted only through published output ports.

**F1.8 — Multi-Cloud Tenant Isolation**
The platform shall support organizations whose data infrastructure spans multiple cloud providers. The control plane is SaaS; the data plane remains in the domain's own infrastructure regardless of cloud provider.

**F1.9 — Self-Service Org Onboarding**
New organization onboarding — including governance layer initialization, policy bootstrapping from templates, and first domain creation — shall require no platform operator involvement.

**F1.10 — Domain Lifecycle Management**
The platform shall support full domain lifecycle: creation, active operation, deprecation, and decommissioning. Decommissioning a domain with active consumers shall be blocked until all consumer dependencies are resolved or explicitly overridden by the governance layer.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF1.1 | Organization data and metadata shall be cryptographically isolated at rest and in transit |
| NF1.2 | Support organizations with up to 200 domains and up to 50,000 data products without control plane degradation |
| NF1.3 | Identity federation via OIDC and SAML 2.0 |
| NF1.4 | Every action by any principal produces an immutable audit log entry retained for 7 years minimum |
| NF1.5 | Control plane 99.99% availability; outages shall not affect already-published output port serving |

### Out of Scope

- **OS1.1** — Internal org structure and team membership management beyond role assignment
- **OS1.2** — Domain infrastructure provisioning and management
- **OS1.3** — [POST-MVP] Sub-tenancy / business-unit hierarchy above the domain level

---

## Domain 2: Data Product Definition and Lifecycle

The heart of the platform. Defines the data product as a first-class entity, the port model, governance-configured product schemas, versioning, lifecycle states, and AI provenance requirements.

### Functional Requirements

**F2.1 — Data Product as Governed Entity**
The platform shall treat a data product as a first-class, versioned, governed entity with an explicit owner, contract, and lifecycle state at all times.

**F2.2 — Data Product Definition as Code**
Every data product shall have a machine-readable definition — a declarative specification fully describing its identity, ports, schema, SLOs, governance attributes, and lineage declarations. This definition shall be the authoritative source of truth, versionable and submittable via API.

**F2.3 — Governance-Configured Product Schema**
Required attributes in a data product definition shall not be hardcoded. The governance layer shall define a configurable, versioned product schema specifying mandatory, recommended, and optional attributes. Every definition shall be validated against this schema at publication time.

**F2.4 — Domain-Level Schema Extension**
A domain shall define additional required or recommended attributes on top of the governance floor. Extensions shall not contradict or weaken governance-layer attributes.

**F2.5 — Product Schema Versioning**
The governance layer's product schema shall itself be versioned with configurable grace periods for compliance. The platform shall surface compliance drift.

**F2.6 — Ports as Definitional**
A data product shall not be valid or publishable without at minimum one output port and one discovery port declared.

**F2.7 — Port Types**
The platform shall support five port types: Input Ports, Output Ports, Discovery Ports, Observability Ports, and Control Ports.

**F2.8 — Output Port Interface Types**
Six output port types shall be supported: SQL/JDBC endpoint, REST API endpoint, GraphQL endpoint, Streaming topic, File/object export, and Semantic query endpoint (for agent consumption).

**F2.9 — Port Contract Enforcement**
Each declared port shall have an associated machine-readable contract monitored by the platform. Violations shall be surfaced to all authorized consumers.

**F2.10 — Input Port Dependency Declaration**
When a product declares input ports referencing other products, the platform shall register those dependencies in the lineage graph automatically.

**F2.11 — Lifecycle States**
Every data product shall exist in exactly one state: Draft, Published, Deprecated, or Decommissioned.

**F2.12 — Publication Requirements**
A product shall transition from Draft to Published only when the definition is valid, all declared ports have valid contracts, a product owner is assigned, and all governance-mandatory attributes are populated.

**F2.13 — Deprecation Process**
Initiating deprecation shall notify all active consumers, block new access grant requests, and record the deprecation rationale.

**F2.14 — Deprecation Override**
The governance layer shall have authority to accelerate or block a domain team's deprecation action.

**F2.15 — Decommissioning Guard**
A product shall not be transitionable to Decommissioned while it has active consumers. The governance layer may override with documented justification.

**F2.16 — Semantic Versioning**
Every data product definition shall carry a semantic version (MAJOR.MINOR.PATCH) with enforced contracts per level.

**F2.17 — Simultaneous Major Version Support**
The number of simultaneously active major versions permitted shall be governance-configurable. Platform default is two.

**F2.18 — Semantic Change Declaration**
When a MAJOR version increment occurs, the data product owner shall provide a structured semantic change declaration describing what the data means differently — not just what the schema changed.

**F2.19 — Version Deprecation Schedule**
When a new MAJOR version is published, the platform shall automatically initiate a deprecation schedule for the previous MAJOR version.

**F2.20 — Classification as Mandatory Governance Attribute**
Every data product shall carry a data classification defined by the governance layer's taxonomy.

**F2.21 — Classification Inheritance**
A domain team shall not classify an output product at a lower sensitivity level than its most sensitive input product without explicit governance override.

**F2.22 — Governance-Configured Metadata**
Metadata attributes required on a data product shall be fully configurable by the governance layer. The platform shall ship with a DCAT-aligned baseline.

**F2.23 — Lineage Declaration**
Domain teams shall declare transformation lineage within a data product definition at a logical level. Declared lineage shall be supplemented by emitted lineage events from pipelines.

**F2.24 — AI Provenance Metadata**
When a data product is produced or transformed by an AI agent, the product definition shall carry AI provenance metadata by default. The governance layer may configure specific attributes but may not disable AI provenance capture without documented justification.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF2.1 | Definition validation under 2 seconds |
| NF2.2 | Publication atomicity — no partial state |
| NF2.3 | Product schema updates without platform downtime |
| NF2.4 | Open, documented, portable definition format |
| NF2.5 | Immutable audit records for all state transitions and governance events |

### Out of Scope

- **OS2.1** — [POST-MVP] AI-assisted definition authoring
- **OS2.2** — Pipeline execution and scheduling
- **OS2.3** — Data storage — platform holds metadata and contracts only
- **OS2.4** — Data quality computation

---

## Domain 3: Connectivity and Source Integration

Defines how domain teams register and authenticate external data sources, how the platform actively discovers metadata and lineage from connected systems, how inter-product dependencies are declared, and how the platform integrates with domain infrastructure for lineage emission and observability.

### Functional Requirements

#### Connector Framework

**F3.1 — Connector as First-Class Entity**
The platform shall provide a connector framework through which domain teams register external data sources. Connectors are owned by domains and represent authenticated links between the platform control plane and domain infrastructure.

**F3.2 — Connector Library**
The platform shall ship with pre-built connectors covering:

- **Relational Databases:** PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, Cloud Spanner
- **Cloud Warehouses/Lakehouses:** Snowflake, BigQuery, Redshift, Databricks, Microsoft Fabric
- **NoSQL:** MongoDB, Cassandra, DynamoDB, Elasticsearch/OpenSearch
- **Streaming:** Kafka, Kinesis, Pub/Sub, Event Hubs, Pulsar
- **Object Storage:** S3, GCS, ADLS, SFTP
- **SaaS Applications:** Salesforce, HubSpot, ServiceNow, Workday, Stripe
- **APIs:** Generic REST (OpenAPI spec-driven), Generic GraphQL
- **Ingestion Platforms:** Fivetran

**F3.3 — Connector Extensibility** *(amended v1.1)*
The platform shall provide a documented connector SDK that allows domain teams or third parties to build custom connectors for sources not covered by the pre-built library. Custom connectors shall conform to the same interface contract as pre-built connectors and shall be registerable within the platform without requiring platform operator involvement.

All connectors — pre-built and custom — shall declare a capability manifest at registration time. The capability manifest is a structured, machine-readable declaration of the connector's supported capabilities, including: which discovery metadata categories it can populate, which metadata fields within each category it supports, whether it implements discovery mode, and the lineage granularity it can provide (asset-level, column-level, or none). The capability manifest is immutable for a given connector version and must be updated under a new connector version if capabilities change.

The platform shall validate capability manifests at registration time and reject connectors with malformed or incomplete manifests. Governance configuration, coverage scoring, and consumer-facing metadata completeness indicators shall all be bounded by the declared capability manifest of the connector in use.

**F3.4 — Connector Validation**
Upon registration, the platform shall perform a connectivity test. Connectors that fail validation shall not be associatable with data product input ports.

**F3.5 — Connector Health Monitoring**
The platform shall continuously monitor registered connector health and propagate health state to the observability port of dependent data products.

**F3.6 — Credential Management**
The platform shall never store raw credentials. All authentication secrets shall be managed via AWS Secrets Manager, Google Cloud Secret Manager, Azure Key Vault, or HashiCorp Vault.

**F3.7 — Connector Scope Isolation**
A connector registered by one domain shall not be accessible, visible, or usable by any other domain.

#### Source-Aligned Domain Connectivity

**F3.8 — Source Registration**
A source-aligned domain team shall register an external source via a connector and associate it with data product input ports, capturing: connector reference, source object reference, access pattern, and expected refresh cadence.

**F3.9 — Schema Inference**
Upon successful source registration, the platform shall offer schema inference for domain team review and confirmation. Schema inference shall never be auto-applied without explicit acceptance.

**F3.10 — Schema Drift Detection**
The platform shall monitor for schema drift and surface drift events to the domain team. Unresolved schema drift beyond a governance-configurable threshold shall surface as a contract violation on affected output ports.

**F3.11 — Source Lineage Registration**
When a domain team registers a source via a connector, the platform shall automatically create a lineage node for that source in the organization's lineage graph.

#### Connector Discovery

**F3.23 — Connector Discovery Mode** *(new v1.1)*
Connectors for supported systems shall implement a discovery mode that, upon successful registration, actively crawls the connected system for available metadata and lineage. Discovery results are ingested into the platform's metadata store and lineage graph automatically, without requiring domain team input. Discovery mode is a defined capability in the connector interface contract — connectors that do not support it declare this explicitly in their capability manifest.

**F3.23a — Discovery Metadata Taxonomy** *(new v1.1)*
Connectors implementing discovery mode shall populate metadata across the following standard categories where the connected system exposes them. These categories define the contract for discovery completeness and are the basis against which discovery coverage is measured and reported.

- **Structural Metadata** — schemas, tables, columns, data types, primary and foreign key relationships, partitioning and clustering attributes
- **Descriptive Metadata** — asset names, human-readable descriptions, tags, labels, and domain-defined classifications at the asset and column level
- **Operational Metadata** — asset ownership, stewardship assignments, creation and last-modified timestamps, access patterns, refresh cadence, and SLO declarations
- **Quality Metadata** — declared data quality tests, freshness expectations, completeness signals, and anomaly detection configurations where natively available
- **Governance Metadata** — data sensitivity classifications, access control policies, applicable regulatory designations, and retention policies where exposed by the source system

Connectors shall report a discovery coverage score per category upon completion of each crawl, reflecting the proportion of expected metadata fields populated versus available. Partial coverage is recorded and surfaced to domain teams; missing categories are flagged but do not block connector registration.

The metadata taxonomy is governance-configurable — categories and expected fields may be extended beyond the platform baseline. However, governance extensions shall only apply to connectors that have declared support for the relevant metadata category in their capability manifest. Governance may not require metadata fields from connectors that have not declared the capability to provide them. Coverage scores shall be calculated only against fields the connector is capable of providing, not against the full governance-extended taxonomy. This ensures coverage scores reflect genuine completeness rather than architectural limitations of the connected system.

**F3.24 — Discovery Scope: Databricks** *(new v1.1)*
The Databricks connector shall implement discovery mode against Unity Catalog. On registration, the platform shall ingest: table and column-level metadata, ownership, tags, and descriptions; column-level lineage from Unity Catalog's lineage API; and notebook and job lineage where available. Delta table history shall be used to establish data product versioning context.

**F3.25 — Discovery Scope: dbt** *(new v1.1)*
The dbt connector shall implement discovery mode by ingesting the dbt project manifest (manifest.json) and catalog (catalog.json). The platform shall extract: full node-level and column-level lineage graph; model descriptions, column descriptions, and tags declared in dbt; test definitions as data quality metadata; and source declarations as upstream lineage edges into the platform graph.

**F3.26 — Discovery Scope: Snowflake** *(new v1.1)*
The Snowflake connector shall implement discovery mode against Snowflake's Information Schema and Access History. The platform shall ingest: table and column metadata including descriptions and tags; query history-derived lineage where column-level access patterns are inferable; and object ownership and role assignments as governance metadata.

**F3.27 — Discovery Scope: Fivetran** *(new v1.1)*
The Fivetran connector shall implement discovery mode via the Fivetran Metadata API. The platform shall ingest: connector-to-destination schema mappings as source lineage edges; sync cadence and status as observability metadata; and column-level mappings where available. The connector shall make best-effort attempts to represent Fivetran source systems as upstream lineage nodes, with coverage dependent on what the Fivetran API exposes per connector type. Partial lineage is recorded and flagged as incomplete rather than omitted.

**F3.28 — Discovery Re-crawl** *(new v1.1)*
Connectors implementing discovery mode shall support configurable re-crawl schedules. Re-crawls shall perform delta discovery — detecting new objects, changed metadata, and updated lineage — and merge results into the existing graph without overwriting domain-declared lineage or metadata. Re-crawl frequency shall be governance-configurable with a platform default of 24 hours.

**F3.29 — Discovery Conflict Resolution** *(new v1.1)*
Where discovered metadata conflicts with domain-declared metadata, the platform shall surface the conflict to the domain team for resolution rather than auto-overriding. Domain-declared metadata takes precedence until explicitly reconciled unless the governance layer has configured automatic discovery override, in which case discovered metadata shall be applied and the prior domain-declared value preserved in audit history. Discovered lineage that extends or supplements declared lineage shall be merged automatically and flagged as system-discovered in the lineage graph.

#### Inter-Product Connectivity

**F3.12 — Data Product as Input Source**
A domain team building an aggregate or consumer-aligned product shall declare another published data product as an input source via its output port.

**F3.13 — Access-Gated Input Declaration**
A domain team shall not declare an input port dependency on a product without an active access grant. Enforced at definition validation time.

**F3.14 — Inter-Product Schema Propagation**
When a domain team declares a product input port referencing another product's output port, the platform shall make the upstream schema available in the authoring context automatically.

**F3.15 — Inter-Product SLO Dependency**
The platform shall compute a dependency SLO chain and surface it during product definition authoring.

#### Platform Integration Connectivity

**F3.16 — Lineage Emission Endpoint**
The platform shall expose an authenticated, rate-limited lineage emission API endpoint conforming to the platform's open lineage event schema.

**F3.17 — Lineage Emission SDK**
The platform shall provide a lightweight open-source lineage emission SDK in Python, Java, Scala, and JavaScript/TypeScript.

**F3.18 — Observability Emission Endpoint**
The platform shall expose an observability emission API endpoint for domain pipelines to emit quality, freshness, and completeness metrics.

**F3.19 — Webhook and Event Notification**
The platform shall support outbound webhook notifications for control port interactions.

**F3.20 — CI/CD Integration**
The platform shall expose definition validation and publication APIs suitable for CI/CD integration. Reference implementations for GitHub Actions and GitLab CI.

**F3.21 — Semantic Query Port Registration**
For products declaring a semantic query output port, the platform shall manage registration, authentication, and routing to the federated agent query layer.

**F3.22 — Agent Source Discovery**
The federated agent query layer shall have read access to connectivity metadata of all products an agent is authorized to consume. The agent layer sees product interfaces, never source credentials or internals.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF3.1 | New connectors shall be addable without platform downtime |
| NF3.2 | Connector validation shall complete within 10 seconds |
| NF3.3 | Schema inference supported for relational, warehouse, lakehouse at MVP |
| NF3.4 | Lineage emission: 10,000 events/sec, 100ms p99 latency |
| NF3.5 | Credential zero-knowledge — architecturally enforced, audit-verifiable |
| NF3.6 | SDK shall have minimal dependency footprint |
| NF3.7 | Connector failure isolation — zero cross-domain impact |
| NF3.8 | Discovery crawl completion within 30 minutes for sources up to 10,000 objects |
| NF3.9 | Discovery coverage score available within 60 seconds of crawl completion |

### Out of Scope

- **OS3.1** — Data extraction, transformation, or loading
- **OS3.2** — Pipeline execution environment
- **OS3.3** — [POST-MVP] Schema inference for streaming, NoSQL, file sources
- **OS3.4** — [POST-MVP] Managed private connectivity (PrivateLink, Private Service Connect)
- **OS3.5** — Cross-domain connector sharing

### Domain 3 Summary

| ID | Type | Summary |
| --- | --- | --- |
| F3.1 | Functional | Connector as first-class domain-owned entity |
| F3.2 | Functional | Pre-built connector library across 8 source categories including Fivetran |
| F3.3 | Functional | Connector SDK with mandatory capability manifest for all connectors |
| F3.4 | Functional | Connector validation on registration |
| F3.5 | Functional | Continuous connector health monitoring with observability propagation |
| F3.6 | Functional | Credential management via external secrets managers, zero raw credential storage |
| F3.7 | Functional | Connector scope isolation — no cross-domain sharing |
| F3.8 | Functional | Source registration with access pattern and cadence declaration |
| F3.9 | Functional | Schema inference — proposed, never auto-applied |
| F3.10 | Functional | Schema drift detection with configurable contract violation threshold |
| F3.11 | Functional | Source lineage node auto-created on connector registration |
| F3.12 | Functional | Data product as first-class input source type |
| F3.13 | Functional | Access-gated input declaration — unauthorized dependency blocked at validation |
| F3.14 | Functional | Inter-product schema propagation in authoring context |
| F3.15 | Functional | Dependency SLO chain computation — surfaced during authoring |
| F3.16 | Functional | Lineage emission API — authenticated, rate-limited, open schema |
| F3.17 | Functional | Lineage emission SDK — Python, Java, Scala, JavaScript/TypeScript |
| F3.18 | Functional | Observability emission API |
| F3.19 | Functional | Outbound webhook notifications for control port interactions |
| F3.20 | Functional | CI/CD integration — GitHub Actions and GitLab CI reference implementations |
| F3.21 | Functional | Semantic query port registration wired to agent layer by platform |
| F3.22 | Functional | Agent layer sees product interfaces only — never source credentials or internals |
| F3.23 | Functional | Connector discovery mode — active crawl at registration, auto-ingest to metadata store and lineage graph |
| F3.23a | Functional | Discovery metadata taxonomy — five categories, coverage scoring, governance-configurable with capability manifest guardrails |
| F3.24 | Functional | Discovery scope: Databricks — Unity Catalog metadata, column-level lineage, notebook/job lineage |
| F3.25 | Functional | Discovery scope: dbt — manifest/catalog ingestion, column-level lineage, test definitions as quality metadata |
| F3.26 | Functional | Discovery scope: Snowflake — Information Schema metadata, Access History lineage, ownership as governance metadata |
| F3.27 | Functional | Discovery scope: Fivetran — schema mappings, sync metadata, best-effort upstream source lineage |
| F3.28 | Functional | Discovery re-crawl — configurable schedule, delta discovery, governance default 24 hours |
| F3.29 | Functional | Discovery conflict resolution — domain-declared takes precedence; governance-configurable auto-override; audit preserved |
| NF3.1 | Non-Functional | Connector library independently deployable, addable without downtime |
| NF3.2 | Non-Functional | Connector validation under 10 seconds |
| NF3.3 | Non-Functional | Schema inference for relational, warehouse, lakehouse at MVP |
| NF3.4 | Non-Functional | Lineage emission: 10,000 events/sec, 100ms p99 latency |
| NF3.5 | Non-Functional | Credential zero-knowledge — architecturally enforced, audit-verifiable |
| NF3.6 | Non-Functional | SDK minimal dependency footprint |
| NF3.7 | Non-Functional | Connector failure isolation — zero cross-domain impact |
| NF3.8 | Non-Functional | Discovery crawl completion within 30 minutes for sources up to 10,000 objects |
| NF3.9 | Non-Functional | Discovery coverage score available within 60 seconds of crawl completion |
| OS3.1 | Out of Scope | Data extraction, transformation, loading |
| OS3.2 | Out of Scope | Pipeline execution environment |
| OS3.3 | Out of Scope (MVP) | Schema inference for streaming, NoSQL, file sources |
| OS3.4 | Out of Scope (MVP) | Managed private connectivity |
| OS3.5 | Out of Scope | Cross-domain connector sharing |

---

## Domain 4: Governance Engine

*(Unchanged from v1.0 — full text omitted for brevity in this diff; content is identical)*

---

## Domain 5: Lineage and Observability

*(Unchanged from v1.0 — full text omitted for brevity in this diff; content is identical)*

---

## Domain 6: Agent Integration Layer

*(Unchanged from v1.0 — full text omitted for brevity in this diff; content is identical)*

---

## Domain 7: Self-Service Experience

*(All requirements F7.1–F7.46 and NF7.1–NF7.7 unchanged from v1.0)*

### Out of Scope

- **OS7.1** — [POST-MVP] Mobile application
- **OS7.2** — [POST-MVP] Embedded analytics and custom report building
- **OS7.3** — [POST-MVP] White-labeling and custom tenant branding
- **OS7.4** — [POST-MVP] In-platform data preview
- **OS7.5** — [POST-MVP] AI-assisted data product definition authoring
- **OS7.6** — [POST-MVP] Collaborative simultaneous multi-user definition editing
- **OS7.7** — [POST-MVP] Reference Architecture Guidance — surface recommended architecture patterns (e.g., Unity Catalog + dbt) during connector registration when eligible stack configurations are detected. Patterns communicate expected lineage coverage and metadata completeness outcomes without mandating infrastructure choices. Trust score and coverage indicators to reflect pattern adoption organically.

---

## Appendix A: Persona-to-Capability Mapping

| Capability Area | Domain Teams | Consumers | Governance Teams | AI Agents | Platform Admins |
| --- | --- | --- | --- | --- | --- |
| Org and Domain Model | Primary | | Primary | | Primary |
| Data Product Definition and Lifecycle | Primary | Read | Oversight | Producer (conditional) | |
| Connectivity and Source Integration | Primary | | Oversight | Read | |
| Governance Engine | Subject | Subject | Primary | Subject | |
| Lineage and Observability | Primary | Read | Oversight | Primary | |
| Agent Integration Layer | Owner | | Policy | Primary | |
| Self-Service Experience | Primary | Primary | Primary | API | Primary |

---

## Appendix B: Post-MVP Candidate Registry

| Capability | Domain | Priority Signal |
| --- | --- | --- |
| Sub-tenancy / business-unit hierarchy | 1 | Enterprise sales driver |
| Scale beyond 200 domains / 50K products | 1 | Architectural growth path |
| AI-assisted data product definition authoring | 2, 7 | High-value — strong candidate for first post-MVP release |
| Schema inference for streaming, NoSQL, file sources | 3 | Natural connector library extension |
| Managed private connectivity | 3 | Enterprise security requirement |
| Policy-as-code authoring | 4 | Sophisticated governance teams |
| Native GRC platform integrations | 4 | Enterprise compliance driver |
| Trust score weight customization | 5 | Governance configurability extension |
| Natural language query precision improvement | 6 | Continuous investment area |
| Agent financial metering and chargeback | 6 | Internal billing / FinOps use case |
| Mobile application | 7 | Broader reach post-stabilization |
| Embedded analytics and custom report building | 7 | Self-service analytics layer |
| White-labeling and custom tenant branding | 7 | Enterprise and OEM use case |
| In-platform data preview | 7 | High-value consumer experience |
| Collaborative simultaneous definition editing | 7 | Team authoring workflow |
| Reference architecture guidance in connector UX | 7 | Adoption accelerator — organic trust score incentive without mandate |

---

## Appendix C: Key Design Decisions

| Decision | Position | Rationale |
| --- | --- | --- |
| AI Agents as First-Class Persona | Agents are the highest-priority persona in Data 3.0 | Agents operate at machine speed, require programmatic interfaces, and create new governance challenges that must be designed for from the start |
| Dual Consumption Model | Humans connect to output ports directly. Agents use a governed federated semantic query layer | Neither model serves both personas well. Each model is optimized for its persona |
| Declarative UI for Governance Policy | Governance policy is authored through a declarative UI, not code | Humans want to do less, not more. A declarative UI lowers the barrier without sacrificing computational enforcement |
| AI Provenance as Default-On | AI provenance metadata is enabled by default | In an agentic world, provenance is a trust primitive. Making it default-on makes the safe path the easy path |
| Semantic Change Declaration | MAJOR version increments require a structured declaration of meaning changes | Agents consume data based on semantic understanding. A schema change that preserves structure but changes meaning is invisible without a semantic change declaration |
| Agent Identity Never Deleted | Agent identities are retired, not deleted | An agent that produced data products must remain attributable in perpetuity |
| MCP as First-Class Protocol | The platform exposes a fully compliant MCP server endpoint | MCP is the standard protocol for agent-to-tool interaction |
| Active Discovery at Registration | Connectors implement discovery mode to automatically crawl metadata and lineage | Manual lineage and metadata declaration is not a realistic expectation at scale. Discovery makes the right thing the easy thing for domain teams |
| Capability Manifest as Governance Guardrail | All connectors declare their capabilities; governance extensions bounded by manifest | Prevents governance from requiring metadata that connectors are architecturally incapable of providing, ensuring coverage scores reflect reality |
| Domain-Declared Metadata Takes Precedence | Discovery does not auto-override domain-declared metadata without governance opt-in | Domain teams are the authoritative source of truth for their own products. Discovery supplements; it does not override without consent |
