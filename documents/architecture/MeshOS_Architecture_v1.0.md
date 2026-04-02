# MeshOS Technical Architecture Document

**Version 1.0 — Companion to PRD v1.0**
**MVP and Production-Grade Specifications**
**Confidential — Not for Distribution**

---

## Section 1: Architecture Philosophy

MeshOS is being built with Claude Code as the primary engineering capability. This is not a constraint — it is a genuine advantage when the architecture is designed to leverage it. Claude Code excels at integrating well-documented open source systems, implementing against clear interface specifications, and reasoning about standard protocols.

Every architectural decision in this document therefore optimizes for three properties simultaneously:

- **Legibility** — the architecture should be explainable in a single diagram and implementable from clear specifications
- **Composability** — components should be independently deployable, independently testable, and replaceable without cascading rewrites
- **Upgrade path clarity** — the MVP architecture should be a strict subset of the production architecture, not a throwaway prototype

> **The single most important architectural principle:** the MVP must be buildable on a startup budget while being architecturally indistinguishable from the production system in its service boundaries and data contracts. What changes from MVP to production is scale, redundancy, and managed service substitution — not structure.

### Five Non-Negotiable Architectural Constraints

| Constraint | Implication |
|---|---|
| The lineage graph must be a native graph database | Relational and document stores cannot efficiently serve arbitrary-depth traversal, impact analysis, and time travel queries at the required performance targets |
| The policy engine must be a hot-reloadable independent runtime | Policy changes cannot require platform redeployment — the policy engine is a live process that reloads rules without downtime |
| Control plane and data plane must be architecturally separated from day one | The platform stores metadata and contracts; data stays in domain infrastructure. This boundary cannot be blurred for MVP speed |
| The agent query layer is a distinct service | Latency, concurrency, and policy evaluation requirements for agent queries are incompatible with sharing a process with the control plane |
| MCP compliance is a native protocol implementation, not an API wrapper | MCP streaming and capability negotiation patterns do not map cleanly to REST wrapper patterns |

---

## Section 2: Open Source Foundation

The build philosophy is: **open source foundations, custom where differentiated.**

Your differentiation is the governance engine, the agent integration layer, the trust score model, the port abstraction, and the UX. Everything else should be assembled from well-maintained open source projects with large training corpora.

### Selection Criteria

- Documentation quality — Claude Code reads documentation to generate correct integrations
- Community health — active maintenance, real production deployments
- Managed service equivalent — a clear path from self-hosted MVP to managed cloud service in production
- License compatibility — Apache 2.0 or MIT preferred
- Claude Code familiarity — projects with large open source codebases

### Component Selection

| Component | MVP Choice | Production Upgrade | License | Rationale |
|---|---|---|---|---|
| Graph Database | Neo4j Community (self-hosted) | Neo4j AuraDB or Amazon Neptune | GPL2 / Enterprise | Best-documented graph DB. OpenCypher query language. Excellent Claude Code familiarity. Zero migration cost to AuraDB. |
| Relational Database | PostgreSQL 16 (self-hosted) | Amazon RDS PostgreSQL or Aurora | PostgreSQL (permissive) | The gold standard. Handles all control plane state. Claude Code knows Postgres deeply. |
| Message Broker | Redpanda (via Kafka-compatible API) | Amazon MSK or Confluent Cloud | Apache 2.0 | Redpanda is Kafka-compatible but Rust-based — dramatically lower operational overhead for MVP. Same API, same client libraries. |
| Policy Engine | Open Policy Agent (OPA) | OPA remains — scale via Styra DAS | Apache 2.0 | Industry standard. Hot-reloadable policies via bundle API. Large Claude Code training corpus. |
| Search / Semantic Index | OpenSearch | Amazon OpenSearch Service | Apache 2.0 | AWS-maintained fork. Powers marketplace search and semantic product discovery via k-NN plugin. |
| Vector Embeddings | sentence-transformers (self-hosted) | Amazon Bedrock Embeddings or OpenAI | Apache 2.0 | For semantic data product discovery by agents. Self-hosted on MVP; managed API in production. |
| Identity / Auth | Keycloak (self-hosted) | Keycloak remains or Auth0/Okta | Apache 2.0 | Full OIDC and SAML 2.0. Large deployment base. |
| API Gateway | Kong (OSS) | Kong Gateway or AWS API Gateway | Apache 2.0 | Rate limiting, auth, routing. Well-documented plugin ecosystem. |
| Lineage Event Schema | OpenLineage (specification + client libs) | OpenLineage remains | Apache 2.0 | Industry standard. |
| Container Orchestration | Docker Compose (MVP) → k3s | Amazon EKS or GKE | Apache 2.0 | Docker Compose for single-node MVP. k3s for lightweight Kubernetes when scale demands it. |
| Object Storage | MinIO (self-hosted) | Amazon S3 | AGPL3 / Apache 2.0 | S3-compatible API. Zero migration to S3 in production. |
| Observability Stack | Grafana + Prometheus + Loki | Grafana Cloud or Datadog | Apache 2.0 | Platform operational monitoring. |
| Frontend Framework | React + TypeScript + Vite | Same | MIT | Industry standard. Claude Code is exceptionally strong here. |
| API Layer | NestJS (TypeScript) | Same, scaled horizontally | MIT | Claude Code strength. Strong typing. Decorator-based architecture maps well to domain model. |
| MCP Server | TypeScript MCP SDK (official) | Same | MIT | The official Anthropic MCP TypeScript SDK is the reference implementation. |
| Workflow Orchestration | Temporal (self-hosted) | Temporal Cloud | MIT | For long-running governance workflows — deprecation notice periods, grace period timers, exception expiry. |

> **On AGPL and SaaS:** MinIO uses AGPL3. For a SaaS platform that does not distribute MinIO itself, AGPL obligations are generally not triggered — but consult legal counsel. The production upgrade to Amazon S3 eliminates this concern entirely.

### Language Stack

**Recommendation: TypeScript as the primary language across the full stack, with Python for ML/embedding workloads only.**

| Service | Language | Rationale |
|---|---|---|
| Control Plane API | TypeScript / NestJS | Strong typing, decorator-based architecture maps well to domain model |
| Agent Query Layer | TypeScript / NestJS | MCP SDK is TypeScript-native |
| Governance Engine | TypeScript / NestJS | OPA policy evaluation via REST API — language-agnostic orchestration |
| Lineage Emission API | TypeScript / NestJS | High-throughput event ingestion |
| Frontend | TypeScript / React | Claude Code strongest in React/TypeScript. Shared types with backend via monorepo. |
| Embedding Service | Python / FastAPI | sentence-transformers is Python-native. Isolated service with clean REST interface. |
| Lineage Emission SDK | Python + TypeScript + Java | Multi-language SDKs built against the same OpenAPI spec |

---

## Section 3: MVP Architecture

A production-structured, startup-budgeted architecture that runs on approximately $300-800/month and scales to the first 10-20 design partner organizations.

> **MVP Budget Target:** $300-800/month all-in cloud infrastructure. Achievable by running all services on a single mid-sized cloud instance for the first phase, then splitting to two instances as load demands. The architecture is identical to production — only the deployment topology differs.

### MVP Hosting Strategy

The most cost-effective MVP hosting path is a lean AWS setup using AWS Activate startup credits. Apply at aws.amazon.com/activate immediately — up to $10,000 in credits available for pre-funded startups.

### MVP Infrastructure Blueprint

| Resource | Specification | Monthly Cost (est.) | Purpose |
|---|---|---|---|
| EC2 t3.xlarge (x1) | 4 vCPU, 16GB RAM | ~$120 | Runs: NestJS monolith, Neo4j Community, PostgreSQL, Redpanda, OPA, OpenSearch, Keycloak, MinIO, Temporal |
| EC2 t3.medium (x1) | 2 vCPU, 8GB RAM | ~$35 | Runs: React frontend (Nginx), Kong API Gateway, Grafana + Prometheus, Embedding service |
| Elastic IP | Static IP for API Gateway | ~$4 | Stable ingress endpoint |
| Route 53 | DNS + SSL (via ACM) | ~$5 | Domain routing and HTTPS |
| S3 bucket | Policy artifacts, exports, audit logs | ~$5 | Overflow from MinIO when data grows |
| CloudWatch Logs | Log aggregation | ~$10 | Operational visibility |
| Data transfer | Outbound traffic | ~$20 | Consumer-facing API responses |
| **AWS Activate credits** | **Startup program** | **Up to -$100K** | **Can fund entire MVP infrastructure** |

Total estimated cost without credits: $200-350/month.

### MVP Service Architecture

For MVP, all NestJS backend services are deployed as modules within a single NestJS monolith — sharing a process but maintaining strict module boundaries. This is the **modular monolith** pattern.

The module boundaries defined in the MVP monolith become the service boundaries when you split to microservices in production. Claude Code is well-suited to this refactor because the interfaces are already clean.

### MVP Service Map

| Module / Service | Type | MVP Deployment | Responsibility |
|---|---|---|---|
| Organization API | NestJS Module | Monolith | Tenant management, domain CRUD, principal management, role assignment |
| Data Product API | NestJS Module | Monolith | Product definition validation, lifecycle state management, port registration, versioning |
| Connector API | NestJS Module | Monolith | Connector registration, credential reference management, schema inference, health monitoring |
| Governance Engine | NestJS Module + OPA | Monolith + sidecar OPA | Policy authoring, effective policy computation, publication-time enforcement, continuous monitoring |
| Lineage API | NestJS Module | Monolith | Lineage event ingestion, graph writes, declared lineage registration |
| Observability API | NestJS Module | Monolith | Observability metric ingestion, SLO evaluation, trust score computation |
| Access Control API | NestJS Module | Monolith | Access grant management, approval workflows, consumer-product relationships |
| Agent Query Layer | Separate NestJS service | Separate process on same EC2 | Semantic query federation, MCP server, agent identity verification, dynamic policy evaluation |
| Embedding Service | FastAPI (Python) | Separate process on t3.medium | Vector embedding generation for semantic index |
| Frontend | React + Vite + Nginx | t3.medium | All four persona UI surfaces served as static SPA |
| Neo4j Community | Database | Same EC2 as monolith | Lineage graph storage and querying |
| PostgreSQL 16 | Database | Same EC2 as monolith | Control plane state |
| Redpanda | Message broker | Same EC2 as monolith | Lineage event ingestion buffer, async governance event propagation |
| OpenSearch | Search | Same EC2 as monolith | Product discovery index, semantic vector search |
| OPA | Policy runtime | Sidecar on same EC2 | Policy bundle evaluation, hot reload on policy publish |
| Keycloak | Identity | Same EC2 as monolith | OIDC/SAML federation, token issuance |
| MinIO | Object storage | Same EC2 as monolith | Policy artifacts, schema exports, audit exports |
| Temporal | Workflow engine | Same EC2 as monolith | Grace period timers, deprecation workflows, exception expiry |
| Kong OSS | API Gateway | t3.medium | Rate limiting, auth token verification, routing |

### MVP Data Architecture

#### PostgreSQL — Control Plane State

| Schema | Tables | Notes |
|---|---|---|
| organizations | orgs, domains, domain_extensions, governance_configs | Top-level tenant isolation via org_id on all tables |
| identity | principals, roles, role_assignments, agent_identities, agent_trust_classifications | Keycloak is auth source; PostgreSQL stores platform-specific identity metadata |
| products | data_products, product_versions, port_declarations, port_contracts, lifecycle_events | Core product registry. Versions stored as immutable records. |
| connectors | connectors, connector_health_events, source_registrations, schema_snapshots | Credentials referenced by external secrets ARN only |
| governance | policy_schemas, policy_versions, effective_policies, compliance_states, exceptions, grace_periods | Policy artifacts stored as JSONB |
| access | access_grants, access_requests, approval_events | Consumer-product access relationships with expiration tracking |
| observability | slo_declarations, slo_evaluations, trust_score_history, observability_snapshots | Partitioned by org_id and time |
| audit | audit_log | Append-only. Never updated or deleted. Partitioned by month. |

#### Neo4j — Lineage Graph

| Node Label | Key Properties | Notes |
|---|---|---|
| SourceNode | org_id, connector_id, source_ref, created_at | One per registered external source |
| DataProductNode | org_id, product_id, version, domain_id, trust_score, compliance_state | Updated on every product state change |
| PortNode | org_id, product_id, port_type, port_id, contract_hash | One per declared port |
| TransformationNode | org_id, transformation_id, pipeline_ref, principal_id | Emitted by pipelines via lineage emission API |
| AgentNode | org_id, agent_id, model_id, model_version, reasoning_trace_ref, non_deterministic: true | Distinct from TransformationNode. Carries model provenance. |
| ConsumerNode | org_id, principal_id, principal_type, access_grant_id | One per access grant |

Key Cypher queries:

```cypher
// Upstream traversal to arbitrary depth
MATCH path = (p:DataProductNode {product_id: $id})<-[:DERIVES_FROM*]-(upstream)
RETURN path

// Impact analysis — all downstream products
MATCH path = (p:DataProductNode {product_id: $id})-[:DERIVES_FROM*]->(downstream)
RETURN downstream.product_id, downstream.domain_id, length(path) as depth

// Agent provenance chain
MATCH (p:DataProductNode)-[:TRANSFORMS]-(a:AgentNode)
WHERE p.product_id = $id AND a.non_deterministic = true
RETURN a.agent_id, a.model_id, a.model_version, a.reasoning_trace_ref
```

#### Redpanda — Event Topics

| Topic | Producers | Consumers | Retention |
|---|---|---|---|
| lineage.emission | Domain pipelines via Lineage API | Lineage API (graph writer), Audit log | 7 days |
| observability.emission | Domain pipelines via Observability API | Observability API (metric writer), SLO evaluator | 24 hours |
| governance.events | Governance Engine | Notification service, Compliance monitor, Temporal workflows | 30 days |
| product.lifecycle | Data Product API | Notification service, Access Control API, Semantic indexer | 30 days |
| agent.activity | Agent Query Layer | Anomaly detector, Audit log, Human oversight notifier | 7 days |
| connector.health | Connector health monitor | Observability API, Notification service | 24 hours |

### MVP API Architecture

#### API Design Principles

- OpenAPI 3.1 spec-first — define the spec, generate client SDKs, validate implementation against spec
- REST for synchronous control plane operations
- WebSocket for real-time UI updates
- GraphQL for agent schema exploration (F6.27)
- MCP protocol for agent primary interface (F6.14)
- Server-Sent Events for lineage emission SDK

#### API Gateway Routing (Kong)

| Route Prefix | Target | Auth Method | Rate Limit |
|---|---|---|---|
| /api/v1/ | NestJS Monolith (control plane) | JWT (Keycloak) | 1000 req/min per principal |
| /agent/v1/ | Agent Query Layer (NestJS) | Agent JWT + scope validation | Configurable per agent grant |
| /mcp/v1/ | MCP Server (Agent Query Layer) | MCP auth (Bearer token) | Per agent grant |
| /lineage/emit | Lineage Emission API (NestJS) | Service account JWT | 10,000 events/sec per org |
| /observability/emit | Observability API (NestJS) | Service account JWT | 5,000 events/sec per org |
| /auth/ | Keycloak | Public (auth endpoints) | Anti-brute-force: 10 req/min |

### MVP Governance Engine Architecture

#### Policy Lifecycle

| Step | System | Description |
|---|---|---|
| 1. Author | React UI (Policy Authoring Studio) | Governance team builds rules via point-and-click UI. Rules stored as structured JSON. |
| 2. Preview | Governance Engine API | Impact preview API evaluates proposed rules against current product catalog. |
| 3. Publish | Governance Engine API | Validated policy JSON written to PostgreSQL as immutable record. Grace period timer started in Temporal if breaking change. |
| 4. Compile | Governance Engine (background) | Policy JSON compiled to OPA Rego bundle. Bundle pushed to OPA via bundle API. Hot reload — no restart required. |
| 5. Enforce (publication time) | Data Product API → OPA | On product publish, calls OPA /v1/data/meshos/policy/allow. OPA evaluates in under 10ms. |
| 6. Enforce (continuous) | Compliance Monitor (scheduled) | Temporal workflow evaluates all published products against current OPA policy every 24 hours and on trigger events. |

### MVP Agent Query Layer Architecture

| Component | Implementation | Notes |
|---|---|---|
| MCP Server | TypeScript MCP SDK (@modelcontextprotocol/sdk) | Exposes Resources (data products), Tools (search, query, lineage), and Prompts. WebSocket transport. |
| GraphQL API | Apollo Server (TypeScript) | Schema-first. Exposes data product schema exploration. |
| Natural Language Query | Claude API (claude-sonnet-4-20250514) | NL query translated to structured semantic query. |
| Structured Semantic Query Engine | Custom NestJS service | Decomposes structured query into OpenSearch product discovery, Neo4j lineage context retrieval, output port sub-queries. |
| Dynamic Policy Evaluator | OPA client (HTTP) | Before every query execution, evaluates agent access scope and governance policy. Under 200ms overhead target. |
| Provenance Envelope Builder | Custom NestJS service | Assembles provenance envelope (F6.17) from query execution context. Writes consumer lineage event to Redpanda. |
| Agent Anomaly Detector | Custom NestJS service | Sliding window query pattern analysis per agent identity. |

### MVP Security Architecture

| Concern | Approach | Notes |
|---|---|---|
| Tenant isolation | org_id column on all PostgreSQL tables + row-level security policies | Every query requires org_id context. RLS enforced at database level. |
| Authentication | Keycloak OIDC + JWT | All API calls carry JWT. Kong validates JWT signature before routing. |
| Agent identity | Separate JWT claim: principal_type=agent + agent_id | Agent tokens carry additional claims validated on every request. |
| Credential storage | AWS Secrets Manager ARN references only | Never logged, never cached longer than connection lifetime. |
| Audit log | PostgreSQL append-only table + row-level security | No UPDATE or DELETE permissions at database level. Exported to S3 nightly. |
| Data in transit | TLS 1.3 enforced at Kong | All external traffic TLS-terminated at Kong. |
| Data at rest | EC2 EBS encryption enabled | All EBS volumes encrypted at rest using AWS-managed keys. |

---

## Section 4: Production-Grade Architecture

The target architecture for general availability — multi-region capable, managed services where appropriate, enterprise security posture, and designed for the PRD scale targets.

> **The production architecture is the MVP architecture with three changes:** (1) the monolith splits into independent microservices, (2) self-hosted databases and brokers are replaced with managed cloud services, and (3) deployment moves to Kubernetes with full observability. Every interface contract defined in the MVP remains unchanged.

### Production Hosting Architecture

Production runs on AWS with EKS as the orchestration layer.

### Production Infrastructure Overview

| Layer | Service | Scale Configuration | Monthly Cost Range (est.) |
|---|---|---|---|
| Compute | EKS with auto-scaling node groups | Base: 3x m6i.xlarge nodes. Scales to 20+ nodes under load. | $600-2,500 |
| Graph Database | Amazon Neptune (or Neo4j AuraDB) | Neptune Serverless — scales to demand | $200-800 |
| Relational Database | Amazon Aurora PostgreSQL Serverless v2 | Auto-scales 0.5-64 ACUs. Multi-AZ by default. | $200-600 |
| Message Broker | Amazon MSK (Managed Kafka) | kafka.m5.large x3 (3-broker cluster) | $400-800 |
| Search | Amazon OpenSearch Service | 3-node cluster, r6g.large | $300-600 |
| Object Storage | Amazon S3 | Standard storage class. Lifecycle policies to Glacier for old audit logs. | $50-200 |
| Identity | Keycloak on EKS (retained) or Auth0/Okta | Keycloak in HA mode (2 replicas) | $0-500 |
| Policy Engine | OPA on EKS | 2 replicas minimum. Stateless — horizontally scalable. | Included in EKS compute |
| API Gateway | Kong Gateway (EKS) or AWS API Gateway | Kong in HA mode | $100-500 |
| CDN | Amazon CloudFront | Global edge for React SPA and static assets | $50-200 |
| Secrets | AWS Secrets Manager | Per-secret pricing | $50-150 |
| Workflow Engine | Temporal Cloud | Managed Temporal | $200-500 |
| Monitoring | Datadog or Grafana Cloud | Full observability stack | $200-800 |

Total production cost range: $2,400-$8,000/month before customer workload. At meaningful customer scale (20+ organizations), plan for $8,000-$25,000/month.

### Microservices Decomposition

| Microservice | Replicas (base) | Owns | Communicates With |
|---|---|---|---|
| Organization Service | 2 | organizations schema | Identity Service, Product Service |
| Identity Service | 2 | identity schema + Keycloak sync | All services (auth context) |
| Data Product Service | 3 | products schema | Governance Engine, Lineage Service, Access Service, Search Indexer |
| Connector Service | 2 | connectors schema | Lineage Service, Observability Service |
| Governance Engine | 2 + OPA sidecar | governance schema + OPA bundles | Data Product Service, Compliance Monitor, Notification Service |
| Lineage Service | 3 | Neo4j (graph writes) | Data Product Service, Observability Service |
| Observability Service | 2 | observability schema | Lineage Service, Trust Score Engine |
| Trust Score Engine | 2 | trust_score_history | Observability Service, Lineage Service, Governance Engine |
| Access Control Service | 2 | access schema | Data Product Service, Agent Query Layer, Notification Service |
| Notification Service | 2 | (stateless — reads from Kafka) | All services (consumes events), Temporal workflows |
| Agent Query Layer | 3-10 (auto-scale) | (stateless query execution) | All services (reads), OPA, Neo4j, OpenSearch |
| MCP Server | 2-5 (auto-scale) | (stateless MCP protocol layer) | Agent Query Layer |
| Embedding Service | 2 | OpenSearch vector index | Data Product Service (triggers reindex on publish) |
| Compliance Monitor | 2 | (scheduled evaluation) | Governance Engine, Data Product Service, Temporal |
| Search Indexer | 2 | OpenSearch product index | Data Product Service (consumes events) |
| Lineage Emission API | 3-10 (auto-scale) | (stateless ingestion) | MSK (Kafka producer), OPA (auth) |
| Observability Emission API | 2-5 (auto-scale) | (stateless ingestion) | MSK (Kafka producer), OPA (auth) |

### Production Security Posture

| Concern | Production Approach | Delta from MVP |
|---|---|---|
| Network isolation | VPC with private subnets for all databases and internal services. Only API Gateway and CloudFront in public subnets. | MVP runs everything on same EC2. Production adds full network isolation. |
| mTLS | All inter-service communication uses mTLS via service mesh (AWS App Mesh or Istio) | MVP uses plaintext on localhost. |
| Secrets rotation | AWS Secrets Manager automatic rotation. 90-day rotation schedule. | MVP has manual rotation. |
| KMS | Customer-managed KMS keys for all encrypted data at rest. | MVP uses AWS-managed keys. |
| WAF | AWS WAF in front of CloudFront and API Gateway. OWASP Top 10 rule set. | MVP has no WAF. |
| Penetration testing | Annual third-party pen test. Continuous DAST via OWASP ZAP in CI/CD. | MVP has no formal pen testing program. |
| SOC 2 Type II | Audit readiness from day one. Formal SOC 2 engagement at GA. | MVP architecture supports SOC 2 — formal audit engagement post-GA. |
| Data residency | VPC per region. Aurora Global Database for cross-region replication where required. | MVP is single-region. |

### Production Observability Architecture

| Layer | What It Observes | Stack | Audience |
|---|---|---|---|
| Platform Operational Observability | MeshOS infrastructure health — service latency, error rates, database performance, Kafka consumer lag, EKS node health | Datadog APM + Logs + Infrastructure | Platform engineering team |
| Data Product Observability | Data product health — SLO compliance, freshness, schema conformance, trust score, connector health | Custom MeshOS observability service + MeshOS UI | Domain teams, consumers, governance teams |
| Agent Activity Observability | Agent query patterns, anomaly detection, consumption trends, MCP session metrics | Agent Query Layer metrics → Datadog + MeshOS agent monitoring UI | Governance teams, domain teams (oversight contacts) |

> **Critical:** these three layers must never be conflated in the codebase. Platform operational observability uses Datadog/Grafana. Data product observability is a core MeshOS product feature built custom.

---

## Section 5: MVP Build Sequence

A phased build plan optimized for Claude Code — shipping a coherent, usable slice of the platform in each phase rather than building all seven domains in parallel.

Each phase produces something a real user can interact with. Each phase's components are prerequisites for the next phase's components.

### Phase 1 — Foundation (Weeks 1-6)

**Goal:** A running platform with organization onboarding, domain creation, and basic data product definition. Enough for the first design partner conversation.

| Component | What to Build | Open Source to Integrate |
|---|---|---|
| Infrastructure | Docker Compose file with all services defined. EC2 provisioning via Terraform. Kong routing configured. | Docker, Terraform, Kong OSS |
| Identity | Keycloak configured with OIDC. NestJS auth module with JWT validation. Principal model in PostgreSQL. | Keycloak, passport-jwt (NestJS) |
| Organization API | Org and domain CRUD. Role assignment. Namespace model. Self-service onboarding flow. | NestJS, TypeORM, PostgreSQL |
| Data Product API (core) | Product definition schema. Draft lifecycle state. Port declaration model. Definition validation (schema only). | NestJS, Zod (schema validation), PostgreSQL |
| Frontend Shell | React app with Keycloak auth. Persona-adaptive navigation shell. Domain dashboard (empty state). Basic product authoring form. | React, TypeScript, TailwindCSS, Keycloak-js |
| CI/CD Pipeline | GitHub Actions: test, lint, build, deploy to EC2. Docker build and push to ECR. | GitHub Actions, Docker, ECR |

**Phase 1 deliverable:** A design partner can create their organization, create domains, and start defining data products.

### Phase 2 — Governance and Publishing (Weeks 7-12)

**Goal:** The governance engine is live. Domain teams can publish data products validated against real governance policy. The marketplace is visible to consumers. The first complete data mesh workflow.

| Component | What to Build | Open Source to Integrate |
|---|---|---|
| OPA Integration | OPA sidecar deployed. Policy compilation pipeline (JSON → Rego). Governance Engine NestJS module. Default policy schema. | OPA, opa npm client |
| Governance UI | Policy Authoring Studio (initial version). Rule builder for Product Schema Policy and Classification Taxonomy Policy. Impact preview. | React, NestJS governance API |
| Data Product API (full) | Published lifecycle state. Port contract validation. Publication-time OPA enforcement. Versioning. Connector integration. | NestJS, OPA client |
| Connector Framework | Connector registration API. Credential reference model (Secrets Manager integration). Connector validation for PostgreSQL, Snowflake, BigQuery, S3. | NestJS, AWS Secrets Manager SDK |
| Marketplace | React marketplace UI. Product discovery (keyword search only). Product detail page. Trust score (basic). | React, NestJS search API, OpenSearch |
| Access Control | Access grant model. Access request workflow via Temporal. Consumer-product relationship tracking. | NestJS, Temporal TypeScript SDK |

**Phase 2 deliverable:** End-to-end data mesh workflow. A real design partner can run a pilot.

### Phase 3 — Lineage and Observability (Weeks 13-18)

**Goal:** The trust infrastructure is live. Lineage graph populated. Trust scores full-fidelity. Ready for serious design partner use.

| Component | What to Build | Open Source to Integrate |
|---|---|---|
| Lineage Emission API | High-throughput ingestion endpoint. Kafka producer. OpenLineage-aligned event schema. Idempotent deduplication. | NestJS, Redpanda/Kafka, openlineage-js |
| Lineage Graph Service | Neo4j schema initialization. Graph write service (consuming from Kafka). Lineage query API. Declared vs emitted reconciliation. | Neo4j (neo4j-driver npm), NestJS |
| Lineage Emission SDK | Python SDK (PyPI). TypeScript SDK (npm). OpenAPI-generated clients. | openlineage-python, OpenAPI Generator |
| Observability Emission API | Metric ingestion endpoint. SLO evaluation engine. Observability state writes to PostgreSQL. | NestJS, Redpanda |
| Trust Score Engine | Full trust score computation: lineage completeness + SLO compliance + governance compliance + schema conformance + freshness. | NestJS, PostgreSQL time-series queries |
| Lineage Visualization | React graph visualization component. Upstream/downstream display. Depth control. Node type visual encoding. Export. | React Flow or D3.js, React |
| Observability Dashboard | Per-product observability UI. SLO compliance display. Trust score detail view with breakdown. Trend sparklines. | React, Recharts, NestJS observability API |

**Phase 3 deliverable:** The platform is a genuine trust infrastructure. Consumers can evaluate data products before consuming them.

### Phase 4 — Agent Integration (Weeks 19-26)

**Goal:** AI agents are first-class participants. The MCP server is live. The federated semantic query layer is operational. The Data 3.0 milestone.

| Component | What to Build | Open Source to Integrate |
|---|---|---|
| Agent Identity Service | Agent identity registration. Trust classification model. Human oversight contact assignment. Model version binding. Lifecycle management. | NestJS, PostgreSQL, Keycloak |
| Agent Access Control | Agent-specific access grant model. Dynamic per-query evaluation. Rate limiting at Kong. Anomaly detection service. | NestJS, Kong rate-limiting plugin, Temporal |
| Embedding Service | sentence-transformers deployment. Product embedding pipeline. OpenSearch vector index population. | Python, FastAPI, sentence-transformers, OpenSearch kNN |
| Semantic Search | OpenSearch semantic search API. Natural language query translation (Claude API). Structured semantic query engine. | NestJS, OpenSearch, Anthropic SDK |
| MCP Server | Full MCP server implementation. Resources: all authorized product output ports. Tools: search, query, lineage traversal, access request, observability. Prompts: common agent patterns. | @modelcontextprotocol/sdk (TypeScript), NestJS |
| Federated Query Layer | Query planning engine. Policy-aware execution (OPA integration). Cross-product join semantics. Provenance envelope builder. Result caching (Redis). | NestJS, OPA client, Redis |
| Agent UI | Agent Registry UI. Agent Activity Monitor. Human Review Queue. Agent Trust Classification UI for governance teams. | React, NestJS agent API |

**Phase 4 deliverable:** MeshOS is a Data 3.0 platform. Any MCP-compatible AI agent can discover, access, and query data products through the platform.

### Phase 5 — Production Hardening (Weeks 27-34)

**Goal:** Migration from MVP infrastructure to production-grade managed services. No new features.

| Activity | Description | Risk |
|---|---|---|
| Monolith to microservices split | Extract NestJS modules into independent services. Kubernetes manifests. Helm charts. | Medium — interface contracts are pre-defined |
| Database migration to managed services | PostgreSQL → Aurora. Neo4j → Neptune or AuraDB. Redpanda → MSK. OpenSearch → Amazon OpenSearch Service. | Low — same APIs, configuration-only changes |
| EKS migration | Containerized services moved to EKS. Auto-scaling configured. | Low — already containerized in MVP |
| Security hardening | VPC with private subnets. mTLS via App Mesh. WAF deployment. KMS customer-managed keys. Penetration testing. | Medium — new infrastructure components |
| Multi-tenancy validation | Load testing with simulated multi-tenant workload. RLS audit. Tenant isolation penetration test. | High — critical to get right before enterprise customers |
| SOC 2 readiness audit | Internal audit against SOC 2 controls. Gap analysis. Remediation. | Medium — documentation-heavy but architecture is already compliant |
| Disaster recovery | RTO and RPO definition. Cross-region Aurora replication. Neptune snapshot automation. Runbook documentation. | Low — managed services simplify DR |

---

## Section 6: Technology Decision Register

Explicit records of significant technology choices, alternatives considered, and rationale.

| Decision | Choice | Alternatives Considered | Rationale | Revisit Trigger |
|---|---|---|---|---|
| Graph Database | Neo4j (MVP) → Neptune (prod) | Amazon Neptune from day one; TigerGraph; PostgreSQL with recursive CTEs | Neo4j Community is free and best-documented for Claude Code. Neptune is the managed upgrade path — same Cypher query language, zero migration. | If Neo4j AuraDB pricing becomes prohibitive at scale |
| Policy Engine | Open Policy Agent (OPA) | Casbin; custom policy evaluation; Cedar (AWS); SpiceDB | OPA is the industry standard. Hot-reload via bundle API satisfies NF4.3 without redeployment. | If Rego becomes a maintenance burden — consider Cedar for more readable policy language |
| Message Broker | Redpanda (MVP) → MSK (prod) | RabbitMQ; AWS SQS/SNS; Pulsar; pure Kafka | Redpanda is Kafka-compatible with dramatically lower operational overhead for MVP (single binary, no Zookeeper). MSK in production eliminates Kafka operational burden. | If Redpanda introduces licensing changes |
| Workflow Engine | Temporal | AWS Step Functions; Airflow; custom state machine in PostgreSQL | Temporal handles durable long-running workflows without the complexity of building state machines. TypeScript SDK is excellent. | If Temporal Cloud pricing becomes significant — Step Functions is the AWS-native alternative |
| Frontend Framework | React + TypeScript + TailwindCSS | Vue.js; Svelte; Angular; Next.js | React is the highest-Claude-Code-familiarity frontend framework. Shared types with backend via monorepo. | No strong revisit trigger |
| NL Query Translation | Claude API (claude-sonnet-4-20250514) | GPT-4o; local Llama via Ollama; rule-based query parser | Using Claude for NL query translation in an Anthropic-protocol platform is the natural choice. Performance and accuracy are leading class. | If cost at scale becomes prohibitive — a fine-tuned local model could reduce per-query cost |
| MCP Implementation | @modelcontextprotocol/sdk (official TypeScript) | Custom MCP implementation; Python MCP SDK | The official TypeScript SDK is the reference implementation. Using it guarantees spec compliance and benefits from upstream updates. | No revisit trigger — always use the official SDK |
| Semantic Embeddings | sentence-transformers (self-hosted) | OpenAI Embeddings API; AWS Bedrock Titan; Cohere | Self-hosted all-MiniLM-L6-v2 is free, fast enough for product discovery, and avoids per-embedding API cost at scale. | If embedding quality is insufficient for agent semantic search accuracy |

---

## Section 7: Claude Code Implementation Guidance

Specific patterns and approaches that maximize Claude Code effectiveness for this architecture.

> This section is unique to MeshOS's situation: Claude Code as the engineering team. These are not general software engineering principles — they are specific practices that make Claude Code more effective for this particular architecture.

### Repository Structure

```
meshos-platform/
├── apps/
│   ├── api/                        # NestJS modular monolith (MVP)
│   │   └── src/
│   │       ├── organizations/      # Module: org and domain management
│   │       ├── products/           # Module: data product lifecycle
│   │       ├── connectors/         # Module: connector framework
│   │       ├── governance/         # Module: policy engine integration
│   │       ├── lineage/            # Module: lineage graph service
│   │       ├── observability/      # Module: metrics and trust score
│   │       ├── access/             # Module: access grants and requests
│   │       └── notifications/      # Module: notification service
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
├── docs/
│   ├── prd/                        # Product Requirements Document
│   ├── architecture/               # Architecture document and ADRs
│   ├── api/                        # Generated from OpenAPI specs
│   └── runbooks/                   # Operational runbooks
├── CLAUDE.md                       # Claude Code persistent context
└── README.md
```

### Claude Code Effective Patterns

| Pattern | Description | Why It Matters for Claude Code |
|---|---|---|
| OpenAPI spec first | Define the API spec in packages/openapi/ before writing any implementation. Generate types, client SDKs, and validation schemas from the spec. | Claude Code generates accurate implementations when given a precise spec. |
| Database migrations as schema definition | Write Flyway migration files as the authoritative schema definition before writing TypeORM entities. | Claude Code generates accurate TypeORM entities from migration files. |
| Test as specification | Write failing tests before implementation. Describe behavior in test names, not comments. | Claude Code writes implementations that pass tests reliably. |
| Environment-based configuration | All configuration via environment variables. No hardcoded values. Use Zod for env validation at startup. | Claude Code generates portable code when configuration is externalized. |
| Explicit module interfaces | Every NestJS module exports a typed interface defining what it exposes. Cross-module calls use the interface, not the implementation. | Claude Code respects module boundaries when they are explicit TypeScript interfaces. |
| ADR for every significant decision | Architecture Decision Records in docs/architecture/adr/. Numbered, dated, with context, decision, and consequences. | Claude Code reads ADRs and makes consistent decisions within established patterns. |
| Seed data as documentation | Maintain a comprehensive seed dataset for local development covering all entity types and lifecycle states. | Claude Code builds features against concrete examples. |

### What to Build vs. What to Configure

**Build from scratch (this is our differentiation):**
- Governance policy UI (Policy Authoring Studio)
- Trust score computation algorithm
- Data product definition validation logic
- Port contract enforcement engine
- Semantic change declaration model
- Agent provenance envelope builder
- MeshOS-specific MCP tools and prompts
- Non-determinism lineage markers
- Federated query planner and executor

**Configure from open source (do not reinvent):**
- OPA Rego policy evaluation
- Neo4j graph schema and Cypher queries
- Keycloak realm configuration and OIDC flows
- Temporal workflow definitions for governance processes
- OpenSearch index mapping and query DSL
- Kong plugin configuration for rate limiting and auth
- Redpanda topic configuration and consumer groups
- Docker Compose and Terraform infrastructure
- sentence-transformers model selection and serving

---

## Section 8: Architecture Summary

### MVP Architecture in One View

| Dimension | Choice |
|---|---|
| Primary cloud | AWS (with Activate startup credits) |
| Compute (MVP) | 2x EC2 instances (~$155/month) |
| Deployment model (MVP) | Docker Compose → NestJS monolith with module boundaries |
| Primary language | TypeScript (NestJS + React). Python for embedding service only. |
| Graph database | Neo4j Community (self-hosted on EC2) |
| Relational database | PostgreSQL 16 (self-hosted on EC2) |
| Message broker | Redpanda (Kafka-compatible, self-hosted) |
| Policy engine | Open Policy Agent (OPA sidecar) |
| Search | OpenSearch (single-node, self-hosted) |
| Identity | Keycloak (self-hosted) |
| Workflow engine | Temporal (self-hosted) |
| API gateway | Kong OSS |
| Agent interface | MCP server (official TypeScript SDK) + GraphQL + REST |
| Semantic search | sentence-transformers + OpenSearch kNN |
| NL query translation | Claude API (claude-sonnet-4-20250514) |
| Estimated MVP cost | $200-350/month ($0 with AWS Activate credits) |
| MVP build timeline | ~26 weeks (4 feature phases + infrastructure) |

### Production Architecture in One View

| Dimension | Choice |
|---|---|
| Primary cloud | AWS |
| Compute | EKS with auto-scaling node groups (3x m6i.xlarge base) |
| Deployment model | Independent microservices on Kubernetes. Helm charts. GitOps via ArgoCD. |
| Graph database | Amazon Neptune Serverless or Neo4j AuraDB |
| Relational database | Amazon Aurora PostgreSQL Serverless v2 (Multi-AZ) |
| Message broker | Amazon MSK (Managed Kafka) |
| Policy engine | OPA on EKS (2 replicas, stateless, horizontally scalable) |
| Search | Amazon OpenSearch Service (3-node cluster) |
| Identity | Keycloak on EKS (HA) or Auth0/Okta |
| Workflow engine | Temporal Cloud (managed) |
| API gateway | Kong Gateway on EKS or AWS API Gateway |
| CDN | Amazon CloudFront |
| Secrets | AWS Secrets Manager with automatic rotation |
| Observability | Datadog APM + Logs + Infrastructure |
| Security additions | VPC private subnets, mTLS via App Mesh, WAF, KMS CMK |
| Estimated platform cost | $2,400-$8,000/month (before customer workload costs) |
| MVP to Production migration | Configuration changes only — no code rewrites. Same service interfaces. |

### The Upgrade Path

| MVP Component | Production Equivalent | Migration Complexity |
|---|---|---|
| PostgreSQL on EC2 | Aurora PostgreSQL Serverless v2 | Low — connection string change + RLS policy review |
| Neo4j Community on EC2 | Amazon Neptune or Neo4j AuraDB | Low — same Cypher dialect, connection string change |
| Redpanda on EC2 | Amazon MSK | Low — Kafka-compatible API, configuration change |
| OpenSearch on EC2 | Amazon OpenSearch Service | Low — same REST API, index migration script |
| Temporal self-hosted | Temporal Cloud | Low — same SDK, namespace configuration change |
| MinIO on EC2 | Amazon S3 | Low — S3-compatible API, endpoint configuration change |
| Keycloak self-hosted | Keycloak on EKS (HA) | Low — realm export/import, HA configuration |
| Docker Compose | EKS + Helm charts | Medium — containerization is done; Kubernetes manifests to write |
| NestJS monolith | Independent microservices | Medium — module boundaries pre-defined; service extraction is mechanical |
