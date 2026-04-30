# Provenance Implementation Status

**Last updated:** April 24, 2026
**PRD version:** 1.5
**Active phase:** Phase 5 - Open Source Ready

This document tracks the implementation status of every requirement in the PRD. It is a living burndown checklist updated as Phase 5 progresses. The PRD is the authoritative requirements document; this document tracks what is built against it.

**Status key:**
- Implemented - fully built and verified working
- Partially implemented - built but incomplete or not verified end-to-end
- Not implemented - not yet built

**Open source readiness flags:**
- Blocker - must be resolved before presenting the platform as open source ready
- Post-launch - important but not required for initial open source release

---

## Domain 1: Multi-Tenancy and Organization Model

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F1.1 | Organization as Top-Level Tenant | Implemented | Multi-tenant isolation verified |
| F1.2 | Domain as First-Class Entity | Implemented | Domain CRUD working |
| F1.3 | Domain Namespacing | Implemented | Namespace model in place |
| F1.4 | Governance Layer as Distinct Entity | Implemented | Governance layer separation confirmed |
| F1.5 | Identity and Principal Model | Implemented | Four principal types supported |
| F1.6 | Role Assignment | Partially implemented | Role model exists; no UI for assignment (see F7.7) |
| F1.7 | Domain Autonomy Boundaries | Implemented | Cross-domain isolation enforced |
| F1.8 | Multi-Cloud Tenant Isolation | Implemented | Control/data plane separation enforced |
| F1.9 | Self-Service Org Onboarding | Implemented | Covered by F10.1 + F10.2 + F10.3 — Keycloak signup, `POST /organizations/self-serve` binding the first platform admin, and the invitation flow for adding collaborators. End-to-end onboarding of a new org and its initial team is now fully self-serve; Workstream A of Domain 10 shipped in Phase 5. |
| F1.10 | Domain Lifecycle Management | Partially implemented | Creation and active operation working; deprecation/decommission not implemented |
| NF1.1 | Cryptographic isolation | Implemented | |
| NF1.2 | Scale targets | Not implemented | Not load tested |
| NF1.3 | OIDC and SAML 2.0 | Implemented | Keycloak OIDC confirmed; SAML not verified |
| NF1.4 | Audit log retention | Implemented | Audit log append-only |
| NF1.5 | 99.99% availability | Not implemented | EC2 single instance; Phase 6 |

---

## Domain 2: Data Product Definition and Lifecycle

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F2.1 | Data Product as Governed Entity | Implemented | |
| F2.2 | Data Product Definition as Code | Implemented | Machine-readable definition in place |
| F2.3 | Governance-Configured Product Schema | Partially implemented | Schema exists; full configurability not verified |
| F2.4 | Domain-Level Schema Extension | Not implemented | Blocker - Open source readiness |
| F2.5 | Product Schema Versioning | Not implemented | |
| F2.6 | Ports as Definitional | Implemented | Publication blocked without ports |
| F2.7 | Port Types | Implemented | Five port types supported |
| F2.8 | Output Port Interface Types | Partially implemented | Port types defined; connection details field not enforced |
| F2.9 | Port Contract Enforcement | Partially implemented | Contract model exists; enforcement not fully verified |
| F2.10 | Input Port Dependency Declaration | Implemented | Lineage registered on input port declaration |
| F2.11 | Lifecycle States | Implemented | Draft/Published/Deprecated/Decommissioned |
| F2.11a | Lifecycle Transition Endpoints | Implemented | Deprecate and decommission endpoints with index removal |
| F2.11b | Mutable Fields on Published Products | Implemented | Name/description/tags mutable with auto re-index |
| F2.12 | Publication Requirements | Partially implemented | Most requirements enforced; connection details not yet required |
| F2.13 | Deprecation Process | Partially implemented | Endpoint exists; consumer notifications not implemented (Domain 11) |
| F2.14 | Deprecation Override | Not implemented | |
| F2.15 | Decommissioning Guard | Not implemented | |
| F2.16 | Semantic Versioning | Implemented | MAJOR.MINOR.PATCH enforced |
| F2.17 | Simultaneous Major Version Support | Not implemented | |
| F2.18 | Semantic Change Declaration | Not implemented | |
| F2.19 | Version Deprecation Schedule | Not implemented | |
| F2.20 | Classification as Mandatory Attribute | Implemented | |
| F2.21 | Classification Inheritance | Not implemented | |
| F2.22 | Governance-Configured Metadata | Partially implemented | DCAT baseline in place; full configurability not verified |
| F2.23 | Lineage Declaration | Implemented | |
| F2.24 | AI Provenance Metadata | Implemented | |

---

## Domain 3: Connectivity and Source Integration

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F3.1 | Connector as First-Class Entity | Implemented | |
| F3.2 | Connector Library | Partially implemented | Framework built; not all connectors implemented |
| F3.3 | Connector Extensibility | Partially implemented | SDK framework exists; capability manifest not implemented |
| F3.4 | Connector Validation | Implemented | Connectivity test on registration |
| F3.5 | Connector Health Monitoring | Partially implemented | Health monitoring exists; observability port propagation not verified |
| F3.6 | Credential Management | Implemented | Secrets Manager integration confirmed |
| F3.7 | Connector Scope Isolation | Implemented | |
| F3.8 | Source Registration | Implemented | |
| F3.9 | Schema Inference | Partially implemented | Inference for some connector types |
| F3.10 | Schema Drift Detection | Not implemented | |
| F3.11 | Source Lineage Registration | Implemented | Lineage node created on registration |
| F3.12 | Data Product as Input Source | Implemented | |
| F3.13 | Access-Gated Input Declaration | Not implemented | |
| F3.14 | Inter-Product Schema Propagation | Not implemented | |
| F3.15 | Inter-Product SLO Dependency | Not implemented | |
| F3.16 | Lineage Emission Endpoint | Implemented | |
| F3.17 | Lineage Emission SDK | Partially implemented | TypeScript SDK exists; Python/Java/Scala not complete |
| F3.18 | Observability Emission Endpoint | Implemented | |
| F3.19 | Webhook and Event Notification | Not implemented | |
| F3.20 | CI/CD Integration | Not implemented | |
| F3.21 | Semantic Query Port Registration | Implemented | MCP routing in place |
| F3.22 | Agent Source Discovery | Implemented | |
| F3.23 | Connector Discovery Mode | Not implemented | Phase 5 |
| F3.23a | Discovery Metadata Taxonomy | Not implemented | Phase 5 |
| F3.24 | Discovery Scope: Databricks | Not implemented | Phase 5 |
| F3.25 | Discovery Scope: dbt | Not implemented | Phase 5 |
| F3.26 | Discovery Scope: Snowflake | Not implemented | Phase 5 |
| F3.27 | Discovery Scope: Fivetran | Not implemented | Phase 5 |
| F3.28 | Discovery Re-crawl | Not implemented | Phase 5 |
| F3.29 | Discovery Conflict Resolution | Not implemented | Phase 5 |

---

## Domain 4: Governance Engine

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F4.1 | Governance as Computation | Implemented | OPA integration confirmed |
| F4.2 | Right Thing is Easy Thing | Partially implemented | In-authoring validation works; not verified across all flows |
| F4.3 | Governance Layer Separation | Implemented | |
| F4.4 | Declarative Policy UI | Implemented | Policy Authoring Studio built |
| F4.5 | Policy as Versioned Artifact | Implemented | |
| F4.6 | Policy Domains | Partially implemented | Some policy domains implemented; all eight not verified |
| F4.7 | Policy Rule Builder | Implemented | |
| F4.8 | Policy Impact Preview | Implemented | |
| F4.9 | Policy Grace Periods | Implemented | Temporal workflows for grace periods |
| F4.10 | Policy Templates | Partially implemented | Some templates exist; regulatory templates not complete |
| F4.11 | Global Policy Floor | Implemented | |
| F4.12 | Domain Policy Extensions | Partially implemented | Extension model exists; not fully verified |
| F4.13 | Effective Policy Computation | Implemented | |
| F4.14 | Extension Inheritance Transparency | Partially implemented | |
| F4.15 | Cross-Domain Policy Visibility | Not implemented | |
| F4.16 | Publication-Time Enforcement | Implemented | OPA evaluation at publication |
| F4.17 | Continuous Compliance Monitoring | Partially implemented | Monitoring exists; event-triggered near real-time not verified |
| F4.18 | Compliance State | Implemented | Four compliance states |
| F4.19 | Enforcement Actions | Partially implemented | Some actions implemented; Auto-Remediate not implemented |
| F4.20 | Governance Override | Partially implemented | Exception model exists; auto-expiry not verified |
| F4.21 | Classification Taxonomy Authoring | Implemented | |
| F4.22 | Classification-Driven Enforcement | Implemented | |
| F4.23 | Classification Change Governance | Partially implemented | |
| F4.24 | Governance Dashboard | Implemented | |
| F4.25 | Domain Compliance Reports | Not implemented | Blocker - Open source readiness |
| F4.26 | Audit Export | Not implemented | Phase 5.7 |

---

## Domain 5: Lineage and Observability

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F5.1 | Lineage as a Graph | Implemented | Neo4j graph operational |
| F5.2 | Lineage Node Types | Implemented | Six node types in graph |
| F5.3 | Lineage Edge Types | Implemented | Five edge types with source markers |
| F5.4 | Dual Lineage Assembly | Partially implemented | Declared and emitted working; discovered not implemented (Phase 5) |
| F5.5 | Lineage Completeness Scoring | Partially implemented | Score computed; governance threshold configuration not verified |
| F5.6 | Lineage Depth | Implemented | Arbitrary depth traversal |
| F5.7 | Cross-Domain Lineage | Implemented | |
| F5.8 | Emission Event Schema | Implemented | OpenLineage-aligned schema |
| F5.9 | Emission Authentication | Implemented | |
| F5.10 | Emission Idempotency | Implemented | Client-provided event ID deduplication |
| F5.11 | Batch and Streaming Emission | Implemented | |
| F5.12 | Agent Lineage Emission | Implemented | Agent provenance in lineage events |
| F5.13 | Lineage Drift Detection | Not implemented | |
| F5.14 | Lineage Graph API | Implemented | Upstream/downstream traversal, get_lineage MCP tool |
| F5.15 | Lineage Visualization | Not implemented | Blocker - D3 rejected; React Flow / Dagre required |
| F5.16 | Impact Analysis Workflow | Not implemented | |
| F5.17 | Lineage Time Travel | Not implemented | |
| F5.18 | Observability as a Port | Implemented | |
| F5.19 | Observability Metric Categories | Partially implemented | Some categories implemented; not all eight verified |
| F5.20 | SLO Declaration and Monitoring | Implemented | SLO health with trend data confirmed |
| F5.21 | Observability Emission | Implemented | |
| F5.22 | Consumer-Visible Observability | Implemented | |
| F5.23 | Observability Alerting | Not implemented | Blocker - depends on Domain 11 |
| F5.24 | Observability History | Partially implemented | 90-day retention not verified |
| F5.25 | Trust Score | Implemented | Composite trust score with breakdown confirmed |
| F5.26 | Agent Consumption Tracking | Implemented | Every MCP tool call logged |
| F5.27 | Non-Determinism Lineage Markers | Implemented | |
| F5.28 | Agent Observability Signals | Not implemented | |

---

## Domain 6: Agent Integration Layer

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F6.1 | Agent Identity as First-Class Principal | Implemented | |
| F6.2 | Agent Identity Registration | Implemented | register_agent MCP tool working |
| F6.3 | Agent Trust Classification | Implemented | Three tiers with behavioral definitions |
| F6.3a | Classification Transition Rules | Implemented | Transition rules enforced |
| F6.3b | Classification Scope | Implemented | Global scope with scope field ready |
| F6.3c | Frozen Operations on Downgrade | Implemented | Temporal frozen state |
| F6.3d | Audit Requirements for Classification Changes | Implemented | Audit log entries with reason field |
| F6.4 | Agent Identity Lifecycle | Implemented | |
| F6.5 | Model Version Binding | Implemented | |
| F6.6 | Human Oversight Requirement | Implemented | Oversight contact required; auto-suspend on contact deactivation not verified |
| F6.7 | Agent Access Grants | Partially implemented | Grant model exists; rate limits not enforced at infrastructure level |
| F6.8 | Agent Access Scope Enforcement | Partially implemented | Application-level enforcement; infrastructure-level not verified |
| F6.9 | Agent Access Policy | Not implemented | |
| F6.10 | Dynamic Access Evaluation | Partially implemented | Evaluated at query time; not all policy dimensions verified |
| F6.11 | Agent Activity Tracking and Audit Log Query API | Implemented | Audit log complete; query API with filters implemented |
| F6.12 | Semantic Query Interface | Implemented | |
| F6.13 | Query Protocol | Partially implemented | MCP and NL query working; GraphQL interface not verified |
| F6.14 | MCP Server Compliance | Implemented | 9 tools operational via SSE port 3002 |
| F6.15 | Query Planning | Implemented | |
| F6.16 | Policy-Aware Query Execution | Partially implemented | OPA integration; not all policy dimensions verified |
| F6.17 | Query Result Provenance | Implemented | Provenance envelope on query results |
| F6.18 | Cross-Product Join Semantics | Partially implemented | |
| F6.19 | Query Rate Limiting | Not implemented | |
| F6.20 | Query Result Caching | Not implemented | |
| F6.21 | Production-Capable Agent Registration | Implemented | |
| F6.22 | Agent-Produced Data Product Publication | Partially implemented | |
| F6.23 | Agent-Produced Product Ownership | Implemented | |
| F6.24 | Human Review Workflow | Not implemented | Blocker - Open source readiness |
| F6.25 | Agent Production Audit | Implemented | |
| F6.26 | Semantic Data Product Discovery | Implemented | semantic_search MCP tool working |
| F6.27 | Schema Exploration | Not implemented | get_product does not return schema (Phase 5) |
| F6.28 | Semantic Annotation | Not implemented | |
| F6.29 | Lineage-Aware Recommendation | Not implemented | |
| F6.30 | Version-Aware Consumption | Not implemented | |

---

## Domain 7: Self-Service Experience

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F7.1 | Unified Platform Shell | Implemented | |
| F7.2 | Persona-Adaptive Navigation | Partially implemented | Navigation adapts; not fully persona-segmented per v1.5 spec |
| F7.3 | Context Switching | Implemented | |
| F7.4 | Global Search | Implemented | |
| F7.5 | Notifications | Not implemented | Blocker - Domain 11 not implemented |
| F7.6 | Keyboard and Accessibility | Not implemented | WCAG 2.1 AA not verified |
| F7.7 | Role Assignment UI | Not implemented | Blocker - requires Keycloak console today |
| F7.8 | Progressive Disclosure | Partially implemented | |
| F7.9 | Empty States | Partially implemented | Some surfaces have empty states |
| F7.10 | Inline Contextual Help | Not implemented | |
| F7.11 | Confirmation and Consequence Surfacing | Partially implemented | Some destructive actions have confirmation |
| F7.12 | Responsive Design | Partially implemented | Desktop working; tablet not verified |
| F7.13 | Theme Support | Not implemented | |
| F7.14 | Domain Admin Dashboard | Implemented | Dashboard is primary domain admin surface |
| F7.15 | Data Product Authoring Interface | Implemented | |
| F7.16 | Port Configuration UI | Partially implemented | Port configuration exists; connection details completion indicator not implemented |
| F7.17 | Schema Editor | Partially implemented | Basic schema editing; guided experience not implemented |
| F7.18 | SLO Configuration UI | Implemented | |
| F7.19 | Connector Management UI | Partially implemented | Connector management exists; discovery coverage scores not surfaced |
| F7.20 | Product Lifecycle Management UI | Implemented | |
| F7.21 | Versioning UI | Partially implemented | Version history exists; MAJOR version workflow not fully implemented |
| F7.22 | Domain Team Management UI | Partially implemented | `apps/web/src/features/team/DomainTeamPage.tsx` renders members, pending invitations, and revoke — but reads org-scoped members, not domain-scoped (see comment at `DomainTeamPage.tsx:157`). Strict domain isolation of membership still requires Keycloak console. Tracked with F10.4. |
| F7.23 | Data Product Marketplace | Implemented | Marketplace operational |
| F7.24 | Faceted Search and Filtering | Partially implemented | Some filtering; true faceted filtering not implemented |
| F7.25 | Related Products and Join Recommendations | Not implemented | |
| F7.26 | Data Product Detail Page | Partially implemented | Basic detail page; missing schema, ownership, freshness, access status |
| F7.27 | Trust Score Transparency | Implemented | Trust score with breakdown confirmed |
| F7.28 | Access Request Workflow | Partially implemented | Request flow exists; SLA display and connection package not implemented |
| F7.29 | Access Request SLA and Escalation | Not implemented | Blocker - Open source readiness |
| F7.30 | Consumer Workspace | Partially implemented | Active grants visible; SLA countdown not implemented |
| F7.31 | Deprecation Impact Management | Not implemented | |
| F7.32 | Governance Command Center | Implemented | |
| F7.33 | Policy Authoring Studio | Implemented | |
| F7.34 | Rule Builder UX | Implemented | |
| F7.35 | Classification Taxonomy Manager | Implemented | |
| F7.36 | Compliance Drill-Down | Partially implemented | |
| F7.37 | Exception Management UI | Partially implemented | Exception model exists; auto-expiry display not verified |
| F7.38 | Domain Compliance Reports UI | Not implemented | |
| F7.39 | Access Request SLA Monitoring (Governance) | Not implemented | Depends on F7.29 |
| F7.40 | Agent Registry UI | Implemented | |
| F7.41 | Agent Activity Monitor | Implemented | |
| F7.42 | Human Review Queue | Not implemented | Blocker - Open source readiness |
| F7.43 | Agent Trust Classification UI | Implemented | |
| F7.44 | Frozen Operations Queue | Implemented | |
| F7.45 | Organization Administration | Partially implemented | Basic admin exists; role assignment requires Keycloak |
| F7.46 | Onboarding Experience | Not implemented | Blocker - depends on Domain 10 |
| F7.47 | Usage and Health Monitoring | Not implemented | |

---

## Domain 8: Operations and Workflow State

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F8.1 | Frozen Workflow State | Implemented | Temporal frozen state |
| F8.2 | Frozen State Trigger: Classification Downgrade | Implemented | |
| F8.3 | Frozen State Visibility | Implemented | Visible in governance command center |
| F8.4 | Frozen State Audit | Implemented | Audit log entries on frozen state transitions |

---

## Domain 9: Data Product Detail Completeness

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| Column-level schema (Priority 1) | Not implemented | Phase 5 - Blocker |
| Ownership and stewardship (Priority 1) | Not implemented | Phase 5 - Blocker |
| Data freshness signals (Priority 1) | Not implemented | Phase 5 - Blocker |
| Access status for requesting principal (Priority 1) | Not implemented | Phase 5 - Blocker |
| Data quality signals (Priority 2) | Not implemented | Phase 5 |
| Versioning and change history (Priority 2) | Not implemented | Phase 5 |
| Contractual and compliance (Priority 2) | Not implemented | Phase 5 |
| Volume and performance (Priority 2) | Not implemented | Phase 5 |

---

## Domain 10: Self-Serve Infrastructure

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F10.1 | Self-Service User Registration | Implemented | Keycloak user signup + login verified end-to-end on dev.provenancelogic.com |
| F10.2 | Organization Creation at Registration | Implemented | POST /organizations/self-serve binds org + platform_admin principal + seeds default governance layer; Keycloak attribute merge writes provenance_* claims onto the user so refreshed tokens carry them |
| F10.3 | Invitation Flow | Implemented | `POST /organizations/:orgId/invitations` in `apps/api/src/organizations/invitations.controller.ts` creates rows in `identity.invitations` (entity at `invitations/entities/invitation.entity.ts`), sends email via `apps/api/src/email/templates/invitation.ts`, accepted at public `POST /invitations/:token/accept` which binds `role_assignments` and Keycloak `provenance_*` attributes. Frontend acceptance at `apps/web/src/features/onboarding/AcceptInvitePage.tsx`, public route `/accept-invite`. Unit tests in `invitations.service.spec.ts` cover create/resend/accept. E2E tests not yet written. |
| F10.4 | Domain Team Self-Management | Partially implemented | Frontend UI present at `apps/web/src/features/team/DomainTeamPage.tsx` (route `/dashboard/:orgId/domains/:domainId/team`) — members tab, invitations tab, revoke action. Backend gap: members tab reads org-scoped `listMembers()` not domain-scoped (see code comment `DomainTeamPage.tsx:157` "preserved for future domain-scoped filters"), and revoke calls org-level `members.remove()`. Strict domain-isolated membership management still requires Keycloak console. Tracked with F7.22. |
| F10.5 | Connection Details Schema by Port Type | Implemented | Per-interface-type TypeScript + Zod schemas in `packages/types/src/products.ts` and `apps/api/src/products/connection-details.schemas.ts` (SQL/JDBC, REST, GraphQL, Kafka, File export). Backend validates on declare/update and rejects publication when output ports are missing details. Frontend `ConnectionDetailsFields` in `apps/web/src/features/publishing/ProductDetail.tsx` renders dynamic fields per interface type with required-field validation before submit. Semantic query endpoint is platform-populated — no user-facing schema. |
| F10.6 | Connection Details Confidentiality | Implemented | `EncryptionService` (AES-256-GCM, Secrets Manager ARN + dev-key fallback) at `apps/api/src/common/encryption.service.ts` encrypts at rest on port declare/update. `ProductEnrichmentService.disclosePortConnectionDetails` gates disclosure (owner/granted → full, authed-no-grant → redacted preview, unauth → null) and is called from both `get_product` and marketplace product detail. Marketplace `ConnectionDetailsPanel` renders the full credentials block (green) for grantees and a host/endpoint-only preview (gray, with "request access for full details") for non-grantees. End-to-end verified 2026-04-25 against dev across three personas — owner, authed-no-grant, granted-consumer — by hitting `GET /api/v1/organizations/:orgId/marketplace/products/:productId` with each principal's JWT and observing the expected `connectionDetails` vs `connectionDetailsPreview` shape; unit tests cover revoked / expired / no-port-details fallbacks. One adjacent SQL bug discovered while exercising the revoke transition: R-011 (broken `updated_at` trigger on `access_grants`) — fixed in V20. |
| F10.7 | Connection Details Validation | Partially implemented | `ConnectionProbeService` (`apps/api/src/products/connection-probes/`) dispatches per `(interfaceType, subkind)` to a registry of `ConnectionProbe` implementations. Real probes shipped 2026-04-25 for `rest_api` (HTTP GET, any HTTP response → success, network error → failure), `graphql` (POST `{ __typename }` introspection), and `streaming_topic` (kafkajs admin connect + listTopics, verifies declared topic exists). `sql_jdbc` and `file_object_export` return a typed `{ status: 'unsupported', message: '... mark validated manually ...' }` response (no longer a 501) — adding their probes is a one-call `registry.register(...)` because the contract supports `subkind` for postgres/mysql/snowflake and s3/gcs/adls. Successful probes persist `connectionDetailsValidated=true`; failure and unsupported leave it untouched. 10s default per-probe timeout. Frontend `ProbeStatusBadge` (`apps/web/src/features/publishing/ProductDetail.tsx`) renders the three-state enum with status-aware coloring: `success` → green "Reachable" + latency, `failure` → red "Unreachable", `unsupported` → slate "Not auto-validated". End-to-end verified 2026-04-25 across all four real-probe paths and the unsupported path. Remaining: per-driver SQL probes, per-storage file probes. |
| F10.8 | Connection Package Generation | Implemented | `ConnectionPackageService` at `apps/api/src/access/connection-package.service.ts` builds per-interface-type artifact bundles (JDBC URL + Python snippet + sample query + data dictionary for SQL/JDBC; curl + Postman + Python for REST; equivalent bundles for GraphQL, Kafka, and file exports). `AccessService.createGrant` and `approveRequest` call it and persist the payload to `access.access_grants.connection_package` (V17 migration). Grant responses surface the package. Agent integration guide (F10.9) attaches when any port is semantic. Failures in package generation log-and-continue so they never block grant issuance. |
| F10.9 | Agent Integration Package | Implemented | Generated inline by `ConnectionPackageService` whenever any output port on the product is `semantic_query_endpoint`. Guide carries MCP tool calls, an example prompt naming the product, and placeholders for trust score and governance policy version. Surfaced on the access grant response. |
| F10.10 | Connection Package Refresh | Implemented | `AccessService.refreshPackagesForProduct(orgId, productId)` enumerates active grants (revoked_at IS NULL AND not past expiry), regenerates the package via `ConnectionPackageService.generateForProduct`, and writes back per-grant with `packageVersion = (prior ?? 0) + 1`. `ProductsService.updatePort` calls it whenever the DTO carries `connectionDetails`; the call is best-effort wrapped in try/catch so a refresh failure cannot roll back the port edit. End-to-end verified 2026-04-25: created grant → packageVersion 1 with original host; PATCH'd port host → grant package auto-refreshed to packageVersion 2 with new host; description-only PATCH did not bump the version. Notification wiring (F11.27) remains for Domain 11. |
| F10.11 | Guided Schema Authoring | Not implemented | |
| F10.12 | Schema Import from Connector | Partially implemented | Basic import exists; guided experience not implemented |
| F10.13 | Schema Import from Upstream Product | Not implemented | |

---

## Domain 11: Notifications

Architecture decisions in ADR-009 (notification routing, channels, dedup, retry). Implementation phased per CLAUDE.md Domain 11 banner: PR #2 (this entry) lands the in-platform tier; email channel, webhook channel, preferences, notification center UI, and per-trigger wiring are subsequent PRs.

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F11.1 | Notification Service | Implemented | `NotificationsService.enqueue()` writes one row per recipient to `notifications.notifications` (V21). Recipients snapshotted at trigger time per ADR-009 §3. First trigger bundle (access — F11.6/7/8/9/10/11) wired in PR #7. Remaining trigger bundles in PRs #8–12 are additive callers; the service surface is stable. |
| F11.2 | Delivery Channels | Implemented | All three channels live: in-platform (the row itself), email (platform-wide `EmailService`), webhook (Node `fetch` with 10s `AbortController` timeout, https-only, posts stable `NotificationWebhookPayload` envelope). Per-org SMTP config deferred per ADR-009 note; HMAC signing of webhook bodies deferred. URL config at `notifications.principal_settings` (V24, per-principal not per-category — see ADR-009 implementation note). Same outbox + worker pipeline drains all out-of-band channels with NF11.3 retries (1m/5m/25m, 3 attempts then mark failed). |
| F11.3 | Notification Preferences | Implemented | Per-(principal, category) preferences with `enabled` opt-in/out and `channels[]` override at `notifications.principal_preferences` (V23). Resolution via `channel-resolver.ts` at enqueue time (see ADR-009 Implementation Notes for the deviation from "delivery time"). Governance-mandatory categories (`GOVERNANCE_MANDATORY_CATEGORIES`) keep at least the in-platform channel even when opted out. REST surface: `GET /organizations/:orgId/notifications/preferences`, `PUT /:category`, `DELETE /:category` (reset). Org-level defaults and per-principal webhook URL deferred (deferred per PR #4 bundle). |
| F11.4 | Notification Center UI | Implemented | Frontend shipped in PR #6 (branch `feat/notifications-frontend`). `NotificationBell` in the sidebar shows the unread badge and opens a drawer with the most recent inbox items + read/dismiss controls + deep links. `/notifications` route is the full inbox with category, unread, and dismissed filters. `/notifications/preferences` exposes per-category enable/channel-override controls and a webhook URL setting. Polls the inbox every 30s — matches the worker drain cadence so freshly written notifications appear within one tick. Backend REST already in place since PR #2. |
| F11.5 | Notification Deduplication | Implemented | `(orgId, recipient, category, dedupKey)` lookup over the configurable window (default 15 min, `DEFAULT_DEDUP_WINDOW_SECONDS`). Dedup hit increments `dedup_count` on the existing row instead of inserting; suppresses both the inbox row and any downstream channel send (ADR-009 §5). |
| F11.6 | Access Request Submitted | Implemented | Fired from `AccessService.submitRequest` to the product owner. Best-effort wrapper: notification failure does not roll back the request. |
| F11.7 | Access Request Approved | Implemented | Fired from `AccessService.approveRequest` to the requester with grant ID and expiry. |
| F11.8 | Access Request Denied | Implemented | Fired from `AccessService.denyRequest` to the requester with the denial reason. |
| F11.9 | Access Request SLA Warning | Implemented | `AccessNotificationsTriggerWorker` (every 5 min) scans pending requests where `requested_at <= now - 0.8 * APPROVAL_TIMEOUT_HOURS` and `sla_warning_sent_at IS NULL` (V25). Stamps the row on success so each request fires at most once. |
| F11.10 | Access Request SLA Breach | Implemented | Same worker scans pending requests past `APPROVAL_TIMEOUT_HOURS` with `sla_breach_notified_at IS NULL`. Recipients: product owner + governance team (`identity.role_assignments.role = 'governance_member'`), deduplicated when overlap. |
| F11.11 | Access Grant Expiring | Implemented | Same worker scans active grants where `expires_at` is within 14 days and `expiry_warning_sent_at IS NULL`. Stamps the grant on success. |
| F11.12 | Product Deprecated | Implemented | Fired from `ProductsService.deprecateProduct` to all active grantees of the product. Recipients resolved via `AccessService.listGranteesForProduct`. |
| F11.13 | Product Decommissioned | Implemented | Fired from `ProductsService.decommissionProduct` to all grantees including those whose grants were revoked within the past 90 days (per PRD wording). |
| F11.14 | Product Published | Not implemented | Deferred — requires a subscription / interest model that does not exist in the codebase yet. PRD wording: "principals who have subscribed to the publishing domain or have expressed interest in the product's classification or tags." Will be wired when the subscription primitive lands. |
| F11.15 | Schema Drift Detected | Not implemented | Deferred — there is no schema-drift detection code path in the codebase. The platform has compliance-state drift detection (governance domain) but nothing that compares port contract schemas across product versions. Will be wired when schema-drift detection itself ships. |
| F11.16 | SLO Violation | Implemented | Fired from `SloService.createEvaluation` when `passed = false`. Recipients: product owner. Date-bucketed `dedupKey` (`slo_violation:{sloId}:{YYYY-MM-DD}`) so a sustained breach collapses to one notification per day per SLO without preventing next-day repeats. Best-effort wrapper. |
| F11.17 | Trust Score Significant Change | Implemented | Fired at the end of `TrustScoreService.computeScore` after the new history row is saved. Compares against the score that was current 24 hours ago (most recent row at-or-before `now - 24h`); if no prior 24h-old history exists, no notification fires. Threshold: 0.10 absolute (the PRD-default 10 points on a 0–100 representation). Recipients: product owner ∪ active access-grant principals (deduped). Payload: prior/current score + band, delta, direction, primary driver (component with largest absolute change in `weighted_score`), product name. Date-bucketed `dedupKey` (`trust_score_significant_change:{productId}:{YYYY-MM-DD}`) collapses sustained shifts to one notification per recipient per day. Best-effort wrapper — never rolls back the history insert. |
| F11.18 | Connector Health Degraded | Implemented | Fired from `ConnectorsService.runProbeAndRecord` only on transition `validationStatus: valid → invalid` (not while continuously invalid; not on recovery). Recipients: domain owners (`role='domain_owner' AND domain_id=connector.domainId`). Per-connector `dedupKey` so flapping in/out of invalid within the dedup window collapses. Best-effort wrapper. |
| F11.19 | Policy Change Impact | Not implemented | Deferred — `GovernanceService.publishPolicyVersion` does not currently re-evaluate existing products. Detecting "policies that affect existing compliant products" requires that re-evaluation infrastructure to land first. |
| F11.20 | Compliance Drift Detected | Implemented | Fired from `GovernanceService.upsertComplianceState` on transition `compliant → non_compliant` (or any non-compliant value). Also fires when a fresh row starts non-compliant (no prior compliant state). Per-product `dedupKey` collapses repeated drifts within the dedup window; recovery + new drift fires fresh. Recipients: product owner. Best-effort wrapper. |
| F11.21 | Grace Period Expiring | Implemented | `GovernanceNotificationsTriggerWorker` (every 5 min) scans `governance.grace_periods` where `outcome='pending' AND expiry_warning_sent_at IS NULL AND ends_at` is within the next 7 days. Stamps `expiry_warning_sent_at` (V26) on success. Recipients: product owner. |
| F11.22 | Classification Changed | Not implemented | Deferred — `ProductsService.updateProduct` rejects classification changes on published products (`ConflictException` at the controller layer). The trigger has no real recipients to notify in the current model. Will be wired if/when classification becomes mutable post-publish. |
| F11.23 | Agent Classification Changed | Implemented | Fired from `AgentsService.updateClassification` after the new classification row is saved. Recipients: oversight contact (resolved from `agent.humanOversightContact` email → `identity.principals`) + governance team. Per-(agent, target classification) `dedupKey` collapses repeated changes to the same target within the dedup window. Best-effort wrapper. Falls back gracefully when the oversight contact email does not resolve to a platform principal — governance team still receives the notification, warning logged for operators. |
| F11.24 | Agent Suspended | Not implemented | Deferred — there is no agent auto-suspension code path in the codebase. Will be wired when the underlying suspension feature ships (Phase 5.5 anomaly detection per CLAUDE.md). |
| F11.25 | Human Review Required | Not implemented | Deferred — there is no human review queue in the codebase. PRD trigger requires "an Observed-class agent performs a consequential action requiring human review," which depends on the human review queue infrastructure that does not yet exist. Will be wired when the queue lands. |
| F11.26 | Frozen Operation Requires Disposition | Not implemented | Deferred — there is no frozen-operation state machine in the codebase. Domain 8 frozen-state work is referenced from Domain 12 (F12.19) but has not yet shipped. Will be wired when the state machine lands. |
| F11.27 | Connection Package Refreshed | Implemented | Fired from `AccessService.refreshPackagesForProduct` per refreshed grant. Recipients: grantee. Per-(grant, package version) `dedupKey` so a recipient sees one notification per actual version bump. PRD's "owning principal of the connection reference" recipient deferred until per-reference package refresh ships (ADR-008 follow-up). Best-effort wrapper. |

---

## Domain 12: Connection References and Per-Use-Case Consent

New in PRD v1.5. Introduces universal per-use-case consent and runtime scope enforcement for all agent access. A connection reference composes with (does not replace) the existing access grant: both must be active for any agent action against a product. **Partial as of 2026-04-24.** Depends on Domain 6 (Agent Integration Layer), Domain 8 (Operations and Workflow State), Domain 10 (Self-Serve Infrastructure), Domain 11 (Notifications). Architectural decisions in ADR-005 (composition), ADR-006 (runtime scope enforcement), ADR-007 (state propagation), ADR-008 (reference ↔ package relationship).

**Shipped in this window (2026-04-24):**

- **Data layer.** Migrations V18 (`consent.connection_references` + `consent.connection_reference_outbox`, RLS, indices, updated_at trigger) and V19 (per-reference `connection_package` JSONB column). TypeORM entities and shared `@provenance/types` definitions for the full entity, lifecycle states, cause markers, submit/approve/deny/revoke payloads, and paginated list.
- **State machine.** `ConsentService` implements request initiation with trust-classification gating (F12.9 — Observed cannot self-submit; Supervised/Autonomous may), approval with optional scope narrowing (F12.13), denial with immutable reason record (F12.12), principal-initiated revocation from active/suspended (F12.19), and automatic grant-revoke cascade (F12.21, one of the four triggers). Every mutation is transactional — row update + outbox event + audit-log entry land in one PostgreSQL transaction per CLAUDE.md and ADR-007.
- **Package at activation.** Approval now generates a per-reference connection package via `ConnectionPackageService` (ADR-008) and stores it on the row. Narrowing the package to the approved scope is deferred; the full product package is currently stored.
- **REST surface.** `ConsentController` exposes request / approve / deny / revoke / get / list under `/api/v1/organizations/{orgId}/consent/connection-references`. Guarded by `JwtAuthGuard` + `RolesGuard`; ownership precision enforced at the service row level. `packages/openapi/consent.yaml` validates clean (redocly).

**Deferred (explicit):**

- Supervised oversight-hold sub-state between submission and owner routing — requires the Domain 11 notification path.
- Governance override on activation (F12.14) and governance-initiated revocation (F12.20) — need a governance-role gate on the service.
- MAJOR-version suspension (F12.15) — Temporal workflow triggered by the product lifecycle event.
- Runtime scope enforcement at the Agent Query Layer (F12.16–F12.18, ADR-006) — the hot-path in-memory cache and its Redpanda consumer.
- Automatic expiration (F12.22) — Temporal expiration workflow with advance-notice notifications.
- Legacy-agent migration on enforcement activation (F12.25).
- Remaining F12.21 cascade triggers: product deprecation/decommission, agent lifecycle transitions, owning-principal deactivation.
- Per-reference scope filtering on the connection package (ADR-008 "Scope Inheritance") — requires extending the Domain 10 package contract.
- Outbox publisher worker, Redpanda topic wiring, and the AQL cache-invalidation consumer (ADR-007).
- Notification fan-out on every transition (F12.10, F12.19, F12.20 — depend on Domain 11).
- Frontend UI (domain admin dashboard for pending approvals, agent view for current status).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F12.1 | Connection Reference as Owned Entity | Partial | Schema + TypeORM entity landed in V18 (`consent.connection_references`). Service layer, API surface, state machine not yet implemented. |
| F12.2 | Connection Reference Lifecycle States | Partial | States encoded as CHECK constraint on the table; state-transition service logic not yet implemented. |
| F12.3 | Connection Reference Ownership | Partial | `owning_principal_id` column NOT NULL; app-layer immutability enforcement pending with service. |
| F12.4 | Connection Reference Expiration | Partial | `expires_at` column NOT NULL; Temporal expiration workflow and classification-based maximum enforcement not yet implemented. |
| F12.5 | Use-Case Declaration as Required Field | Partial | Schema fields NOT NULL; request/approval flow not yet implemented. |
| F12.6 | Use-Case Declaration Structure | Partial | Schema carries category, elaboration, scope, duration, optional constraints. Governance-configurable taxonomy and default 8-category seed not yet implemented. |
| F12.7 | Use-Case Declaration Preservation | Not implemented | Audit requirement |
| F12.8 | Agent Discovery of Connection Reference Status | Not implemented | Required for agent UX via MCP |
| F12.9 | Request Initiation by Trust Classification | Partial | `ConsentService.requestConnectionReference` implemented with trust-classification gating: Observed agents cannot self-submit (human proxy required); Supervised and Autonomous may self-submit. Writes reference, outbox event, and audit log atomically. REST endpoint `POST /organizations/{orgId}/consent/connection-references` live. Supervised oversight-hold sub-state and notification fan-out (F12.10) pending. |
| F12.10 | Request Routing and Notification | Implemented | Fired from `ConsentService.requestConnectionReference` after the reference is transactionally persisted. Recipient: product owner (`product.ownerPrincipalId`). Payload includes agent identity, trust classification at request time, full use-case declaration (category + elaboration + intended scope + data category constraints), requested duration, and computed `expiresAt`. Per-reference `dedupKey`. Best-effort wrapper. |
| F12.11 | Consent as an Immutable Record | Not implemented | Blocker — foundational audit primitive |
| F12.12 | Denial Record | Partial | `ConsentService.denyConnectionReference` implemented: transitions pending → revoked, captures `denial_reason` and `denied_by_principal_id`, writes audit + outbox atomically. Only the owning principal may deny; a non-null, non-empty reason is required. |
| F12.13 | Activation on Approval | Partial | `ConsentService.approveConnectionReference` transitions pending → active, sets approved_* fields (inheriting from the request when the approver makes no change, marking `modifiedByApprover` when narrowed), recomputes `expires_at` from the approved duration, generates the per-reference connection package (ADR-008) via `ConnectionPackageService.generateForProduct` and stores it on the row, writes audit + outbox atomically. Only the owning principal may approve. **Per-reference scope filtering on the package (ADR-008 "Scope Inheritance") still deferred** — the full product package is stored; narrowing to approved_scope requires extending the Domain 10 package contract. |
| F12.14 | Governance Override on Activation | Not implemented | |
| F12.15 | Version Behavior on Product Republication | Not implemented | MAJOR version auto-suspends active references |
| F12.16 | Use-Case Scope Enforcement | Not implemented | Blocker — real-time preventive enforcement at Agent Query Layer (ADR-006) |
| F12.17 | Behavioral Differences by Trust Classification at Runtime | Not implemented | Runtime enforcement of F6.3 behavior per tier |
| F12.18 | Connection Reference Verification in Provenance Envelopes | Not implemented | Extends F6.17 envelope |
| F12.19 | Principal-Initiated Revocation | Partial | `ConsentService.revokeConnectionReference` transitions active/suspended → revoked; only the owning principal may revoke; reason is required and recorded in the audit log (not on the row). Transactional outbox + audit. Frozen-state propagation for in-flight operations (F8.1 integration at the Agent Query Layer) deferred — the operations registry doesn't exist there yet. Notifications (Domain 11) deferred. |
| F12.20 | Governance-Initiated Revocation | Not implemented | |
| F12.21 | Automatic Revocation Triggers | Partial | `ConsentService.cascadeRevokeForGrant` implemented; wired into `AccessService.revokeGrant` so that revoking a grant automatically revokes all non-terminal connection references for that agent-product pair with `caused_by = 'grant_revocation_cascade'`. Idempotent. Product deprecation/decommission, agent lifecycle, and owning-principal deactivation triggers not yet wired. |
| F12.22 | Expiration Behavior | Not implemented | |
| F12.23 | Complete Audit Trail | Not implemented | Blocker — every state transition must be reconstructible from audit log alone |
| F12.24 | Scope Violation Logging | Not implemented | |
| F12.25 | Legacy Agent Migration on Enforcement Activation | Not implemented | Blocker — one-time legacy-compatibility provisioning to avoid immediate denial on rollout |
| NF12.1 | Consent capture latency (5s) | Not implemented | |
| NF12.2 | Runtime scope enforcement p95 overhead (+50ms cap) | Not implemented | |
| NF12.3 | Revocation propagation (10s) | Not implemented | |
| NF12.4 | Automatic expiration propagation (60s) | Not implemented | |
| NF12.5 | Audit trail completeness | Not implemented | |
| NF12.6 | Preventive scope violation detection (same-cycle) | Not implemented | |
| NF12.7 | Request notification delivery (30s) | Not implemented | Depends on Domain 11 |
| NF12.8 | MAJOR version suspension propagation (60s) | Not implemented | |

---

## Open Source Readiness Summary

### Blockers (must be resolved before open source ready)

1. **F5.15 Lineage Visualization** - React Flow / Dagre not implemented; D3 rejected
2. **F7.5 / Domain 11 Notifications** - Zero notification capability; access request flow, SLO violations, product deprecation all untriggered
3. **F7.7 Role Assignment UI** - Requires Keycloak console; not self-serve
4. **F7.22 Domain Team Management UI** - Partially implemented — UI exists but membership listing is still org-scoped; strict domain isolation requires Keycloak console (tracked with F10.4)
5. **F7.29 Access Request SLA and Escalation** - No SLA enforcement; no escalation path
6. **F7.42 Human Review Queue** - Observed-class agent actions have no review surface
7. **F7.46 Onboarding Experience** - No guided onboarding; depends on Domain 10 Workstream B
8. **Domain 10 Workstream B — Connection packages and schema authoring** - Mostly shipped. Connection details (F10.5), connection-details confidentiality (F10.6, end-to-end verified 2026-04-25), connection package generation (F10.8, F10.9), connection-package refresh on detail edit (F10.10, end-to-end verified 2026-04-25), and connectivity validation (F10.7, partial — REST/GraphQL/Kafka real probes plus typed `unsupported` response for SQL/JDBC and file_object_export) all implemented and deployed. Schema authoring items (F10.11–F10.13) untouched. Remaining: per-driver SQL probes (postgres/mysql/snowflake) and per-storage file probes (s3/gcs/adls) — additive, no blocker. Workstream A shipped earlier in Phase 5.
9. **Domain 9 Priority 1 completeness** - Column-level schema, ownership, freshness, access status not in get_product response. Agents and consumers cannot evaluate or use data products without this information.
10. **Domain 12 Connection References and Per-Use-Case Consent** - New in PRD v1.5. Universal per-use-case consent and runtime scope enforcement for all agent access; connection references compose with access grants and both must be active for any agent action. **Partial as of 2026-04-24** — data primitives (V18/V19), state-machine service (request / approve / deny / principal-revoke / grant-revoke cascade), REST surface at `/consent/connection-references`, and connection package emission at activation (ADR-008) have shipped. Runtime scope enforcement at the Agent Query Layer (ADR-006), automatic expiration (F12.22), governance override (F12.14/F12.20), MAJOR-version suspension (F12.15), legacy-agent migration (F12.25), outbox publisher, and notification fan-out (F12.10 — needs Domain 11) remain. Architectural decisions captured in ADR-005 through ADR-008.

### Post-Launch (important but not blocking)

- F2.4 Domain-level schema extension
- F2.14 Deprecation override
- F2.15 Decommissioning guard
- F3.23-F3.29 Connector discovery
- F4.25 Domain compliance reports
- F4.26 Audit export (Phase 5.7)
- F5.13 Lineage drift detection
- F5.16 Impact analysis workflow
- F5.17 Lineage time travel
- F5.23 Observability alerting (depends on Domain 11)
- F6.24 Human review workflow
- F6.27 Schema exploration in MCP
- F7.24 True faceted filtering
- F7.25 Related products and join recommendations
- F7.31 Deprecation impact management
- Domain 9 Priority 2 completeness items
