# Provenance Product Requirements Document

**Version 1.5**
**Confidential - Not for Distribution**

> **Changelog - v1.4 to v1.5**
> New Domain 12: Connection References and Per-Use-Case Consent - first-class per-use-case authorization layer composing with the existing access grant model. Covers connection reference lifecycle, use-case declaration (hybrid taxonomy plus free-text), request flow by trust classification, consent capture, version behavior (MAJOR version suspends active references), runtime scope enforcement, revocation and expiration, legacy agent migration, and complete audit trail.
>
> Domain 11: F11.27 added - Connection Package Refreshed notification, required by ADR-008.
>
> Appendix A: Domain 12 row added to persona-to-capability mapping.
>
> Appendix B: Domain 12 post-MVP items added.
>
> Appendix C: Two new design decisions added - Connection Reference as Composition Primitive, Per-Use-Case Consent Required for All Agent Access.
>
> **Changelog - v1.3 to v1.4**
> Major revision following human walkthrough of the platform. All development halted until documentation complete.
>
> New Domain 10: Self-Serve Infrastructure - first-class treatment of Dehghani's third principle including user registration, onboarding flows, port connection details as a required publication field, and connection package generation for human and agent data engineers
>
> New Domain 11: Notifications - complete notification domain covering all triggers, delivery mechanisms, and recipients
>
> Domain 7 rewritten: Persona-driven UI architecture with explicit requirements per persona (Domain Admin, Consumer, Governance, Agent Management). Role assignment UI added. Two-view inconsistency resolved. Search and discovery gaps addressed.
>
> Domain 5: F5.15, F7.29, F7.30, F7.31 updated - React Flow with Dagre layout replaces D3 force-directed graph. ADR-002 documents this decision.
>
> Domain 2: F2.12 updated - port connection details added as a platform-enforced publication requirement.
>
> Access workflow gaps addressed: SLA enforcement, escalation path, consumer visibility into response time.
>
> Implementation status tags added to all requirements: Implemented, Partially implemented, Not implemented.
>
> Open source readiness flags added to all gaps: Blocker or Post-launch.
>
> Em dashes removed throughout. Replaced with hyphens in compound modifiers, semicolons or commas in prose.

---

## Executive Summary

Provenance is a cloud-native, multi-tenant self-service data mesh platform designed for the Data 3.0 era. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

The platform embodies the data mesh principles articulated by Zhamak Dehghani while extending them for the agentic AI era through a dual consumption model: human consumers connect directly to data product output ports, and AI agents interact through a governed, policy-aware federated semantic query layer.

Provenance is a coordination and contract platform. It does not store data, execute pipelines, or provide a centralized query engine for human consumers. It owns the contracts between domains, the lineage graph that connects them, and the governance engine that makes the mesh trustworthy.

### Five Foundational Design Principles

1. **Domain sovereignty with interoperability contracts** - domains own their data and pipelines; the platform owns the contracts between them and the lineage graph that connects them
2. **Ports are definitional** - a dataset without explicit ports is not a data product on this platform; a port without connection details is not self-serve
3. **Governance as a policy engine** - the federated governance team defines a minimum viable policy floor; domains extend upward; the platform enforces both computationally, never manually
4. **Dual consumption model** - humans discover and connect to output ports directly; AI agents interact through a semantic federated query layer that is policy-aware in real time
5. **Lineage by emission and discovery, not capture** - the platform assembles a complete lineage graph from active discovery at connector registration, events emitted by domain pipelines, and agent reasoning traces without owning pipeline execution

### Four Personas (Priority Order for Data 3.0)

1. AI Agents - autonomous consumers and potential producers of data products
2. Domain Teams - human owners and publishers of data products
3. Data Consumers - human discoverers and users of data products
4. Governance Teams - policy authors and compliance monitors

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

**Implementation status tags used in the companion Implementation Status document:**
- Implemented - fully built and verified
- Partially implemented - built but incomplete or not verified
- Not implemented - not yet built

**Open source readiness flags:**
- Blocker - must be resolved before the platform can be presented as open source ready
- Post-launch - important but not required for initial open source release

---

## Domain 1: Multi-Tenancy and Organization Model

### Functional Requirements

**F1.1 - Organization as Top-Level Tenant**
The platform shall support multiple organizations as fully isolated top-level tenants. No data, metadata, policy, or identity shall be shared across organization boundaries under any circumstance.

**F1.2 - Domain as First-Class Entity**
Within an organization, the platform shall support the creation and management of domains as first-class entities. A domain represents a bounded business context owned by a specific team and is the unit of data product ownership.

**F1.3 - Domain Namespacing**
Every domain shall have a globally unique, human-readable namespace within its organization. All data products, ports, and policies shall be addressable via a hierarchical namespace: `{org}/{domain}/{product}/{port}`.

**F1.4 - Governance Layer as Distinct Entity**
Each organization shall have exactly one federated governance layer, a distinct entity separate from all domains that holds authority to define and publish the minimum viable policy floor. The governance layer cannot own data products.

**F1.5 - Identity and Principal Model**
The platform shall support four distinct principal types: Human users, Service accounts (automated pipelines), AI agent identities (distinct from service accounts), and Platform administrators (strictly separated from org-level governance).

**F1.6 - Role Assignment**
The platform shall support role assignment at organization, domain, and data product level. Minimum roles: Governance Author, Domain Owner, Data Product Owner, Data Product Consumer, Platform Observer.

**F1.7 - Domain Autonomy Boundaries**
No domain shall read, write, or administer another domain's internal configuration, pipelines, or unpublished data products. Cross-domain interaction is permitted only through published output ports.

**F1.8 - Multi-Cloud Tenant Isolation**
The platform shall support organizations whose data infrastructure spans multiple cloud providers. The control plane is SaaS; the data plane remains in the domain's own infrastructure regardless of cloud provider.

**F1.9 - Self-Service Org Onboarding**
New organization onboarding shall require no platform operator involvement. See Domain 10 for the complete self-serve infrastructure requirements.

**F1.10 - Domain Lifecycle Management**
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

- **OS1.1** - Internal org structure and team membership management beyond role assignment
- **OS1.2** - Domain infrastructure provisioning and management
- **OS1.3** - [POST-MVP] Sub-tenancy / business-unit hierarchy above the domain level

---

## Domain 2: Data Product Definition and Lifecycle

### Functional Requirements

**F2.1 - Data Product as Governed Entity**
The platform shall treat a data product as a first-class, versioned, governed entity with an explicit owner, contract, and lifecycle state at all times.

**F2.2 - Data Product Definition as Code**
Every data product shall have a machine-readable definition, a declarative specification fully describing its identity, ports, schema, SLOs, governance attributes, and lineage declarations.

**F2.3 - Governance-Configured Product Schema**
Required attributes in a data product definition shall not be hardcoded. The governance layer shall define a configurable, versioned product schema specifying mandatory, recommended, and optional attributes.

**F2.4 - Domain-Level Schema Extension**
A domain shall define additional required or recommended attributes on top of the governance floor. Extensions shall not contradict or weaken governance-layer attributes.

**F2.5 - Product Schema Versioning**
The governance layer's product schema shall itself be versioned with configurable grace periods for compliance.

**F2.6 - Ports as Definitional**
A data product shall not be valid or publishable without at minimum one output port and one discovery port declared.

**F2.7 - Port Types**
The platform shall support five port types: Input Ports, Output Ports, Discovery Ports, Observability Ports, and Control Ports.

**F2.8 - Output Port Interface Types**
Six output port types shall be supported: SQL/JDBC endpoint, REST API endpoint, GraphQL endpoint, Streaming topic, File/object export, and Semantic query endpoint (for agent consumption). Every output port declaration shall include complete connection details as a required field. Connection details are port-type-specific and defined in Domain 10.

**F2.9 - Port Contract Enforcement**
Each declared port shall have an associated machine-readable contract monitored by the platform. Violations shall be surfaced to all authorized consumers.

**F2.10 - Input Port Dependency Declaration**
When a product declares input ports referencing other products, the platform shall register those dependencies in the lineage graph automatically.

**F2.11 - Lifecycle States**
Every data product shall exist in exactly one state: Draft, Published, Deprecated, or Decommissioned.

**F2.11a - Lifecycle Transition Endpoints**
The platform shall expose explicit `POST .../deprecate` and `POST .../decommission` endpoints for lifecycle state transitions. Both transitions shall trigger automatic removal of the product from the semantic search index. Index removal is fire-and-forget and does not block the lifecycle transition from completing.

**F2.11b - Mutable Fields on Published Products**
The fields `name`, `description`, and `tags` shall be mutable on published products without requiring a version increment. Changes to any of these fields on a published product shall trigger automatic re-indexing in the semantic search index. Re-indexing is fire-and-forget and does not block the update from completing.

**F2.12 - Publication Requirements** *(amended v1.4)*
A product shall transition from Draft to Published only when all of the following are satisfied: the definition is valid against the effective product schema; all declared ports have valid contracts; all declared output ports have complete connection details populated; a product owner is assigned; and all governance-mandatory attributes are populated. Connection details completeness is a platform-enforced requirement and cannot be waived by domain policy or governance override. A data product without complete connection details on all output ports is not self-serve and shall not be published.

**F2.13 - Deprecation Process**
Initiating deprecation shall notify all active consumers, block new access grant requests, and record the deprecation rationale.

**F2.14 - Deprecation Override**
The governance layer shall have authority to accelerate or block a domain team's deprecation action.

**F2.15 - Decommissioning Guard**
A product shall not be transitionable to Decommissioned while it has active consumers. The governance layer may override with documented justification.

**F2.16 - Semantic Versioning**
Every data product definition shall carry a semantic version (MAJOR.MINOR.PATCH) with enforced contracts per level.

**F2.17 - Simultaneous Major Version Support**
The number of simultaneously active major versions permitted shall be governance-configurable. Platform default is two.

**F2.18 - Semantic Change Declaration**
When a MAJOR version increment occurs, the data product owner shall provide a structured semantic change declaration describing what the data means differently, not just what the schema changed.

**F2.19 - Version Deprecation Schedule**
When a new MAJOR version is published, the platform shall automatically initiate a deprecation schedule for the previous MAJOR version.

**F2.20 - Classification as Mandatory Governance Attribute**
Every data product shall carry a data classification defined by the governance layer's taxonomy.

**F2.21 - Classification Inheritance**
A domain team shall not classify an output product at a lower sensitivity level than its most sensitive input product without explicit governance override.

**F2.22 - Governance-Configured Metadata**
Metadata attributes required on a data product shall be fully configurable by the governance layer. The platform shall ship with a DCAT-aligned baseline.

**F2.23 - Lineage Declaration**
Domain teams shall declare transformation lineage within a data product definition at a logical level. Declared lineage shall be supplemented by emitted lineage events from pipelines.

**F2.24 - AI Provenance Metadata**
When a data product is produced or transformed by an AI agent, the product definition shall carry AI provenance metadata by default. The governance layer may configure specific attributes but may not disable AI provenance capture without documented justification.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF2.1 | Definition validation under 2 seconds |
| NF2.2 | Publication atomicity - no partial state |
| NF2.3 | Product schema updates without platform downtime |
| NF2.4 | Open, documented, portable definition format |
| NF2.5 | Immutable audit records for all state transitions and governance events |

### Out of Scope

- **OS2.1** - [POST-MVP] AI-assisted definition authoring
- **OS2.2** - Pipeline execution and scheduling
- **OS2.3** - Data storage - platform holds metadata and contracts only
- **OS2.4** - Data quality computation

---

## Domain 3: Connectivity and Source Integration

### Functional Requirements

**F3.1 - Connector as First-Class Entity**
The platform shall provide a connector framework through which domain teams register external data sources. Connectors are owned by domains and represent authenticated links between the platform control plane and domain infrastructure.

**F3.2 - Connector Library**
The platform shall ship with pre-built connectors covering: Relational Databases (PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, Cloud Spanner), Cloud Warehouses/Lakehouses (Snowflake, BigQuery, Redshift, Databricks, Microsoft Fabric), NoSQL (MongoDB, Cassandra, DynamoDB, Elasticsearch/OpenSearch), Streaming (Kafka, Kinesis, Pub/Sub, Event Hubs, Pulsar), Object Storage (S3, GCS, ADLS, SFTP), SaaS Applications (Salesforce, HubSpot, ServiceNow, Workday, Stripe), APIs (Generic REST, Generic GraphQL), and Ingestion Platforms (Fivetran).

**F3.3 - Connector Extensibility**
The platform shall provide a documented connector SDK for custom connector development. All connectors, pre-built and custom, shall declare a capability manifest at registration time. The capability manifest is a structured, machine-readable declaration of supported capabilities including: discovery metadata categories supported, metadata fields per category, whether discovery mode is implemented, and lineage granularity (asset-level, column-level, or none). Capability manifests are immutable for a given connector version. The platform shall validate capability manifests at registration time and reject connectors with malformed or incomplete manifests.

**F3.4 - Connector Validation**
Upon registration, the platform shall perform a connectivity test. Connectors that fail validation shall not be associatable with data product input ports.

**F3.5 - Connector Health Monitoring**
The platform shall continuously monitor registered connector health and propagate health state to the observability port of dependent data products.

**F3.6 - Credential Management**
The platform shall never store raw credentials. All authentication secrets shall be managed via AWS Secrets Manager, Google Cloud Secret Manager, Azure Key Vault, or HashiCorp Vault.

**F3.7 - Connector Scope Isolation**
A connector registered by one domain shall not be accessible, visible, or usable by any other domain.

**F3.8 - Source Registration**
A source-aligned domain team shall register an external source via a connector and associate it with data product input ports, capturing: connector reference, source object reference, access pattern, and expected refresh cadence.

**F3.9 - Schema Inference**
Upon successful source registration, the platform shall offer schema inference for domain team review and confirmation. Schema inference shall never be auto-applied without explicit acceptance.

**F3.10 - Schema Drift Detection**
The platform shall monitor for schema drift and surface drift events to the domain team. Unresolved schema drift beyond a governance-configurable threshold shall surface as a contract violation on affected output ports.

**F3.11 - Source Lineage Registration**
When a domain team registers a source via a connector, the platform shall automatically create a lineage node for that source in the organization's lineage graph.

**F3.12 - Data Product as Input Source**
A domain team building an aggregate or consumer-aligned product shall declare another published data product as an input source via its output port.

**F3.13 - Access-Gated Input Declaration**
A domain team shall not declare an input port dependency on a product without an active access grant.

**F3.14 - Inter-Product Schema Propagation**
When a domain team declares a product input port referencing another product's output port, the platform shall make the upstream schema available in the authoring context automatically.

**F3.15 - Inter-Product SLO Dependency**
The platform shall compute a dependency SLO chain and surface it during product definition authoring.

**F3.16 - Lineage Emission Endpoint**
The platform shall expose an authenticated, rate-limited lineage emission API endpoint conforming to the platform's open lineage event schema.

**F3.17 - Lineage Emission SDK**
The platform shall provide a lightweight open-source lineage emission SDK in Python, Java, Scala, and JavaScript/TypeScript.

**F3.18 - Observability Emission Endpoint**
The platform shall expose an observability emission API endpoint for domain pipelines to emit quality, freshness, and completeness metrics.

**F3.19 - Webhook and Event Notification**
The platform shall support outbound webhook notifications for control port interactions.

**F3.20 - CI/CD Integration**
The platform shall expose definition validation and publication APIs suitable for CI/CD integration. Reference implementations for GitHub Actions and GitLab CI.

**F3.21 - Semantic Query Port Registration**
For products declaring a semantic query output port, the platform shall manage registration, authentication, and routing to the federated agent query layer.

**F3.22 - Agent Source Discovery**
The federated agent query layer shall have read access to connectivity metadata of all products an agent is authorized to consume. The agent layer sees product interfaces, never source credentials or internals.

**F3.23 - Connector Discovery Mode**
Connectors for supported systems shall implement a discovery mode that, upon successful registration, actively crawls the connected system for available metadata and lineage. Discovery results are ingested into the platform's metadata store and lineage graph automatically, without requiring domain team input.

**F3.23a - Discovery Metadata Taxonomy**
Connectors implementing discovery mode shall populate metadata across five standard categories where the connected system exposes them: Structural Metadata (schemas, tables, columns, data types, key relationships), Descriptive Metadata (asset names, descriptions, tags, classifications), Operational Metadata (ownership, stewardship, timestamps, refresh cadence, SLO declarations), Quality Metadata (data quality tests, freshness expectations, completeness signals), and Governance Metadata (sensitivity classifications, access control policies, regulatory designations, retention policies). Connectors shall report a discovery coverage score per category. The taxonomy is governance-configurable but governance extensions may only apply to connectors that have declared support in their capability manifest.

**F3.24 - Discovery Scope: Databricks**
The Databricks connector shall implement discovery mode against Unity Catalog. On registration, the platform shall ingest table and column-level metadata, ownership, tags, and descriptions; column-level lineage from Unity Catalog's lineage API; and notebook and job lineage where available.

**F3.25 - Discovery Scope: dbt**
The dbt connector shall implement discovery mode by ingesting the dbt project manifest (manifest.json) and catalog (catalog.json), extracting full node-level and column-level lineage, model and column descriptions, test definitions as quality metadata, and source declarations as upstream lineage edges.

**F3.26 - Discovery Scope: Snowflake**
The Snowflake connector shall implement discovery mode against Snowflake's Information Schema and Access History, ingesting table and column metadata, query history-derived lineage, and object ownership as governance metadata.

**F3.27 - Discovery Scope: Fivetran**
The Fivetran connector shall implement discovery mode via the Fivetran Metadata API, ingesting schema mappings, sync cadence as observability metadata, and making best-effort attempts to represent upstream source systems as lineage nodes. Partial lineage is recorded and flagged as incomplete rather than omitted.

**F3.28 - Discovery Re-crawl**
Connectors implementing discovery mode shall support configurable re-crawl schedules performing delta discovery. Re-crawl frequency shall be governance-configurable with a platform default of 24 hours.

**F3.29 - Discovery Conflict Resolution**
Where discovered metadata conflicts with domain-declared metadata, the platform shall surface the conflict to the domain team for resolution. Domain-declared metadata takes precedence until explicitly reconciled unless the governance layer has configured automatic discovery override, in which case discovered metadata shall be applied and the prior domain-declared value preserved in audit history.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF3.1 | New connectors addable without platform downtime |
| NF3.2 | Connector validation within 10 seconds |
| NF3.3 | Schema inference for relational, warehouse, lakehouse at MVP |
| NF3.4 | Lineage emission: 10,000 events/sec, 100ms p99 latency |
| NF3.5 | Credential zero-knowledge - architecturally enforced, audit-verifiable |
| NF3.6 | SDK minimal dependency footprint |
| NF3.7 | Connector failure isolation - zero cross-domain impact |
| NF3.8 | Discovery crawl completion within 30 minutes for sources up to 10,000 objects |
| NF3.9 | Discovery coverage score available within 60 seconds of crawl completion |

### Out of Scope

- **OS3.1** - Data extraction, transformation, or loading
- **OS3.2** - Pipeline execution environment
- **OS3.3** - [POST-MVP] Schema inference for streaming, NoSQL, file sources
- **OS3.4** - [POST-MVP] Managed private connectivity
- **OS3.5** - Cross-domain connector sharing

## Domain 4: Governance Engine

> A deliberate design decision: governance policy is authored through a declarative UI, not code. The governance team should not need to become engineers to govern effectively.

### Functional Requirements

**F4.1 - Governance as Computation, Not Process**
The platform shall enforce governance rules computationally and automatically.

**F4.2 - The Right Thing Is the Easy Thing**
Compliant behavior shall always be the path of least resistance for every persona.

**F4.3 - Governance Layer Separation**
The governance layer shall be architecturally and operationally separate from all domain activity.

**F4.4 - Declarative Policy UI**
All governance policy shall be authored through a structured, declarative web interface. No coding, scripting, or query language knowledge shall be required.

**F4.5 - Policy as Versioned Artifact**
Every policy shall be stored as a versioned, machine-readable artifact. Complete version history shall be maintained.

**F4.6 - Policy Domains**
The governance UI shall organize policy into eight independently configurable domains: Product Schema Policy, Classification Taxonomy Policy, Versioning and Deprecation Policy, Access Control Policy, Lineage Policy, SLO Policy, Agent Access Policy, and Interoperability Policy.

**F4.7 - Policy Rule Builder**
A point-and-click rule builder shall allow governance teams to construct conditional rules using dropdown menus. The completed rule shall display as a plain-language sentence confirming intent.

**F4.8 - Policy Impact Preview**
Before publishing a policy change, the UI shall present a preview showing affected products and estimated remediation effort, generated from live platform data within 3 seconds.

**F4.9 - Policy Grace Periods**
Policy changes that make existing compliant products non-compliant shall require a configured grace period. Grace periods shall never be zero for breaking policy changes.

**F4.10 - Policy Templates**
The platform shall ship with governance policy templates aligned to GDPR, CCPA, HIPAA, SOC 2, and data mesh best practices.

**F4.11 - Global Policy Floor**
Policies published by the governance layer constitute the global policy floor. Domains cannot opt out of, weaken, or override floor policies.

**F4.12 - Domain Policy Extensions**
Domain teams shall define policy extensions within their domain, additive only, never contradictory to the floor.

**F4.13 - Effective Policy Computation**
For any data product, the platform shall compute and expose the effective policy, the union of the governance floor and all applicable domain extensions.

**F4.14 - Extension Inheritance Transparency**
The effective policy view shall clearly indicate for each rule whether it originates from the governance floor or a domain extension.

**F4.15 - Cross-Domain Policy Visibility**
Governance teams shall have visibility into all domain policy extensions.

**F4.16 - Publication-Time Enforcement**
The platform shall enforce the effective policy at publication time with plain-language descriptions and remediation guidance for all violations.

**F4.17 - Continuous Compliance Monitoring**
The platform shall continuously detect compliance drift.

**F4.18 - Compliance State**
Every published data product shall carry one of four compliance states: Compliant, Drift Detected, Grace Period, or Non-Compliant.

**F4.19 - Enforcement Actions**
Five enforcement actions configurable per policy rule: Warn, Block Publication, Restrict Access, Notify Governance, Auto-Remediate.

**F4.20 - Governance Override**
The governance layer shall grant time-limited compliance exceptions with documented rationale and expiration dates. Exceptions shall auto-expire.

**F4.21 - Classification Taxonomy Authoring**
The governance layer shall define the organization's data classification taxonomy.

**F4.22 - Classification-Driven Enforcement**
Classification shall be a first-class input to all policy rule conditions.

**F4.23 - Classification Change Governance**
Reclassification to higher sensitivity shall be immediately effective. Reclassification to lower sensitivity shall require governance acknowledgment if the product has active consumers.

**F4.24 - Governance Dashboard**
The governance layer shall have access to a real-time compliance dashboard.

**F4.25 - Domain Compliance Reports**
The governance layer shall generate compliance reports per domain, exportable in PDF and CSV.

**F4.26 - Audit Export**
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

- **OS4.1** - Legal interpretation of regulatory requirements
- **OS4.2** - Governance enforcement on data outside registered data products
- **OS4.3** - [POST-MVP] Policy-as-code authoring
- **OS4.4** - [POST-MVP] Native GRC platform integrations

---

## Domain 5: Lineage and Observability

### Functional Requirements

**F5.1 - Lineage as a Graph**
The platform shall maintain a continuously updated, organization-wide lineage graph representing the complete provenance network of all data products. The lineage graph is a first-class queryable asset.

**F5.2 - Lineage Node Types**
Six node types: Source Nodes, Data Product Nodes, Port Nodes, Transformation Nodes, Agent Nodes (distinct from Transformation Nodes due to non-deterministic characteristics), and Consumer Nodes.

**F5.3 - Lineage Edge Types**
Five edge types: Derives From, Transforms, Consumes, Depends On, Supersedes. All edges carry a `source` property: `declared` (domain team), `emitted` (pipeline runtime), or `discovered` (connector crawl).

**F5.4 - Dual Lineage Assembly**
The lineage graph shall be assembled from declared lineage (domain team design-time declarations) and emitted lineage (runtime pipeline events), supplemented by discovered lineage (connector crawl). The platform shall reconcile all three sources, surfacing discrepancies as lineage drift events.

**F5.5 - Lineage Completeness Scoring**
The platform shall compute a lineage completeness score for every data product. Governance shall configure minimum completeness thresholds by classification.

**F5.6 - Lineage Depth**
The platform shall support lineage traversal of arbitrary depth with no imposed technical limit.

**F5.7 - Cross-Domain Lineage**
Lineage shall traverse domain boundaries seamlessly. Cross-domain lineage visibility shall be governed by access grants.

**F5.8 - Emission Event Schema**
The platform shall define and publish an open lineage event schema aligned with the OpenLineage specification, extended with platform-specific fields for agent provenance, governance policy references, and semantic change markers.

**F5.9 - Emission Authentication**
All lineage emission API calls shall be authenticated using the emitting principal's identity, stored as an immutable attribute of the lineage record.

**F5.10 - Emission Idempotency**
The lineage emission API shall be idempotent. Duplicate emissions identified by client-provided event ID shall be deduplicated without error.

**F5.11 - Batch and Streaming Emission**
Both individual event emission and batch emission (up to 1,000 events per call) shall be supported.

**F5.12 - Agent Lineage Emission**
AI agent executions shall emit lineage events including agent identity and version, model identifier and version, reasoning context reference, input and output ports consumed/produced, governance policy version in effect, and confidence indicators where available.

**F5.13 - Lineage Drift Detection**
The platform shall compare declared versus emitted versus discovered lineage and surface discrepancies as lineage drift events.

**F5.14 - Lineage Graph API**
The platform shall expose a lineage graph query API supporting upstream traversal, downstream traversal, impact analysis, path query, and consumer query.

**F5.15 - Lineage Visualization** *(revised v1.4)*
The platform shall provide an interactive lineage visualization implemented with React Flow using Dagre layout. The layout is left-to-right directed: upstream source nodes on the left, the focal data product in the center, and downstream consumers on the right. Node cards display product name, domain, and trust score. Edges are labeled with relationship type (Derives From, Transforms, Consumes, Depends On, Supersedes). Deep graphs support expand/collapse at any node. The visualization shall distinguish node types visually and indicate lineage completeness, drift, and non-determinism markers. Export to PNG and SVG shall be supported. See ADR-002 for the technology decision rationale.

**F5.16 - Impact Analysis Workflow**
When a domain team initiates a MAJOR version change or deprecation, the platform shall automatically execute an impact analysis and present results before the change is committed. Acknowledgment is a required step.

**F5.17 - Lineage Time Travel**
The lineage graph as it existed at any prior point in time shall be reconstructable. Minimum historical retention is governance-configurable with a platform minimum of 2 years.

**F5.18 - Observability as a Port**
The observability port is the authoritative interface through which consumers, agents, and the governance layer assess a product's runtime health.

**F5.19 - Observability Metric Categories**
Eight metric categories on every data product: Freshness, Completeness, Schema Conformance, SLO Compliance, Lineage Completeness, Governance Compliance, Connector Health, and Version Currency.

**F5.20 - SLO Declaration and Monitoring**
Domain teams shall declare SLOs for freshness, availability, schema stability, and query response time. The platform shall continuously evaluate declared SLOs against metrics in near real time.

**F5.21 - Observability Emission**
Domain pipelines shall emit observability metrics via the observability emission API. Discrepancies between platform-computed and domain-emitted metrics shall be flagged as observability drift events.

**F5.22 - Consumer-Visible Observability**
The observability port shall be accessible to all authorized consumers without a separate access request.

**F5.23 - Observability Alerting**
Domain teams shall configure alert rules on observability metrics. The governance layer shall define mandatory minimum alerting requirements by classification.

**F5.24 - Observability History**
Observability metric history shall be retained with a platform minimum of 90 days.

**F5.25 - Trust Score**
The platform shall compute a trust score for every published product, a composite of lineage completeness, SLO compliance history, governance compliance state, schema conformance, and freshness consistency over a rolling time window. The algorithm shall be transparent and documented.

**F5.26 - Agent Consumption Tracking**
Every AI agent consumption event against an output port shall be recorded automatically.

**F5.27 - Non-Determinism Lineage Markers**
Lineage edges produced by AI agent transformations shall carry a non-determinism marker.

**F5.28 - Agent Observability Signals**
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
| NF5.8 | Lineage visualization renders 500 nodes at 60fps |

### Out of Scope

- **OS5.1** - Internal data quality metric computation
- **OS5.2** - Data profiling
- **OS5.3** - Real-time operational monitoring dashboards
- **OS5.4** - [POST-MVP] Trust score weight customization
- **OS5.5** - Automated lineage backfill for pre-adoption data products

---

## Domain 6: Agent Integration Layer

> Central design challenge: agents are simultaneously the most powerful consumers the platform will ever have and the least trustworthy ones by default.

### Functional Requirements

**F6.1 - Agent Identity as First-Class Principal**
The platform shall treat AI agent identities as a distinct principal type carrying: model identifier, model version, agent framework, delegated authority scope, and a trust classification. These attributes are immutable once registered.

**F6.2 - Agent Identity Registration**
Registration shall capture: agent name and description, owning domain, model provider and identifier, model version or version constraint, agent framework, intended consumption patterns, maximum access scope declaration, and a named human oversight contact. Registration shall require governance layer acknowledgment for production-capable agents.

**F6.3 - Agent Trust Classification**
The governance layer shall define an agent trust classification taxonomy. Platform default three tiers:

- **Observed** (default for all newly registered agents): read-only access to the mesh, including product discovery, metadata queries, and lineage inspection. No side-effect operations permitted; cannot submit access requests, emit lineage events, draft products, or trigger any workflow. All actions logged to the audit trail in real time. Appropriate for newly registered agents of unknown behavioral profile.

- **Supervised**: extended read access plus consequential actions permitted, but held in a pending state awaiting human approval. Permitted pending actions include access requests, lineage emission, and product draft creation. The human oversight contact must explicitly approve each consequential action before it takes effect. Appropriate for agents with an established behavioral record in Observed mode.

- **Autonomous**: full operational capability within the agent's access grant scope. Actions take immediate effect with no human checkpoint in the execution path. The audit trail remains mandatory and complete; only the approval gate is removed. Appropriate for agents with a validated track record in Supervised mode, explicitly granted by a governance role. The platform shall guarantee that Autonomous classification can never be assigned by an automated process or set as a default. It always requires an explicit human action by a governance role.

**F6.3a - Classification Transition Rules**
Permitted transitions:

- Observed to Supervised: requires governance role
- Supervised to Autonomous: requires governance role
- Autonomous to Supervised: may be performed by the agent's human oversight contact or a governance role
- Supervised to Observed: may be performed by the agent's human oversight contact or a governance role
- Autonomous to Observed: may be performed by the agent's human oversight contact or a governance role

Any upward transition (toward Autonomous) by the human oversight contact alone is not permitted. Any transition to Autonomous via automated process or rule is not permitted.

**F6.3b - Classification Scope**
Classification is global per agent in the MVP. A single trust classification applies to the agent across all domains. The `agent_trust_classifications` table shall include a `scope` field defaulting to `'global'` in MVP to ensure the migration path to per-domain classification does not require a breaking schema change. Per-domain classification is explicitly deferred post-MVP.

**F6.3c - Frozen Operations on Classification Downgrade**
When an agent's classification is downgraded in any direction, all in-flight operations that were permitted under the prior classification but are not permitted under the new classification shall be frozen immediately. Frozen operations are not cancelled or rolled back. They enter a `frozen` state visible to governance team members and require explicit review and disposition by a governance role: approve to complete, or cancel. This applies to all pending approval requests, queued lineage events, and any other operations in a non-terminal state at the time of classification change.

**F6.3d - Audit Requirements for Classification Changes**
Every classification change event shall be written to the audit log with: `event_type: agent_classification_changed`, `agent_id`, `previous_classification`, `new_classification`, `changed_by_principal_id`, `changed_by_principal_type` (human_user or governance_role), `reason` (free-text, mandatory and cannot be null or empty), and `timestamp`. The question "who classified this agent as Autonomous and why" must always be answerable from the audit log alone.

**F6.4 - Agent Identity Lifecycle**
Lifecycle states: Registered, Active, Suspended, Retired. Agent identities shall not be deleted. Retired identities preserve all audit and lineage history permanently.

**F6.5 - Model Version Binding**
An agent identity shall be bound to a specific model version or version constraint. Model version changes require re-registration or explicit acknowledgment.

**F6.6 - Human Oversight Requirement**
Every agent identity shall have a named human oversight contact. An agent whose oversight contact is no longer an active platform principal shall be automatically suspended.

**F6.7 - Agent Access Grants**
Agent access grants shall specify: a maximum query rate limit, an expiration date (no indefinite grants), governance layer approval for Autonomous trust class agents, and explicit acknowledgment of AI provenance requirements for production-capable agents.

**F6.8 - Agent Access Scope Enforcement**
An agent registered as read-only shall be architecturally prevented from writing to or producing data products, enforced at infrastructure level.

**F6.9 - Agent Access Policy**
The governance layer shall configure agent access policy defining which trust classifications may access which data classifications and under what conditions.

**F6.10 - Dynamic Access Evaluation**
Agent access shall be evaluated dynamically at query time, verifying current valid access grants, access scope compliance, governance policy allowance, and trust classification authorization before every query execution.

**F6.11 - Agent Activity Tracking and Audit Log Query API**
The platform shall maintain a complete audit trail of all agent activity. Every MCP tool call shall be logged with agent identity context. The platform shall expose an audit log query API as a governance visibility capability, supporting filters by `agent_id`, `event_type`, time range, and `principal_type`. The query API returns filtered log entries without aggregation or pattern analysis. Anomaly detection and pattern analysis are explicitly deferred to Phase 5; they require a behavioral baseline that does not exist until activity tracking has run in production.

**F6.12 - Semantic Query Interface**
The platform shall provide a federated semantic query interface presenting the authorized portion of the data mesh as a single logical data surface.

**F6.13 - Query Protocol**
Four surfaces: natural language query, structured semantic query, GraphQL interface, and MCP endpoint.

**F6.14 - MCP Server Compliance**
The platform's MCP endpoint shall be a fully compliant MCP server exposing Resources (every authorized output port), Tools (data product search, lineage traversal, observability query, access grant request, semantic query execution), and Prompts (platform-provided templates). As of Phase 4 completion the platform exposes 9 MCP tools: `list_products`, `get_product`, `get_trust_score`, `get_lineage`, `get_slo_summary`, `search_products`, `semantic_search`, `register_agent`, and `get_agent_status`. MCP compliance shall be maintained against the current stable specification within 60 days of new versions.

**F6.15 - Query Planning**
For natural language and structured semantic queries, the platform shall identify relevant authorized products, evaluate trust scores and compliance states, construct an execution plan, and evaluate access scope and policy compliance.

**F6.16 - Policy-Aware Query Execution**
Query execution shall enforce governance policy in real time across every product touched. A governance policy violation in any component of a federated query shall halt the entire query execution.

**F6.17 - Query Result Provenance**
Every query result shall carry a provenance envelope containing: contributing product versions, trust scores at time of query, governance policy versions in effect, lineage completeness scores, non-determinism markers, and query execution timestamp.

**F6.18 - Cross-Product Join Semantics**
Cross-product joins shall respect all access grants, propagate the highest classification of any joined product to the result, and record a lineage event for all contributing products.

**F6.19 - Query Rate Limiting**
Per-agent rate limits shall be enforced at the query layer infrastructure level.

**F6.20 - Query Result Caching**
The federated query layer shall support result caching within a configurable TTL. Cache invalidation shall occur automatically when any contributing product publishes a new version, updates its schema, or changes compliance state.

**F6.21 - Production-Capable Agent Registration**
Production-capable agents require governance layer acknowledgment, mandatory AI provenance metadata, and mandatory Observed or Supervised trust classification for the first 90 days of operation.

**F6.22 - Agent-Produced Data Product Publication**
A production-capable agent shall publish through the same governance compliance pipeline as human-published products, with additional requirements: complete AI provenance metadata, domain team notification, and a permanent indicator that the product was AI-produced.

**F6.23 - Agent-Produced Product Ownership**
An AI agent shall not be the registered owner of a data product. The owning domain team is always the human owner of record.

**F6.24 - Human Review Workflow**
For Observed trust class agents, a human review workflow shall surface the agent reasoning trace reference, provenance envelope of consumed inputs, proposed product definition, and diff against any prior version.

**F6.25 - Agent Production Audit**
Every production-capable agent publication or modification shall produce a complete, immutable, permanently retained audit record.

**F6.26 - Semantic Data Product Discovery**
Agents shall discover data products through semantic search. Results ranked by trust score, relevance, and compliance state.

**F6.27 - Schema Exploration**
Agents shall programmatically explore the schema of any authorized output port without executing a data query.

**F6.28 - Semantic Annotation**
Domain teams shall add semantic annotations to product schemas. Governance policy shall mandate minimum annotation coverage for products available to agent consumption.

**F6.29 - Lineage-Aware Recommendation**
The federated query layer shall provide agents with lineage-aware product recommendations.

**F6.30 - Version-Aware Consumption**
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

- **OS6.1** - Agent development, hosting, or orchestration
- **OS6.2** - Agent reasoning quality evaluation or output validation
- **OS6.3** - Native multi-agent orchestration patterns
- **OS6.4** - [POST-MVP] Natural language query precision improvement
- **OS6.5** - Reasoning trace content storage (references only)
- **OS6.6** - [POST-MVP] Agent financial metering and chargeback
- **OS6.7** - [POST-MVP] Agent anomaly detection and automatic escalation (requires behavioral baseline from production activity tracking)
- **OS6.8** - [POST-MVP] Per-domain trust classification (schema scope field is ready; logic deferred)
- **OS6.9** - [POST-MVP] Trust-scope-based search result filtering

## Domain 7: Self-Service Experience

> Organizing principle: every persona has a distinct primary surface. The right thing is the easy thing for each persona. A domain team member should never have to navigate through governance screens to do their work. A consumer should never have to navigate through authoring screens to find data.

The platform is a single unified web application with persona-adaptive navigation. What follows defines the canonical experience for each persona. Where a requirement applies to a specific persona, it is labeled. Where it applies to all personas, it is general.

### Platform Shell (All Personas)

**F7.1 - Unified Platform Shell**
Single unified web application. The shell adapts navigation, primary actions, and information density based on the authenticated principal's roles. A principal with multiple roles (e.g., both Domain Owner and Data Consumer) shall have access to all relevant surfaces with clear context switching.

**F7.2 - Persona-Adaptive Navigation**
Primary navigation is dynamically composed based on principal roles. Governance-specific items do not appear as disabled or locked for domain team members; they simply do not appear. Consumer-specific items do not appear for principals with no consumer grants.

**F7.3 - Organization and Domain Context Switching**
A persistent context switcher makes the current active organization and domain always visible and changeable without a full page reload.

**F7.4 - Global Search**
Keyboard-shortcut accessible global search indexing product names, descriptions, tags, domain names, owner names, and semantic annotations. Results respect the principal's access grants and role scope.

**F7.5 - Notifications**
Role-appropriate, actionable notifications surfaced in-platform and via configured delivery channels. Full notification domain defined in Domain 11.

**F7.6 - Keyboard and Accessibility**
WCAG 2.1 AA compliance. All primary workflows completable via keyboard alone. Accessibility compliance is a release gate.

**F7.7 - Role Assignment UI** *(new v1.4)*
Platform administrators and domain owners shall manage role assignments through a dedicated UI without requiring Keycloak console access or database intervention. The UI shall support: assigning and revoking platform-level roles (Platform Admin, Platform Observer), assigning and revoking domain-level roles (Domain Owner, Data Product Owner, Data Product Consumer), inviting users by email address (triggers invitation flow defined in Domain 10), and viewing all current role assignments within scope. Governance role assignment requires governance layer acknowledgment.

**F7.8 - Progressive Disclosure**
Minimum necessary information presented at first; detail on demand.

**F7.9 - Empty States**
Every list, dashboard, and data surface shall have a contextually appropriate empty state message and call to action.

**F7.10 - Inline Contextual Help**
Every field and configuration option shall have inline contextual help accessible without leaving current context, written in persona-appropriate plain language.

**F7.11 - Confirmation and Consequence Surfacing**
Every destructive or consequential action shall require explicit confirmation through a consequence-surfacing dialog requiring active user input.

**F7.12 - Responsive Design**
Fully functional on desktop (1280px+). Tablet support (768px+) for read-only and monitoring experiences.

**F7.13 - Theme Support**
Light and dark themes persisted per principal. System theme preference respected as default.

---

### Domain Admin Experience (Domain Owner, Data Product Owner)

> The domain admin experience is domain-scoped. A domain admin sees their domain's products, connectors, compliance state, and team. They do not see other domains' internals.

**F7.14 - Domain Admin Dashboard** *(canonical product view for domain admins)*
The domain admin dashboard is the primary landing surface for domain owners and data product owners. It shall display: all domain products with current lifecycle state, compliance state, trust score, and active consumer count; domain-level compliance score with trend; connector health summary; SLO compliance summary; pending access requests requiring action; recent activity feed; and quick-action affordances for common tasks (new product, new connector, review pending requests). This is the canonical product view for the domain admin persona. The information shown here defines what a domain admin needs to operate their domain day-to-day.

**F7.15 - Data Product Authoring Interface**
Structured, guided authoring interface presenting the effective policy requirements as a visible checklist throughout. Continuous in-authoring validation surfaces issues as the author works, never as a surprise at publication time.

**F7.16 - Port Configuration UI**
Port-type-specific configuration UI with real-time port validation. Connection details fields are required for all output ports and clearly labeled as publication blockers when incomplete. The UI shall surface a completion indicator showing which ports have complete connection details and which do not.

**F7.17 - Schema Editor**
Integrated schema editor supporting: manual field definition, import from connector-inferred schema, import from upstream product output port schema, visual version diff, and semantic annotation authoring.

**F7.18 - SLO Configuration UI**
Guided SLO configuration surfacing the dependency SLO chain during configuration.

**F7.19 - Connector Management UI**
Pre-built connector library with search and filtering, connector-type-specific configuration forms, inline validation, connector health with historical trend, discovery coverage scores per metadata category, and guided custom connector registration flow.

**F7.20 - Product Lifecycle Management UI**
All domain products with current lifecycle state, compliance state, trust score, and active consumer count. Lifecycle actions presented as consequence-surfacing workflows. Deprecation and decommission actions surface impact analysis before confirmation.

**F7.21 - Versioning UI**
Complete version history, currently active versions, consumers per version, and deprecation schedules. MAJOR version publication workflow enforces the semantic change declaration through a structured form. Impact analysis is a mandatory step before MAJOR version publication.

**F7.22 - Domain Team Management UI**
Domain owners shall manage their team membership through a UI. This includes: viewing current team members and their roles, inviting new members by email, assigning domain-level roles (Domain Owner, Data Product Owner), revoking access, and viewing pending invitations. See Domain 10 for invitation flow.

---

### Consumer Experience (Data Product Consumer)

> The consumer experience is discovery-first. A consumer's primary job is to find data they can trust and get access to it. Every surface is optimized for that journey.

**F7.23 - Data Product Marketplace** *(canonical product view for consumers)*
The marketplace is the primary landing surface for data consumers. It shall display all discoverable products with faceted filtering by: domain, classification, data type, tag, trust score range (slider), compliance state, SLO characteristics, and freshness status. Search results support both keyword and semantic search. The marketplace is the canonical discovery surface for the consumer persona; the domain admin dashboard is not consumer-facing. Each product card in the marketplace shall show: product name, domain, classification, trust score, compliance state, freshness indicator, and access status for the requesting principal (granted, pending, not requested).

**F7.24 - Faceted Search and Filtering** *(new v1.4)*
The marketplace shall implement true faceted filtering where each applied filter updates the available options in other facets to reflect only valid combinations. Applied filters shall be displayed as removable chips. Filter state shall be shareable via URL. A consumer shall be able to reach a relevant product in three clicks or fewer from the marketplace landing page.

**F7.25 - Related Products and Join Recommendations** *(new v1.4)*
The product detail page shall surface related products and join recommendations. Related products are those in the same domain or with overlapping lineage. Join recommendations are products that are frequently accessed together by other consumers or that share common key fields based on schema analysis. Each recommendation shall display trust score, access status, and the basis for the recommendation (same domain, overlapping lineage, common join key, frequently accessed together).

**F7.26 - Data Product Detail Page** *(consumer view)*
Dedicated page per product presenting: identity and lifecycle state; trust score with transparent breakdown; compliance state; available output ports with connection details preview (full details revealed on access grant); column-level schema browser with data types, descriptions, PII indicators, and semantic annotations; ownership and stewardship contacts; data freshness signals (last refresh, cadence, freshness SLA, compliance state); observability summary; lineage preview (upstream sources and downstream consumers); version history with semantic change summaries; access status for the requesting principal; and access request affordance. This is the authoritative consumer view of a data product.

**F7.27 - Trust Score Transparency**
Trust score accompanied by transparent breakdown with plain-language explanation of each component's contribution and what would improve the score.

**F7.28 - Access Request Workflow** *(amended v1.4)*
Direct access request from the product detail page, including: output port selection, justification field, governance acknowledgments, and submission. Upon submission the consumer shall see: confirmation of submission, expected response time based on the access SLA for that product's classification (see F7.29), current status (pending/approved/denied), and escalation contact if the SLA is approaching. On approval: complete connection details, connection package appropriate to the port type (see Domain 10), and getting-started guidance. On denial: reason and next steps.

**F7.29 - Access Request SLA and Escalation** *(new v1.4)*
Every data product classification shall have a configured access request SLA defining the maximum time from submission to a decision. The platform shall: display the expected response time to the consumer at submission time; notify the approver when a request is approaching the SLA threshold; automatically escalate to a governance-configured escalation contact if the SLA is breached; and notify the consumer of the escalation. SLA configuration is part of the Access Control Policy domain in Domain 4. The default SLA for all classifications is 5 business days unless overridden by governance policy.

**F7.30 - Consumer Workspace**
Personal persistent workspace displaying: active access grants with expiration dates and connection details; consumed products with current trust scores and freshness status; deprecation notices with replacement product recommendations; pending access requests with current status and SLA countdown; and denied requests with reasons.

**F7.31 - Deprecation Impact Management**
Structured deprecation impact experience: deprecation timeline, reason, available replacement products with direct comparison, and a migration planning checklist.

---

### Governance Experience (Governance Author)

> The governance experience is platform-wide. Governance teams see across all domains. Their primary job is to configure policy, monitor compliance, and intervene when needed.

**F7.32 - Governance Command Center**
Unified governance state at a glance. Every metric is drillable to the underlying products or events. Every actionable item is executable without leaving the command center. The command center shall display: overall compliance rate with trend across all domains; compliance breakdown by domain; active grace periods; open exceptions; recent policy changes and their impact; agent trust classification distribution; frozen operations requiring disposition; and SLA breach alerts on access requests.

**F7.33 - Policy Authoring Studio**
Three-panel dedicated experience: navigable policy domain list (left), active policy domain rule builder (center), and persistent impact preview panel (right). The impact preview updates in real time as rules are built and shall complete within 3 seconds of a rule change.

**F7.34 - Rule Builder UX**
Structured plain-language rule composition using dropdown menus populated with the organization's actual domains, classifications, and metadata attributes. Completed rule displayed as a plain-language sentence confirming intent before saving.

**F7.35 - Classification Taxonomy Manager**
Editable taxonomy hierarchy with impact preview before any change is committed. Changes to classification definitions surface all affected products for review.

**F7.36 - Compliance Drill-Down**
Three-click path from command center summary to individual violation detail, showing: the specific requirement violated, the current value, the required value, and the remediation path.

**F7.37 - Exception Management UI**
Grant, review, and revoke compliance exceptions with expiration countdown and auto-close on expiry. Each exception requires a documented rationale.

**F7.38 - Domain Compliance Reports UI**
Generate and export domain compliance reports in PDF and CSV. Reports retained for 90 days.

**F7.39 - Access Request SLA Monitoring** *(new v1.4)*
The governance command center shall surface all access requests approaching or breaching their SLA, with one-click escalation capability and visibility into the full request history per product.

---

### Agent Management Experience (Domain Owner, Governance Author)

> Agent management is a shared responsibility. Domain owners manage agents within their domain. Governance teams manage trust classifications and access policy across all domains.

**F7.40 - Agent Registry UI**
Register and manage agent identities within domain context with a guided registration flow that makes agent-specific concepts (trust classification, oversight contact, model binding) clear to non-specialists. The registration flow shall produce a Keycloak client credential package ready for the agent developer to use.

**F7.41 - Agent Activity Monitor**
Real-time and historical view per agent identity: MCP tool call volume, data products accessed, cross-product join patterns, rate limit proximity, classification change history, and frozen operation history.

**F7.42 - Human Review Queue**
For Observed trust class agents: structured review queue with approve, reject with feedback, and request revision actions. Aging items surfaced as escalation alerts to the oversight contact.

**F7.43 - Agent Trust Classification UI**
Governance teams view and manage agent trust classifications across the organization. Classification change UI enforces transition rules (F6.3a) and requires a documented reason before committing. Upward transitions (toward Autonomous) require additional confirmation.

**F7.44 - Frozen Operations Queue**
Governance teams view and disposition all frozen operations in a dedicated queue separate from the agent activity monitor. Each entry shows: the operation type, the agent that initiated it, the trigger that caused the freeze, the timestamp, and the disposition actions (approve or cancel).

---

### Platform Administration (Platform Administrator)

**F7.45 - Organization Administration**
Manage organization tenant configuration, identity provider federation setup, platform-level role assignments (using the Role Assignment UI in F7.7), and audit log access. Platform administration is strictly separated from organization data.

**F7.46 - Onboarding Experience**
Guided multi-step onboarding completable in a single session with progress saved for pause and resume. See Domain 10 for the complete self-serve onboarding requirements.

**F7.47 - Usage and Health Monitoring**
Control plane availability and latency, lineage emission throughput, federated query layer performance, connector health distribution, and usage metrics. Does not expose organization data.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF7.1 | Primary surface initial load within 3 seconds; navigation within 1 second |
| NF7.2 | Lineage visualization renders 500 nodes at 60fps (React Flow / Dagre) |
| NF7.3 | UI state reflects platform within 30 seconds of underlying state change |
| NF7.4 | Global search results within 1 second |
| NF7.5 | Current and previous major versions of Chrome, Firefox, Safari, Edge |
| NF7.6 | Internationalization architecture from day one - translations post-MVP |
| NF7.7 | 99.9% UI availability with graceful read-only degradation |
| NF7.8 | Marketplace faceted search results update within 500ms of filter change |
| NF7.9 | Access request SLA breach triggers escalation notification within 15 minutes |

### Out of Scope

- **OS7.1** - [POST-MVP] Mobile application
- **OS7.2** - [POST-MVP] Embedded analytics and custom report building
- **OS7.3** - [POST-MVP] White-labeling and custom tenant branding
- **OS7.4** - [POST-MVP] In-platform data preview
- **OS7.5** - [POST-MVP] AI-assisted data product definition authoring
- **OS7.6** - [POST-MVP] Collaborative simultaneous multi-user definition editing
- **OS7.7** - [POST-MVP] Reference architecture guidance in connector UX
- **OS7.8** - [POST-MVP] Consumer connection experience - port-type-specific connection packages tailored to consumer tooling context beyond the standard packages defined in Domain 10

## Domain 8: Operations and Workflow State

This domain defines platform-level workflow states that cut across multiple domains. These are not domain-specific constructs; they are first-class platform states managed by Temporal and visible to governance teams.

### Functional Requirements

**F8.1 - Frozen Workflow State**
The platform shall support a `frozen` workflow state for in-flight operations. A frozen operation is suspended pending governance review. It is not cancelled, not rolled back, and not automatically completed. Frozen operations are visible to governance team members and require explicit disposition by a governance role: approve to complete, or cancel.

**F8.2 - Frozen State Trigger: Agent Classification Downgrade**
When an agent's classification is downgraded in any direction, all in-flight operations permitted under the prior classification but not permitted under the new classification shall be immediately transitioned to the `frozen` state. This is the only trigger for the frozen state implemented in Phase 4. Other triggers (domain suspension, policy change mid-workflow) are reserved for future phases.

**F8.3 - Frozen State Visibility**
All frozen operations shall be surfaced in the Governance Command Center with: the operation type, the agent or principal that initiated it, the trigger that caused the freeze, the timestamp of the freeze, and the available disposition actions (approve or cancel).

**F8.4 - Frozen State Audit**
Every transition into and out of the frozen state shall produce an immutable audit log entry with the disposition action taken and the governance principal who took it.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF8.1 | Frozen state transition occurs within 5 seconds of triggering event |
| NF8.2 | Frozen operations remain durable across platform restarts |

### Out of Scope

- **OS8.1** - [POST-MVP] Additional frozen state triggers beyond agent classification downgrade
- **OS8.2** - Automated disposition of frozen operations - always requires explicit human action

---

## Domain 9: Data Product Detail Completeness

This domain defines the target completeness state for the `get_product` MCP tool and the product detail page. It exists to make explicit what is currently available, what is planned, and when.

### Current State (Phase 4 Complete)

The following are exposed through the `get_product` MCP tool and verified working: name, slug, lifecycle status, semantic version, classification, description, tags, domain assignment, port definitions (type, name, interface), trust score with component breakdown, SLO health with 7-day and 30-day pass rates, and lineage graph (upstream sources and downstream consumers including external systems).

### Planned Additions by Phase

| Field / Signal | Priority | Target Phase | Notes |
| --- | --- | --- | --- |
| Column-level schema | 1 | Phase 5 | Field names, data types, nullability, descriptions, PK/partition indicators, PII indicators. Schema snapshots exist in DB. |
| Ownership and stewardship | 1 | Phase 5 | Owner name and contact, domain team name, created_by, created_at, updated_at |
| Data freshness signals | 1 | Phase 5 | Last refresh timestamp, cadence, freshness SLA, compliance state |
| Access status for requesting principal | 1 | Phase 5 | Granted/pending/not requested/denied, how to request, expected approval time, expiration date |
| Data quality signals | 2 | Phase 5 | Known quality issues (owner-supplied), completeness metrics, row count, last quality assessment |
| Versioning and change history | 2 | Phase 5 | Human-readable changelog, breaking vs non-breaking per version, semantic change declaration |
| Contractual and compliance metadata | 2 | Phase 5 | Terms of use, data retention policy, regulatory classification |
| Volume and performance | 2 | Phase 5 | Approximate row count, typical query latency, rate limits, streaming throughput |
| Sample data | 3 | Post-Phase 5 | Non-PII preview rows, opt-in by domain team |
| Related products | 3 | Post-Phase 5 | Products in same domain or with overlapping lineage |
| Consumer count | 3 | Post-Phase 5 | Number of principals actively consuming this product |
| Popularity signal | 3 | Post-Phase 5 | Query frequency over last 30 days |
| Community annotations | 3 | Post-Phase 5 | Consumer-supplied notes and ratings |

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF9.1 | get_product response shall include all Phase 5 additions without degrading current response time targets |

---

## Domain 10: Self-Serve Infrastructure *(new v1.4)*

This domain makes Dehghani's third data mesh principle - self-serve data infrastructure - a first-class platform capability. Self-serve is not a collection of convenience features; it is the foundational promise that any domain team or data engineer, human or AI agent, can go from registration to running queries without contacting the platform team, without filing a ticket, and without decoding undocumented systems.

The key insight driving this domain: a data product without usable connection details is not a data product. It is documentation. The platform shall ensure that publishing a data product means publishing something a data engineer can actually use.

### Functional Requirements

#### User Registration and Account Creation

**F10.1 - Self-Service User Registration**
The platform shall support self-service user registration without platform operator involvement. A prospective user shall be able to: register with an email address and password, or authenticate via a configured identity provider (Google, GitHub, Microsoft, or any OIDC-compliant provider). Email verification is required before access is granted. The registration flow shall be completable in under 5 minutes.

**F10.2 - Organization Creation at Registration**
Upon completing registration, a new user shall be presented with the option to create a new organization or request an invitation to an existing organization. Creating a new organization provisions: the organization tenant, a default governance layer with policy templates pre-loaded, and the registering user as the first Platform Administrator. No platform operator action is required.

**F10.3 - Invitation Flow**
Existing organization members shall invite new users by email address. The invitation shall: be sent automatically by the platform, include a time-limited acceptance link (default 7 days, governance-configurable), pre-assign the invitee to a specified role and domain, and on acceptance complete the new user's registration and grant the pre-assigned role without additional steps. Invitations that expire shall be re-sendable without creating duplicate records.

**F10.4 - Domain Team Self-Management**
Domain owners shall manage their team without platform administrator involvement: inviting members, assigning domain-level roles, revoking access, and viewing team membership. Domain team management is defined in F7.22.

#### Port Connection Details as a Required Field

**F10.5 - Connection Details Schema by Port Type**
Every output port type shall have a defined connection details schema specifying the required and optional fields for that port type. The platform shall enforce completeness of required fields at publication time (F2.12). The connection details schemas are:

- **SQL/JDBC**: host, port, database name, schema name, authentication method (username/password, IAM, certificate), SSL mode, JDBC URL template (auto-generated from fields)
- **REST API**: base URL, authentication method (API key, OAuth 2.0, bearer token), required headers, rate limit information, API version
- **GraphQL**: endpoint URL, authentication method, introspection endpoint
- **Streaming topic (Kafka)**: bootstrap servers, topic name, authentication method (SASL/PLAIN, SASL/SCRAM, mTLS), consumer group prefix, schema registry URL if applicable
- **File/object export**: storage endpoint (S3, GCS, ADLS), bucket/container name, path prefix, authentication method, file format, compression
- **Semantic query endpoint**: automatically populated by the platform when the port is registered with the federated query layer; not manually configured

**F10.6 - Connection Details Confidentiality**
Connection details shall be stored encrypted at rest. Full connection details shall be surfaced only to principals with an active access grant for that output port. Principals without a grant shall see a redacted preview (host only, no credentials) sufficient to understand what system they would be connecting to. The full details including credentials are revealed only at access grant time.

**F10.7 - Connection Details Validation**
The platform shall validate connection details at publication time by performing a connectivity check against the declared endpoint using the provided credentials. A port with connection details that fail validation shall not be publishable. Validation failure shall surface a specific error message indicating what failed.

#### Connection Package Generation

**F10.8 - Connection Package Generation at Access Grant**
When an access grant is issued, the platform shall automatically generate a connection package appropriate to the output port type. The connection package is a ready-to-use artifact that a data engineer, human or agent, can use immediately without additional configuration. Connection packages by port type:

- **SQL/JDBC**: JDBC connection string (copy-ready), Python connection snippet (psycopg2, snowflake-connector, or appropriate driver), sample SELECT query against the actual schema with real column names, data dictionary (column names, types, descriptions)
- **REST API**: curl example for a representative endpoint, Postman collection (JSON, importable), Python requests snippet, endpoint reference with authentication configured
- **GraphQL**: Apollo Studio link if available, example query against the actual schema, Python gql snippet
- **Streaming topic (Kafka)**: Kafka consumer configuration (properties file format), Python kafka-python or confluent-kafka snippet, schema definition if schema registry is configured
- **File/object export**: AWS CLI / gsutil / azcopy command to list/download, Python boto3 / google-cloud-storage / azure-storage-blob snippet, file format documentation
- **Semantic query endpoint**: MCP tool reference with example invocations, Python MCP client snippet

**F10.9 - Agent Integration Package**
For any data product with a semantic query output port or any port accessible to agents, the platform shall generate an agent integration guide at access grant time. The guide shall include: the MCP tool calls to discover and query this product, an example agent prompt that demonstrates finding and using this product, the trust score and what it means for agent decision-making, and the governance policy version in effect. This makes the agent consumption path as clear as the human consumption path.

**F10.10 - Connection Package Refresh**
When a connection detail changes (e.g., credential rotation, endpoint migration), the platform shall regenerate connection packages for all active access grants and notify affected consumers via the notification system (Domain 11). Connection packages shall be versioned so consumers can see when their package was last updated.

#### Schema Authoring Guided Experience

**F10.11 - Guided Schema Authoring**
The platform shall provide a guided schema authoring experience that reduces the time to define a complete, well-annotated schema from hours to minutes. The experience shall include: a field-by-field wizard with type inference from connector-inferred schema, auto-suggestions for field descriptions based on field names and types, PII detection prompts for fields matching known PII patterns (email, phone, SSN, date of birth, etc.), and a schema completeness score showing what percentage of fields have descriptions and semantic annotations.

**F10.12 - Schema Import from Connector**
When a connector has inferred a schema, the schema authoring experience shall offer one-click import of the inferred schema as a starting point. Imported schema fields are presented for review and annotation; they are not auto-applied without acceptance. The domain team adds descriptions, PII indicators, and semantic annotations to the imported fields before accepting.

**F10.13 - Schema Import from Upstream Product**
When a data product declares an input port referencing another product's output port, the schema authoring experience shall offer import of the upstream product's schema as a starting point for the output port schema. This accelerates schema authoring for transformation products that pass through or extend upstream fields.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF10.1 | Self-service registration to first published data product completable in under 30 minutes |
| NF10.2 | Invitation email delivered within 60 seconds of sending |
| NF10.3 | Connection details validation at publication time within 15 seconds |
| NF10.4 | Connection package generation at access grant time within 10 seconds |
| NF10.5 | Connection packages for all active grants regenerated within 5 minutes of a connection detail change |

### Out of Scope

- **OS10.1** - Platform-managed credential provisioning (the platform documents credentials; it does not create database users or API keys in external systems)
- **OS10.2** - [POST-MVP] SSO for connection packages (consuming SSO-authenticated data sources)
- **OS10.3** - [POST-MVP] Interactive query sandbox within the platform

---

## Domain 11: Notifications *(new v1.4)*

The platform currently has no notification capability. This domain defines notifications as a first-class platform capability covering every trigger, every delivery mechanism, and every recipient. Notifications are the connective tissue between platform events and the humans who need to act on them.

### Functional Requirements

#### Notification Infrastructure

**F11.1 - Notification Service**
The platform shall provide a notification service responsible for routing, deduplicating, and delivering notifications to the correct recipients via the correct channels. The notification service shall be decoupled from the event sources that trigger it; any platform event can trigger a notification without coupling the source service to the delivery mechanism.

**F11.2 - Delivery Channels**
The platform shall support the following notification delivery channels: in-platform notification center (persistent, dismissible, deep-linked to relevant context), email (SMTP or SES, configurable per organization), and webhook (for integration with Slack, PagerDuty, or any HTTP receiver). Principals shall configure their preferred channels per notification category. Organizations shall configure default channels.

**F11.3 - Notification Preferences**
Each principal shall configure notification preferences at the category level: opt in to receive, opt out entirely, or configure channel override (e.g., email only for SLO violations, in-platform only for policy changes). Governance-mandated notifications cannot be opted out of.

**F11.4 - Notification Center UI**
A persistent in-platform notification center accessible from the platform shell (all personas) displaying: unread notifications with recency, notification category, summary, and deep link; read/dismiss controls; and a full notification history filterable by category and date range.

**F11.5 - Notification Deduplication**
The notification service shall deduplicate notifications within a configurable window (default 15 minutes) to prevent notification fatigue from repeated events. For example, multiple SLO violations on the same product within 15 minutes produce one notification, not one per violation.

#### Access Request Notifications

**F11.6 - Access Request Submitted**
Triggered when a consumer submits an access request. Recipients: the data product owner (or designated approver). Content: requester identity, product name, requested port, justification, SLA deadline. Deep link: access request review in domain admin dashboard.

**F11.7 - Access Request Approved**
Triggered when an access request is approved. Recipients: the requesting consumer. Content: product name, port, grant expiration date, link to connection package. Deep link: consumer workspace with connection details.

**F11.8 - Access Request Denied**
Triggered when an access request is denied. Recipients: the requesting consumer. Content: product name, denial reason, next steps. Deep link: product detail page.

**F11.9 - Access Request SLA Warning**
Triggered when an access request is approaching its SLA deadline (configurable threshold, default 80% of SLA elapsed). Recipients: the approver and the designated escalation contact. Content: request details, time remaining, escalation path. Deep link: access request review.

**F11.10 - Access Request SLA Breach**
Triggered when an access request breaches its SLA deadline without a decision. Recipients: the escalation contact and governance team. Content: request details, time overdue, escalation confirmation. Deep link: access request review in governance command center.

**F11.11 - Access Grant Expiring**
Triggered when an access grant is approaching expiration (configurable threshold, default 14 days before expiry). Recipients: the consumer holding the grant. Content: product name, expiration date, renewal path. Deep link: consumer workspace.

#### Product Lifecycle Notifications

**F11.12 - Product Deprecated**
Triggered when a data product is deprecated. Recipients: all consumers with active access grants for that product. Content: product name, deprecation date, deprecation reason, replacement product if specified, migration checklist link. Deep link: deprecation impact management in consumer workspace.

**F11.13 - Product Decommissioned**
Triggered when a data product is decommissioned. Recipients: all consumers who held access grants within the past 90 days. Content: product name, decommission date, replacement product if specified. Deep link: marketplace search for replacement.

**F11.14 - Product Published**
Triggered when a new data product is published. Recipients: principals who have subscribed to the publishing domain or have expressed interest in the product's classification or tags. Content: product name, domain, classification, trust score, port types available. Deep link: product detail page.

**F11.15 - Schema Drift Detected**
Triggered when schema drift is detected on a published product. Recipients: the data product owner and active consumers. Content: product name, drifted fields, severity. Deep link: schema drift detail in domain admin dashboard.

#### Observability and Quality Notifications

**F11.16 - SLO Violation**
Triggered when a declared SLO is violated. Recipients: the data product owner; governance team if classification requires it. Content: product name, SLO type violated, current value vs target, duration. Deep link: observability dashboard for the product.

**F11.17 - Trust Score Significant Change**
Triggered when a product's trust score changes by more than a governance-configurable threshold (default 10 points) within a 24-hour period. Recipients: the data product owner and active consumers. Content: product name, prior score, current score, primary driver of change. Deep link: trust score detail view.

**F11.18 - Connector Health Degraded**
Triggered when a connector transitions to an unhealthy state. Recipients: the domain owner of the domain that registered the connector. Content: connector name, affected products, health status detail. Deep link: connector management UI.

#### Governance Notifications

**F11.19 - Policy Change Impact**
Triggered when a governance policy is published that affects existing compliant products (i.e., creates compliance drift). Recipients: domain owners of affected domains. Content: policy change summary, number of affected products, grace period if applicable, remediation guidance. Deep link: compliance drill-down for affected products.

**F11.20 - Compliance Drift Detected**
Triggered when a published product transitions from Compliant to Drift Detected. Recipients: the data product owner. Content: product name, compliance state, specific violations, remediation guidance, grace period if applicable. Deep link: product compliance detail.

**F11.21 - Grace Period Expiring**
Triggered when a compliance grace period is approaching expiration (configurable threshold, default 7 days before expiry). Recipients: the data product owner. Content: product name, violations, days remaining, consequence of expiry. Deep link: product compliance detail.

**F11.22 - Classification Changed**
Triggered when a product's data classification changes. Recipients: all active consumers (classification change may affect their access); the governance team (for downward reclassifications). Content: product name, prior classification, new classification, effective date. Deep link: product detail page.

#### Agent Notifications

**F11.23 - Agent Classification Changed**
Triggered when an agent's trust classification is changed. Recipients: the agent's human oversight contact; the governance team. Content: agent name, prior classification, new classification, changed by, reason. Deep link: agent activity monitor.

**F11.24 - Agent Suspended**
Triggered when an agent is automatically suspended (oversight contact no longer active, or anomaly threshold breached in Phase 5). Recipients: the governance team and the prior oversight contact. Content: agent name, suspension reason, reactivation path. Deep link: agent registry.

**F11.25 - Human Review Required**
Triggered when an Observed-class agent performs a consequential action requiring human review. Recipients: the agent's human oversight contact. Content: agent name, action type, product affected, review deadline. Deep link: human review queue.

**F11.26 - Frozen Operation Requires Disposition**
Triggered when an operation enters the frozen state. Recipients: the governance team. Content: operation type, agent name, trigger, timestamp. Deep link: frozen operations queue in governance command center.

**F11.27 - Connection Package Refreshed** *(new v1.5)*
Triggered when a connection package is regenerated due to a connection detail change on the underlying product (F10.10). Recipients: the agent's oversight contact and the owning principal of the connection reference under which the package was issued. Content: product name, connection reference identifier, description of what changed in the connection details, and confirmation that the approved use-case scope is unchanged. Deep link: connection reference detail view in the domain admin dashboard. This notification is not triggered by connection package invalidation due to reference expiration or revocation; those events are covered by F12.22 expiration advance warning and F12.19 revocation notification respectively.

### Non-Functional Requirements
| NF11.2 | Email notifications delivered within 5 minutes of triggering event |
| NF11.3 | Webhook delivery with retry on failure (3 attempts, exponential backoff) |
| NF11.4 | Notification center loads within 1 second |
| NF11.5 | Notification history retained for 90 days |
| NF11.6 | Deduplication window configurable per notification category |

### Out of Scope

- **OS11.1** - SMS / push notification delivery
- **OS11.2** - [POST-MVP] Native Slack / Microsoft Teams app integration (webhook covers this use case at MVP)
- **OS11.3** - [POST-MVP] Notification analytics and delivery reporting
- **OS11.4** - AI-generated notification summaries

---

## Domain 12: Connection References and Per-Use-Case Consent *(new v1.5)*

**Depends on:** Domain 6 (Agent Integration Layer), Domain 8 (Operations and Workflow State), Domain 10 (Self-Serve Infrastructure), Domain 11 (Notifications)

### Domain Summary

Provenance currently grants agent access at the product level: an access grant records that a specific agent may consume a specific product. This model is necessary but not sufficient. It does not capture why the agent needs access, for how long, or within what scope of use. A governance team or product owner reviewing the access grant list cannot determine whether a given grant is still appropriate for its original purpose, whether the agent's behavior has remained within the intended use, or whether consent for a new use case has been implicitly assumed from an existing grant.

The connection reference pattern addresses this gap. A connection reference is a first-class, owned, revocable entity that pairs an agent's access to a product with an explicit, human-consented declaration of use case. The consenting principal sees what the agent claims it intends to do, approves or denies that specific intent, and that decision is preserved immutably as part of the audit trail. Revocation is explicit and immediate. Expiration is bounded. Runtime enforcement verifies that agent actions remain within the declared scope of the consent that authorized them.

Connection references compose with, not replace, the existing access grant model. An access grant establishes that an agent may access a product. A connection reference establishes for what declared purpose and within what scope that access is authorized at a given point in time. Both must exist and be in an active state for an agent action to be authorized against any product.

### Functional Requirements

**F12.1 - Connection Reference as Owned Entity**
The platform shall treat a connection reference as a first-class, versioned entity with an owning principal, a declared use case, a lifecycle state, and an explicit expiration. A connection reference is distinct from an access grant: an access grant establishes that an agent may access a product; a connection reference establishes for what declared purpose and within what scope that access is authorized at a given point in time. Both must exist and be in an active state for an agent action to be authorized against any product.

**F12.2 - Connection Reference Lifecycle States**
Every connection reference shall exist in exactly one of the following states at any given time:

- **Pending** - the agent or human proxy has submitted a request with a declared use case; no human decision has been made
- **Active** - the owning principal has consented; the agent may act within the declared scope
- **Suspended** - temporarily deactivated by the owning principal, governance, or automatic trigger; the agent may not act; the reference is not revoked and may be reactivated by the owning principal
- **Expired** - the declared duration has elapsed; the reference is no longer usable and cannot be reactivated; it is retained as an immutable audit record
- **Revoked** - explicitly terminated by the owning principal, the governance layer, or by automatic trigger (F12.21); the reference is no longer usable and cannot be reactivated; it is retained as an immutable audit record

No transition from Expired or Revoked to any other state is permitted under any circumstance.

**F12.3 - Connection Reference Ownership**
Every connection reference shall have exactly one owning principal. The owning principal is the human principal responsible for the data product being accessed (the Data Product Owner, or a Domain Owner acting in that capacity). The owning principal is the sole authority who may approve, suspend, reactivate, or revoke a connection reference, subject to governance override as defined in F12.14. Ownership cannot be transferred after creation.

**F12.4 - Connection Reference Expiration**
Every connection reference shall carry an explicit expiration date. No indefinite connection references are permitted under any circumstance, for any product classification, trust tier, or agent type. The maximum permitted duration is governance-configurable per data classification. Platform-shipped defaults are:

| Classification | Default Maximum Duration |
| --- | --- |
| Public | 1 year |
| Internal | 180 days |
| Confidential | 90 days |
| Restricted | 30 days |

Governance may override these defaults upward or downward. The platform shall enforce expiration automatically without requiring action from the owning principal. An agent operating under an expired connection reference shall be denied at the point of enforcement without grace period.

**F12.5 - Use-Case Declaration as Required Field**
Every connection reference shall carry a use-case declaration provided by the requesting agent or human proxy at request time. The platform shall not permit a connection reference to be created without a use-case declaration. The use-case declaration is immutable after the connection reference is created; if the agent's purpose changes, a new connection reference must be requested.

**F12.6 - Use-Case Declaration Structure**
A use-case declaration shall use a hybrid structure combining a governance-defined taxonomy category with a required free-text elaboration:

- **Use-case category** (required, selected from governance-defined taxonomy): the platform shall ship with a default taxonomy of eight categories: Reporting and Analytics, Model Training, Pipeline Input, Audit and Compliance, Product Development, Operational Monitoring, Research, and Integration. The governance layer may extend, rename, or restrict the available categories for their organization. The category is machine-readable and may be referenced in governance policy rules.
- **Purpose elaboration** (required, free-text): a human-readable description of the specific intended use within the selected category. Minimum length governance-configurable; platform default is 50 characters. Preserved verbatim and immutably in the audit record.
- **Intended scope** (required): the subset of the product's output ports or data categories the agent intends to access. An agent may declare a narrower scope than its access grant permits; it may not declare a broader scope. Enforced at runtime per F12.16.
- **Requested duration** (required): the time period for which the agent requires access under this use case. May not exceed the governance-configured maximum for the product's classification.
- **Data category constraints** (optional): if the product carries fields of multiple sensitivity levels, the agent may declare that it will access only specific data categories. A declaration to access a subset does not grant access to the full product; the platform shall enforce the declared constraint at runtime.

**F12.7 - Use-Case Declaration Preservation**
The use-case declaration as submitted by the requesting agent or proxy shall be preserved verbatim and immutably in the audit record for the lifetime of the connection reference and beyond. If the owning principal modifies scope during the approval flow, both the original declaration and the approved declaration shall be retained, with the modification attributed to the approving principal with timestamp and reason.

**F12.8 - Agent Discovery of Connection Reference Status**
When an agent queries the platform for data products it may access, the platform shall indicate for each product whether an active connection reference exists for the requesting agent. An agent shall be able to distinguish between: products accessible immediately under an existing active connection reference; products with an active access grant but no active connection reference (request required before access); and products with no access grant (grant request required first, then connection reference request).

**F12.9 - Request Initiation by Trust Classification**
The platform shall enforce different request initiation rules based on the agent's trust classification:

- **Observed**: the agent may not initiate a connection reference request autonomously. A human proxy must submit the request on the agent's behalf. This extends the no-side-effect rule established in F6.3.
- **Supervised**: the agent may initiate a connection reference request autonomously. The request is treated as a consequential action and is held pending oversight contact acknowledgment before being routed to the owning principal for approval.
- **Autonomous**: the agent may initiate a connection reference request autonomously. The request is routed directly to the owning principal for approval without an additional oversight hold. Autonomous classification does not grant self-approval; human approval by the owning principal is always required regardless of trust classification.

**F12.10 - Request Routing and Notification**
Upon submission, the platform shall route the connection reference request to the owning principal of the target product for review and notify them immediately via the notification system (Domain 11). The notification shall surface: the requesting agent's identity and trust classification, the full use-case declaration including category and elaboration, the requested duration, and the requested data category scope. The owning principal shall be able to approve, deny, or modify-and-approve the request from the notification or from the domain admin dashboard.

**F12.11 - Consent as an Immutable Record**
When an owning principal approves a connection reference request, the platform shall capture the consent as an immutable record containing: the approving principal's identity, the timestamp of approval, the use-case declaration as approved, the approved duration, the approved data category scope, and the governance policy version in effect at time of approval. This consent record is append-only. No subsequent modification to the connection reference's operational state may alter the consent record.

**F12.12 - Denial Record**
When an owning principal denies a connection reference request, the platform shall capture the denial as an immutable record containing: the denying principal's identity, the timestamp, the reason for denial (required, cannot be null), and the full use-case declaration as submitted. The requesting agent or proxy shall be notified of the denial with the stated reason.

**F12.13 - Activation on Approval**
A connection reference transitions from Pending to Active immediately upon approval by the owning principal. Upon activation, the platform shall: emit a connection package (per Domain 10, F10.8) scoped to the approved data category scope and port access of the connection reference; record the activation in the audit log; and make the connection reference visible to the agent through the federated query layer. Each connection reference produces its own connection package. The connection package inherits its scope directly from the approved scope of the connection reference and is invalidated when the reference is no longer Active.

**F12.14 - Governance Override on Activation**
The governance layer may configure policy requiring governance review before activation for specific product classifications or use-case categories. In such cases, the connection reference enters a governance-hold sub-state after owning-principal approval, pending governance sign-off. The governance team shall be notified immediately. The requesting agent and owning principal shall be informed that governance review is required.

**F12.15 - Version Behavior on Product Republication**
Connection reference state shall respond to product version changes as follows:

- **PATCH or MINOR version**: active connection references remain Active. The provenance envelope shall reflect the current product version at query time. No re-consent is required.
- **MAJOR version**: all active connection references for that product shall automatically transition to Suspended immediately upon publication of the new MAJOR version. The owning principal and each affected agent's oversight contact shall be notified. Suspended references cannot be reactivated against a new MAJOR version; the agent must submit a new connection reference request against the new version. Prior connection references are retained as immutable audit records linked to the prior product version.

**F12.16 - Use-Case Scope Enforcement**
At the time of every agent action against a product, the platform shall verify that an active connection reference exists for that agent-product pair and that the action falls within the declared and approved scope of that connection reference. An action that exceeds the declared scope shall be denied, logged with a scope-violation marker, and surfaced to the owning principal and governance team. The denial shall return a specific error distinguishing scope violation from reference absence and reference expiration, so that agent developers can respond appropriately. Scope verification is in addition to, not a replacement for, existing trust classification enforcement (F6.10) and access grant enforcement.

**F12.17 - Behavioral Differences by Trust Classification at Runtime**
The platform shall enforce different behavioral rules for agents holding active connection references based on trust classification:

- **Observed**: every action taken under the connection reference is logged in real time and surfaced in the human review queue. No action takes effect until the oversight contact approves it, consistent with F6.3.
- **Supervised**: consequential actions are held pending oversight contact approval. Read-only actions within declared scope proceed immediately.
- **Autonomous**: actions within the declared scope of an active connection reference proceed immediately. The full audit trail is maintained.

**F12.18 - Connection Reference Verification in Provenance Envelopes**
Every query result produced by an agent operating under a connection reference shall include, in the provenance envelope (F6.17), the connection reference identifier, the approved use-case category, the purpose elaboration as approved, the approved scope, and the governance policy version at time of query. This makes the authorization basis for any agent-produced artifact fully traceable from the artifact back to the human consent decision.

**F12.19 - Principal-Initiated Revocation**
The owning principal may revoke an active or suspended connection reference at any time without governance approval. Revocation takes effect immediately. In-flight operations authorized by the revoked connection reference and not yet complete shall enter the frozen state (Domain 8, F8.1) pending governance disposition. The revoking principal must provide a reason; the reason is recorded in the audit log.

**F12.20 - Governance-Initiated Revocation**
The governance layer may revoke any connection reference across all domains. Governance revocation requires a documented reason. In-flight operations follow the same frozen-state path as principal-initiated revocation. The owning principal and the requesting agent's oversight contact are notified immediately.

**F12.21 - Automatic Revocation Triggers**
The platform shall automatically revoke a connection reference when any of the following conditions occur: the product is deprecated or decommissioned; the agent's underlying access grant is revoked or expires; the agent transitions to Suspended or Retired lifecycle state; or the owning principal is no longer an active platform principal. The triggering condition is recorded as the revocation reason in the audit log. Revocation of an access grant cascades to revoke all connection references for that agent-product pair; revocation of a connection reference does not affect the underlying access grant.

**F12.22 - Expiration Behavior**
When a connection reference reaches its expiration date, it transitions to Expired automatically. Expiration does not trigger the frozen-state path. In-flight operations initiated before the expiration timestamp are permitted to complete. Operations initiated after the expiration timestamp are denied. The agent and owning principal shall be notified in advance of expiration per the notification conventions in Domain 11. When the connection package associated with an expired reference is requested, the platform shall return an invalidated status rather than the package contents.

**F12.23 - Complete Audit Trail**
Every state transition of a connection reference shall produce an immutable audit log entry. The audit trail shall be sufficient to reconstruct the complete lifecycle of a connection reference without consulting any other data source, answering: who requested it and when, what use case was declared, who approved it and when, what scope was approved, when it became active, what actions were taken under it, whether any scope violations occurred, who revoked it and why or that it expired, and what happened to any in-flight operations at revocation time.

**F12.24 - Scope Violation Logging**
Every instance where an agent action is denied due to scope violation shall produce an audit log entry with: the agent identity, the connection reference identifier, the action attempted, the declared scope that was exceeded, and the timestamp. Scope violations shall be surfaced to the owning principal and governance team via the notification system.

**F12.25 - Legacy Agent Migration on Enforcement Activation**
When Domain 12 enforcement is activated on a platform that has existing agents with active access grants but no connection references, the platform shall not deny those agents immediately. The platform shall execute a one-time migration that provisions a legacy-compatibility connection reference for each existing active agent-product access grant pair. Legacy-compatibility connection references shall: carry a use-case category of "Legacy - Migration Required"; carry a purpose elaboration of "Auto-provisioned for continuity at Domain 12 enforcement activation. The owning principal should review and replace with a proper use-case declaration"; be scoped to the full approved scope of the underlying access grant; have a maximum duration of 30 days from activation (non-renewable as a legacy reference); notify the owning principal of each product via the notification system at provisioning time; and be visually distinguished in the governance and domain admin UI from properly requested connection references. At the end of the 30-day period, legacy-compatibility references expire normally. Agents operating under expired legacy references must request a proper connection reference before access resumes.

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NF12.1 | Consent capture (Pending to Active transition on principal approval) shall complete within 5 seconds of the principal's approval action |
| NF12.2 | Runtime scope enforcement overhead shall not increase the agent query path p95 latency beyond 50ms above the baseline targets (single-product query under 2s p95; 10-product federated query under 10s p95) |
| NF12.3 | Revocation shall propagate to all enforcement points within 10 seconds of the revocation action |
| NF12.4 | Automatic expiration shall take effect within 60 seconds of the expiration timestamp |
| NF12.5 | The audit trail for a connection reference shall be complete - no state transition shall occur without a corresponding immutable audit log entry |
| NF12.6 | Scope violation detection and denial shall occur within the same request cycle as the denied action - no action that violates declared scope shall be permitted to proceed and then denied retroactively |
| NF12.7 | Connection reference request notification shall reach the owning principal within 30 seconds of submission |
| NF12.8 | MAJOR version publication shall trigger automatic suspension of all affected connection references within 60 seconds of the version publication event |

### Acceptance Criteria

**AC12.1 - Connection reference is required for all agent access**
Attempt an agent action against any product with an active access grant but no active connection reference. The action shall be denied regardless of product classification, trust tier, or use-case type.

**AC12.2 - Use-case declaration is preserved verbatim**
Retrieve the audit log for any connection reference. The use-case declaration as submitted by the requesting agent or proxy shall match exactly what was submitted. If the owning principal modified scope during approval, both the original and modified declarations shall be independently retrievable with attribution.

**AC12.3 - Scope enforcement is real-time and preventive**
Submit an agent action that falls outside the declared scope of an active connection reference. The action shall be denied before execution with a scope-violation error distinct from reference-absent and reference-expired errors. A scope violation entry shall appear in the audit log. The owning principal shall receive a notification of the violation.

**AC12.4 - Revocation is immediate and propagates to in-flight operations**
Revoke an active connection reference while an agent operation is in progress. The in-flight operation shall enter the frozen state within 10 seconds of revocation. The agent shall be denied for any new actions against that product immediately. The frozen operation shall not auto-complete or auto-cancel.

**AC12.5 - MAJOR version publication suspends active connection references**
Publish a new MAJOR version of a product with active connection references. All active connection references shall transition to Suspended within 60 seconds. Attempts to act under a suspended connection reference shall be denied. The owning principal and oversight contacts shall receive suspension notifications.

**AC12.6 - Autonomous agents may self-request but not self-approve**
Submit a connection reference request as an Autonomous-class agent. The request shall be accepted and routed to the owning principal. The connection reference shall not become Active without explicit owning-principal approval. The agent shall not be able to approve its own request.

**AC12.7 - Observed agents require human proxy to request**
Attempt to submit a connection reference request as an Observed-class agent without a human proxy. The request shall be rejected. Submit the same request through a human proxy. The request shall be accepted and routed to the owning principal.

**AC12.8 - Provenance envelopes include connection reference context**
Execute a data query as an agent holding an active connection reference. The provenance envelope on the query result shall include the connection reference identifier, the approved use-case category, and the approved scope. Retrieve the connection reference record from the audit log using the identifier. The records shall match.

**AC12.9 - Default expiration maximums are enforced by classification**
Attempt to request a connection reference against a Restricted product with a requested duration of 31 days. The request shall be rejected for exceeding the default maximum of 30 days. The same request with a 30-day duration shall be accepted.

**AC12.10 - Legacy migration does not cause immediate denial of existing agents**
Activate Domain 12 enforcement on a platform with existing agent-product access grants and no connection references. No existing agent shall be denied access immediately. Legacy-compatibility connection references shall appear in the governance UI for each affected agent-product pair. Owning principals shall receive notification of the auto-provisioned references. After 30 days, legacy references expire and agents must request proper connection references.

### Architectural Decisions

The three architectural open questions identified during requirements authoring are resolved by the following ADRs:

| Open Question | Resolution Summary | ADR |
| --- | --- | --- |
| AQ1 - How does scope enforcement integrate with the existing OPA policy evaluation path? | Scope matching runs as a structural subset check in a new Agent Query Layer guard placed after JWT validation and before tool dispatch. OPA is consulted only for governance-authored rules at state transition time, not on the hot path. | ADR-006 |
| AQ2 - How is connection reference state replicated to enforcement points within the revocation propagation window? | In-memory cache at each Agent Query Layer replica, invalidated via Redpanda events published using the transactional outbox pattern. Temporal drives scheduled state transitions. No new paid infrastructure required at MVP. | ADR-007 |
| AQ3 - How does the connection reference relate to the connection package issued in Domain 10? | A connection package is issued per connection reference with scope inherited from the approved scope of the reference. Package lifecycle tracks reference lifecycle. Connection detail refresh regenerates packages without re-consent. | ADR-008 |

### Out of Scope

- **OS12.1** - Internal platform-to-source credential handling (Domain 3)
- **OS12.2** - Changes to the MCP protocol specification
- **OS12.3** - SOC 2 control mapping
- **OS12.4** - Human-to-human access delegation (governed by Domain 6 and Domain 7)
- **OS12.5** - Connection reference analytics and aggregate reporting (post-launch)

---

## Infrastructure Readiness

These requirements define the thresholds at which the EC2 infrastructure is no longer adequate and Phase 6 migration should be initiated. They are observable signals, not subjective judgments. Phase 5.1 (Stability and Reliability) monitoring puts the instrumentation in place to track all of these.

**NF-IR.1 - Disk Utilization Threshold**
When primary EC2 EBS volume utilization exceeds 75% sustained over a 7-day period, Phase 6 planning shall be initiated. When utilization exceeds 90%, Phase 6 migration shall be treated as urgent.

**NF-IR.2 - Memory Pressure Threshold**
When average memory utilization on the primary EC2 instance exceeds 80% sustained over a 72-hour period, Phase 6 planning shall be initiated. When memory utilization causes any service to restart due to OOM conditions more than twice in a 30-day period, Phase 6 migration shall be treated as urgent.

**NF-IR.3 - API Response Time Degradation**
*Dependency: baseline established during Phase 5.1 commissioning.*
When p95 API response time for standard control plane operations exceeds 3x the established baseline, sustained over a 48-hour period, Phase 6 planning shall be initiated.

**NF-IR.4 - MCP Query Degradation**
When p95 MCP tool response time for single-product queries exceeds 5 seconds (against the 2 second target in NF6.1) sustained over a 24-hour period, Phase 6 planning shall be initiated.

**NF-IR.5 - Recovery Time Objective**
*Dependency: recovery procedures established during Phase 5.1.*
The platform shall be recoverable from a complete primary EC2 instance failure within 4 hours. If actual recovery from any incident exceeds 4 hours, Phase 6 migration shall be treated as urgent.

**NF-IR.6 - Tenant Scale Threshold**
When the platform reaches 10 active organizations or 5,000 published data products, Phase 6 planning shall be initiated regardless of whether performance thresholds have been breached.

**NF-IR.7 - Backup Restore Validation**
*Dependency: backup procedures established during Phase 5.1.*
Phase 5 backup procedures shall be validated by a successful test restore at least once per quarter. If a test restore fails or exceeds 2 hours, Phase 6 planning shall be initiated.

**NF-IR.8 - Concurrent Session Threshold**
When the platform sustains more than 50 concurrent MCP sessions over a 24-hour period, performance shall be benchmarked against NF6.1 targets. If targets are not met at this concurrency level, Phase 6 planning shall be initiated.

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
| Self-Serve Infrastructure | Primary | Primary | Oversight | Primary | Admin |
| Notifications | Recipient | Recipient | Primary | Recipient | Admin |
| Connection References and Per-Use-Case Consent | Owner (consent) | | Policy | Requestor | |

---

## Appendix B: Post-MVP Candidate Registry

| Capability | Domain | Priority Signal |
| --- | --- | --- |
| Sub-tenancy / business-unit hierarchy | 1 | Enterprise sales driver |
| Scale beyond 200 domains / 50K products | 1 | Architectural growth path |
| AI-assisted data product definition authoring | 2, 7 | High-value, strong candidate for first post-MVP release |
| Schema inference for streaming, NoSQL, file sources | 3 | Natural connector library extension |
| Managed private connectivity | 3 | Enterprise security requirement |
| Policy-as-code authoring | 4 | Sophisticated governance teams |
| Native GRC platform integrations | 4 | Enterprise compliance driver |
| Trust score weight customization | 5 | Governance configurability extension |
| Natural language query precision improvement | 6 | Continuous investment area |
| Agent financial metering and chargeback | 6 | Internal billing / FinOps use case |
| Agent anomaly detection and Temporal escalation | 6 | Requires production behavioral baseline; Phase 5 |
| Per-domain agent trust classification | 6 | Schema scope field ready; logic deferred |
| Trust-scope-based search result filtering | 6 | Audit infrastructure confirmed; filtering deferred |
| Mobile application | 7 | Broader reach post-stabilization |
| Embedded analytics and custom report building | 7 | Self-service analytics layer |
| White-labeling and custom tenant branding | 7 | Enterprise and OEM use case |
| In-platform data preview | 7 | High-value consumer experience |
| Collaborative simultaneous definition editing | 7 | Team authoring workflow |
| Reference architecture guidance in connector UX | 7 | Adoption accelerator |
| Extended consumer connection experience | 7, 10 | Tooling-context-aware packages beyond standard types |
| Additional frozen state triggers | 8 | Domain suspension, policy change mid-workflow |
| Audit log pattern analysis and anomaly detection | 8 | Phase 5, requires behavioral baseline |
| SSO for connection packages | 10 | Enterprise identity management |
| Interactive query sandbox | 10 | High-value developer experience |
| Native Slack / Teams integration | 11 | Post-webhook convenience |
| Notification analytics and delivery reporting | 11 | Operational visibility |
| AI-generated notification summaries | 11 | Reduce notification fatigue at scale |
| Connection reference analytics and aggregate reporting | 12 | Operational visibility post-launch |
| Per-use-case consent for human consumers | 12 | Currently applies to agents only; human extension is post-launch |
| Use-case taxonomy governance tooling | 12 | Richer taxonomy management UI beyond add/remove/rename |

---

### Phase 6 - Production Scale (When Funded)

Phase 6 is triggered by enterprise customer requirements, investor funding, or the Infrastructure Readiness thresholds defined above. It is not a calendar-driven phase.

| Capability | Trigger |
| --- | --- |
| Kubernetes / EKS migration | Engineering team scale or customer SLA requires it |
| Amazon Aurora PostgreSQL | Database reliability SLA required by customers |
| Amazon Neptune | Graph database scale or managed SLA required |
| Amazon MSK | Kafka operational burden at scale |
| Amazon OpenSearch Service | Search reliability SLA required |
| Temporal Cloud | Workflow engine managed SLA required |
| mTLS between services | Enterprise security requirements or compliance audit |
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
| Lean Phase 5 - Open Source Ready | Phase 5 focuses on reliability, security, and developer experience on existing infrastructure | Provenance is an open source platform pre-revenue and pre-investment. Phase 6 is triggered by customers or funding, not a calendar date. |
| React Flow with Dagre for Lineage Visualization | React Flow replaces D3 force-directed graph | Left-to-right directed layout communicates data flow direction intuitively. React Flow's Dagre integration provides deterministic, readable layout for directed acyclic graphs. D3 force-directed layout is appropriate for exploratory network graphs but not for communicating structured lineage. See ADR-002. |
| Port Connection Details as Platform-Enforced Publication Requirement | Connection details completeness cannot be waived by domain policy or governance override | A data product without usable connection details is not self-serve. Domains have maximum autonomy in all other dimensions; this is the non-negotiable floor for the self-serve infrastructure principle. |
| Notifications as a First-Class Domain | Notifications defined as a complete domain with all triggers, recipients, and channels specified | Notifications are not a UI feature; they are the connective tissue between platform events and human action. An untriggered event that required human response is a platform failure. |
| Connection Reference as Composition Primitive | Connection references compose with, not replace, the existing access grant model. Both must be active for an agent action to be authorized. | The consent decision (for what declared purpose) and the grant decision (may this agent ever access this product) answer different governance questions at different cadences with different review criteria. Conflating them makes it impossible to answer either question cleanly from the audit log. See ADR-005. |
| Per-Use-Case Consent Required for All Agent Access | Connection references are required for all agent access to all products regardless of classification, trust tier, or use-case type | Universal requirement provides maximum auditability and eliminates the class of exploitable gaps created by exemptions. The operational overhead concern is addressed through implementation (efficient request flow) rather than policy exemptions. |

---

## Appendix D: Phase 5 Scope - Open Source Ready

Phase 5 is "Open Source Ready." The goal is to make the platform reliable, secure, and contributor-friendly on existing infrastructure. No significant new cloud spend. Estimated additional monthly infrastructure cost: $10-30.

### 5.1 - Stability and Reliability (Complete - April 17, 2026)

Automated daily backups, Docker restart policies, CloudWatch basic monitoring, operational runbook, log rotation.

### 5.2 - Security Essentials (Complete - April 18, 2026)

HTTPS enforced via Caddy at dev.provenancelogic.com and auth.provenancelogic.com. Keycloak domain wiring complete. JWT claims correctly plumbed. Security group audit complete. MCP API key rotated. Environment variable audit and SSH key management review carryover.

### 5.3 - JWT Agent Authentication (Complete - April 16, 2026)

X-Agent-Id header replaced with cryptographically verified JWT tokens. Agent registration provisions Keycloak client credential. MCP server validates JWT on every request. See ADR-002.

### 5.4 - Data Product Completeness - Priority 1

Column-level schema, ownership/stewardship, freshness signals, and access status for requesting principal in get_product response. Data exists in platform today.

### 5.5 - Agent Anomaly Detection

Behavioral pattern analysis against audit log. Configurable thresholds per trust classification. Temporal escalation workflows.

### 5.6 - Developer Experience

Local setup under 30 minutes. CONTRIBUTING.md. Comprehensive seed data. OpenAPI documentation. README update (handled by Claude Code from this PRD).

### 5.7 - SOC 2 Foundations

Data flow documentation, access control documentation, incident response runbook, audit log export, change management documentation.

### Out of Scope for Phase 5 - Deferred to Phase 6

Kubernetes / EKS, Aurora, Neptune, MSK, Amazon OpenSearch Service, Temporal Cloud, mTLS, WAF, multi-AZ, Datadog, CloudFront, formal SOC 2 Type II audit.
