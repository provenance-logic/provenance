# Provenance Technical Architecture Document

# Provenance Technical Architecture Document

**Version 1.5 - Companion to PRD v1.5**
**MVP and Production-Grade Specifications**
**Confidential - Not for Distribution**

> **Changelog - v1.4 to v1.5**
> Section 3: Domain 12 subsection added - MVP Connection Reference and Use-Case Consent Architecture. Covers component responsibilities, interaction flow, state propagation model, relationship to connection packages, what does not change, and MVP infrastructure impact. No new paid infrastructure required. See ADR-005 through ADR-008.
>
> Section 6: One new technology decision added - Connection Reference Composition and Enforcement Strategy.
>
> Section 8: Build status updated - Domain 12 noted as planned.
>
> **Changelog - v1.3 to v1.4**
> Domain 10 self-serve infrastructure — invitation flow, email service (nodemailer/SES), V15 migration (identity.invitations, organizations.governance_configs), RequireOrg frontend gate, @AllowNoOrg decorator pattern, Keycloak provenance-admin client for user provisioning.
>
> Section 3: New subsection added — MVP Self-Serve Infrastructure (Domain 10) covering registration flow, invitation flow, Keycloak admin client pattern, email service abstraction, and the V15 schema additions.
>
> Section 5: Phase 5 build sequence — Domain 10 Workstream A marked complete.
>
> Section 6: Technology decision register — email service abstraction added (nodemailer + Mailhog dev / SES production).
>
> Section 8: MVP summary updated — Domain 10 Workstream A self-serve infrastructure noted as complete.

> **Changelog — v1.2 → v1.3**
> Phase 5 redefined as "Open Source Ready" — lean, infrastructure-light scope replacing the original expensive managed services migration. Phase 6 "Production Scale" introduced as the funded future state for Kubernetes, managed AWS services, and enterprise security hardening.
>
> Section 5: Phase 5 build sequence replaced entirely with lean scope
>
> Section 6: New technology decision added — Lean Phase 5 Strategy
>
> Section 8: Architecture summary updated — Phase 5 description updated, Phase 6 Production Scale added
> Phase 4 complete as of April 13, 2026.
>
> Section 3: PostgreSQL connectors schema — added agent_authentication_method field note; Two OpenSearch indices documented explicitly
>
> Section 3: MVP Agent Authentication — new subsection documenting X-Agent-Id header pattern as MVP shortcut with Phase 5 resolution path
>
> Section 5: Phase 4 marked complete with confirmed technology decisions (MCP transport, 9 tools, embedding model, two OpenSearch indices, NL query translation, agent auth)
>
> Section 5: Phase 5 becomes active phase; anomaly detection moved to Phase 5; Priority 1 data product completeness items added as Phase 4c / early Phase 5 deliverables
>
> Section 6: Two new technology decisions — MVP Agent Authentication, Two OpenSearch Index Strategy
>
> Section 7: Build-from-scratch list updated — audit log query API added; X-Agent-Id pattern noted as temporary
>
> Section 8: MVP summary updated — Phase 4 confirmed complete, Phase 5 active
>
> **Changelog — v1.0 → v1.1**
> - Header updated: companion to PRD v1.1
> - Section 2: Open Source Foundation intro updated to include discovery engine as a differentiated build
> - Section 3: PostgreSQL connectors schema — added capability_manifests, discovery_crawl_events, discovery_coverage_scores
> - Section 3: MVP Service Map — Connector API description updated to include discovery responsibilities
> - Section 3: Neo4j — added lineage edge source markers (declared/emitted/discovered)
> - Section 3: Redpanda — added connector.discovery topic
> - Section 3: New subsection added — MVP Connector Discovery Architecture (crawl flow, re-crawl flow, conflict resolution logic)
> - Section 3: Security — added discovery crawl credentials rule
> - Section 5: Phase 2 — connector framework build updated to include capability manifest validation and priority connectors
> - Section 5: Phase 3 — renamed to "Lineage, Observability, and Discovery". Discovery engine and four connector adapters added as Phase 3 deliverables
> - Section 5: Phase 3 deliverable description updated
> - Section 6: Two new technology decisions added — Discovery Engine Architecture, Discovery Conflict Resolution
> - Section 7: Repository structure updated — connectors module expanded with discovery submodule and adapter pattern
> - Section 7: Two new Claude Code patterns added — capability manifest immutability, discovery override guard
> - Section 7: Build-from-scratch list updated — discovery engine components added
> - Section 7: Configure-from-open-source list updated — connector SDK adapters noted
> - Section 8: MVP summary updated — discovery engine row added, timeline updated to 34 weeks
> - Section 8: Upgrade path — discovery engine migration row added

---

## Section 1: Architecture Philosophy

Provenance is being built with Claude Code as the primary engineering capability. This is not a constraint — it is a genuine advantage when the architecture is designed to leverage it. Claude Code excels at integrating well-documented open source systems, implementing against clear interface specifications, and reasoning about standard protocols.

Every architectural decision in this document therefore optimizes for three properties simultaneously:

* **Legibility** — the architecture should be explainable in a single diagram and implementable from clear specifications
* **Composability** — components should be independently deployable, independently testable, and replaceable without cascading rewrites
* **Upgrade path clarity** — the MVP architecture should be a strict subset of the production architecture, not a throwaway prototype

> **The single most important architectural principle:** the MVP must be buildable on a startup budget while being architecturally indistinguishable from the production system in its service boundaries and data contracts. What changes from MVP to production is scale, redundancy, and managed service substitution — not structure.

### Five Non-Negotiable Architectural Constraints

| Constraint | Implication |
| --- | --- |
| The lineage graph must be a native graph database | Relational and document stores cannot efficiently serve arbitrary-depth traversal, impact analysis, and time travel queries at the required performance targets |
| The policy engine must be a hot-reloadable independent runtime | Policy changes cannot require platform redeployment — the policy engine is a live process that reloads rules without downtime |
| Control plane and data plane must be architecturally separated from day one | The platform stores metadata and contracts; data stays in domain infrastructure. This boundary cannot be blurred for MVP speed |
| The agent query layer is a distinct service | Latency, concurrency, and policy evaluation requirements for agent queries are incompatible with sharing a process with the control plane |
| MCP compliance is a native protocol implementation, not an API wrapper | MCP streaming and capability negotiation patterns do not map cleanly to REST wrapper patterns |

---

## Section 2: Open Source Foundation

The build philosophy is: **open source foundations, custom where differentiated.**

Your differentiation is the governance engine, the agent integration layer, the trust score model, the port abstraction, the connector discovery engine, and the UX. Everything else should be assembled from well-maintained open source projects with large training corpora.

### Component Selection

| Component | MVP Choice | Production Upgrade | License | Rationale |
| --- | --- | --- | --- | --- |
| Graph Database | Neo4j Community (self-hosted) | Neo4j AuraDB or Amazon Neptune | GPL2 / Enterprise | Best-documented graph DB. OpenCypher query language. Excellent Claude Code familiarity. Zero migration cost to AuraDB. |
| Relational Database | PostgreSQL 16 (self-hosted) | Amazon RDS PostgreSQL or Aurora | PostgreSQL (permissive) | The gold standard. Handles all control plane state. |
| Message Broker | Redpanda (via Kafka-compatible API) | Amazon MSK or Confluent Cloud | Apache 2.0 | Redpanda is Kafka-compatible but Rust-based — dramatically lower operational overhead for MVP. |
| Policy Engine | Open Policy Agent (OPA) | OPA remains — scale via Styra DAS | Apache 2.0 | Industry standard. Hot-reloadable policies via bundle API. |
| Search / Semantic Index | OpenSearch | Amazon OpenSearch Service | Apache 2.0 | Powers marketplace search and semantic product discovery via k-NN plugin. |
| Vector Embeddings | sentence-transformers (self-hosted) | Amazon Bedrock Embeddings or OpenAI | Apache 2.0 | Self-hosted on MVP; managed API in production. |
| Identity / Auth | Keycloak (self-hosted) | Keycloak remains or Auth0/Okta | Apache 2.0 | Full OIDC and SAML 2.0. |
| API Gateway | Kong (OSS) | Kong Gateway or AWS API Gateway | Apache 2.0 | Rate limiting, auth, routing. |
| Lineage Event Schema | OpenLineage (specification + client libs) | OpenLineage remains | Apache 2.0 | Industry standard. |
| Container Orchestration | Docker Compose (MVP) → k3s | Amazon EKS or GKE | Apache 2.0 | Docker Compose for single-node MVP. |
| Object Storage | MinIO (self-hosted) | Amazon S3 | AGPL3 / Apache 2.0 | S3-compatible API. Zero migration to S3 in production. |
| Observability Stack | Grafana + Prometheus + Loki | Grafana Cloud or Datadog | Apache 2.0 | Platform operational monitoring. |
| Frontend Framework | React + TypeScript + Vite | Same | MIT | Claude Code is exceptionally strong here. |
| API Layer | NestJS (TypeScript) | Same, scaled horizontally | MIT | Strong typing. Decorator-based architecture maps well to domain model. |
| MCP Server | TypeScript MCP SDK (official) | Same | MIT | The official Anthropic MCP TypeScript SDK is the reference implementation. |
| Workflow Orchestration | Temporal (self-hosted) | Temporal Cloud | MIT | Long-running governance workflows and discovery re-crawl scheduling. |

### Language Stack

| Service | Language | Rationale |
| --- | --- | --- |
| Control Plane API | TypeScript / NestJS | Strong typing, decorator-based architecture |
| Agent Query Layer | TypeScript / NestJS | MCP SDK is TypeScript-native |
| Governance Engine | TypeScript / NestJS | OPA policy evaluation via REST API |
| Lineage Emission API | TypeScript / NestJS | High-throughput event ingestion |
| Frontend | TypeScript / React | Shared types with backend via monorepo |
| Embedding Service | Python / FastAPI | sentence-transformers is Python-native |
| Lineage Emission SDK | Python + TypeScript + Java | Multi-language SDKs against the same OpenAPI spec |

---

## Section 3: MVP Architecture

### MVP Infrastructure Blueprint

| Resource | Specification | Monthly Cost (est.) | Purpose |
| --- | --- | --- | --- |
| EC2 t3.xlarge (x1) | 4 vCPU, 16GB RAM | ~$120 | NestJS monolith, Neo4j, PostgreSQL, Redpanda, OPA, OpenSearch, Keycloak, MinIO, Temporal |
| EC2 t3.medium (x1) | 2 vCPU, 8GB RAM | ~$35 | React frontend, Kong, Grafana + Prometheus, Embedding service |
| Elastic IP | Static IP | ~$4 | Stable ingress endpoint |
| Route 53 | DNS + SSL (via ACM) | ~$5 | Domain routing and HTTPS |
| S3 bucket | Policy artifacts, exports, audit logs | ~$5 | Overflow from MinIO |
| CloudWatch Logs | Log aggregation | ~$10 | Operational visibility |
| Data transfer | Outbound traffic | ~$20 | Consumer-facing API responses |

Total estimated cost without credits: $200-350/month.

### MVP Service Map

| Module / Service | Type | MVP Deployment | Responsibility |
| --- | --- | --- | --- |
| Organization API | NestJS Module | Monolith | Tenant management, domain CRUD, principal management, role assignment |
| Data Product API | NestJS Module | Monolith | Product definition validation, lifecycle state management, port registration, versioning |
| Connector API | NestJS Module | Monolith | Connector registration, credential reference management, **capability manifest validation and storage**, **discovery crawl orchestration via Temporal**, schema inference, health monitoring, **coverage score computation**, **conflict detection and notification** |
| Governance Engine | NestJS Module + OPA | Monolith + sidecar OPA | Policy authoring, effective policy computation, publication-time enforcement, continuous monitoring |
| Lineage API | NestJS Module | Monolith | Lineage event ingestion, graph writes, declared lineage registration, **discovered lineage merge with source markers** |
| Observability API | NestJS Module | Monolith | Observability metric ingestion, SLO evaluation, trust score computation |
| Access Control API | NestJS Module | Monolith | Access grant management, approval workflows, consumer-product relationships |
| Agent Query Layer | Separate NestJS service | Separate process on same EC2 | Semantic query federation, MCP server, agent identity verification, dynamic policy evaluation |
| Embedding Service | FastAPI (Python) | Separate process on t3.medium | Vector embedding generation for semantic index |
| Frontend | React + Vite + Nginx | t3.medium | All four persona UI surfaces |
| Neo4j Community | Database | Same EC2 as monolith | Lineage graph storage and querying |
| PostgreSQL 16 | Database | Same EC2 as monolith | Control plane state |
| Redpanda | Message broker | Same EC2 as monolith | Lineage event ingestion buffer, async governance events, **discovery crawl result pipeline** |
| OpenSearch | Search | Same EC2 as monolith | Product discovery index, semantic vector search |
| OPA | Policy runtime | Sidecar on same EC2 | Policy bundle evaluation, hot reload on policy publish |
| Keycloak | Identity | Same EC2 as monolith | OIDC/SAML federation, token issuance |
| MinIO | Object storage | Same EC2 as monolith | Policy artifacts, schema exports, audit exports |
| Temporal | Workflow engine | Same EC2 as monolith | Grace period timers, deprecation workflows, exception expiry, **discovery registration crawls and re-crawl scheduling** |
| Kong OSS | API Gateway | t3.medium | Rate limiting, auth token verification, routing |

### MVP Data Architecture

#### PostgreSQL — Control Plane State

| Schema | Tables | Notes |
| --- | --- | --- |
| organizations | orgs, domains, domain_extensions, governance_configs | Top-level tenant isolation via org_id on all tables |
| identity | principals, roles, role_assignments, agent_identities, agent_trust_classifications | Keycloak is auth source; PostgreSQL stores platform-specific identity metadata |
| products | data_products, product_versions, port_declarations, port_contracts, lifecycle_events | Core product registry. Versions stored as immutable records. |
| connectors | connectors, connector_health_events, source_registrations, schema_snapshots, **capability_manifests**, **discovery_crawl_events**, **discovery_coverage_scores** | Credentials referenced by external secrets ARN only. Capability manifests immutable per connector version. |
| identity | principals, roles, role_assignments, agent_identities, agent_trust_classifications | agent_trust_classifications includes `scope` field defaulting to `'global'` for MVP; `changed_by_principal_id`, `changed_by_principal_type`, and `reason` fields mandatory on all classification change events |
| governance | policy_schemas, policy_versions, effective_policies, compliance_states, exceptions, grace_periods | Policy artifacts stored as JSONB |
| access | access_grants, access_requests, approval_events | Consumer-product access relationships with expiration tracking |
| observability | slo_declarations, slo_evaluations, trust_score_history, observability_snapshots | Partitioned by org_id and time |
| audit | audit_log | Append-only. Never updated or deleted. Partitioned by month. |

**Key tables added in v1.1:**

`capability_manifests` — structured, machine-readable capability declaration per connector version. Immutable once written. Key fields: connector_id, connector_version, discovery_mode_supported (bool), supported_metadata_categories (JSONB array of enum), supported_metadata_fields_per_category (JSONB), lineage_granularity (enum: none/asset/column).

`discovery_crawl_events` — append-only record of every discovery crawl. Key fields: connector_id, org_id, crawl_type (enum: registration/scheduled/manual), started_at, completed_at, status (enum: running/completed/failed), objects_discovered, objects_changed, errors (JSONB).

`discovery_coverage_scores` — per-crawl coverage per metadata category. Key fields: connector_id, org_id, crawl_event_id, category (enum: structural/descriptive/operational/quality/governance), fields_possible, fields_populated, coverage_pct, computed_at.

#### Neo4j — Lineage Graph

| Node Label | Key Properties | Notes |
| --- | --- | --- |
| SourceNode | org_id, connector_id, source_ref, created_at | One per registered external source |
| DataProductNode | org_id, product_id, version, domain_id, trust_score, compliance_state | Updated on every product state change |
| PortNode | org_id, product_id, port_type, port_id, contract_hash | One per declared port |
| TransformationNode | org_id, transformation_id, pipeline_ref, principal_id | Emitted by pipelines via lineage emission API |
| AgentNode | org_id, agent_id, model_id, model_version, reasoning_trace_ref, non_deterministic: true | Distinct from TransformationNode. Carries model provenance. |
| ConsumerNode | org_id, principal_id, principal_type, access_grant_id | One per access grant |

**Lineage edge source markers (added v1.1):** All edges carry a `source` property: `declared` (domain team in product definition), `emitted` (pipeline runtime via emission API), or `discovered` (connector crawl). Enables lineage completeness computation and UI transparency about provenance of each lineage edge.

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

// Lineage coverage by source
MATCH (p:DataProductNode {product_id: $id})-[e:DERIVES_FROM]->(upstream)
RETURN e.source, count(*) as edge_count
```

#### Redpanda — Event Topics

| Topic | Producers | Consumers | Retention |
| --- | --- | --- | --- |
| lineage.emission | Domain pipelines via Lineage API | Lineage API (graph writer), Audit log | 7 days |
| observability.emission | Domain pipelines via Observability API | Observability API (metric writer), SLO evaluator | 24 hours |
| governance.events | Governance Engine | Notification service, Compliance monitor, Temporal workflows | 30 days |
| product.lifecycle | Data Product API | Notification service, Access Control API, Semantic indexer | 30 days |
| agent.activity | Agent Query Layer | Anomaly detector, Audit log, Human oversight notifier | 7 days |
| connector.health | Connector health monitor | Observability API, Notification service | 24 hours |
| **connector.discovery** | **Connector API (crawl completion events)** | **Lineage API (graph merge), Metadata store writer, Coverage score calculator** | **7 days** |

### MVP Connector Discovery Architecture

The discovery engine is a submodule within the Connector API NestJS module. Not a separate service in MVP.

**Registration Crawl Flow:**
1. Domain team registers connector → passes validation (F3.4)
2. Connector API reads capability manifest — if `discovery_mode_supported: true`, enqueues registration crawl via Temporal
3. Temporal workflow executes connector-specific crawl adapter (Databricks/dbt/Snowflake/Fivetran)
4. Raw results published to `connector.discovery` Kafka topic
5. Lineage API consumes topic → merges discovered edges into Neo4j with `source: discovered` marker
6. Metadata store writer consumes topic → writes structural/descriptive/operational/quality/governance metadata
7. Coverage score calculator computes per-category scores against capability manifest → writes to `discovery_coverage_scores`
8. Conflict detector compares discovered values against domain-declared values → surfaces conflicts via notification service

**Re-crawl Flow:**
- Temporal scheduled workflow triggers delta crawl at governance-configured interval (platform default: 24h)
- Delta crawl fetches only objects modified since `last_crawl_completed_at`
- Same downstream pipeline as registration crawl
- Delta results never overwrite domain-declared metadata unless governance `auto_discovery_override = true`

**Conflict Resolution Logic:**
```
IF discovered_value conflicts with domain_declared_value:
  IF governance.auto_discovery_override == true:
    APPLY discovered_value
    PRESERVE domain_declared_value in audit_log
    EMIT governance.events: metadata_auto_overridden
  ELSE:
    PRESERVE domain_declared_value
    WRITE conflict to discovery_conflicts table
    NOTIFY domain team via notification service
    SURFACE in connector management UI as pending resolution
```

### MVP API Architecture

#### API Gateway Routing (Kong)

| Route Prefix | Target | Auth Method | Rate Limit |
| --- | --- | --- | --- |
| /api/v1/ | NestJS Monolith (control plane) | JWT (Keycloak) | 1000 req/min per principal |
| /agent/v1/ | Agent Query Layer (NestJS) | Agent JWT + scope validation | Configurable per agent grant |
| /mcp/v1/ | MCP Server (Agent Query Layer) | MCP auth (Bearer token) | Per agent grant |
| /lineage/emit | Lineage Emission API (NestJS) | Service account JWT | 10,000 events/sec per org |
| /observability/emit | Observability API (NestJS) | Service account JWT | 5,000 events/sec per org |
| /auth/ | Keycloak | Public (auth endpoints) | Anti-brute-force: 10 req/min |

### MVP Governance Engine Architecture

| Step | System | Description |
| --- | --- | --- |
| 1. Author | React UI (Policy Authoring Studio) | Governance team builds rules via point-and-click UI. Rules stored as structured JSON. |
| 2. Preview | Governance Engine API | Impact preview API evaluates proposed rules against current product catalog. |
| 3. Publish | Governance Engine API | Validated policy JSON written to PostgreSQL as immutable record. Grace period timer started in Temporal if breaking change. |
| 4. Compile | Governance Engine (background) | Policy JSON compiled to OPA Rego bundle. Bundle pushed to OPA via bundle API. Hot reload — no restart required. |
| 5. Enforce (publication time) | Data Product API → OPA | On product publish, calls OPA /v1/data/provenance/policy/allow. OPA evaluates in under 10ms. |
| 6. Enforce (continuous) | Compliance Monitor (scheduled) | Temporal workflow evaluates all published products against current OPA policy every 24 hours and on trigger events. |

### MVP Agent Query Layer Architecture

| Component | Implementation | Notes |
| --- | --- | --- |
| MCP Server | TypeScript MCP SDK (@modelcontextprotocol/sdk) | Exposes Resources, Tools, and Prompts. WebSocket transport. |
| GraphQL API | Apollo Server (TypeScript) | Schema-first. Exposes data product schema exploration. |
| Natural Language Query | Claude API (claude-sonnet-4-20250514) | NL query translated to structured semantic query. |
| Structured Semantic Query Engine | Custom NestJS service | Decomposes structured query into OpenSearch discovery, Neo4j lineage retrieval, output port sub-queries. |
| Dynamic Policy Evaluator | OPA client (HTTP) | Before every query execution, evaluates agent access scope and governance policy. Under 200ms overhead target. |
| Provenance Envelope Builder | Custom NestJS service | Assembles provenance envelope (F6.17) from query execution context. Writes consumer lineage event to Redpanda. |
| Agent Anomaly Detector | Custom NestJS service | Sliding window query pattern analysis per agent identity. |

### MVP Two OpenSearch Indices *(new v1.2)*

Two distinct OpenSearch indices are active simultaneously. Their purposes are complementary and they must not be conflated:

| Index | Name | Type | Used By | Populated By |
| --- | --- | --- | --- | --- |
| Semantic search | `data_products` | kNN, 384-dimension embeddings (all-MiniLM-L6-v2), cosine similarity, nmslib/HNSW | `semantic_search` MCP tool | Product publish, name/description/tags update, deprecation, decommission |
| Keyword search | `provenance-products` | BM25, no embeddings | Marketplace search endpoint, `search_products` MCP tool | Product publish and updates |

Both indices are refreshed automatically on lifecycle transitions (deprecation, decommission trigger removal) and on mutable field updates (name, description, tags trigger re-index). All index operations are fire-and-forget — they do not block the triggering action from completing.

### Agent Authentication (ADR-002) *(updated v1.3 — Phase 5 complete)*

Agent authentication uses Keycloak's OAuth2 `client_credentials` grant flow, implemented in Phase 5 per ADR-002. This supersedes the Phase 4 MVP pattern (`X-Agent-Id` self-reported header).

**How it works:**
1. **Registration provisioning:** When an agent is registered (via `register_agent` MCP tool or `POST /agents`), the platform provisions a dedicated Keycloak client with `client_id` = agent UUID, `client_secret` returned once, and custom JWT claims: `principal_type=ai_agent`, `agent_id`, `provenance_org_id`.
2. **Token acquisition:** The agent authenticates to Keycloak's token endpoint (`POST /realms/provenance/protocol/openid-connect/token`) with `grant_type=client_credentials`. Token lifetime is 300 seconds, no refresh tokens.
3. **Request authentication:** The agent includes the JWT as `Authorization: Bearer <token>` on every MCP request (`/mcp/sse`, `/mcp/messages`).
4. **Validation:** The Agent Query Layer validates JWT signature (RS256 via JWKS with 1-hour key cache), expiry, issuer, and `principal_type=ai_agent`. Rejected requests receive 401 with no body.
5. **Session binding:** Verified `agent_id` and `org_id` are bound to the MCP session. All tool calls within that session use the verified identity — `agent_id` is not accepted as a tool argument.
6. **Identity forwarding:** The Agent Query Layer forwards verified identity to the control plane via `X-Agent-Id` and `X-Org-Id` headers alongside the `MCP_API_KEY` service-to-service token. The control plane `JwtAuthGuard` verifies the agent exists in the database before populating `RequestContext`.

**Credential lifecycle:** Secret rotation via `POST /agents/:agentId/rotate-secret` (governance or oversight contact). One-time migration for pre-existing agents via `POST /agents/:agentId/provision-credentials` (governance only). See `documents/architecture/adr/ADR-002-jwt-agent-authentication.md` for full decision record.

### MVP Self-Serve Infrastructure (Domain 10) *(new v1.4 — Workstream A complete)*

Domain 10 is the self-serve onboarding surface — how a new user lands on the platform, creates an org, invites collaborators, and gets provisioned in Keycloak. Workstream A (the infrastructure layer) shipped in Phase 5; Workstream B (the UX polish layer — notifications, dashboards, billing stubs) is deferred.

**Registration flow:**

1. Anonymous visitor hits the web app and chooses "Sign up." The React app redirects to Keycloak's hosted registration page (realm `provenance`, flow `registration`). We do not self-host the registration form — Keycloak handles email verification and password strength.
2. On successful registration, Keycloak redirects back to the SPA with an OIDC token. The JWT carries no `provenance_org_id` because the user has not yet joined or created one.
3. The SPA's `RequireOrg` guard (`apps/web/src/auth/AuthProvider.tsx`) reads `keycloak.tokenParsed.provenance_org_id`. When empty, it redirects to `/onboarding/org` (unless the path already starts with `/onboarding/*`).
4. The onboarding page calls `POST /organizations/self-serve` on the control-plane API. That route is decorated with `@AllowNoOrg` — the only decorator that waives the `JwtAuthGuard`'s non-empty-org-claim requirement. By definition, a user creating their first org has no org yet.
5. The API creates the `orgs` row, seeds a default `organizations.governance_configs` row (invitation TTL, default role, email template overrides), writes a `role_assignments` row making the caller an org admin, and returns the new `org_id`.
6. The API then calls Keycloak Admin REST via the `provenance-admin` client (see below) to set the user's `provenance_org_id` attribute, triggering a token refresh on the SPA. `RequireOrg` re-evaluates and admits the user.

**Invitation flow:**

1. An org admin visits the team settings page and submits an email address and role. The SPA calls `POST /organizations/:orgId/invitations`.
2. The API inserts a row into `identity.invitations` with a UUID token, `org_id`, role, `invited_by_principal_id`, and `expires_at = now() + governance_configs.invitation_ttl`.
3. The API publishes an `invitation.created` event to Redpanda. The notifications module consumes it and renders the invitation email through the email service abstraction, using the org's `governance_configs` template overrides where present.
4. The invitee clicks the email link (`/invitations/accept?token=<uuid>`). The SPA POSTs `/invitations/:token/accept`. That route is `@AllowNoOrg` — the invitee may not yet have an org on their JWT, or may be an anonymous visitor who needs to register first.
5. If the invitee is not registered, the SPA redirects to Keycloak registration with the invitation token held in session storage, then retries `/invitations/:token/accept` after login.
6. The API validates the token (not expired, not already accepted), writes a `role_assignments` row, marks the invitation accepted in `identity.invitations`, and sets the invitee's `provenance_org_id` via the Keycloak admin client. The invitee's next token carries the org claim.

**Keycloak admin client (`provenance-admin`):**

The control-plane API needs to write Keycloak user attributes (principal_id, org_id, principal_type) without asking for user consent. We provision a single service-account Keycloak client, `provenance-admin`, with `realm-management.manage-users` and `realm-management.query-users` scopes. The API caches the admin-client access token in memory for the token's lifetime minus 30 seconds and refreshes on demand. All admin-client calls go through `KeycloakAdminService`.

A subtle but important rule is encoded in that service: `PUT /admin/realms/{realm}/users/{id}` is a full-replace, not a merge. Sending only `{ attributes: {...} }` drops required fields (`email`, `username`, `firstName`, `lastName`) and trips user-profile validation with a 400. All attribute updates are GET → merge → PUT. The pattern is enforced centrally in `KeycloakAdminService.updateUserAttributes`.

**Email service abstraction:**

The notifications module depends on an `EmailService` interface, not a concrete transport. Two implementations are wired by `NOTIFICATIONS_EMAIL_TRANSPORT` env var:

| Transport | Env value | Use | Configuration |
| --- | --- | --- | --- |
| Nodemailer → Mailhog | `smtp` (dev default) | Local and dev-on-EC2. Captures outbound mail in Mailhog's UI at port 8025 — nothing leaves the host. | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (boolean string coerced by Zod), `SMTP_USER`, `SMTP_PASS` (both optional for Mailhog) |
| AWS SES | `ses` (production) | Production. IAM role on the platform runtime grants `ses:SendEmail` and `ses:SendRawEmail`. Domain verified and DKIM signed. | `AWS_REGION`, `SES_FROM_ADDRESS`, `SES_CONFIGURATION_SET` (optional — for engagement tracking) |

Templates live in `apps/api/src/notifications/templates/` as MJML files compiled at build time. Per-org overrides for subject line and sender display name are stored in `organizations.governance_configs.email_templates` and merged over the defaults at send time.

**V15 schema additions:**

| Schema.Table | Key columns | Notes |
| --- | --- | --- |
| `identity.invitations` | `id uuid pk`, `org_id uuid fk`, `email citext`, `role text`, `token uuid unique`, `invited_by_principal_id uuid fk`, `status text check in ('pending','accepted','revoked','expired')`, `expires_at timestamptz`, `accepted_at timestamptz null`, `accepted_by_principal_id uuid fk null` | Indexed on `(org_id, status)` and `(email, status)`. Row-level security enforces `org_id` match for select/update. |
| `organizations.governance_configs` | `org_id uuid pk fk`, `invitation_ttl interval default '7 days'`, `default_invite_role text default 'consumer'`, `email_templates jsonb default '{}'::jsonb`, `updated_at timestamptz` | One row per org. Backfilled by V15 migration for all existing orgs with defaults. |

V15 also adds the `CITEXT` extension (if not already present) to normalize email lookups, and a trigger that transitions `identity.invitations.status` from `pending` to `expired` when `expires_at < now()` on select. Nightly Temporal workflow sweeps for expired invitations and emits `invitation.expired` for audit logging.

### MVP Security Architecture

| Concern | Approach | Notes |
| --- | --- | --- |
| Tenant isolation | org_id column on all PostgreSQL tables + row-level security policies | Every query requires org_id context. RLS enforced at database level. |
| Authentication | Keycloak OIDC + JWT | All API calls carry JWT. Kong validates JWT signature before routing. |
| Agent identity | Separate JWT claim: principal_type=agent + agent_id | Agent tokens carry additional claims validated on every request. |
| Credential storage | AWS Secrets Manager ARN references only | Never logged, never cached longer than connection lifetime. |
| **Discovery crawl credentials** | **Same Secrets Manager pattern as connector credentials** | **Discovery crawls use connector credentials. Never stored raw. Same zero-knowledge architecture.** |
| Audit log | PostgreSQL append-only table + row-level security | No UPDATE or DELETE permissions at database level. Exported to S3 nightly. |
| Data in transit | TLS 1.3 enforced at Kong | All external traffic TLS-terminated at Kong. |
| Data at rest | EC2 EBS encryption enabled | All EBS volumes encrypted at rest using AWS-managed keys. |

---

### MVP Connection Reference and Use-Case Consent Architecture (Domain 12) *(new v1.5)*

Domain 12 adds a per-use-case consent layer between the existing access grant model and the runtime query path. This subsection documents the component boundaries, service responsibilities, and data flow. Detailed design rationale and alternatives considered live in ADR-005 through ADR-008.

#### Architectural Open Questions Resolved

The PRD flagged three architectural questions for this domain (AQ1, AQ2, AQ3). Each is resolved by a specific ADR:

| Open Question | Resolution | ADR |
| --- | --- | --- |
| AQ1 - How does scope enforcement integrate with the existing OPA policy evaluation path? | Scope matching runs as a structural subset check in an Agent Query Layer guard, not as OPA policy. OPA is reserved for governance-authored rules (F12.14 activation override, F12.9 routing-by-classification) evaluated at state transition time, not on the hot path. | ADR-006 |
| AQ2 - How is connection reference state replicated to enforcement points within the revocation propagation window? | In-memory cache at each Agent Query Layer replica, invalidated via Redpanda events published using the transactional outbox pattern. Temporal drives scheduled state transitions (expiration, MAJOR-version suspension). No new paid infrastructure. | ADR-007 |
| AQ3 - How does the connection reference relate to the connection package issued in Domain 10? | A connection package is issued per connection reference with scope inherited from the approved scope of the reference. Package lifecycle tracks reference lifecycle. Connection detail refresh regenerates packages without re-consent. | ADR-008 |

#### Component Responsibilities

| Component | Domain 12 Responsibility | Notes |
| --- | --- | --- |
| Access Control API (NestJS module) | Connection reference lifecycle (create, approve, suspend, reactivate, revoke), use-case declaration validation against governance taxonomy, owning-principal notifications via Domain 11 | New module peer to existing `access` module. Reuses `access_grants` as a prerequisite check, does not modify it. |
| Governance Engine (OPA sidecar) | Use-case taxonomy rule evaluation, governance-override activation rules (F12.14), classification-aware request routing rules (F12.9) | New policy bundle `connection_reference.rego` alongside existing bundles. Hot-reloadable per existing OPA pattern. |
| Agent Query Layer | Runtime scope enforcement on every MCP tool call - verifies active connection reference exists, use-case scope matches action scope, expiration is not passed | Enforcement middleware sits after JWT validation (ADR-002) and before tool dispatch. See ADR-006. |
| Redpanda | `connection_reference.state` topic carries lifecycle transitions for in-memory cache invalidation at enforcement points | Reuses existing Redpanda broker. New topic, no infrastructure addition. See ADR-007. |
| Temporal | Scheduled expiration workflows (F12.22), MAJOR-version suspension propagation workflows (F12.15), principal-initiated revocation frozen-state coordination (F12.19) | Reuses existing Temporal deployment. New workflow definitions. See ADR-007. |
| PostgreSQL | Connection reference records, use-case declarations, consent records, audit log entries for all state transitions | New schema `consent` following existing schema conventions. Schema design left to Claude Code. |
| Notification Service (Domain 11) | Request-submitted, consent-granted, consent-denied, suspension, expiration-warning, revocation notifications | Reuses existing notification categories and delivery channels. New category entries only. |

#### Interaction Flow

The following describes how a single agent MCP tool call flows through Domain 12 enforcement alongside existing Phase 4 and Phase 5 mechanisms:

1. Agent acquires a Keycloak JWT via `client_credentials` grant (ADR-002, unchanged).
2. Agent sends an MCP tool call with the JWT as Bearer token to the Agent Query Layer.
3. Agent Query Layer validates the JWT (ADR-002, unchanged).
4. **New in Domain 12:** Agent Query Layer checks the in-memory connection reference cache for an active reference matching the `(agent_id, product_id)` pair in the tool call.
5. **New in Domain 12:** Agent Query Layer verifies the requested action falls within the declared scope of the active connection reference.
6. If scope matches, the tool call proceeds to existing trust classification enforcement (F6.3) and dispatch.
7. If scope does not match, the call is denied, a scope violation audit entry is written, and a notification fires to the owning principal and governance team.

Steps 4 and 5 are the Domain 12 additions. Steps 3, 6, and 7 reuse mechanisms established in Phase 4 and Phase 5.

#### State Propagation Model

Connection reference state is authoritative in PostgreSQL and cached at each enforcement point with Redpanda-driven invalidation:

- Write path: Access Control API writes the state transition to PostgreSQL within a database transaction, then publishes the transition event to `connection_reference.state`.
- Read path: Agent Query Layer subscribes to `connection_reference.state` and maintains an in-memory map of active references per `(agent_id, product_id)`. On enforcement, it reads from this map rather than PostgreSQL on the hot path.
- Cold start and cache miss: on Agent Query Layer startup or cache miss, fall back to PostgreSQL query with the result backfilled into the cache.
- Expiration: Temporal schedules an expiration transition at reference creation time; the scheduled workflow fires a state transition event at the expiration timestamp, invalidating caches the same way a revocation does.
- MAJOR version suspension: product publication triggers a Temporal workflow that transitions all affected references to Suspended and publishes the resulting state transitions.

This model satisfies NF12.3 (revocation propagation under 10 seconds), NF12.4 (expiration under 60 seconds), and NF12.8 (MAJOR-version suspension under 60 seconds) on existing MVP infrastructure without new paid services. See ADR-007 for the full propagation analysis.

#### Relationship to Connection Packages (Domain 10)

A connection reference grants the authorization for a use case. A connection package (F10.8) provides the usable artifact - the JDBC string, the curl snippet, the MCP tool invocations - that a consumer or agent needs to actually reach the source. These are composed, not conflated:

- Activation of a connection reference triggers generation of a connection package scoped to the approved ports and data categories of that reference.
- A single `(agent_id, product_id)` pair may hold multiple connection references over time (sequentially - one reference expires or is revoked, another is requested and approved). Each activation generates its own connection package.
- A connection package is always tied to exactly one connection reference. If the connection reference transitions to Suspended, Expired, or Revoked, the connection package is invalidated.
- Connection package refresh (F10.10) triggered by connection detail changes reuses the active connection reference's approved scope without re-consent - the use case has not changed, only the underlying endpoint.

See ADR-008 for the full composition rationale and alternatives considered.

#### What Does Not Change

Domain 12 introduces no changes to:

- JWT agent authentication (ADR-002).
- Access grant creation, approval, or revocation flow (Domain 6, F6.7).
- Trust classification taxonomy or transition rules (F6.3, F6.3a).
- Frozen workflow state mechanism or governance disposition path (Domain 8, F8.1).
- Notification service infrastructure (Domain 11, F11.1).
- Tenant isolation via `org_id` RLS.
- Audit log append-only invariant.

Connection reference enforcement is additive to existing trust classification and access grant enforcement. All three conditions must be satisfied for an agent action to proceed: valid agent JWT with active access grant, active connection reference with matching scope, and trust classification permitting the action type (immediate for Autonomous, pending approval for Supervised, human-reviewed for Observed).

#### MVP Infrastructure Impact

No new paid infrastructure is required. All propagation, scheduling, and enforcement mechanisms run on the existing MVP t3.xlarge deployment:

- Redpanda: one new topic, negligible throughput relative to existing lineage event volume.
- Temporal: new workflow definitions, negligible worker load at MVP scale.
- OPA: new policy bundle, evaluated on the existing sidecar.
- PostgreSQL: new `consent` schema, sized similarly to existing `access` schema.
- Agent Query Layer: additional in-memory cache, estimated under 10 MB at MVP scale assuming under 10,000 active connection references per organization.

Production scale impact is analyzed in ADR-007 under "Scale Considerations."

---

## Section 4: Production-Grade Architecture

> **The production architecture is the MVP architecture with three changes:** (1) the monolith splits into independent microservices, (2) self-hosted databases and brokers are replaced with managed cloud services, and (3) deployment moves to Kubernetes with full observability. Every interface contract defined in the MVP remains unchanged.

### Production Infrastructure Overview

| Layer | Service | Scale Configuration | Monthly Cost Range (est.) |
| --- | --- | --- | --- |
| Compute | EKS with auto-scaling node groups | Base: 3x m6i.xlarge nodes | $600-2,500 |
| Graph Database | Amazon Neptune (or Neo4j AuraDB) | Neptune Serverless | $200-800 |
| Relational Database | Amazon Aurora PostgreSQL Serverless v2 | Auto-scales 0.5-64 ACUs. Multi-AZ. | $200-600 |
| Message Broker | Amazon MSK (Managed Kafka) | kafka.m5.large x3 | $400-800 |
| Search | Amazon OpenSearch Service | 3-node cluster, r6g.large | $300-600 |
| Object Storage | Amazon S3 | Standard + Glacier lifecycle for old audit logs | $50-200 |
| Identity | Keycloak on EKS (HA, 2 replicas) or Auth0/Okta | | $0-500 |
| Policy Engine | OPA on EKS (2 replicas, stateless) | | Included in EKS compute |
| API Gateway | Kong Gateway on EKS or AWS API Gateway | Kong in HA mode | $100-500 |
| CDN | Amazon CloudFront | Global edge for React SPA | $50-200 |
| Secrets | AWS Secrets Manager | Per-secret pricing | $50-150 |
| Workflow Engine | Temporal Cloud | Managed Temporal | $200-500 |
| Monitoring | Datadog or Grafana Cloud | Full observability stack | $200-800 |

Total production cost range: $2,400-$8,000/month before customer workload.

### Microservices Decomposition

| Microservice | Replicas (base) | Owns | Communicates With |
| --- | --- | --- | --- |
| Organization Service | 2 | organizations schema | Identity Service, Product Service |
| Identity Service | 2 | identity schema + Keycloak sync | All services (auth context) |
| Data Product Service | 3 | products schema | Governance Engine, Lineage Service, Access Service, Search Indexer |
| Connector Service | 2 | connectors schema + capability_manifests + discovery tables | Lineage Service, Observability Service, Temporal (discovery scheduling) |
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
| --- | --- | --- |
| Network isolation | VPC with private subnets for all databases and internal services | MVP runs everything on same EC2 |
| mTLS | All inter-service communication uses mTLS via service mesh (AWS App Mesh or Istio) | MVP uses plaintext on localhost |
| Secrets rotation | AWS Secrets Manager automatic rotation. 90-day rotation schedule. | MVP has manual rotation |
| KMS | Customer-managed KMS keys for all encrypted data at rest | MVP uses AWS-managed keys |
| WAF | AWS WAF in front of CloudFront and API Gateway. OWASP Top 10 rule set. | MVP has no WAF |
| Penetration testing | Annual third-party pen test. Continuous DAST via OWASP ZAP in CI/CD. | MVP has no formal pen testing program |
| SOC 2 Type II | Audit readiness from day one. Formal SOC 2 engagement at GA. | MVP architecture supports SOC 2 |
| Data residency | VPC per region. Aurora Global Database for cross-region replication where required. | MVP is single-region |

### Production Observability Architecture

| Layer | What It Observes | Stack | Audience |
| --- | --- | --- | --- |
| Platform Operational Observability | Provenance infrastructure health | Datadog APM + Logs + Infrastructure | Platform engineering team |
| Data Product Observability | Data product health — SLO, freshness, trust score, discovery coverage | Custom Provenance observability service + Provenance UI | Domain teams, consumers, governance teams |
| Agent Activity Observability | Agent query patterns, anomaly detection, MCP session metrics | Agent Query Layer metrics → Datadog + Provenance agent monitoring UI | Governance teams, domain teams |

> **Critical:** Platform operational observability uses Datadog/Grafana. Data product observability is a core Provenance product feature built custom. Never conflate these in the codebase.

---

## Section 5: MVP Build Sequence

### Phase 1 — Foundation (Weeks 1-6)

**Goal:** Running platform with organization onboarding, domain creation, and basic data product definition.

| Component | What to Build | Open Source to Integrate |
| --- | --- | --- |
| Infrastructure | Docker Compose with all services. EC2 provisioning via Terraform. Kong routing. | Docker, Terraform, Kong OSS |
| Identity | Keycloak configured with OIDC. NestJS auth module with JWT validation. Principal model in PostgreSQL. | Keycloak, passport-jwt |
| Organization API | Org and domain CRUD. Role assignment. Namespace model. Self-service onboarding. | NestJS, TypeORM, PostgreSQL |
| Data Product API (core) | Product definition schema. Draft lifecycle. Port declaration model. Definition validation. | NestJS, Zod, PostgreSQL |
| Frontend Shell | React app with Keycloak auth. Persona-adaptive navigation. Domain dashboard. Product authoring form. | React, TypeScript, TailwindCSS, Keycloak-js |
| CI/CD Pipeline | GitHub Actions: test, lint, build, deploy to EC2. | GitHub Actions, Docker, ECR |

### Phase 2 — Governance and Publishing (Weeks 7-12)

**Goal:** Governance engine live. Domain teams can publish products. Marketplace visible to consumers.

| Component | What to Build | Open Source to Integrate |
| --- | --- | --- |
| OPA Integration | OPA sidecar. Policy compilation pipeline. Governance Engine module. Default policy schema. | OPA, opa npm client |
| Governance UI | Policy Authoring Studio. Rule builder for Product Schema and Classification Taxonomy policy. Impact preview. | React, NestJS governance API |
| Data Product API (full) | Published lifecycle. Port contract validation. Publication-time OPA enforcement. Versioning. | NestJS, OPA client |
| Connector Framework | Connector registration API. Credential reference model. **Capability manifest schema and validation. Connector validation for Databricks, dbt, Snowflake, Fivetran, PostgreSQL, BigQuery, S3.** Health monitoring. | NestJS, AWS Secrets Manager SDK |
| Marketplace | React marketplace UI. Keyword search. Product detail page. Basic trust score. | React, NestJS search API, OpenSearch |
| Access Control | Access grant model. Access request workflow via Temporal. | NestJS, Temporal TypeScript SDK |

### Phase 3 — Lineage, Observability, and Discovery (Weeks 13-18)

**Goal:** Trust infrastructure live. Lineage populated from both emission and active discovery. Trust scores full-fidelity.

| Component | What to Build | Open Source to Integrate |
| --- | --- | --- |
| Lineage Emission API | High-throughput ingestion. Kafka producer. OpenLineage-aligned event schema. Idempotent deduplication. | NestJS, Redpanda/Kafka, openlineage-js |
| Lineage Graph Service | Neo4j schema. Graph write service (from Kafka). Lineage query API. Declared/emitted/discovered reconciliation. Edge source markers. | Neo4j (neo4j-driver npm), NestJS |
| Lineage Emission SDK | Python SDK (PyPI). TypeScript SDK (npm). | openlineage-python, OpenAPI Generator |
| **Connector Discovery Engine** | **Temporal crawl orchestration. Registration crawl flow. Delta re-crawl scheduling. connector.discovery Kafka topic pipeline. Coverage score computation. Conflict detection. Auto-override logic.** | **NestJS, Temporal TypeScript SDK, Redpanda** |
| **Discovery Adapter: Databricks** | **Unity Catalog API integration. Column-level lineage. Notebook/job lineage. Delta table history for versioning context.** | **Databricks SDK, Unity Catalog REST API** |
| **Discovery Adapter: dbt** | **manifest.json + catalog.json ingestion. Column-level lineage extraction. Test definitions as quality metadata. Source declarations as upstream lineage edges.** | **dbt Core manifest schema** |
| **Discovery Adapter: Snowflake** | **Information Schema crawl. Access History lineage. Object ownership as governance metadata.** | **Snowflake Node.js driver** |
| **Discovery Adapter: Fivetran** | **Fivetran Metadata API. Schema mappings. Sync cadence as observability metadata. Best-effort upstream source lineage.** | **Fivetran REST API** |
| Observability Emission API | Metric ingestion. SLO evaluation engine. Observability state writes. | NestJS, Redpanda |
| Trust Score Engine | Full computation: lineage completeness + SLO compliance + governance compliance + schema conformance + freshness. | NestJS, PostgreSQL |
| Lineage Visualization | React graph. Upstream/downstream. Depth control. Node type encoding. Source marker display. Export. | React Flow or D3.js |
| Observability Dashboard | Per-product dashboard. SLO compliance. Trust score breakdown. Discovery coverage scores. Trend sparklines. | React, Recharts |

**Phase 3 deliverable:** Teams connecting Databricks, dbt, Snowflake, or Fivetran get automatic metadata and lineage population on day one of connection.

### Phase 4 — Agent Integration (Weeks 19-26)

**Goal:** AI agents as first-class participants. MCP server live. Federated semantic query layer operational.

| Component | What to Build | Open Source to Integrate |
| --- | --- | --- |
| Agent Identity Service | Agent identity registration. Trust classification. Human oversight contact. Model version binding. | NestJS, PostgreSQL, Keycloak |
| Agent Access Control | Agent-specific access grants. Dynamic per-query evaluation. Rate limiting at Kong. Anomaly detection. | NestJS, Kong rate-limiting plugin, Temporal |
| Embedding Service | sentence-transformers deployment. Product embedding pipeline. OpenSearch vector index. | Python, FastAPI, sentence-transformers, OpenSearch kNN |
| Semantic Search | OpenSearch semantic search. NL query translation (Claude API). Structured semantic query engine. | NestJS, OpenSearch, Anthropic SDK |
| MCP Server | Full MCP implementation. Resources: authorized output ports. Tools: search, query, lineage, access, observability. Prompts: common patterns. | @modelcontextprotocol/sdk (TypeScript) |
| Federated Query Layer | Query planning. Policy-aware execution. Cross-product join semantics. Provenance envelope builder. Result caching. | NestJS, OPA client, Redis |
| Agent UI | Agent Registry. Activity Monitor. Human Review Queue. Trust Classification UI. | React, NestJS agent API |

### Phase 3 — Lineage, Observability, and Discovery ✅ Complete

### Phase 4 — Agent Integration ✅ Complete (April 13, 2026)

**Confirmed technology decisions:**

| Component | Decision |
| --- | --- |
| MCP transport | SSE, port 3002 |
| MCP tools | 9 tools: list_products, get_product, get_trust_score, get_lineage, get_slo_summary, search_products, semantic_search, register_agent, get_agent_status |
| Embedding model | all-MiniLM-L6-v2, 384 dimensions |
| Embedding service | Python FastAPI, port 8001 |
| Semantic index | `data_products`, kNN, cosine similarity, nmslib/HNSW |
| Keyword index | `provenance-products`, BM25 |
| NL query translation | claude-sonnet-4-20250514, 5s timeout, graceful fallback to keyword search |
| Agent authentication | JWT via Keycloak `client_credentials` (ADR-002, Phase 5) — supersedes Phase 4 X-Agent-Id header pattern |
| Agent trust classification | Three tiers (Observed/Supervised/Autonomous), global scope, scope field ready for per-domain post-MVP |
| Audit log query API | Filter by agent_id, event_type, time range, principal_type — no aggregation |
| Frozen state | Temporal workflow state, triggered by agent classification downgrade |

### Phase 4c / Early Phase 5 — Data Product Completeness (Priority 1)

Before or alongside Phase 5 infrastructure hardening, the following Priority 1 data product completeness items should be delivered. They are implementation tasks against existing data — the data exists in the platform; surfacing it through the agent interface and product detail page is the work.

| Component | What to Build | Data Source |
| --- | --- | --- |
| Column-level schema in get_product | Expose most recent schema snapshot per output port in MCP tool response and product detail page | connectors.schema_snapshots |
| Ownership and stewardship in get_product | Expose owner name, contact, domain team name, created_by, created_at, updated_at | products and identity schemas |
| Data freshness signals in get_product | Expose last successful refresh timestamp, refresh cadence, freshness SLA, freshness compliance state | observability schema |
| Access status for requesting principal | Expose current access status (granted/pending/not requested/denied) and how to request | access schema |

### Phase 5 — Open Source Ready (Active Phase)

**Theme:** Make the platform reliable, secure, and contributor-friendly on existing infrastructure. No significant new cloud spend. Estimated additional monthly cost: $10-30.

| Activity | Description | Infrastructure Cost |
| --- | --- | --- |
| Stability and reliability | Automated daily backups for PostgreSQL and Neo4j with tested restore procedure. Docker restart policies for auto-recovery. CloudWatch basic monitoring — EC2 health, disk, memory alerts. Operational runbook for common failure scenarios. Log rotation. | ~$10-20/month CloudWatch |
| Security essentials | HTTPS enforced on all external endpoints. Security group audit and tightening. Credentials rotation procedure executed and documented. Environment variable audit — no secrets in code or logs. SSH key management review. | Zero |
| JWT agent authentication ✅ | Keycloak `client_credentials` JWT auth for agents (ADR-002). Per-agent Keycloak client provisioned at registration. Agent Query Layer validates JWT (RS256/JWKS) on every MCP request. Session-bound identity replaces self-reported `agent_id`. Secret rotation and migration endpoints. 30-day deprecation mode. Complete April 16, 2026. | Zero |
| Domain 10 Workstream A — Self-serve infrastructure ✅ | Invitation flow (`identity.invitations`), email service abstraction (nodemailer + Mailhog dev / SES production), V15 migration (invitations, `organizations.governance_configs`), `RequireOrg` frontend gate, `@AllowNoOrg` decorator, Keycloak `provenance-admin` client for user attribute provisioning. Workstream B (notifications UI, admin dashboards, billing stubs) deferred. Complete April 2026. | Zero (dev: Mailhog container, ~free; prod: SES at $0.10 per 1k emails) |
| Data product completeness Priority 1 | Column-level schema, ownership/stewardship, freshness signals, and access status for requesting principal in get_product response. Data exists in platform today — this is API and MCP tool work only. | Zero |
| Agent anomaly detection | Behavioral pattern analysis against audit log. Configurable thresholds per trust classification. Temporal escalation workflows to human oversight contacts. Auto-suspension on sustained anomaly. Temporal and audit log already operational. | Zero |
| Developer experience | Local setup in under 30 minutes from clean clone on Mac and Linux. CONTRIBUTING.md. Comprehensive seed data. OpenAPI docs published. README reflects current state. | Zero |
| SOC 2 foundations | Data flow documentation. Access control documentation. Incident response runbook. Audit log export capability. Change management documentation. | Zero |

### Phase 6 — Production Scale (When Funded)

Phase 6 is triggered by enterprise customer requirements, investor funding, or both. It is not a calendar-driven phase. The architecture is designed so Phase 6 is a configuration migration, not a rewrite — every managed service upgrade is a connection string change.

| Activity | Description | Trigger |
| --- | --- | --- |
| Kubernetes / EKS migration | Extract monolith to microservices. Write Kubernetes manifests and Helm charts. Deploy to EKS with auto-scaling. | Engineering team scale or customer SLA requires it |
| Managed database migration | PostgreSQL → Aurora Serverless v2. Neo4j → Neptune or AuraDB. Redpanda → MSK. OpenSearch → Amazon OpenSearch Service. | Customer database reliability SLA |
| Temporal Cloud | Migrate from self-hosted Temporal. | Workflow engine managed SLA required |
| Security hardening | VPC private subnets. mTLS via App Mesh. WAF. KMS customer-managed keys. Penetration testing. | Enterprise security requirements or compliance audit |
| Multi-AZ and DR | Cross-region Aurora replication. Neptune snapshot automation. RTO/RPO definitions. | Customer data residency or DR requirements |
| Full observability stack | Datadog APM + Logs + Infrastructure. | Engineering team scale requires it |
| CloudFront CDN | Global edge for React SPA. | Global performance requirements |
| Formal SOC 2 Type II audit | Formal engagement with auditor. | Enterprise sales requirement |
| Keycloak HA | Keycloak on EKS with HA config, or migrate to Auth0/Okta. | Identity provider uptime SLA |

---

## Section 6: Technology Decision Register

| Decision | Choice | Alternatives Considered | Rationale | Revisit Trigger |
| --- | --- | --- | --- | --- |
| Graph Database | Neo4j (MVP) → Neptune (prod) | Amazon Neptune from day one; TigerGraph; PostgreSQL recursive CTEs | Neo4j Community is free and best-documented. Neptune is zero-migration upgrade. | If Neo4j AuraDB pricing becomes prohibitive |
| Policy Engine | Open Policy Agent (OPA) | Casbin; Cedar (AWS); SpiceDB | Industry standard. Hot-reload via bundle API. | If Rego becomes a maintenance burden |
| Message Broker | Redpanda (MVP) → MSK (prod) | RabbitMQ; SQS/SNS; Pulsar; pure Kafka | Redpanda is Kafka-compatible with lower MVP operational overhead. | If Redpanda introduces licensing changes |
| Workflow Engine | Temporal | AWS Step Functions; Airflow; custom PostgreSQL state machine | Handles durable long-running workflows. Also used for discovery scheduling. | If Temporal Cloud pricing becomes significant |
| Frontend Framework | React + TypeScript + TailwindCSS | Vue.js; Svelte; Angular; Next.js | Highest Claude Code familiarity. Shared types with backend via monorepo. | No strong revisit trigger |
| NL Query Translation | Claude API (claude-sonnet-4-20250514) | GPT-4o; local Llama; rule-based parser | Natural choice for an Anthropic-protocol platform. | If cost at scale becomes prohibitive |
| MCP Implementation | @modelcontextprotocol/sdk (official TypeScript) | Custom implementation; Python MCP SDK | Reference implementation. Guarantees spec compliance. | No revisit trigger — always use official SDK |
| Semantic Embeddings | sentence-transformers (self-hosted) | OpenAI Embeddings API; AWS Bedrock Titan | Free, fast enough, avoids per-embedding API cost at scale. | If embedding quality is insufficient for agent discovery accuracy |
| **Lean Phase 5 Strategy** | **Open Source Ready on existing infrastructure** | **Full managed services migration as Phase 5** | **Provenance is an open source platform pre-revenue and pre-investment. A $2,400-8,000/month infrastructure jump is not appropriate at this stage. The architecture is designed so managed services migration (Phase 6) is a configuration change, not a rewrite. Phase 6 is triggered by customers or funding, not a calendar date.** | **When first enterprise customer or funding round requires it** |
| **Agent Authentication (ADR-002)** | **Keycloak `client_credentials` JWT per agent (Phase 5)** | **X-Agent-Id header (Phase 4 MVP); shared API key** | **Each agent gets a dedicated Keycloak client at registration. JWT validated on every MCP request. Identity is cryptographic, not self-reported. Supersedes X-Agent-Id pattern. See ADR-002.** | **Resolved — implemented Phase 5 (April 16, 2026)** |
| **Two OpenSearch Index Strategy** | **Separate semantic (kNN) and keyword (BM25) indices** | **Single index with both field types; unified index with embedding fallback** | **Semantic and keyword search have different refresh patterns, query paths, and failure modes. Separate indices provide clean isolation and independent scaling. The MCP tools that use each index are distinct.** | **No revisit trigger** | **Synchronous crawl on registration; direct database writes from crawler** | **Temporal provides durable crawl execution with retries. Kafka decouples crawl output from downstream consumers. Synchronous crawl is viable MVP fallback if Temporal overhead is too heavy.** | **If Temporal adds unacceptable latency to connector registration** |
| **Discovery Conflict Resolution** | **Domain-declared takes precedence; governance-configurable auto-override** | **Last-write-wins; always-override discovered; manual merge only** | **Domain teams are authoritative source of truth for their products. Governance override is the escape valve without making override the default.** | **No revisit trigger** |
| **Connection Reference Composition and Enforcement Strategy** | **Compose with access grants (AND relationship); enforce via in-memory cache at Agent Query Layer; OPA for governance-authored rules only** | **Replace access grants; OPA for all enforcement; synchronous PostgreSQL query per action** | **Connection references answer a different governance question than access grants at a different cadence. Conflating them loses audit clarity. In-memory cache with Redpanda invalidation satisfies NF12.3 (10-second revocation) without PostgreSQL hot-path load. OPA is reserved for policy questions, not per-reference data lookups. See ADR-005, ADR-006, ADR-007.** | **If per-org active references exceed ~50,000 (cache size) or if governance teams require scope match decisions in OPA decision logs (scope match can be moved to OPA with cached reference as input)** |

---

## Section 7: Claude Code Implementation Guidance

### Repository Structure

```
provenance-platform/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── organizations/
│   │       ├── products/
│   │       ├── connectors/
│   │       │   ├── connectors.module.ts
│   │       │   ├── discovery/
│   │       │   │   ├── crawl.service.ts
│   │       │   │   ├── conflict-resolution.service.ts
│   │       │   │   └── coverage-score.service.ts
│   │       │   └── adapters/
│   │       │       ├── databricks.adapter.ts
│   │       │       ├── dbt.adapter.ts
│   │       │       ├── snowflake.adapter.ts
│   │       │       └── fivetran.adapter.ts
│   │       ├── governance/
│   │       ├── lineage/
│   │       ├── observability/
│   │       ├── access/
│   │       └── notifications/
│   ├── agent-query/
│   ├── embedding/
│   └── web/
├── packages/
│   ├── types/
│   ├── openapi/
│   ├── sdk-ts/
│   ├── sdk-python/
│   └── policy/
├── infrastructure/
├── documents/
├── CLAUDE.md
└── README.md
```

### Claude Code Effective Patterns

| Pattern | Description | Why It Matters for Claude Code |
| --- | --- | --- |
| OpenAPI spec first | Define the API spec in packages/openapi/ before writing any implementation. Generate types, client SDKs, and validation from the spec. | Claude Code generates accurate implementations when given a precise spec. |
| Database migrations as schema definition | Write Flyway migration files as the authoritative schema definition before writing TypeORM entities. | Claude Code generates accurate TypeORM entities from migration files. |
| Test as specification | Write failing tests before implementation. Describe behavior in test names, not comments. | Claude Code writes implementations that pass tests reliably. |
| Environment-based configuration | All configuration via environment variables. No hardcoded values. Use Zod for env validation at startup. | Claude Code generates portable code when configuration is externalized. |
| Explicit module interfaces | Every NestJS module exports a typed interface. Cross-module calls use the interface, not the implementation. | Claude Code respects module boundaries when they are explicit TypeScript interfaces. |
| ADR for every significant decision | Architecture Decision Records in documents/architecture/adr/. Numbered, dated, with context, decision, and consequences. | Claude Code reads ADRs and makes consistent decisions within established patterns. |
| Seed data as documentation | Comprehensive seed dataset covering all entity types and lifecycle states. | Claude Code builds features against concrete examples. |
| **Capability manifests are immutable per version** | **Never mutate a capability manifest in place. Create a new connector version with an updated manifest.** | **Prevents inconsistency between stored coverage scores and connector capabilities. Bugs here corrupt coverage reporting.** |
| **Discovery never auto-overrides without governance configuration** | **Always check governance_config.auto_discovery_override before applying discovered metadata over domain-declared values.** | **Protects domain team authority. This check must never be bypassed.** |

### What to Build vs. What to Configure

**Build from scratch (this is our differentiation):**

* Governance policy UI (Policy Authoring Studio)
* Trust score computation algorithm
* Data product definition validation logic
* Port contract enforcement engine
* Semantic change declaration model
* Agent provenance envelope builder
* Provenance-specific MCP tools and prompts (9 tools as of Phase 4)
* Non-determinism lineage markers
* Federated query planner and executor
* Connector discovery engine (crawl orchestration, delta detection, Kafka result pipeline)
* Capability manifest validation and enforcement
* Discovery coverage scoring per metadata category per connector
* Discovery conflict detection and resolution workflow
* Agent trust classification enforcement and transition logic
* Frozen state management (Temporal workflow state, governance disposition)
* Audit log query API (filter layer — agent_id, event_type, time range, principal_type)

**Configure from open source (do not reinvent):**

* OPA Rego policy evaluation
* Neo4j graph schema and Cypher queries
* Keycloak realm configuration and OIDC flows
* Temporal workflow definitions for governance processes and discovery scheduling
* OpenSearch index mapping and query DSL
* Kong plugin configuration for rate limiting and auth
* Redpanda topic configuration and consumer groups
* Docker Compose and Terraform infrastructure
* sentence-transformers model selection and serving
* **Databricks SDK, Snowflake Node.js driver, Fivetran REST API clients — use official SDKs; build thin adapters around them**

---

## Section 8: Architecture Summary

### MVP Architecture in One View

| Dimension | Choice |
| --- | --- |
| Primary cloud | AWS (with Activate startup credits) |
| Compute (MVP) | 2x EC2 instances (~$155/month) |
| Deployment model (MVP) | Docker Compose → NestJS monolith with module boundaries |
| Primary language | TypeScript (NestJS + React). Python for embedding service only. |
| Graph database | Neo4j Community (self-hosted on EC2) |
| Relational database | PostgreSQL 16 (self-hosted on EC2) |
| Message broker | Redpanda (Kafka-compatible, self-hosted) |
| Policy engine | Open Policy Agent (OPA sidecar) |
| Search | OpenSearch (single-node) — two indices: `data_products` (kNN semantic) + `provenance-products` (BM25 keyword) |
| Identity | Keycloak (self-hosted) |
| Workflow engine | Temporal (self-hosted) — governance workflows, discovery scheduling, frozen state |
| API gateway | Kong OSS |
| Agent interface | MCP server SSE on port 3002 — 9 tools (official TypeScript SDK) |
| Semantic search | all-MiniLM-L6-v2 (384 dimensions) + OpenSearch kNN, cosine similarity, nmslib/HNSW |
| Embedding service | Python FastAPI, port 8001 |
| NL query translation | claude-sonnet-4-20250514, 5s timeout, graceful fallback |
| Agent authentication | Keycloak `client_credentials` JWT per agent (ADR-002) |
| Discovery engine | Temporal-orchestrated crawls, Kafka result pipeline, per-connector adapters (Databricks, dbt, Snowflake, Fivetran) |
| Build status | Phases 1–4 complete. **Phase 5 (Open Source Ready) active. Est. additional cost: $10-30/month. Domain 12 (Connection References) planned - requirements complete (PRD v1.5), architecture complete (ADR-005 through ADR-008), implementation not yet started.** |
| Phase 6 trigger | First enterprise customer or funding round — Kubernetes, managed services, security hardening |

### Production Architecture in One View

| Dimension | Choice |
| --- | --- |
| Primary cloud | AWS |
| Compute | EKS with auto-scaling node groups (3x m6i.xlarge base) |
| Deployment model | Independent microservices on Kubernetes. Helm charts. GitOps via ArgoCD. |
| Graph database | Amazon Neptune Serverless or Neo4j AuraDB |
| Relational database | Amazon Aurora PostgreSQL Serverless v2 (Multi-AZ) |
| Message broker | Amazon MSK (Managed Kafka) |
| Policy engine | OPA on EKS (2 replicas, stateless) |
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
| --- | --- | --- |
| PostgreSQL on EC2 | Aurora PostgreSQL Serverless v2 | Low — connection string change + RLS policy review |
| Neo4j Community on EC2 | Amazon Neptune or Neo4j AuraDB | Low — same Cypher dialect, connection string change |
| Redpanda on EC2 | Amazon MSK | Low — Kafka-compatible API, configuration change |
| OpenSearch on EC2 | Amazon OpenSearch Service | Low — same REST API, index migration script |
| Temporal self-hosted | Temporal Cloud | Low — same SDK, namespace configuration change |
| MinIO on EC2 | Amazon S3 | Low — S3-compatible API, endpoint configuration change |
| Keycloak self-hosted | Keycloak on EKS (HA) | Low — realm export/import, HA configuration |
| Docker Compose | EKS + Helm charts | Medium — containerization is done; Kubernetes manifests to write |
| NestJS monolith | Independent microservices | Medium — module boundaries pre-defined; service extraction is mechanical |
| **Discovery engine (Connector API submodule)** | **Connector Service (independent microservice)** | **Low — already modular within Connector API; extraction is mechanical** |
