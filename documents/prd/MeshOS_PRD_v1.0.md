# MeshOS Product Requirements Document

**Version 1.0 — MVP Release**
**Confidential — Not for Distribution**

---

## Executive Summary

MeshOS is a cloud-native, multi-tenant self-service data mesh platform designed for the Data 3.0 era. It is the first platform purpose-built to treat AI agents as first-class participants alongside human domain teams, consumers, and governance boards in a federated data mesh architecture.

The platform embodies the data mesh principles articulated by Zhamak Dehghani while extending them for the agentic AI era through a dual consumption model: human consumers connect directly to data product output ports; AI agents interact through a governed, policy-aware federated semantic query layer.

MeshOS is a coordination and contract platform. It does not store data, execute pipelines, or provide a centralized query engine for human consumers. It owns the contracts between domains, the lineage graph that connects them, and the governance engine that makes the mesh trustworthy.

### Five Foundational Design Principles

1. **Domain sovereignty with interoperability contracts** — domains own their data and pipelines; the platform owns the contracts between them and the lineage graph that connects them
2. **Ports are definitional** — a dataset without explicit ports is not a data product on this platform
3. **Governance as a policy engine** — the federated governance team defines a minimum viable policy floor; domains extend upward; the platform enforces both computationally, never manually
4. **Dual consumption model** — humans discover and connect to output ports directly; AI agents interact through a semantic federated query layer that is policy-aware in real time
5. **Lineage by emission, not capture** — the platform assembles a complete lineage graph from events emitted by domain pipelines and agent reasoning traces without owning pipeline execution

### Four Personas (Priority Order for Data 3.0)

1. AI Agents — autonomous consumers and potential producers of data products
2. Domain Teams — human owners and publishers of data products
3. Data Consumers — human discoverers and users of data products
4. Governance Teams — policy authors and compliance monitors

### Deployment Model

Cloud-native SaaS, multi-tenant. The control plane is fully managed SaaS. The data plane remains in each domain's own infrastructure regardless of cloud provider. No data ever transits the MeshOS platform.

### MVP Scale Targets

| Dimension | MVP Target |
|---|---|
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
|---|---|---|
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

**NF1.1 — Tenant Isolation**
Organization data and metadata shall be cryptographically isolated at rest and in transit.

**NF1.2 — Scale**
The platform shall support organizations with up to 200 domains and up to 50,000 data products per organization without degradation of control plane performance.

**NF1.3 — Identity Federation**
The platform shall support federation with external identity providers via OIDC and SAML 2.0.

**NF1.4 — Auditability**
Every action by any principal shall produce an immutable audit log entry retained for a minimum of 7 years.

**NF1.5 — Availability**
The control plane shall target 99.99% availability. Control plane outages shall not affect domain teams' ability to serve data through already-published output ports.

### Out of Scope

- **OS1.1** — Internal org structure and team membership management beyond role assignment
- **OS1.2** — Domain infrastructure provisioning and management
- **OS1.3** — [POST-MVP] Sub-tenancy / business-unit hierarchy above the domain level

---

## Domain 2: Data Product Definition and Lifecycle

The heart of the platform. Defines the data product as a first-class entity, the port model, governance-configured product schemas, versioning, lifecycle states, and AI provenance requirements.

### Functional Requirements

#### The Data Product as a First-Class Entity

**F2.1 — Data Product as Governed Entity**
The platform shall treat a data product as a first-class, versioned, governed entity with an explicit owner, contract, and lifecycle state at all times.

**F2.2 — Data Product Definition as Code**
Every data product shall have a machine-readable definition — a declarative specification fully describing its identity, ports, schema, SLOs, governance attributes, and lineage declarations. This definition shall be the authoritative source of truth, versionable and submittable via API.

**F2.3 — Governance-Configured Product Schema**
Required attributes in a data product definition shall not be hardcoded. The governance layer shall define a configurable, versioned product schema specifying mandatory, recommended, and optional attributes. Every definition shall be validated against this schema at publication time.

**F2.4 — Domain-Level Schema Extension**
A domain shall define additional required or recommended attributes on top of the governance floor. Extensions shall not contradict or weaken governance-layer attributes. The effective product schema is the union of the governance floor and applicable domain extensions.

**F2.5 — Product Schema Versioning**
The governance layer's product schema shall itself be versioned with configurable grace periods for compliance. The platform shall surface compliance drift — products compliant under a prior schema version but non-compliant under the current one.

#### The Port Model

**F2.6 — Ports as Definitional**
A data product shall not be valid or publishable without at minimum one output port and one discovery port declared.

**F2.7 — Port Types**
The platform shall support five port types:
- **Input Ports** — upstream data consumed by this product
- **Output Ports** — how consumers access this product
- **Discovery Ports** — findability metadata surface
- **Observability Ports** — quality and SLO signals
- **Control Ports** — administrative interface for governance interactions

**F2.8 — Output Port Interface Types**
Six output port types shall be supported: SQL/JDBC endpoint, REST API endpoint, GraphQL endpoint, Streaming topic (Kafka/Kinesis/Pub/Sub), File/object export (S3/GCS/ADLS), and Semantic query endpoint (for agent consumption).

**F2.9 — Port Contract Enforcement**
Each declared port shall have an associated machine-readable contract monitored by the platform. Violations shall be surfaced to all authorized consumers.

**F2.10 — Input Port Dependency Declaration**
When a product declares input ports referencing other products, the platform shall register those dependencies in the lineage graph automatically. A domain team shall not declare a dependency on a product they are not authorized to access.

#### Data Product Lifecycle

**F2.11 — Lifecycle States**
Every data product shall exist in exactly one state:
- **Draft** — being authored, not visible to consumers
- **Published** — active, discoverable, fully governed
- **Deprecated** — discoverable, no new access grants permitted
- **Decommissioned** — no longer accessible, metadata retained

**F2.12 — Publication Requirements**
A product shall transition from Draft to Published only when: the definition is valid against the effective product schema, all declared ports have valid contracts, a product owner is assigned, and all governance-mandatory attributes are populated.

**F2.13 — Deprecation Process**
Initiating deprecation shall: notify all active consumers with a configurable notice period, surface the deprecation in the discovery port, block new access grant requests, and record the deprecation rationale.

**F2.14 — Deprecation Override**
The governance layer shall have authority to accelerate or block a domain team's deprecation action.

**F2.15 — Decommissioning Guard**
A product shall not be transitionable to Decommissioned while it has active consumers. The governance layer may override with documented justification.

#### Versioning

**F2.16 — Semantic Versioning**
Every data product definition shall carry a semantic version (MAJOR.MINOR.PATCH):
- **PATCH** — non-breaking changes, no consumer notification required
- **MINOR** — additive changes, consumers notified, no action required
- **MAJOR** — breaking changes, triggers deprecation process for prior version

**F2.17 — Simultaneous Major Version Support**
The number of simultaneously active major versions permitted shall be governance-configurable. Platform default is two (current and one prior).

**F2.18 — Semantic Change Declaration**
When a MAJOR version increment occurs, the data product owner shall provide a structured semantic change declaration describing what the data means differently — not just what the schema changed. Stored in the lineage record and surfaced to human consumers and AI agents.

**F2.19 — Version Deprecation Schedule**
When a new MAJOR version is published, the platform shall automatically initiate a deprecation schedule for the previous MAJOR version.

#### Data Classification and Metadata

**F2.20 — Classification as Mandatory Governance Attribute**
Every data product shall carry a data classification defined by the governance layer's taxonomy. Classification influences access control, deprecation notice periods, lineage depth requirements, and agent access permissions.

**F2.21 — Classification Inheritance**
A domain team shall not classify an output product at a lower sensitivity level than its most sensitive input product without explicit governance override and documented justification.

**F2.22 — Governance-Configured Metadata**
Metadata attributes required on a data product shall be fully configurable by the governance layer. The platform shall ship with a DCAT-aligned baseline.

**F2.23 — Lineage Declaration**
Domain teams shall declare transformation lineage within a data product definition at a logical level. Declared lineage shall be supplemented by emitted lineage events from pipelines.

**F2.24 — AI Provenance Metadata**
When a data product is produced or transformed by an AI agent, the product definition shall carry AI provenance metadata by default: agent identity, model identifier and version, reasoning trace reference, and governance policy version at time of production. The governance layer may configure specific attributes but may not disable AI provenance capture without documented justification.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF2.1 | Definition validation shall complete in under 2 seconds |
| NF2.2 | Publication shall be atomic — no partial state visible to consumers |
| NF2.3 | Product schema updates shall take effect without platform downtime |
| NF2.4 | The data product definition format shall be an open, documented standard |
| NF2.5 | Every state transition shall produce an immutable audit record |

### Out of Scope

- **OS2.1** — [POST-MVP] AI-assisted data product definition authoring
- **OS2.2** — Pipeline execution and scheduling
- **OS2.3** — Data storage — platform holds metadata only
- **OS2.4** — Data quality computation

---

## Domain 3: Connectivity and Source Integration

Defines how domain teams register and authenticate external data sources, how inter-product dependencies are declared, and how the platform integrates with domain infrastructure for lineage emission and observability.

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

**F3.3 — Connector Extensibility**
The platform shall provide a documented connector SDK for custom connector development conforming to the same interface contract as pre-built connectors.

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

#### Inter-Product Connectivity

**F3.12 — Data Product as Input Source**
A domain team building an aggregate or consumer-aligned product shall declare another published data product as an input source via its output port.

**F3.13 — Access-Gated Input Declaration**
A domain team shall not declare an input port dependency on a product without an active access grant. Enforced at definition validation time.

**F3.14 — Inter-Product Schema Propagation**
When a domain team declares a product input port referencing another product's output port, the platform shall make the upstream schema available in the authoring context automatically.

**F3.15 — Inter-Product SLO Dependency**
The platform shall compute a dependency SLO chain — the aggregate reliability and freshness guarantees implied by upstream SLOs — and surface it during product definition authoring.

#### Platform Integration Connectivity

**F3.16 — Lineage Emission Endpoint**
The platform shall expose an authenticated, rate-limited lineage emission API endpoint conforming to the platform's open lineage event schema.

**F3.17 — Lineage Emission SDK**
The platform shall provide a lightweight open-source lineage emission SDK in Python, Java, Scala, and JavaScript/TypeScript.

**F3.18 — Observability Emission Endpoint**
The platform shall expose an observability emission API endpoint for domain pipelines to emit quality, freshness, and completeness metrics.

**F3.19 — Webhook and Event Notification**
The platform shall support outbound webhook notifications for control port interactions: deprecation signals, access grant changes, policy enforcement actions, and schema drift alerts.

**F3.20 — CI/CD Integration**
The platform shall expose definition validation and publication APIs suitable for CI/CD integration. Reference implementations shall be provided for GitHub Actions and GitLab CI.

**F3.21 — Semantic Query Port Registration**
For products declaring a semantic query output port, the platform shall manage registration, authentication, and routing to the federated agent query layer without requiring domain teams to understand the agent layer architecture.

**F3.22 — Agent Source Discovery**
The federated agent query layer shall have read access to connectivity metadata of all products an agent is authorized to consume. The agent layer sees product interfaces, never source credentials or internals.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF3.1 | New connectors shall be addable without platform downtime |
| NF3.2 | Connector validation shall complete within 10 seconds |
| NF3.3 | Schema inference supported for relational, warehouse, lakehouse at MVP |
| NF3.4 | Lineage emission: 10,000 events/sec, 100ms p99 latency |
| NF3.5 | Credential zero-knowledge — architecturally enforced, audit-verifiable |
| NF3.6 | SDK shall have minimal dependency footprint |
| NF3.7 | Connector failure isolation — zero cross-domain impact |

### Out of Scope

- **OS3.1** — Data extraction, transformation, or loading
- **OS3.2** — Pipeline execution environment
- **OS3.3** — [POST-MVP] Schema inference for streaming, NoSQL, file sources
- **OS3.4** — [POST-MVP] Managed private connectivity (PrivateLink, Private Service Connect)
- **OS3.5** — Cross-domain connector sharing

---

## Domain 4: Governance Engine

The computational embodiment of the organization's federated governance model. Governance rules are configured through a declarative UI, stored as versioned policy artifacts, and enforced automatically.

> **A deliberate design decision:** governance policy is authored through a declarative UI, not code. The governance team should not need to become engineers to govern effectively. The platform makes compliant behavior the path of least resistance — the right thing is always the easy thing.

### Functional Requirements

#### Governance Design Principles

**F4.1 — Governance as Computation, Not Process**
The platform shall enforce governance rules computationally and automatically. A data product violating a governance rule shall be flagged, blocked, or remediated by the platform without requiring manual governance team intervention.

**F4.2 — The Right Thing Is the Easy Thing**
Compliant behavior shall always be the path of least resistance for every persona. Non-compliance shall be surfaced clearly, early, and with actionable remediation guidance — never as a surprise at publication time.

**F4.3 — Governance Layer Separation**
The governance layer shall be architecturally and operationally separate from all domain activity. Governance team members shall not have access to domain-internal data, unpublished definitions, or connector configurations.

#### Policy Authoring

**F4.4 — Declarative Policy UI**
All governance policy shall be authored through a structured, declarative web interface using plain-language descriptions, contextual help, and real-time impact previews. No coding, scripting, or query language knowledge shall be required.

**F4.5 — Policy as Versioned Artifact**
Despite UI authoring, every policy shall be stored as a versioned, machine-readable artifact. Complete version history shall be maintained. Policy artifacts shall be exportable for external audit.

**F4.6 — Policy Domains**
The governance UI shall organize policy into eight independently configurable domains:
1. Product Schema Policy
2. Classification Taxonomy Policy
3. Versioning and Deprecation Policy
4. Access Control Policy
5. Lineage Policy
6. SLO Policy
7. Agent Access Policy
8. Interoperability Policy

**F4.7 — Policy Rule Builder**
A point-and-click rule builder shall allow governance teams to construct conditional rules using dropdown menus populated with the organization's actual domains, classifications, and metadata attributes. The completed rule shall display as a plain-language sentence confirming intent.

**F4.8 — Policy Impact Preview**
Before publishing a policy change, the UI shall present a preview showing affected products, products that would become non-compliant, impacted domains, and estimated remediation effort. Generated from live platform data within 3 seconds.

**F4.9 — Policy Grace Periods**
Policy changes that make existing compliant products non-compliant shall require a configured grace period. Grace periods shall never be zero for breaking policy changes.

**F4.10 — Policy Templates**
The platform shall ship with governance policy templates aligned to GDPR, CCPA, HIPAA, SOC 2, and data mesh best practices.

#### The Floor / Extension Model

**F4.11 — Global Policy Floor**
Policies published by the governance layer constitute the global policy floor. Domains cannot opt out of, weaken, or override floor policies.

**F4.12 — Domain Policy Extensions**
Domain teams shall define policy extensions within their domain — additive only, never contradictory to the floor.

**F4.13 — Effective Policy Computation**
For any data product, the platform shall compute and expose the effective policy — the union of the governance floor and all applicable domain extensions.

**F4.14 — Extension Inheritance Transparency**
The effective policy view shall clearly indicate for each rule whether it originates from the governance floor (non-negotiable) or a domain extension (domain-owned).

**F4.15 — Cross-Domain Policy Visibility**
Governance teams shall have visibility into all domain policy extensions. Domain teams shall only see their own extensions and the global floor.

#### Policy Enforcement

**F4.16 — Publication-Time Enforcement**
The platform shall enforce the effective policy at publication time. All policy violations shall be surfaced simultaneously with plain-language descriptions and remediation guidance.

**F4.17 — Continuous Compliance Monitoring**
The platform shall continuously detect compliance drift — products that were compliant when published but have become non-compliant due to policy changes, schema drift, SLO violations, or connector health degradation.

**F4.18 — Compliance State**
Every published data product shall carry one of four compliance states: **Compliant**, **Drift Detected**, **Grace Period**, or **Non-Compliant**.

**F4.19 — Enforcement Actions**
Five enforcement actions configurable per policy rule:
- **Warn** — surface warning, no blocking action
- **Block Publication** — prevent non-compliant publication
- **Restrict Access** — block new consumer grants
- **Notify Governance** — alert for manual review
- **Auto-Remediate** — for specific well-defined gaps with domain team confirmation

**F4.20 — Governance Override**
The governance layer shall grant time-limited compliance exceptions with documented rationale, granting team member, and expiration date. Exceptions shall auto-expire.

#### Classification Management and Reporting

**F4.21 — Classification Taxonomy Authoring**
The governance layer shall define the organization's data classification taxonomy. The platform shall ship with a recommended default taxonomy (Public, Internal, Confidential, Restricted).

**F4.22 — Classification-Driven Enforcement**
Classification shall be a first-class input to all policy rule conditions.

**F4.23 — Classification Change Governance**
Reclassification to higher sensitivity shall be immediately effective. Reclassification to lower sensitivity shall require governance layer acknowledgment if the product has active consumers.

**F4.24 — Governance Dashboard**
The governance layer shall have access to a real-time compliance dashboard: overall compliance rate with trend, compliance by domain, active grace periods, open exceptions, and recent policy changes.

**F4.25 — Domain Compliance Reports**
The governance layer shall generate compliance reports per domain, exportable in PDF and CSV.

**F4.26 — Audit Export**
All governance events shall be exportable from the audit log in a structured format suitable for external compliance audit consumption.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF4.1 | Policy evaluation at publication time under 3 seconds |
| NF4.2 | Continuous monitoring every 24 hours minimum, event-triggered near real-time |
| NF4.3 | Non-technical governance team member can author policy within 30 minutes of first use |
| NF4.4 | Policy evaluation shall be deterministic and consistent across all platform nodes |
| NF4.5 | Regulatory templates reviewed within 90 days of material regulatory changes |

### Out of Scope

- **OS4.1** — Legal interpretation of regulatory requirements
- **OS4.2** — Governance enforcement on data outside registered data products
- **OS4.3** — [POST-MVP] Policy-as-code authoring
- **OS4.4** — [POST-MVP] Native GRC platform integrations

---

## Domain 5: Lineage and Observability

Lineage is the trust infrastructure of the mesh. Observability is the reliability contract made visible. Together they transform a dataset into something a consumer — human or agent — can confidently depend on.

### Functional Requirements

#### Lineage Philosophy and Model

**F5.1 — Lineage as a Graph**
The platform shall maintain a continuously updated, organization-wide lineage graph representing the complete provenance network of all data products. The lineage graph is a first-class queryable asset.

**F5.2 — Lineage Node Types**
Six node types:
- **Source Nodes** — external systems registered via connectors
- **Data Product Nodes** — every published product
- **Port Nodes** — individual input and output ports
- **Transformation Nodes** — logical representations of transformation steps
- **Agent Nodes** — AI agent executions (distinct from transformation nodes due to non-deterministic characteristics)
- **Consumer Nodes** — authorized human and agent consumers

**F5.3 — Lineage Edge Types**
Five edge types: Derives From, Transforms, Consumes, Depends On, Supersedes.

**F5.4 — Dual Lineage Assembly**
The lineage graph shall be assembled from two sources:
- **Declared Lineage** — domain teams' design-time declarations in product definitions
- **Emitted Lineage** — runtime events emitted by pipelines and agents

The platform shall reconcile declared and emitted lineage, surfacing discrepancies as lineage drift events.

**F5.5 — Lineage Completeness Scoring**
The platform shall compute a lineage completeness score for every data product. Governance shall configure minimum completeness thresholds by classification.

**F5.6 — Lineage Depth**
The platform shall support lineage traversal of arbitrary depth with no imposed technical limit.

**F5.7 — Cross-Domain Lineage**
Lineage shall traverse domain boundaries seamlessly. Cross-domain lineage visibility shall be governed by access grants.

#### Lineage Emission

**F5.8 — Emission Event Schema**
The platform shall define and publish an open lineage event schema aligned with the OpenLineage specification, extended with platform-specific fields for agent provenance, governance policy references, and semantic change markers.

**F5.9 — Emission Authentication**
All lineage emission API calls shall be authenticated using the emitting principal's identity, stored as an immutable attribute of the lineage record.

**F5.10 — Emission Idempotency**
The lineage emission API shall be idempotent. Duplicate emission identified by client-provided event ID shall be deduplicated without error.

**F5.11 — Batch and Streaming Emission**
Both individual event emission (streaming pipelines) and batch emission (up to 1,000 events per call) shall be supported.

**F5.12 — Agent Lineage Emission**
AI agent executions shall emit lineage events including: agent identity and version, model identifier and version, reasoning context reference, input and output ports consumed/produced, governance policy version in effect, and confidence indicators where available.

**F5.13 — Lineage Drift Detection**
The platform shall compare declared versus emitted lineage and surface discrepancies as lineage drift events.

#### Lineage Querying and Visualization

**F5.14 — Lineage Graph API**
The platform shall expose a lineage graph query API supporting: upstream traversal, downstream traversal, impact analysis, path query between two nodes, and consumer query.

**F5.15 — Lineage Visualization**
An interactive, zoomable, navigable lineage visualization distinguishing node types visually, indicating lineage completeness and drift, supporting depth control, focus mode, and export.

**F5.16 — Impact Analysis Workflow**
When a domain team initiates a MAJOR version change or deprecation, the platform shall automatically execute an impact analysis and present results before the change is committed. Acknowledgment is a required step.

**F5.17 — Lineage Time Travel**
The lineage graph as it existed at any prior point in time shall be reconstructable. Minimum historical retention shall be governance-configurable with a platform minimum of 2 years.

#### Observability

**F5.18 — Observability as a Port**
The observability port is the authoritative interface through which consumers, agents, and the governance layer assess a product's runtime health. Populated from domain-emitted metrics and platform-computed metrics.

**F5.19 — Observability Metric Categories**
Eight metric categories on every data product:
1. Freshness
2. Completeness
3. Schema Conformance
4. SLO Compliance
5. Lineage Completeness
6. Governance Compliance
7. Connector Health
8. Version Currency

**F5.20 — SLO Declaration and Monitoring**
Domain teams shall declare SLOs for freshness, availability, schema stability, and query response time. The platform shall continuously evaluate declared SLOs against metrics in near real time.

**F5.21 — Observability Emission**
Domain pipelines shall emit observability metrics via the observability emission API. Discrepancies between platform-computed and domain-emitted metrics shall be flagged as observability drift events.

**F5.22 — Consumer-Visible Observability**
The observability port shall be accessible to all authorized consumers without a separate access request.

**F5.23 — Observability Alerting**
Domain teams shall configure alert rules on observability metrics with notifications via webhook, email, or external incident management. The governance layer shall define mandatory minimum alerting requirements by classification.

**F5.24 — Observability History**
Observability metric history shall be retained with a platform minimum of 90 days.

**F5.25 — Trust Score**
The platform shall compute a trust score for every published product — a composite of lineage completeness, SLO compliance history, governance compliance state, schema conformance, and freshness consistency over a rolling time window. The algorithm shall be transparent and documented.

**F5.26 — Agent Consumption Tracking**
Every AI agent consumption event against an output port shall be recorded automatically — capturing agent identity, model version, timestamp, query pattern, and governance policy version.

**F5.27 — Non-Determinism Lineage Markers**
Lineage edges produced by AI agent transformations shall carry a non-determinism marker. Downstream products inheriting from agent-produced products shall surface this marker in their own lineage records.

**F5.28 — Agent Observability Signals**
Agent-produced data products shall expose additional signals: model drift indicator, reasoning stability score, and human review status.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
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

The most novel domain in the platform — where Data 3.0 departs most significantly from prior data mesh frameworks. Defines AI agent identity, access control, the federated semantic query layer, agent-as-producer governance, and agent discovery capabilities.

> **Central design challenge:** agents are simultaneously the most powerful consumers the platform will ever have and the least trustworthy ones by default. The agent integration layer must make agents capable without making them ungovernable.

### Functional Requirements

#### Agent Identity

**F6.1 — Agent Identity as First-Class Principal**
The platform shall treat AI agent identities as a distinct principal type carrying: model identifier, model version, agent framework, delegated authority scope, and a trust classification. These attributes are immutable once registered.

**F6.2 — Agent Identity Registration**
Registration shall capture: agent name and description, owning domain, model provider and identifier, model version or version constraint, agent framework, intended consumption patterns (read-only, read-write, production-capable), maximum access scope declaration, and a named human oversight contact. Registration shall require governance layer acknowledgment for production-capable agents.

**F6.3 — Agent Trust Classification**
The governance layer shall define an agent trust classification taxonomy. Platform default:
- **Observed** — every action logged, surfaced for human review before downstream effects are committed
- **Supervised** — permitted within pre-approved scope, sampled for review, auto-escalation on anomaly
- **Autonomous** — permitted within pre-approved scope with post-hoc audit only

Trust classification upgrades require formal governance review.

**F6.4 — Agent Identity Lifecycle**
Lifecycle states: Registered, Active, Suspended, Retired. Agent identities shall not be deleted — retired identities preserve all audit and lineage history permanently.

**F6.5 — Model Version Binding**
An agent identity shall be bound to a specific model version or version constraint. Model version changes require re-registration or explicit acknowledgment. Prior version lineage records remain attributed to the prior identity.

**F6.6 — Human Oversight Requirement**
Every agent identity shall have a named human oversight contact who receives all escalation notifications. An agent whose oversight contact is no longer an active platform principal shall be automatically suspended.

#### Agent Access Control

**F6.7 — Agent Access Grants**
Agent access grants shall specify: a maximum query rate limit, an expiration date (no indefinite grants), governance layer approval for Autonomous trust class agents, and explicit acknowledgment of AI provenance requirements for production-capable agents.

**F6.8 — Agent Access Scope Enforcement**
An agent registered as read-only shall be architecturally prevented from writing to or producing data products — enforced at infrastructure level, not application policy check.

**F6.9 — Agent Access Policy**
The governance layer shall configure agent access policy defining which trust classifications may access which data classifications and under what conditions.

**F6.10 — Dynamic Access Evaluation**
Agent access shall be evaluated dynamically at query time — verifying current valid access grants, access scope compliance, governance policy allowance, and trust classification authorization before every query execution.

**F6.11 — Agent Access Anomaly Detection**
The platform shall detect anomalous agent behavior and trigger automatic escalation to the human oversight contact. Above configurable thresholds, automatic suspension pending review shall be triggered.

#### Federated Query Layer

**F6.12 — Semantic Query Interface**
The platform shall provide a federated semantic query interface presenting the authorized portion of the data mesh as a single logical data surface, abstracting away the distributed mesh topology.

**F6.13 — Query Protocol**
Four surfaces:
- Natural language query (platform translates to structured queries)
- Structured semantic query (platform-defined format for precision)
- GraphQL interface (schema-first exploration and query)
- MCP endpoint (compliant MCP server for any MCP-compatible agent framework)

**F6.14 — MCP Server Compliance**
The platform's MCP endpoint shall be a fully compliant MCP server exposing:
- **Resources** — every authorized output port as an MCP resource with schema, metadata, and trust score
- **Tools** — data product search, lineage traversal, observability query, access grant request, semantic query execution
- **Prompts** — platform-provided templates for common agent data interaction patterns

MCP compliance shall be maintained against the current stable specification within 60 days of new versions.

**F6.15 — Query Planning**
For natural language and structured semantic queries, the platform shall: identify relevant authorized products, evaluate trust scores and compliance states, construct an execution plan, evaluate access scope and policy compliance, and return the plan for inspection before execution if the agent prefers.

**F6.16 — Policy-Aware Query Execution**
Query execution shall enforce governance policy in real time across every product touched. A governance policy violation in any component of a federated query shall halt the entire query execution.

**F6.17 — Query Result Provenance**
Every query result shall carry a provenance envelope containing: contributing product versions, trust scores at time of query, governance policy versions in effect, lineage completeness scores, non-determinism markers, and query execution timestamp. Automatically recorded in the lineage graph.

**F6.18 — Cross-Product Join Semantics**
Cross-product joins shall: respect all access grants, propagate the highest classification of any joined product to the result, record a lineage event for all contributing products, and enforce that joined data is not cached or persisted without explicit agent-initiated data product publication.

**F6.19 — Query Rate Limiting**
Per-agent rate limits shall be enforced at the query layer infrastructure level with structured warning responses before hard limiting.

**F6.20 — Query Result Caching**
The federated query layer shall support result caching within a configurable TTL. Cache invalidation shall occur automatically when any contributing product publishes a new version, updates its schema, or changes compliance state.

#### Agent as Data Product Producer

**F6.21 — Production-Capable Agent Registration**
Production-capable agents require governance layer acknowledgment, mandatory AI provenance metadata, human review status tracking, and mandatory Observed or Supervised trust classification for the first 90 days of operation.

**F6.22 — Agent-Produced Data Product Publication**
A production-capable agent shall publish through the same governance compliance pipeline as human-published products, with additional requirements: complete AI provenance metadata, domain team notification, domain team acknowledgment for Observed trust class agents, and a permanent indicator that the product was AI-produced.

**F6.23 — Agent-Produced Product Ownership**
An AI agent shall not be the registered owner of a data product. The owning domain team is always the human owner of record.

**F6.24 — Human Review Workflow**
For Observed trust class agents, a human review workflow shall surface: agent reasoning trace reference, provenance envelope of consumed inputs, proposed product definition, and diff against any prior version.

**F6.25 — Agent Production Audit**
Every production-capable agent publication or modification shall produce a complete, immutable, permanently retained audit record.

#### Agent Discovery and Mesh Navigation

**F6.26 — Semantic Data Product Discovery**
Agents shall discover data products through semantic search — querying by describing needed data in natural language or structured semantic terms. Results ranked by trust score, relevance, and compliance state.

**F6.27 — Schema Exploration**
Agents shall programmatically explore the schema of any authorized output port without executing a data query.

**F6.28 — Semantic Annotation**
Domain teams shall add semantic annotations to product schemas. Governance policy shall mandate minimum annotation coverage for products available to agent consumption.

**F6.29 — Lineage-Aware Recommendation**
The federated query layer shall provide agents with lineage-aware product recommendations surfacing trust scores, compliance states, and semantic similarity scores.

**F6.30 — Version-Aware Consumption**
The platform shall provide a structured version compatibility assessment API that agents query to determine whether their current consumption pattern is compatible with a new product version.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF6.1 | Single-product semantic queries under 2s p95; 10-product federated queries under 10s p95 |
| NF6.2 | MCP endpoint 99.99% availability independent of control plane |
| NF6.3 | 10,000 concurrent agent query sessions per organization |
| NF6.4 | Policy evaluation overhead under 200ms p99 |
| NF6.5 | Semantic index reflects new products within 5 minutes |
| NF6.6 | Agent identity isolation enforced at infrastructure level |
| NF6.7 | Anomaly detection escalation within 60 seconds |
| NF6.8 | MCP spec compliance within 60 days of new stable version |

### Out of Scope

- **OS6.1** — Agent development, hosting, or orchestration
- **OS6.2** — Agent reasoning quality evaluation or output validation
- **OS6.3** — Native multi-agent orchestration patterns
- **OS6.4** — [POST-MVP] Natural language query precision improvement
- **OS6.5** — Reasoning trace content storage (references only)
- **OS6.6** — [POST-MVP] Agent financial metering and chargeback

---

## Domain 7: Self-Service Experience

The platform made visible. Every architectural decision, governance rule, lineage record, and agent interaction surfaces through this layer.

> **Organizing principle:** the right thing is the easy thing for every persona. The UI will be judged by whether a domain team can publish their first product without reading a manual, whether a governance team member can configure meaningful policy without engineering knowledge, and whether a consumer can find and trust a data product in under five minutes.

### Functional Requirements

#### Platform Shell and Navigation

**F7.1 — Unified Platform Shell**
Single unified web application. The shell adapts navigation and available actions based on the authenticated principal's role. Governance team members and domain team members share the same URL but see meaningfully different primary navigation.

**F7.2 — Persona-Adaptive Navigation**
Primary navigation dynamically composed based on principal roles. Governance-specific items do not appear as disabled or locked for domain team members — they simply do not appear.

**F7.3 — Organization and Domain Context Switching**
A persistent context switcher makes the current active domain or organization always visible and always changeable without a full page reload.

**F7.4 — Global Search**
Keyboard-shortcut accessible global search indexing product names, descriptions, tags, domain names, owner names, and semantic annotations. Results respect the principal's access grants.

**F7.5 — Notifications and Activity Feed**
Role-appropriate, actionable notifications deep-linking to relevant platform context for all personas.

**F7.6 — Keyboard and Accessibility**
WCAG 2.1 AA compliance. All primary workflows completable via keyboard alone. Accessibility compliance shall be a release gate.

#### Data Product Publishing and Management

**F7.7 — Data Product Authoring Interface**
Structured, guided authoring interface presenting the effective policy requirements as a visible checklist throughout. Continuous in-authoring validation surfaces issues as the author works.

**F7.8 — Port Configuration UI**
Port-type-specific configuration UI with real-time port validation.

**F7.9 — Schema Editor**
Integrated schema editor supporting: manual field definition, import from connector-inferred schema, import from upstream product output port schema, visual version diff, and semantic annotation authoring.

**F7.10 — SLO Configuration UI**
Guided SLO configuration translating business-language questions into platform-enforceable declarations. Surfaces the dependency SLO chain during configuration.

**F7.11 — Connector Management UI**
Pre-built connector library with search and category filtering, connector-type-specific configuration forms, inline validation, connector health with historical trend, and guided custom connector registration flow.

**F7.12 — Product Lifecycle Management UI**
All domain products with current lifecycle state, compliance state, trust score, and active consumer count. Lifecycle actions presented as consequence-surfacing workflows.

**F7.13 — Versioning UI**
Complete version history, currently active versions, consumers per version, and deprecation schedules. MAJOR version publication workflow enforces the semantic change declaration through a structured form. Impact analysis is a mandatory step.

**F7.14 — Domain Team Dashboard**
Operational home: all domain products with current status, domain compliance score, active consumer count, connector health summary, SLO compliance summary, and recent activity.

#### Data Product Discovery and Consumption

**F7.15 — Data Product Marketplace**
Primary discovery interface presenting all discoverable products with rich filtering by domain, classification, data type, tag, trust score range, compliance state, and SLO characteristics.

**F7.16 — Data Product Detail Page**
Dedicated page per product presenting: identity and lifecycle state, trust score with breakdown, compliance state, available output ports, schema browser with semantic annotations, observability summary, lineage preview, version history with semantic change summaries, and access request affordance.

**F7.17 — Trust Score Transparency**
Trust score accompanied by transparent breakdown with plain-language explanation of drivers and what would change it.

**F7.18 — Access Request Workflow**
Direct access request from the product detail page — output port selection, governance acknowledgments, approval routing, real-time status tracking, and on-approval: connection details and getting-started guidance.

**F7.19 — Consumer Workspace**
Personal persistent workspace: active access grants with expiration dates, consumed products with current trust scores, deprecation notices, and recommendations.

**F7.20 — Deprecation Impact Management**
Structured deprecation impact experience: deprecation timeline, reason, available replacement products with direct comparison, and a migration planning checklist.

#### Governance Experience

**F7.21 — Governance Command Center**
Unified governance state at a glance. Every metric drillable. Every actionable item executable without leaving the command center.

**F7.22 — Policy Authoring Studio**
Three-panel dedicated experience: navigable policy domain list (left), active policy domain rule builder (main), and persistent impact preview panel (right).

**F7.23 — Rule Builder UX**
Structured plain-language rule composition using dropdown menus. Logical operators as visual connectors. Completed rule displayed as a plain-language sentence confirming intent.

**F7.24 — Impact Preview Panel**
Real-time update as rules are built. Generated from live platform data. Completes within 3 seconds of rule change.

**F7.25 — Classification Taxonomy Manager**
Editable taxonomy hierarchy with impact preview before any change is committed.

**F7.26 — Compliance Drill-Down**
Three-click path from command center summary to individual violation detail.

**F7.27 — Exception Management UI**
Grant, review, and revoke compliance exceptions with expiration countdown and auto-close.

**F7.28 — Domain Compliance Reports UI**
Generate and export domain compliance reports in PDF and CSV. Reports retained for 90 days.

#### Lineage and Observability Experience

**F7.29 — Lineage Graph Visualization**
Interactive, zoomable, navigable lineage graph: node type visual encoding, trust score and compliance state as visual indicators, depth control, focus mode, non-determinism marker highlighting, smooth performance at up to 500 visible nodes, and export.

**F7.30 — Lineage Time Travel UI**
Date picker-based time travel mode visually distinct from current state view. Smooth transition without page reload.

**F7.31 — Impact Analysis Visualization**
For breaking change workflows: all downstream products and consumers highlighted in the lineage graph, with navigation to each affected product's detail page. Required acknowledgment step.

**F7.32 — Observability Dashboard**
Per-product real-time observability dashboard: all eight metric categories with current values vs SLO targets, trend sparklines, SLO violation timeline, source labeling, observability drift alerts, and agent-specific signals section for agent-produced products.

**F7.33 — Trust Score Detail View**
Expandable full trust score detail: current score, historical trend, component contribution breakdown, plain-language explanation, and actionable improvement recommendations for domain teams.

#### Agent Management Experience

**F7.34 — Agent Registry UI**
Register and manage agent identities within domain context with guided registration flow and contextual help for agent-specific concepts.

**F7.35 — Agent Activity Monitor**
Real-time and historical view per agent identity: query volume, data products accessed, cross-product join patterns, rate limit proximity, and anomaly escalation events.

**F7.36 — Human Review Queue**
For Observed trust class agents: structured review queue with approve, reject with feedback, and request revision actions. Aging items surfaced as escalation alerts.

**F7.37 — Agent Trust Classification UI**
Governance teams view and manage agent trust classifications across the organization. Trust classification upgrade requests surfaced for governance review.

#### Platform Administration

**F7.38 — Organization Administration**
Manage organization tenant configuration, identity provider federation setup, platform-level role assignments, and audit log access. Strictly separated from org data.

**F7.39 — Onboarding Experience**
Guided multi-step onboarding: organization configuration, identity provider setup, governance layer initialization, policy template selection, and first domain creation. Completable in a single session. Progress saved for pause and resume.

**F7.40 — Usage and Health Monitoring**
Control plane availability and latency, lineage emission throughput, federated query layer performance, connector health distribution, and usage metrics. Does not expose organization data.

#### Cross-Cutting UX Requirements

**F7.41 — Progressive Disclosure**
Minimum necessary information presented at first; detail on demand.

**F7.42 — Empty States**
Every list, dashboard, and data surface shall have a contextually appropriate empty state message and call to action.

**F7.43 — Inline Contextual Help**
Every field and configuration option shall have inline contextual help accessible without leaving current context, written in persona-appropriate plain language.

**F7.44 — Confirmation and Consequence Surfacing**
Every destructive or consequential action shall require explicit confirmation through a consequence-surfacing dialog requiring active user input.

**F7.45 — Responsive Design**
Fully functional on desktop (1280px+). Tablet support (768px+) for read-only and monitoring experiences.

**F7.46 — Theme Support**
Light and dark themes persisted per principal. System theme preference respected as default.

### Non-Functional Requirements

| ID | Requirement |
|---|---|
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

---

## Appendix A: Persona-to-Capability Mapping

| Capability Area | Domain Teams | Consumers | Governance Teams | AI Agents | Platform Admins |
|---|---|---|---|---|---|
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
|---|---|---|
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

---

## Appendix C: Key Design Decisions

| Decision | Position | Rationale |
|---|---|---|
| AI Agents as First-Class Persona | Agents are the highest-priority persona in Data 3.0 | Agents operate at machine speed, require programmatic interfaces, and create new governance challenges that must be designed for from the start |
| Dual Consumption Model | Humans connect to output ports directly. Agents use a governed federated semantic query layer | Neither model serves both personas well. Each model is optimized for its persona |
| Declarative UI for Governance Policy | Governance policy is authored through a declarative UI, not code | Humans want to do less, not more. A declarative UI lowers the barrier without sacrificing computational enforcement |
| AI Provenance as Default-On | AI provenance metadata is enabled by default. It can be configured but not silently disabled | In an agentic world, provenance is a trust primitive. Making it default-on makes the safe path the easy path |
| Semantic Change Declaration | MAJOR version increments require a structured declaration of meaning changes, not just schema changes | Agents consume data based on semantic understanding. A schema change that preserves structure but changes meaning is invisible without a semantic change declaration |
| Agent Identity Never Deleted | Agent identities are retired, not deleted. All history permanently retained | An agent that produced data products must remain attributable in perpetuity |
| MCP as First-Class Protocol | The platform exposes a fully compliant MCP server endpoint as a primary agent interface | MCP is the standard protocol for agent-to-tool interaction. First-class support enables any MCP-compatible framework to interact natively |
