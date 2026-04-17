# Provenance Product Requirements Document

**Version 1.3 — MVP Release**
**Confidential — Not for Distribution**

> **Changelog — v1.2 → v1.3**
> Phase 5 redefined as "Open Source Ready" — lean, infrastructure-light scope appropriate for an open source platform pre-revenue and pre-investment. Original expensive infrastructure targets moved to Phase 6 "Production Scale."
>
> Appendix D updated: Phase 5 scope replaced entirely
>
> Appendix B updated: Phase 6 Production Scale added as post-funding candidate registry
>
> Appendix C updated: new design decision — Lean Phase 5
> Phase 4 complete as of April 13, 2026.
>
> Domain 2: F2.11a added (lifecycle endpoints trigger index removal), F2.11b added (mutable fields on published products with auto re-indexing)
>
> Domain 6: F6.3 replaced with refined tier definitions; F6.3a–F6.3d added (transition rules, scope, frozen state, audit requirements); F6.11 updated (anomaly detection deferred to Phase 5)
>
> Domain 8 added: Operations and Workflow State (frozen state as platform-level Temporal construct)
>
> Domain 9 added: Data Product Detail Completeness (phased roadmap for get_product completeness)
>
> Domain 7: OS7.8 added (consumer connection experience post-MVP)
>
> Appendix B updated: post-MVP registry additions
>
> Appendix D added: Phase 5 scope confirmation
>
> **Changelog — v1.0 → v1.1**
> F3.3 amended (capability manifest); F3.23–F3.29 and F3.23a added (connector discovery); Domain 3 summary updated; Post-MVP registry updated

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
5. **Lineage by emission and discovery, not capture** — the platform assembles a complete lineage graph from active discovery at connector registration, events emitted by domain pipelines, and agent reasoning traces without owning pipeline execution. Agent activity is captured via a complete audit trail with agent identity context on every MCP tool call.

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

| Prefix | Type | Description |
| --- | --- | --- |
| F | Functional | Capabilities the platform shall provide |
| NF | Non-Functional | Performance, scale, reliability, and quality attributes |
| OS | Out of Scope | Explicitly excluded from MVP scope |

Requirement IDs follow the format `{PREFIX}{DOMAIN}.{NUMBER}`. The word **shall** denotes a mandatory requirement. The word **should** denotes a strong recommendation. The word **may** denotes an optional capability.

---

## Domain 1: Multi-Tenancy and Organization Model

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
The platform shall support role assignment at organization, domain, and data product level. Minimum roles: Governance Author, Domain Owner, Data Product Owner, Data Product Consumer, Platform Observer.

**F1.7 — Domain Autonomy Boundaries**
No domain shall read, write, or administer another domain's internal configuration, pipelines, or unpublished data products. Cross-domain interaction is permitted only through published output ports.

**F1.8 — Multi-Cloud Tenant Isolation**
The platform shall support organizations whose data infrastructure spans multiple cloud providers. The control plane is SaaS; the data plane remains in the domain's own infrastructure regardless of cloud provider.

**F1.9 — Self-Service Org Onboarding**
New organization onboarding shall require no platform operator involvement.

**F1.10 — Domain Lifecycle Management**
The platform shall support full domain lifecycle: creation, active operation, deprecation, and decommissioning. Decommissioning a domain with active consumers shall be blocked until all consumer dependencies are resolved or explicitly overridden by the governance layer.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF1.1 | Organization data and metadata cryptographically isolated at rest and in transit |
| NF1.2 | Support up to 200 domains and 50,000 data products per organization |
| NF1.3 | Identity federation via OIDC and SAML 2.0 |
| NF1.4 | Every action produces an immutable audit log entry retained for 7 years minimum |
| NF1.5 | Control plane 99.99% availability |

### Out of Scope

- **OS1.1** — Internal org structure and team membership management beyond role assignment
- **OS1.2** — Domain infrastructure provisioning and management
- **OS1.3** — [POST-MVP] Sub-tenancy / business-unit hierarchy above the domain level

---

## Domain 2: Data Product Definition and Lifecycle

### Functional Requirements

**F2.1 — Data Product as Governed Entity**
The platform shall treat a data product as a first-class, versioned, governed entity with an explicit owner, contract, and lifecycle state at all times.

**F2.2 — Data Product Definition as Code**
Every data product shall have a machine-readable definition — a declarative specification fully describing its identity, ports, schema, SLOs, governance attributes, and lineage declarations.

**F2.3 — Governance-Configured Product Schema**
Required attributes in a data product definition shall not be hardcoded. The governance layer shall define a configurable, versioned product schema specifying mandatory, recommended, and optional attributes.

**F2.4 — Domain-Level Schema Extension**
A domain shall define additional required or recommended attributes on top of the governance floor. Extensions shall not contradict or weaken governance-layer attributes.

**F2.5 — Product Schema Versioning**
The governance layer's product schema shall itself be versioned with configurable grace periods for compliance.

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

**F2.11a — Lifecycle Transition Endpoints** *(new v1.2)*
The platform shall expose explicit `POST .../deprecate` and `POST .../decommission` endpoints for lifecycle state transitions. Both transitions shall trigger automatic removal of the product from the semantic search index. Index removal is fire-and-forget — it does not block the lifecycle transition from completing.

**F2.11b — Mutable Fields on Published Products** *(new v1.2)*
The fields `name`, `description`, and `tags` shall be mutable on published products without requiring a version increment. Changes to any of these fields on a published product shall trigger automatic re-indexing in the semantic search index. Re-indexing is fire-and-forget — it does not block the update from completing.

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

### Functional Requirements

#### Connector Framework

**F3.1 — Connector as First-Class Entity**
The platform shall provide a connector framework through which domain teams register external data sources. Connectors are owned by domains and represent authenticated links between the platform control plane and domain infrastructure.

**F3.2 — Connector Library**
The platform shall ship with pre-built connectors covering: Relational Databases (PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, Cloud Spanner), Cloud Warehouses/Lakehouses (Snowflake, BigQuery, Redshift, Databricks, Microsoft Fabric), NoSQL (MongoDB, Cassandra, DynamoDB, Elasticsearch/OpenSearch), Streaming (Kafka, Kinesis, Pub/Sub, Event Hubs, Pulsar), Object Storage (S3, GCS, ADLS, SFTP), SaaS Applications (Salesforce, HubSpot, ServiceNow, Workday, Stripe), APIs (Generic REST, Generic GraphQL), and Ingestion Platforms (Fivetran).

**F3.3 — Connector Extensibility** *(amended v1.1)*
The platform shall provide a documented connector SDK for custom connector development. All connectors — pre-built and custom — shall declare a capability manifest at registration time. The capability manifest is a structured, machine-readable declaration of supported capabilities including: discovery metadata categories supported, metadata fields per category, whether discovery mode is implemented, and lineage granularity (asset-level, column-level, or none). Capability manifests are immutable for a given connector version. The platform shall validate capability manifests at registration time and reject connectors with malformed or incomplete manifests.

**F3.4 — Connector Validation**
Upon registration, the platform shall perform a connectivity test. Connectors that fail validation shall not be associatable with data product input ports.

**F3.5 — Connector Health Monitoring**
The platform shall continuously monitor registered connector health and propagate health state to the observability port of dependent data products.

**F3.6 — Credential Management**
The platform shall never store raw credentials. All authentication secrets shall be managed via AWS Secrets Manager, Google Cloud Secret Manager, Azure Key Vault, or HashiCorp Vault.

**F3.7 — Connector Scope Isolation**
A connector registered by one domain shall not be accessible, visible, or usable by any other domain.

**F3.8 — Source Registration**
A source-aligned domain team shall register an external source via a connector and associate it with data product input ports, capturing: connector reference, source object reference, access pattern, and expected refresh cadence.

**F3.9 — Schema Inference**
Upon successful source registration, the platform shall offer schema inference for domain team review and confirmation. Schema inference shall never be auto-applied without explicit acceptance.

**F3.10 — Schema Drift Detection**
The platform shall monitor for schema drift and surface drift events to the domain team. Unresolved schema drift beyond a governance-configurable threshold shall surface as a contract violation on affected output ports.

**F3.11 — Source Lineage Registration**
When a domain team registers a source via a connector, the platform shall automatically create a lineage node for that source in the organization's lineage graph.

**F3.12 — Data Product as Input Source**
A domain team building an aggregate or consumer-aligned product shall declare another published data product as an input source via its output port.

**F3.13 — Access-Gated Input Declaration**
A domain team shall not declare an input port dependency on a product without an active access grant.

**F3.14 — Inter-Product Schema Propagation**
When a domain team declares a product input port referencing another product's output port, the platform shall make the upstream schema available in the authoring context automatically.

**F3.15 — Inter-Product SLO Dependency**
The platform shall compute a dependency SLO chain and surface it during product definition authoring.

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

**F3.23 — Connector Discovery Mode** *(new v1.1)*
Connectors for supported systems shall implement a discovery mode that, upon successful registration, actively crawls the connected system for available metadata and lineage. Discovery results are ingested into the platform's metadata store and lineage graph automatically, without requiring domain team input.

**F3.23a — Discovery Metadata Taxonomy** *(new v1.1)*
Connectors implementing discovery mode shall populate metadata across five standard categories where the connected system exposes them: Structural Metadata (schemas, tables, columns, data types, key relationships), Descriptive Metadata (asset names, descriptions, tags, classifications), Operational Metadata (ownership, stewardship, timestamps, refresh cadence, SLO declarations), Quality Metadata (data quality tests, freshness expectations, completeness signals), and Governance Metadata (sensitivity classifications, access control policies, regulatory designations, retention policies). Connectors shall report a discovery coverage score per category. The taxonomy is governance-configurable but governance extensions may only apply to connectors that have declared support in their capability manifest.

**F3.24 — Discovery Scope: Databricks** *(new v1.1)*
The Databricks connector shall implement discovery mode against Unity Catalog. On registration, the platform shall ingest table and column-level metadata, ownership, tags, and descriptions; column-level lineage from Unity Catalog's lineage API; and notebook and job lineage where available.

**F3.25 — Discovery Scope: dbt** *(new v1.1)*
The dbt connector shall implement discovery mode by ingesting the dbt project manifest (manifest.json) and catalog (catalog.json), extracting full node-level and column-level lineage, model and column descriptions, test definitions as quality metadata, and source declarations as upstream lineage edges.

**F3.26 — Discovery Scope: Snowflake** *(new v1.1)*
The Snowflake connector shall implement discovery mode against Snowflake's Information Schema and Access History, ingesting table and column metadata, query history-derived lineage, and object ownership as governance metadata.

**F3.27 — Discovery Scope: Fivetran** *(new v1.1)*
The Fivetran connector shall implement discovery mode via the Fivetran Metadata API, ingesting schema mappings, sync cadence as observability metadata, and making best-effort attempts to represent upstream source systems as lineage nodes. Partial lineage is recorded and flagged as incomplete rather than omitted.

**F3.28 — Discovery Re-crawl** *(new v1.1)*
Connectors implementing discovery mode shall support configurable re-crawl schedules performing delta discovery. Re-crawl frequency shall be governance-configurable with a platform default of 24 hours.

**F3.29 — Discovery Conflict Resolution** *(new v1.1)*
Where discovered metadata conflicts with domain-declared metadata, the platform shall surface the conflict to the domain team for resolution. Domain-declared metadata takes precedence until explicitly reconciled unless the governance layer has configured automatic discovery override, in which case discovered metadata shall be applied and the prior domain-declared value preserved in audit history.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF3.1 | New connectors addable without platform downtime |
| NF3.2 | Connector validation within 10 seconds |
| NF3.3 | Schema inference for relational, warehouse, lakehouse at MVP |
| NF3.4 | Lineage emission: 10,000 events/sec, 100ms p99 latency |
| NF3.5 | Credential zero-knowledge — architecturally enforced, audit-verifiable |
| NF3.6 | SDK minimal dependency footprint |
| NF3.7 | Connector failure isolation — zero cross-domain impact |
| NF3.8 | Discovery crawl completion within 30 minutes for sources up to 10,000 objects |
| NF3.9 | Discovery coverage score available within 60 seconds of crawl completion |

### Out of Scope

- **OS3.1** — Data extraction, transformation, or loading
- **OS3.2** — Pipeline execution environment
- **OS3.3** — [POST-MVP] Schema inference for streaming, NoSQL, file sources
- **OS3.4** — [POST-MVP] Managed private connectivity
- **OS3.5** — Cross-domain connector sharing

---

## Domain 4: Governance Engine

> **A deliberate design decision:** governance policy is authored through a declarative UI, not code. The governance team should not need to become engineers to govern effectively.

### Functional Requirements

**F4.1 — Governance as Computation, Not Process**
The platform shall enforce governance rules computationally and automatically.

**F4.2 — The Right Thing Is the Easy Thing**
Compliant behavior shall always be the path of least resistance for every persona.

**F4.3 — Governance Layer Separation**
The governance layer shall be architecturally and operationally separate from all domain activity.

**F4.4 — Declarative Policy UI**
All governance policy shall be authored through a structured, declarative web interface. No coding, scripting, or query language knowledge shall be required.

**F4.5 — Policy as Versioned Artifact**
Every policy shall be stored as a versioned, machine-readable artifact. Complete version history shall be maintained.

**F4.6 — Policy Domains**
The governance UI shall organize policy into eight independently configurable domains: Product Schema Policy, Classification Taxonomy Policy, Versioning and Deprecation Policy, Access Control Policy, Lineage Policy, SLO Policy, Agent Access Policy, and Interoperability Policy.

**F4.7 — Policy Rule Builder**
A point-and-click rule builder shall allow governance teams to construct conditional rules using dropdown menus. The completed rule shall display as a plain-language sentence confirming intent.

**F4.8 — Policy Impact Preview**
Before publishing a policy change, the UI shall present a preview showing affected products and estimated remediation effort, generated from live platform data within 3 seconds.

**F4.9 — Policy Grace Periods**
Policy changes that make existing compliant products non-compliant shall require a configured grace period. Grace periods shall never be zero for breaking policy changes.

**F4.10 — Policy Templates**
The platform shall ship with governance policy templates aligned to GDPR, CCPA, HIPAA, SOC 2, and data mesh best practices.

**F4.11 — Global Policy Floor**
Policies published by the governance layer constitute the global policy floor. Domains cannot opt out of, weaken, or override floor policies.

**F4.12 — Domain Policy Extensions**
Domain teams shall define policy extensions within their domain — additive only, never contradictory to the floor.

**F4.13 — Effective Policy Computation**
For any data product, the platform shall compute and expose the effective policy — the union of the governance floor and all applicable domain extensions.

**F4.14 — Extension Inheritance Transparency**
The effective policy view shall clearly indicate for each rule whether it originates from the governance floor or a domain extension.

**F4.15 — Cross-Domain Policy Visibility**
Governance teams shall have visibility into all domain policy extensions.

**F4.16 — Publication-Time Enforcement**
The platform shall enforce the effective policy at publication time with plain-language descriptions and remediation guidance for all violations.

**F4.17 — Continuous Compliance Monitoring**
The platform shall continuously detect compliance drift.

**F4.18 — Compliance State**
Every published data product shall carry one of four compliance states: Compliant, Drift Detected, Grace Period, or Non-Compliant.

**F4.19 — Enforcement Actions**
Five enforcement actions configurable per policy rule: Warn, Block Publication, Restrict Access, Notify Governance, Auto-Remediate.

**F4.20 — Governance Override**
The governance layer shall grant time-limited compliance exceptions with documented rationale and expiration dates. Exceptions shall auto-expire.

**F4.21 — Classification Taxonomy Authoring**
The governance layer shall define the organization's data classification taxonomy.

**F4.22 — Classification-Driven Enforcement**
Classification shall be a first-class input to all policy rule conditions.

**F4.23 — Classification Change Governance**
Reclassification to higher sensitivity shall be immediately effective. Reclassification to lower sensitivity shall require governance acknowledgment if the product has active consumers.

**F4.24 — Governance Dashboard**
The governance layer shall have access to a real-time compliance dashboard.

**F4.25 — Domain Compliance Reports**
The governance layer shall generate compliance reports per domain, exportable in PDF and CSV.

**F4.26 — Audit Export**
All governance events shall be exportable from the audit log in a structured format.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF4.1 | Policy evaluation at publication time under 3 seconds |
| NF4.2 | Continuous monitoring every 24 hours minimum, event-triggered near real-time |
| NF4.3 | Non-technical governance team member can author policy within 30 minutes of first use |
| NF4.4 | Policy evaluation deterministic and consistent across all platform nodes |
| NF4.5 | Regulatory templates reviewed within 90 days of material regulatory changes |

### Out of Scope

- **OS4.1** — Legal interpretation of regulatory requirements
- **OS4.2** — Governance enforcement on data outside registered data products
- **OS4.3** — [POST-MVP] Policy-as-code authoring
- **OS4.4** — [POST-MVP] Native GRC platform integrations

---

## Domain 5: Lineage and Observability

### Functional Requirements

**F5.1 — Lineage as a Graph**
The platform shall maintain a continuously updated, organization-wide lineage graph representing the complete provenance network of all data products. The lineage graph is a first-class queryable asset.

**F5.2 — Lineage Node Types**
Six node types: Source Nodes, Data Product Nodes, Port Nodes, Transformation Nodes, Agent Nodes (distinct from Transformation Nodes due to non-deterministic characteristics), and Consumer Nodes.

**F5.3 — Lineage Edge Types**
Five edge types: Derives From, Transforms, Consumes, Depends On, Supersedes. All edges carry a `source` property: `declared` (domain team), `emitted` (pipeline runtime), or `discovered` (connector crawl).

**F5.4 — Dual Lineage Assembly**
The lineage graph shall be assembled from declared lineage (domain team design-time declarations) and emitted lineage (runtime pipeline events), supplemented by discovered lineage (connector crawl). The platform shall reconcile all three sources, surfacing discrepancies as lineage drift events.

**F5.5 — Lineage Completeness Scoring**
The platform shall compute a lineage completeness score for every data product. Governance shall configure minimum completeness thresholds by classification.

**F5.6 — Lineage Depth**
The platform shall support lineage traversal of arbitrary depth with no imposed technical limit.

**F5.7 — Cross-Domain Lineage**
Lineage shall traverse domain boundaries seamlessly. Cross-domain lineage visibility shall be governed by access grants.

**F5.8 — Emission Event Schema**
The platform shall define and publish an open lineage event schema aligned with the OpenLineage specification, extended with platform-specific fields for agent provenance, governance policy references, and semantic change markers.

**F5.9 — Emission Authentication**
All lineage emission API calls shall be authenticated using the emitting principal's identity, stored as an immutable attribute of the lineage record.

**F5.10 — Emission Idempotency**
The lineage emission API shall be idempotent. Duplicate emissions identified by client-provided event ID shall be deduplicated without error.

**F5.11 — Batch and Streaming Emission**
Both individual event emission and batch emission (up to 1,000 events per call) shall be supported.

**F5.12 — Agent Lineage Emission**
AI agent executions shall emit lineage events including agent identity and version, model identifier and version, reasoning context reference, input and output ports consumed/produced, governance policy version in effect, and confidence indicators where available.

**F5.13 — Lineage Drift Detection**
The platform shall compare declared versus emitted versus discovered lineage and surface discrepancies as lineage drift events.

**F5.14 — Lineage Graph API**
The platform shall expose a lineage graph query API supporting upstream traversal, downstream traversal, impact analysis, path query, and consumer query.

**F5.15 — Lineage Visualization**
An interactive, zoomable, navigable lineage visualization distinguishing node types visually, indicating lineage completeness and drift, supporting depth control, focus mode, and export.

**F5.16 — Impact Analysis Workflow**
When a domain team initiates a MAJOR version change or deprecation, the platform shall automatically execute an impact analysis and present results before the change is committed. Acknowledgment is a required step.

**F5.17 — Lineage Time Travel**
The lineage graph as it existed at any prior point in time shall be reconstructable. Minimum historical retention is governance-configurable with a platform minimum of 2 years.

**F5.18 — Observability as a Port**
The observability port is the authoritative interface through which consumers, agents, and the governance layer assess a product's runtime health.

**F5.19 — Observability Metric Categories**
Eight metric categories on every data product: Freshness, Completeness, Schema Conformance, SLO Compliance, Lineage Completeness, Governance Compliance, Connector Health, and Version Currency.

**F5.20 — SLO Declaration and Monitoring**
Domain teams shall declare SLOs for freshness, availability, schema stability, and query response time. The platform shall continuously evaluate declared SLOs against metrics in near real time.

**F5.21 — Observability Emission**
Domain pipelines shall emit observability metrics via the observability emission API. Discrepancies between platform-computed and domain-emitted metrics shall be flagged as observability drift events.

**F5.22 — Consumer-Visible Observability**
The observability port shall be accessible to all authorized consumers without a separate access request.

**F5.23 — Observability Alerting**
Domain teams shall configure alert rules on observability metrics. The governance layer shall define mandatory minimum alerting requirements by classification.

**F5.24 — Observability History**
Observability metric history shall be retained with a platform minimum of 90 days.

**F5.25 — Trust Score**
The platform shall compute a trust score for every published product — a composite of lineage completeness, SLO compliance history, governance compliance state, schema conformance, and freshness consistency over a rolling time window. The algorithm shall be transparent and documented.

**F5.26 — Agent Consumption Tracking**
Every AI agent consumption event against an output port shall be recorded automatically.

**F5.27 — Non-Determinism Lineage Markers**
Lineage edges produced by AI agent transformations shall carry a non-determinism marker.

**F5.28 — Agent Observability Signals**
Agent-produced data products shall expose additional signals: model drift indicator, reasoning stability score, and human review status.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF5.1 | Lineage traversal to 10 hops under 5 seconds; impact analysis under 30 seconds |
| NF5.2 | 10,000 lineage events/sec, 100ms p99 ingestion latency |
| NF5.3 | Observability metrics current within 5 minutes |
| NF5.4 | Trust score recalculated within 10 minutes of material events |
| NF5.5 | Lineage graph: 5M nodes, 20M edges per org |
| NF5.6 | Historical reconstruction under 60s full org, 5s single product |
| NF5.7 | Observability availability independent of control plane health |

### Out of Scope

- **OS5.1** — Internal data quality metric computation
- **OS5.2** — Data profiling
- **OS5.3** — Real-time operational monitoring dashboards
- **OS5.4** — [POST-MVP] Trust score weight customization
- **OS5.5** — Automated lineage backfill for pre-adoption data products

---

## Domain 6: Agent Integration Layer

> **Central design challenge:** agents are simultaneously the most powerful consumers the platform will ever have and the least trustworthy ones by default.

### Functional Requirements

**F6.1 — Agent Identity as First-Class Principal**
The platform shall treat AI agent identities as a distinct principal type carrying: model identifier, model version, agent framework, delegated authority scope, and a trust classification. These attributes are immutable once registered.

**F6.2 — Agent Identity Registration**
Registration shall capture: agent name and description, owning domain, model provider and identifier, model version or version constraint, agent framework, intended consumption patterns, maximum access scope declaration, and a named human oversight contact. Registration shall require governance layer acknowledgment for production-capable agents.

**F6.3 — Agent Trust Classification** *(revised v1.2)*
The governance layer shall define an agent trust classification taxonomy. Platform default three tiers:

* **Observed** (default for all newly registered agents) — read-only access to the mesh: product discovery, metadata queries, lineage inspection. No side-effect operations permitted: cannot submit access requests, emit lineage events, draft products, or trigger any workflow. All actions logged to the audit trail in real time. Appropriate for newly registered agents of unknown behavioral profile.

* **Supervised** — extended read access plus consequential actions permitted, but held in a pending state awaiting human approval. Permitted pending actions include: access requests, lineage emission, product draft creation. Human oversight contact must explicitly approve each consequential action before it takes effect. Appropriate for agents with an established behavioral record in Observed mode.

* **Autonomous** — full operational capability within the agent's access grant scope. Actions take immediate effect — no human checkpoint in the execution path. Audit trail remains mandatory and complete; only the approval gate is removed. Appropriate for agents with a validated track record in Supervised mode, explicitly granted by a governance role. The platform shall guarantee that Autonomous classification can never be assigned by an automated process or set as a default — it always requires an explicit human action by a governance role.

**F6.3a — Classification Transition Rules** *(new v1.2)*
Permitted transitions:

* Observed → Supervised: requires governance role
* Supervised → Autonomous: requires governance role
* Autonomous → Supervised: may be performed by the agent's human oversight contact OR a governance role
* Supervised → Observed: may be performed by the agent's human oversight contact OR a governance role
* Autonomous → Observed: may be performed by the agent's human oversight contact OR a governance role

Any upward transition (toward Autonomous) by the human oversight contact alone is not permitted. Any transition to Autonomous via automated process or rule is not permitted.

**F6.3b — Classification Scope** *(new v1.2)*
Classification is global per agent in the MVP. A single trust classification applies to the agent across all domains. The `agent_trust_classifications` table shall include a `scope` field defaulting to `'global'` in MVP to ensure the migration path to per-domain classification does not require a breaking schema change. Per-domain classification is explicitly deferred post-MVP.

**F6.3c — Frozen Operations on Classification Downgrade** *(new v1.2)*
When an agent's classification is downgraded in any direction, all in-flight operations that were permitted under the prior classification but are not permitted under the new classification shall be frozen immediately. Frozen operations are not cancelled or rolled back. They enter a `frozen` state visible to governance team members and require explicit review and disposition by a governance role: approve to complete, or cancel. This applies to all pending approval requests, queued lineage events, and any other operations in a non-terminal state at the time of classification change.

**F6.3d — Audit Requirements for Classification Changes** *(new v1.2)*
Every classification change event shall be written to the audit log with: `event_type: agent_classification_changed`, `agent_id`, `previous_classification`, `new_classification`, `changed_by_principal_id`, `changed_by_principal_type` (human_user or governance_role), `reason` (free-text, mandatory — cannot be null or empty), and `timestamp`. The question "who classified this agent as Autonomous and why" must always be answerable from the audit log alone.

**F6.4 — Agent Identity Lifecycle**
Lifecycle states: Registered, Active, Suspended, Retired. Agent identities shall not be deleted — retired identities preserve all audit and lineage history permanently.

**F6.5 — Model Version Binding**
An agent identity shall be bound to a specific model version or version constraint. Model version changes require re-registration or explicit acknowledgment.

**F6.6 — Human Oversight Requirement**
Every agent identity shall have a named human oversight contact. An agent whose oversight contact is no longer an active platform principal shall be automatically suspended.

**F6.7 — Agent Access Grants**
Agent access grants shall specify: a maximum query rate limit, an expiration date (no indefinite grants), governance layer approval for Autonomous trust class agents, and explicit acknowledgment of AI provenance requirements for production-capable agents.

**F6.8 — Agent Access Scope Enforcement**
An agent registered as read-only shall be architecturally prevented from writing to or producing data products — enforced at infrastructure level.

**F6.9 — Agent Access Policy**
The governance layer shall configure agent access policy defining which trust classifications may access which data classifications and under what conditions.

**F6.10 — Dynamic Access Evaluation**
Agent access shall be evaluated dynamically at query time — verifying current valid access grants, access scope compliance, governance policy allowance, and trust classification authorization before every query execution.

**F6.11 — Agent Activity Tracking and Audit Log Query API** *(revised v1.2)*
The platform shall maintain a complete audit trail of all agent activity. Every MCP tool call shall be logged with agent identity context. The platform shall expose an audit log query API as a governance visibility capability, supporting filters by `agent_id`, `event_type`, time range, and `principal_type`. The query API returns filtered log entries without aggregation or pattern analysis. Anomaly detection and pattern analysis are explicitly deferred to Phase 5 — they require a behavioral baseline that does not exist until activity tracking has run in production. Building detection before real production data exists produces arbitrary thresholds and false positives.

**F6.12 — Semantic Query Interface**
The platform shall provide a federated semantic query interface presenting the authorized portion of the data mesh as a single logical data surface.

**F6.13 — Query Protocol**
Four surfaces: natural language query, structured semantic query, GraphQL interface, and MCP endpoint.

**F6.14 — MCP Server Compliance**
The platform's MCP endpoint shall be a fully compliant MCP server exposing Resources (every authorized output port), Tools (data product search, lineage traversal, observability query, access grant request, semantic query execution), and Prompts (platform-provided templates). As of Phase 4 completion the platform exposes 9 MCP tools: `list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, and `get_agent_status`. MCP compliance shall be maintained against the current stable specification within 60 days of new versions.

**F6.15 — Query Planning**
For natural language and structured semantic queries, the platform shall identify relevant authorized products, evaluate trust scores and compliance states, construct an execution plan, and evaluate access scope and policy compliance.

**F6.16 — Policy-Aware Query Execution**
Query execution shall enforce governance policy in real time across every product touched. A governance policy violation in any component of a federated query shall halt the entire query execution.

**F6.17 — Query Result Provenance**
Every query result shall carry a provenance envelope containing: contributing product versions, trust scores at time of query, governance policy versions in effect, lineage completeness scores, non-determinism markers, and query execution timestamp.

**F6.18 — Cross-Product Join Semantics**
Cross-product joins shall respect all access grants, propagate the highest classification of any joined product to the result, and record a lineage event for all contributing products.

**F6.19 — Query Rate Limiting**
Per-agent rate limits shall be enforced at the query layer infrastructure level.

**F6.20 — Query Result Caching**
The federated query layer shall support result caching within a configurable TTL. Cache invalidation shall occur automatically when any contributing product publishes a new version, updates its schema, or changes compliance state.

**F6.21 — Production-Capable Agent Registration**
Production-capable agents require governance layer acknowledgment, mandatory AI provenance metadata, and mandatory Observed or Supervised trust classification for the first 90 days of operation.

**F6.22 — Agent-Produced Data Product Publication**
A production-capable agent shall publish through the same governance compliance pipeline as human-published products, with additional requirements: complete AI provenance metadata, domain team notification, and a permanent indicator that the product was AI-produced.

**F6.23 — Agent-Produced Product Ownership**
An AI agent shall not be the registered owner of a data product. The owning domain team is always the human owner of record.

**F6.24 — Human Review Workflow**
For Observed trust class agents, a human review workflow shall surface the agent reasoning trace reference, provenance envelope of consumed inputs, proposed product definition, and diff against any prior version.

**F6.25 — Agent Production Audit**
Every production-capable agent publication or modification shall produce a complete, immutable, permanently retained audit record.

**F6.26 — Semantic Data Product Discovery**
Agents shall discover data products through semantic search. Results ranked by trust score, relevance, and compliance state.

**F6.27 — Schema Exploration**
Agents shall programmatically explore the schema of any authorized output port without executing a data query.

**F6.28 — Semantic Annotation**
Domain teams shall add semantic annotations to product schemas. Governance policy shall mandate minimum annotation coverage for products available to agent consumption.

**F6.29 — Lineage-Aware Recommendation**
The federated query layer shall provide agents with lineage-aware product recommendations.

**F6.30 — Version-Aware Consumption**
The platform shall provide a structured version compatibility assessment API that agents query to determine compatibility with new product versions.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF6.1 | Single-product semantic queries under 2s p95; 10-product federated queries under 10s p95 |
| NF6.2 | MCP endpoint 99.99% availability independent of control plane |
| NF6.3 | 10,000 concurrent agent query sessions per organization |
| NF6.4 | Policy evaluation overhead under 200ms p99 |
| NF6.5 | Semantic index reflects new products within 5 minutes |
| NF6.6 | Agent identity isolation enforced at infrastructure level |
| NF6.7 | MCP spec compliance within 60 days of new stable version |

### Out of Scope

- **OS6.1** — Agent development, hosting, or orchestration
- **OS6.2** — Agent reasoning quality evaluation or output validation
- **OS6.3** — Native multi-agent orchestration patterns
- **OS6.4** — [POST-MVP] Natural language query precision improvement
- **OS6.5** — Reasoning trace content storage (references only)
- **OS6.6** — [POST-MVP] Agent financial metering and chargeback
- **OS6.7** — [POST-MVP] Agent anomaly detection and automatic escalation (requires behavioral baseline from production activity tracking; Temporal escalation workflows non-trivial and deferred to Phase 5)
- **OS6.8** — [POST-MVP] Per-domain trust classification (schema scope field is ready; logic deferred)
- **OS6.9** — [POST-MVP] Trust-scope-based search result filtering

---

## Domain 7: Self-Service Experience

### Functional Requirements

**F7.1 — Unified Platform Shell**
Single unified web application. The shell adapts navigation and available actions based on the authenticated principal's role.

**F7.2 — Persona-Adaptive Navigation**
Primary navigation dynamically composed based on principal roles.

**F7.3 — Organization and Domain Context Switching**
A persistent context switcher makes the current active domain always visible and changeable without a full page reload.

**F7.4 — Global Search**
Keyboard-shortcut accessible global search indexing product names, descriptions, tags, domain names, owner names, and semantic annotations.

**F7.5 — Notifications and Activity Feed**
Role-appropriate, actionable notifications deep-linking to relevant platform context.

**F7.6 — Keyboard and Accessibility**
WCAG 2.1 AA compliance. All primary workflows completable via keyboard alone.

**F7.7 — Data Product Authoring Interface**
Structured, guided authoring interface presenting effective policy requirements as a visible checklist. Continuous in-authoring validation.

**F7.8 — Port Configuration UI**
Port-type-specific configuration UI with real-time port validation.

**F7.9 — Schema Editor**
Integrated schema editor supporting: manual field definition, import from connector-inferred schema, import from upstream product output port schema, visual version diff, and semantic annotation authoring.

**F7.10 — SLO Configuration UI**
Guided SLO configuration surfacing the dependency SLO chain during configuration.

**F7.11 — Connector Management UI**
Pre-built connector library with search and filtering, connector-type-specific configuration, inline validation, connector health with historical trend, and guided custom connector registration.

**F7.12 — Product Lifecycle Management UI**
All domain products with current lifecycle state, compliance state, trust score, and active consumer count. Lifecycle actions presented as consequence-surfacing workflows.

**F7.13 — Versioning UI**
Complete version history, currently active versions, consumers per version, and deprecation schedules. MAJOR version publication workflow enforces semantic change declaration. Impact analysis is a mandatory step.

**F7.14 — Domain Team Dashboard**
Operational home: all domain products with current status, domain compliance score, active consumer count, connector health summary, SLO compliance summary, and recent activity.

**F7.15 — Data Product Marketplace**
Primary discovery interface with rich filtering by domain, classification, data type, tag, trust score range, compliance state, and SLO characteristics.

**F7.16 — Data Product Detail Page**
Dedicated page per product presenting: identity and lifecycle state, trust score with breakdown, compliance state, available output ports, schema browser with semantic annotations, observability summary, lineage preview, version history, and access request affordance.

**F7.17 — Trust Score Transparency**
Trust score accompanied by transparent breakdown with plain-language explanation.

**F7.18 — Access Request Workflow**
Direct access request from the product detail page — output port selection, governance acknowledgments, approval routing, real-time status tracking, and on approval: connection details and getting-started guidance.

**F7.19 — Consumer Workspace**
Personal persistent workspace: active access grants with expiration dates, consumed products with current trust scores, deprecation notices, and recommendations.

**F7.20 — Deprecation Impact Management**
Structured deprecation impact experience: deprecation timeline, reason, available replacement products with direct comparison, and a migration planning checklist.

**F7.21 — Governance Command Center**
Unified governance state at a glance. Every metric drillable. Every actionable item executable without leaving the command center.

**F7.22 — Policy Authoring Studio**
Three-panel dedicated experience: policy domain list (left), active policy domain rule builder (main), and persistent impact preview panel (right).

**F7.23 — Rule Builder UX**
Structured plain-language rule composition using dropdown menus. Completed rule displayed as a plain-language sentence confirming intent.

**F7.24 — Impact Preview Panel**
Real-time update as rules are built. Completes within 3 seconds of rule change.

**F7.25 — Classification Taxonomy Manager**
Editable taxonomy hierarchy with impact preview before any change is committed.

**F7.26 — Compliance Drill-Down**
Three-click path from command center summary to individual violation detail.

**F7.27 — Exception Management UI**
Grant, review, and revoke compliance exceptions with expiration countdown and auto-close.

**F7.28 — Domain Compliance Reports UI**
Generate and export domain compliance reports in PDF and CSV. Reports retained for 90 days.

**F7.29 — Lineage Graph Visualization**
Interactive, zoomable, navigable lineage graph with node type visual encoding, trust score and compliance state as visual indicators, depth control, focus mode, non-determinism marker highlighting, and export.

**F7.30 — Lineage Time Travel UI**
Date picker-based time travel mode visually distinct from current state view.

**F7.31 — Impact Analysis Visualization**
For breaking change workflows: all downstream products and consumers highlighted in the lineage graph, with required acknowledgment step.

**F7.32 — Observability Dashboard**
Per-product real-time observability dashboard with all eight metric categories, SLO violation timeline, observability drift alerts, and agent-specific signals section for agent-produced products.

**F7.33 — Trust Score Detail View**
Expandable full trust score detail: current score, historical trend, component contribution breakdown, and actionable improvement recommendations.

**F7.34 — Agent Registry UI**
Register and manage agent identities within domain context with guided registration flow.

**F7.35 — Agent Activity Monitor**
Real-time and historical view per agent identity: query volume, data products accessed, cross-product join patterns, rate limit proximity, and anomaly escalation events.

**F7.36 — Human Review Queue**
For Observed trust class agents: structured review queue with approve, reject with feedback, and request revision actions.

**F7.37 — Agent Trust Classification UI**
Governance teams view and manage agent trust classifications across the organization.

**F7.38 — Organization Administration**
Manage organization tenant configuration, identity provider federation, platform-level role assignments, and audit log access.

**F7.39 — Onboarding Experience**
Guided multi-step onboarding completable in a single session with progress saved for pause and resume.

**F7.40 — Usage and Health Monitoring**
Control plane availability and latency, lineage emission throughput, federated query layer performance, connector health distribution, and usage metrics.

**F7.41 — Progressive Disclosure**
Minimum necessary information presented at first; detail on demand.

**F7.42 — Empty States**
Every list, dashboard, and data surface shall have a contextually appropriate empty state message and call to action.

**F7.43 — Inline Contextual Help**
Every field and configuration option shall have inline contextual help accessible without leaving current context.

**F7.44 — Confirmation and Consequence Surfacing**
Every destructive or consequential action shall require explicit confirmation through a consequence-surfacing dialog.

**F7.45 — Responsive Design**
Fully functional on desktop (1280px+). Tablet support (768px+) for read-only and monitoring experiences.

**F7.46 — Theme Support**
Light and dark themes persisted per principal.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF7.1 | Primary surface initial load within 3 seconds; navigation within 1 second |
| NF7.2 | Lineage visualization 60fps at 500 nodes |
| NF7.3 | UI state reflects platform within 30 seconds of underlying state change |
| NF7.4 | Global search results within 1 second |
| NF7.5 | Current and previous major versions of Chrome, Firefox, Safari, Edge |
| NF7.6 | Internationalization architecture from day one — translations post-MVP |
| NF7.7 | 99.9% UI availability with graceful read-only degradation |

### Out of Scope

- **OS7.1** — [POST-MVP] Mobile application
- **OS7.2** — [POST-MVP] Embedded analytics and custom report building
- **OS7.3** — [POST-MVP] White-labeling and custom tenant branding
- **OS7.4** — [POST-MVP] In-platform data preview
- **OS7.5** — [POST-MVP] AI-assisted data product definition authoring
- **OS7.6** — [POST-MVP] Collaborative simultaneous multi-user definition editing
- **OS7.7** — [POST-MVP] Reference architecture guidance in connector UX — surface recommended architecture patterns during connector registration when eligible stack configurations are detected
- **OS7.8** — [POST-MVP] Consumer connection experience — port-type-specific connection packages generated at access grant time (JDBC connection strings, sample queries, Postman collections, Kafka consumer configs, etc.) tailored to consumer tooling context. F7.18 currently delivers connection details and generic getting-started guidance; this enhancement makes the handoff from access granted to value realized frictionless without entering the query path.

---

## Domain 8: Operations and Workflow State *(new v1.2)*

This domain defines platform-level workflow states that cut across multiple domains. These are not domain-specific constructs — they are first-class platform states managed by Temporal and visible to governance teams.

### Functional Requirements

**F8.1 — Frozen Workflow State**
The platform shall support a `frozen` workflow state for in-flight operations. A frozen operation is suspended pending governance review — it is not cancelled, not rolled back, and not automatically completed. Frozen operations are visible to governance team members and require explicit disposition by a governance role: approve to complete, or cancel.

**F8.2 — Frozen State Trigger: Agent Classification Downgrade**
When an agent's classification is downgraded in any direction, all in-flight operations permitted under the prior classification but not permitted under the new classification shall be immediately transitioned to the `frozen` state. This is the only trigger for the frozen state implemented in Phase 4. Other triggers (domain suspension, policy change mid-workflow) are reserved for future phases.

**F8.3 — Frozen State Visibility**
All frozen operations shall be surfaced in the Governance Command Center with: the operation type, the agent or principal that initiated it, the trigger that caused the freeze, the timestamp of the freeze, and the available disposition actions (approve or cancel).

**F8.4 — Frozen State Audit**
Every transition into and out of the frozen state shall produce an immutable audit log entry with the disposition action taken and the governance principal who took it.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF8.1 | Frozen state transition occurs within 5 seconds of triggering event |
| NF8.2 | Frozen operations remain durable across platform restarts — Temporal ensures state persistence |

### Out of Scope

- **OS8.1** — [POST-MVP] Additional frozen state triggers beyond agent classification downgrade
- **OS8.2** — Automated disposition of frozen operations — always requires explicit human action

---

## Domain 9: Data Product Detail Completeness *(new v1.2)*

This domain defines the target completeness state for the `get_product` MCP tool and the product detail page. It exists to make explicit what is currently available, what is planned, and when. Provenance is under active development — the gaps listed here are known, tracked, and planned. The current implementation demonstrates the core data mesh architecture working end-to-end.

### Current State (Phase 4 Complete)

The following are exposed through the `get_product` MCP tool and verified working:

- Name, slug, lifecycle status, semantic version, classification
- Description and tags
- Domain assignment
- Port definitions (type, name, interface)
- Trust score with component breakdown
- SLO health with trend data (7-day and 30-day pass rates)
- Lineage graph (upstream sources and downstream consumers, including external systems)

### Planned Additions by Phase

| Field / Signal | Priority | Target Phase | Notes |
| --- | --- | --- | --- |
| Column-level schema | 1 | Phase 4c / early Phase 5 | Field names, data types, nullability, descriptions, PK/partition indicators, PII indicators. Schema snapshots exist in DB — surfacing through get_product is a targeted implementation task. |
| Ownership and stewardship | 1 | Phase 4c / early Phase 5 | Data product owner name and contact, domain team name, created_by, created_at, updated_at |
| Data freshness signals | 1 | Phase 4c / early Phase 5 | Last successful refresh timestamp, refresh cadence, freshness SLA, freshness compliance state (fresh/stale/unknown) |
| Access status for requesting principal | 1 | Phase 4c / early Phase 5 | Current access status (granted/pending/not requested/denied), how to request access, expected approval time, access expiration date if grant exists |
| Data quality signals | 2 | Phase 5 | Known quality issues or caveats (owner-supplied), completeness metrics on key fields, row count indication, last quality assessment timestamp |
| Versioning and change history | 2 | Phase 5 | Human-readable changelog, breaking vs non-breaking per version, semantic change declaration, deprecation notice with replacement reference |
| Contractual and compliance metadata | 2 | Phase 5 | Terms of use, data retention policy, regulatory classification (GDPR/HIPAA/CCPA), PII fields summary |
| Volume and performance | 2 | Phase 5 | Approximate row count, typical query latency for SQL ports, rate limits for REST ports, streaming throughput |
| Sample data | 3 | Post-Phase 5 | Non-PII preview rows, opt-in by domain team |
| Related products | 3 | Post-Phase 5 | Products in same domain or with overlapping lineage |
| Consumer count | 3 | Post-Phase 5 | Number of principals actively consuming this product |
| Popularity signal | 3 | Post-Phase 5 | Query frequency over last 30 days |
| Community annotations | 3 | Post-Phase 5 | Consumer-supplied notes and ratings |

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF9.1 | get_product response shall include all Phase 4c additions without degrading current response time targets |

---

## Infrastructure Readiness

These non-functional requirements define the thresholds at which the Phase 5 (Open Source Ready) EC2 infrastructure is no longer sufficient and Phase 6 (Production Scale) planning or migration must be initiated. They exist to prevent the platform from degrading silently and to ensure that the transition to managed infrastructure is proactive rather than reactive.

**NF-IR.1 — Disk Utilization Threshold**
When primary EC2 EBS volume utilization exceeds 75% sustained over a 7-day period, Phase 6 planning shall be initiated. When utilization exceeds 90%, Phase 6 migration shall be treated as urgent.
*Rationale:* PostgreSQL, Neo4j, and audit log growth are the primary drivers. At 75% there is still runway to plan and execute migration without emergency. At 90% the risk of service disruption from disk exhaustion is real.

**NF-IR.2 — Memory Pressure Threshold**
When average memory utilization on the primary EC2 instance exceeds 80% sustained over a 72-hour period, Phase 6 planning shall be initiated. When memory utilization causes any service to restart due to OOM conditions more than twice in a 30-day period, Phase 6 migration shall be treated as urgent.
*Rationale:* All platform services share the same memory pool on the primary instance. Sustained high memory utilization causes unpredictable service degradation across all tenants simultaneously.

**NF-IR.3 — API Response Time Degradation**
When p95 API response time for standard control plane operations (product definition validation, marketplace search, trust score retrieval) exceeds 3x the baseline established during Phase 5 commissioning, sustained over a 48-hour period, Phase 6 planning shall be initiated.
*Rationale:* Response time degradation under multi-tenant load is the most user-visible signal that the shared infrastructure is insufficient. 3x baseline provides a meaningful buffer before user experience is materially affected.
*Dependency:* Baseline measurement requires Phase 5 workstream 5.1 (Stability and Reliability) monitoring to be in place first.

**NF-IR.4 — MCP Query Degradation**
When p95 MCP tool response time for single-product queries exceeds 5 seconds (against the 2 second target in NF6.1) sustained over a 24-hour period, Phase 6 planning shall be initiated.
*Rationale:* Agent query performance is the most sensitive capability — agents operating at machine speed are more affected by latency than human users. Degradation here is a direct signal that the shared compute is insufficient for the agent workload.

**NF-IR.5 — Recovery Time Objective**
The platform shall be recoverable from a complete primary EC2 instance failure within 4 hours using the backup and restore procedures established in Phase 5. If actual recovery from any incident exceeds 4 hours, Phase 6 migration shall be treated as urgent.
*Rationale:* A 4-hour RTO is acceptable for an open source pre-revenue platform with design partners but is not acceptable for paying customers with SLAs. Exceeding this threshold signals that the business has outgrown the EC2 architecture.
*Dependency:* Recovery procedures depend on Phase 5 workstream 5.1 (Stability and Reliability) backup infrastructure being in place first.

**NF-IR.6 — Tenant Scale Threshold**
When the platform reaches 10 active organizations or 5,000 published data products, Phase 6 planning shall be initiated regardless of whether performance thresholds have been breached.
*Rationale:* Multi-tenant load at this scale introduces resource contention patterns that are difficult to predict and debug on shared infrastructure. Planning should begin before problems emerge.

**NF-IR.7 — Backup Restore Validation**
Phase 5 backup procedures shall be validated by a successful test restore at least once per quarter. If a test restore fails or exceeds 2 hours, Phase 6 planning shall be initiated.
*Rationale:* A backup that has never been successfully restored is not a backup. Failure to restore within 2 hours signals that the recovery process is too complex for the current setup.
*Dependency:* Backup procedures depend on Phase 5 workstream 5.1 (Stability and Reliability) being complete first.

**NF-IR.8 — Concurrent Session Threshold**
When the platform sustains more than 50 concurrent MCP sessions over a 24-hour period, performance shall be benchmarked against NF6.1 targets. If targets are not met at this concurrency level, Phase 6 planning shall be initiated.
*Rationale:* 50 concurrent MCP sessions is a reasonable proxy for meaningful multi-tenant agent workload that the EC2 setup may not handle without degradation.

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
| Operations and Workflow State | | | Primary | Subject | |
| Data Product Detail Completeness | Primary (owner) | Primary (consumer) | Oversight | Primary | |
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
| Agent anomaly detection and Temporal escalation | 6 | Phase 5 deliverable |
| Per-domain agent trust classification | 6 | Schema scope field ready; logic deferred |
| Trust-scope-based search result filtering | 6 | Audit infrastructure confirmed; filtering deferred |
| Mobile application | 7 | Broader reach post-stabilization |
| Embedded analytics and custom report building | 7 | Self-service analytics layer |
| White-labeling and custom tenant branding | 7 | Enterprise and OEM use case |
| In-platform data preview | 7 | High-value consumer experience |
| Collaborative simultaneous definition editing | 7 | Team authoring workflow |
| Reference architecture guidance in connector UX | 7 | Adoption accelerator |
| Consumer connection experience | 7 | Port-type-specific connection packages at access grant time |
| Additional frozen state triggers | 8 | Domain suspension, policy change mid-workflow |
| Audit log pattern analysis and anomaly detection | 8 | Phase 5 — requires behavioral baseline |

---

### Phase 6 — Production Scale (When Funded)

These capabilities require significant infrastructure investment and belong in a funded future state. They are not appropriate for an open source pre-revenue project. Phase 6 is triggered by enterprise customer requirements, investor funding, or both.

| Capability | Trigger |
| --- | --- |
| Kubernetes / EKS migration | Enterprise customers or team scale requires it |
| Amazon Aurora PostgreSQL | Database reliability SLA required by customers |
| Amazon Neptune | Graph database scale or managed SLA required |
| Amazon MSK | Kafka operational burden at scale |
| Amazon OpenSearch Service | Search reliability SLA required |
| Temporal Cloud | Workflow engine managed SLA required |
| mTLS between services | Enterprise security posture required |
| WAF and advanced security tooling | Enterprise security requirements or compliance audit |
| Multi-AZ and cross-region replication | Customer data residency or DR requirements |
| Datadog / full observability stack | Engineering team scale requires it |
| CloudFront CDN | Global performance requirements |
| Formal SOC 2 Type II audit | Enterprise sales requirement |
| Kong API gateway full activation | Enterprise API management requirements |
| Keycloak HA configuration | Identity provider uptime SLA required |

---

## Appendix C: Key Design Decisions

| Decision | Position | Rationale |
| --- | --- | --- |
| AI Agents as First-Class Persona | Agents are the highest-priority persona in Data 3.0 | Agents operate at machine speed, require programmatic interfaces, and create new governance challenges that must be designed for from the start |
| Dual Consumption Model | Humans connect to output ports directly. Agents use a governed federated semantic query layer | Neither model serves both personas well |
| Declarative UI for Governance Policy | Governance policy is authored through a declarative UI, not code | Humans want to do less, not more |
| AI Provenance as Default-On | AI provenance metadata is enabled by default | In an agentic world, provenance is a trust primitive |
| Semantic Change Declaration | MAJOR version increments require a structured declaration of meaning changes | Agents consume data based on semantic understanding |
| Agent Identity Never Deleted | Agent identities are retired, not deleted | An agent that produced data products must remain attributable in perpetuity |
| MCP as First-Class Protocol | The platform exposes a fully compliant MCP server endpoint | MCP is the standard protocol for agent-to-tool interaction |
| Active Discovery at Registration | Connectors implement discovery mode to automatically crawl metadata and lineage | Manual lineage and metadata declaration is not realistic at scale |
| Capability Manifest as Governance Guardrail | All connectors declare capabilities; governance extensions bounded by manifest | Prevents governance from requiring metadata connectors cannot provide |
| Domain-Declared Metadata Takes Precedence | Discovery does not auto-override domain-declared metadata without governance opt-in | Domain teams are the authoritative source of truth |
| Autonomous Classification Requires Explicit Human Action | Autonomous tier can never be assigned by automated process | The trust level with the least friction must never be granted without deliberate human intent |
| Anomaly Detection Deferred to Phase 5 | Anomaly detection requires production behavioral baseline | Building detection before real data exists produces arbitrary thresholds and false positives |
| Frozen State as Platform-Level Construct | Frozen is a Temporal workflow state, not an agent-specific concept | The pattern will be needed beyond agent classification downgrade in future phases |
| Lean Phase 5 — Open Source Ready | Phase 5 focuses on reliability, security, and developer experience on existing infrastructure. Expensive managed services and Kubernetes deferred to Phase 6. | Provenance is an open source platform pre-revenue and pre-investment. Infrastructure spend must match the business stage. The architecture is designed so Phase 6 is a configuration migration, not a rewrite. Phase 6 is triggered by customers or funding, not a calendar date. |

---

## Appendix D: Phase 5 Scope — Open Source Ready *(revised v1.3)*

Phase 5 is redefined as "Open Source Ready." The goal is to make the platform reliable, secure, and contributor-friendly on existing infrastructure. No significant new cloud spend. The expensive infrastructure migration originally planned for Phase 5 is moved to Phase 6 — it belongs in a funded future state, not an open source pre-revenue project.

**Estimated additional monthly infrastructure cost for Phase 5: $10-30.**

---

### 5.1 — Stability and Reliability ✅ Complete (April 17, 2026)

- Automated daily backups for PostgreSQL and Neo4j with documented and tested restore procedure
- Docker restart policies ensuring all services auto-recover on failure without manual intervention
- CloudWatch basic monitoring — EC2 health, disk usage, memory thresholds, alerting on critical failures
- Operational runbook documenting recovery procedures for common failure scenarios
- Log rotation configured to prevent disk exhaustion

### 5.2 — Security Essentials 🔄 Partially Complete (April 17, 2026)

- 🔄 HTTPS enforced on all external endpoints — Caddy reverse proxy installed on the EC2 dev host with a valid Let's Encrypt certificate live at https://dev.provenancelogic.com. Keycloak realm/client redirect URIs, web origins, and `VITE_KEYCLOAK_URL` / `VITE_API_BASE_URL` wiring for the new domain are pending the next session.
- ✅ Security group audit — all EC2 security groups reviewed and tightened; no ports open that are not required
- 🔄 Credentials rotation — MCP API key rotated this session; full rotation procedure and schedule for remaining secrets pending
- ☐ Environment variable audit — verified no secrets in code, logs, or version control
- ☐ SSH key management — reviewed, documented, unnecessary access revoked

### 5.3 — JWT Agent Authentication ✅ Complete (April 16, 2026)

Replaced the X-Agent-Id header MVP shortcut with cryptographically verified agent identity (ADR-002).

- Agent registration provisions a dedicated Keycloak client per agent via `client_credentials` grant
- Agent Query Layer validates JWT Bearer tokens on every MCP request (RS256 via JWKS, exp, iss, `principal_type=ai_agent`)
- Verified `agent_id` and `provenance_org_id` claims extracted from JWT — identity is cryptographic, not self-reported
- `agent_id` removed from all MCP tool input schemas — sourced from session identity
- Agent Query Layer forwards verified identity to control plane via `X-Agent-Id` / `X-Org-Id` headers (internal service-to-service only)
- `POST /agents/:agentId/rotate-secret` — secret rotation for governance members and oversight contacts
- `POST /agents/:agentId/provision-credentials` — one-time migration for pre-existing agents
- V14 migration adds `keycloak_client_provisioned` flag to `identity.agent_identities`
- 30-day deprecation mode (`DEPRECATION_WARNING_ONLY`) for backward compatibility during migration
- Keycloak is already running — no new infrastructure required. Zero additional cost.

### 5.4 — Data Product Completeness — Priority 1

Surface data that already exists in the platform through the agent interface and product detail page.

- Column-level schema in `get_product` response — field names, data types, nullability, descriptions, PK/partition indicators, PII indicators (from `connectors.schema_snapshots`)
- Ownership and stewardship contacts in `get_product` response — owner name and contact, domain team name, created_by, created_at, updated_at
- Data freshness signals in `get_product` response — last successful refresh timestamp, refresh cadence, freshness SLA, freshness compliance state
- Access status for requesting principal in `get_product` response — granted/pending/not requested/denied, how to request, expected approval time, expiration date if grant exists

No new infrastructure. All data exists in the platform today.

### 5.5 — Agent Anomaly Detection

Build on the audit log and Temporal infrastructure already running.

- Behavioral pattern analysis against audit log — query volume spikes, unusual access patterns, cross-product join anomalies
- Configurable thresholds per trust classification tier
- Temporal escalation workflows — automated notification to human oversight contact on threshold breach
- Automatic agent suspension on sustained anomaly above configurable limit pending governance review
- No new infrastructure — Temporal and audit log already operational

### 5.6 — Developer Experience

Make it easy for contributors to understand, run, and contribute to the platform.

- Local setup working in under 30 minutes from a clean clone on Mac and Linux
- `CONTRIBUTING.md` with clear guidelines — development setup, coding patterns, PR process, ADR expectations
- Comprehensive seed data covering all entity types, lifecycle states, and agent scenarios for local development
- OpenAPI documentation published and accessible from the running platform
- README updated to reflect current actual state of the platform

### 5.7 — SOC 2 Foundations

Documentation and process work that costs nothing but time — positions the platform for a formal SOC 2 engagement when the business warrants it.

- Data flow documentation — what data the platform holds, where it lives, how long it is retained
- Access control documentation — who has access to what and how that is managed
- Incident response runbook — what happens when something goes wrong
- Audit log export capability — structured export for external compliance audit consumption
- Change management documentation — how code changes are reviewed and deployed

---

### Out of Scope for Phase 5 — Deferred to Phase 6

The following were originally planned for Phase 5 but are deferred to Phase 6 ("Production Scale"). They belong in a funded future state when customers or investors require and can fund them.

- Kubernetes / EKS migration
- Amazon Aurora PostgreSQL (replacing self-hosted PostgreSQL)
- Amazon Neptune (replacing self-hosted Neo4j)
- Amazon MSK (replacing self-hosted Redpanda)
- Amazon OpenSearch Service (replacing self-hosted OpenSearch)
- Temporal Cloud (replacing self-hosted Temporal)
- mTLS between services
- WAF and advanced security tooling
- Multi-AZ and cross-region replication
- Datadog / full observability stack
- CloudFront CDN
- Formal SOC 2 Type II audit engagement
