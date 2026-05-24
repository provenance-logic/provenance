# Provenance Implementation Status

**Last updated:** May 14, 2026
**PRD version:** 1.5
**Active phase:** Phase 5 - Open Source Ready
**Sequencing:** See [osr-roadmap.md](./osr-roadmap.md) for the active stage plan. This document is the per-feature truth; the roadmap is the priority and deferral truth. Where the two disagree, the roadmap wins for "what to do next" and this document wins for "what's built."

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
| F1.6 | Role Assignment | Implemented | Role model in `identity.role_assignments`; org-level assignment UI shipped via F7.7 with audit + Keycloak sync; domain-level assignment via the existing Domain Team page (F7.22). Platform-instance-scope roles (`platform_admin`, `platform_observer`) tracked as B-023 — out of scope for MVP (single-tenant-per-deployment); `org_admin` functions as Platform Admin. |
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
| F2.8a | Output Port Source Object Binding | **Implemented end-to-end (B-070 fully closed)** | Backend half closed 2026-05-23 (#179) — migration V33 added `source_registration_id UUID NULL REFERENCES connectors.source_registrations(id)` and `source_object_path TEXT NULL` to `port_declarations` with an index on the FK; entity / type / OpenAPI carry the fields; `ProductsService.declarePort`/`updatePort` validate same-org; `ProductEnrichmentService.resolveColumnSchema` consults the bound source's latest `schema_snapshot`; `freshness.lastRefreshedAt` populates from same. Producer UI closed 2026-05-23 (#183) — new `SourceBindingPicker` component on `AddPortForm` (collapsible "Bind to a discovered source" section); two-step picker (connector → source) with path auto-fill from `sourceRef`; `connectorsApi.listSources` client method; 5 new Vitest tests. **Deferred follow-ups** (not in B-070's strict scope): auto-populate `contractSchema` + `connectionDetails` from the bound snapshot at form time (UI polish on top of the picker); per-port join table for multi-source ports (post-OSR per anchor-decisions doc 4); edit-time binding once a port-edit UI surface exists. |
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

> **Status warning (2026-05-21; reconciled by PRD v1.6 work 2026-05-23).** This domain's "Implemented" entries were the most actively misleading in the doc prior to the PRD v1.6 reshape. The 2026-05-23 work (#173 + step 1 of B-063 — enum cut migration V32) reconciled the framing: F3.2 now names PG + S3 + Databricks as the first-class set; F3.2a codifies the tranche discipline for adding more. Snowflake is the next scheduled tranche. See [B-063](../bugs/open.md#B-063).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F3.1 | Connector as First-Class Entity | Implemented | |
| F3.2 | Connector Library | **Implemented** | postgresql ✅ (probe+schema), s3 ✅ (probe+schema), databricks ✅ (probe+schema+discovery+lineage, shipped 2026-05-21 #142–#146). 9 previously-advertised types retired by V32 (B-063 step 1) — the enum, registration UI, and CHECK constraint now expose only the 3 that work end-to-end. Snowflake next per F3.2a. |
| F3.2a | Connector Tranche Discipline | **Implemented** | New requirement landed with the 2026-05-23 PRD v1.6 work. Enforcement is structural: `ConnectorType` enum is the gate (TypeScript exhaustiveness in `ConnectorProbeService.probe()` / `inferSchema()` fails the build if a new value is added without a probe branch); migration V32 tightens the CHECK constraint to match. New types ship by extending the enum + migration + adding capability manifest + adding probe/inferSchema branches + adding UI dropdown option — partial-ship is not possible without failing the build. |
| F3.3 | Connector Extensibility | **Partially implemented** | Capability manifest table + service shipped 2026-05-21 (#145, V31). Read-only API. Seeded for Databricks 1.0.0 only; PG and S3 have no manifest yet (their probes/inference are implemented but the manifest declarations haven't been backfilled). |
| F3.4 | Connector Validation | **Implemented** | Real probe for postgresql, s3, databricks — the only three connector types in the library after V32. |
| F3.5 | Connector Health Monitoring | Partially implemented | Health-event recording exists; observability port propagation not verified |
| F3.6 | Credential Management | Implemented | Secrets Manager integration confirmed; `local-env:VARNAME` sentinel added 2026-05-21 #142 for laptop dev |
| F3.7 | Connector Scope Isolation | Implemented | |
| F3.8 | Source Registration | Implemented | |
| F3.9 | Schema Inference | **Partially implemented (3 of 12 types real)** | postgresql ✅, s3 ✅, databricks ✅ (Unity Catalog, #143). Others return empty `{}`. |
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
| F3.23 | Connector Discovery Mode | **Implemented for Databricks (the one shipped first-class connector per F3.2)** | Databricks discovery crawl framework shipped 2026-05-21 #144 (V30 `discovery_crawl_events` table + walker + `POST /connectors/:id/crawl`). Auto-crawl on registration shipped #145. Snowflake (next tranche) and PG / S3 (no discovery primitive) per F3.2 / F3.2a. |
| F3.23a | Discovery Metadata Taxonomy | **Partially implemented** | `capability_manifests.capabilities_doc` JSONB carries per-category coverage levels (Databricks: structural=high, descriptive=medium, operational=low, quality=none, governance=low). `discovery_coverage_scores` table referenced by CLAUDE.md not yet created. |
| F3.24 | Discovery Scope: Databricks | **Substantively implemented 2026-05-21** | Layers 1–4 shipped via PRs #142–#146. Live-verified end-to-end against a real workspace: 10 tables, 10 schema snapshots, 9 lineage edges into Neo4j. Deferred: column-level lineage (Layer 4b), push-side notebook (Layer 5), Temporal scheduled re-crawls (Layer 3c), legacy hive-metastore fallback. |
| ~~F3.25~~ | ~~Discovery Scope: dbt~~ | **Removed from PRD** | Deferred per OS3.7 — dbt is a metadata source rather than a data source; planned post-OSR re-framing into a separate "metadata source" category. |
| F3.26 | Discovery Scope: Snowflake | **Planned — next tranche under F3.2a** | information_schema introspection + access_history lineage. Cross-org consumption via Snowflake data shares per Domain 10. Scheduled as the first tranche addition after OSR-set close. |
| ~~F3.27~~ | ~~Discovery Scope: Fivetran~~ | **Removed from PRD** | Deferred per OS3.7 — same logic as dbt; planned post-OSR re-framing. |
| F3.28 | Discovery Re-crawl | **Not implemented (manual + on-registration only)** | Auto-crawl on connector registration (#145) and operator-triggered re-crawl (`POST /connectors/:id/crawl`, #144) ship. Scheduled / cadenced re-crawl per the manifest's `re_crawl_interval_hours_default` would require Temporal — deferred. |
| F3.29 | Discovery Conflict Resolution | Not implemented | CLAUDE.md describes the rule ("Domain-declared metadata takes precedence over discovered metadata unless governance configures auto-override"); no enforcement code exists. Discovered-but-conflicting metadata isn't currently flagged. |

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
| F5.15 | Lineage Visualization | Implemented | React Flow + Dagre per ADR-003. Deterministic left-to-right DAG layout (sources on the left, focal product in the middle, downstream consumers on the right). Card-style nodes show name, type pill (Source / DataProduct / Port / Transformation / Agent / Consumer), and trust score when present in metadata. Edge labels are humanized ("derives from", "transforms", "consumes", "depends on", "supersedes"); low-confidence edges render dashed. Built-in pan, zoom, fit-view, and a per-type-colored minimap. Read-only graph (`nodesDraggable=false`, `nodesConnectable=false`) so the deterministic Dagre layout stays the source of truth. Replaces the previous Cytoscape implementation. ADR-003 follow-ups not yet shipped: expand/collapse at any node, PNG/SVG export, time-travel snapshot mode (F5.17). |
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
| F7.5 | Notifications | Implemented | Domain 11 fully shipped — all 27 PRD trigger requirements wired or explicitly deferred behind upstream features (subscription model, schema-drift detection, classification post-publish mutability, auto-suspension, human review queue, frozen-state machine). See the Domain 11 section below for per-trigger detail. |
| F7.6 | Keyboard and Accessibility | Not implemented | WCAG 2.1 AA not verified |
| F7.7 | Role Assignment UI | Implemented | Org-level Roles page at `/dashboard/:orgId/roles` lists members grouped by principal with their org-level role pills, supports assigning to an existing member or inviting by email at a chosen role, and per-role revoke (new `DELETE /organizations/:orgId/members/:principalId/roles/:role`). Every role mutation writes an audit-log row and syncs to Keycloak (new `KeycloakAdminService.removeRealmRoles` sibling of `assignRealmRoles`). Two deferrals: `platform_admin`/`platform_observer` role types (B-023, MVP treats `org_admin` as Platform Admin); governance-acknowledgment gate on `governance_member` assignment (B-024, audit-only governance for v1). |
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
| F7.22 | Domain Team Management UI | Implemented | `DomainTeamPage` now reads domain-scoped members via `GET /organizations/:orgId/domains/:domainId/members`, supports assigning an existing org member to a domain role via `POST .../domains/:domainId/members`, and revokes per-(principal, domain, role) via `DELETE .../domains/:domainId/members/:principalId/roles/:role`. Every mutation writes an audit-log row carrying the domainId, and Keycloak realm-role binding is idempotent across scopes (only added when not held elsewhere, only removed when no longer held anywhere). Team link added from DomainDashboard so the page is reachable without URL knowledge. |
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
| F7.46 | Onboarding Experience | Implemented | Inline first-run wizard at the top of `/dashboard` with five steps (confirm org, invite team, register connector, publish product, invite agent) backed by a new `identity.principal_preferences` table + `GET/PATCH /me/preferences`. Steps are skippable individually; the wizard as a whole is dismissible and resumable. All five steps wire to live destinations as of 2026-05-15: org summary, OrgRolesPage (F7.7), ConnectorsPage (B-025 closed in #98), NewProductForm via the first available domain, and AgentsPage (B-026 closed in #97). The "Sample data" affordance attached to the confirm-org step (B-027 closed in #100) seeds one domain + two products + ports + an SLO + notifications via a role-and-env-flag-gated `POST /organizations/:orgId/sample-data`. Once the user marks all five steps done/skipped the wizard never auto-opens again. |
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

> **Status reconciled 2026-05-22.** The four P1 rows below previously read "Not implemented — Phase 5 - Blocker," which directly contradicted the "Recently-resolved OSR-track work" entry crediting PRs #43/#45/#46/#47 for shipping P1 completeness. The reconciliation: the summary was right; this table was stale. Verified against `apps/api/src/products/product-enrichment.service.ts` and `apps/web/src/features/discovery/ProductDetailPage.tsx`. Surfaced by the claim-vs-code audit (`documents/audits/claim-vs-code-2026-05-22.md`).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| Column-level schema (Priority 1) | Implemented (via port contracts) | `PortsTab` at `ProductDetailPage.tsx:541-562` renders a real columns table extracted from `port.contractSchema` via `extractFieldsFromContract` — field name, type, required, description. Port contract schemas became real JSON Schema definitions in PR #46. **Note:** the *connector-discovered* path via `ProductEnrichmentService.resolveColumnSchema` returns null pending a product-to-source-registration FK — that's a follow-up enrichment, not a P1 gap; consumers see columns today via declared contracts. |
| Ownership and stewardship (Priority 1) | Implemented | `ProductEnrichmentService.resolveOwner` + `resolveDomainTeam` return real principal + domain + lead data; `OverviewTab` Ownership panel renders product owner + email + domain team name + lead at `ProductDetailPage.tsx:145-169`. Wired in PR #47. |
| Data freshness signals (Priority 1) | Partial | `resolveFreshness` queries the latest active SLO declaration of `sloType='freshness'` and its most recent evaluation; `FreshnessPanel` (`ProductDetailPage.tsx:209-`) renders Within-SLO/Stale status + sloType + measuredValue + evaluatedAt. Sufficient signal for a consumer to judge whether the data is current per the producer's declared SLO. **Stub remaining:** `lastRefreshedAt` is hardcoded to null in the service; UI falls back to "Not yet observed." Populating it requires tying connector lineage emission or source-registration timestamps into the freshness payload. Not OSR-blocking; the SLO-based path delivers visible freshness signal today. |
| Access status for requesting principal (Priority 1) | Implemented | `resolveAccessStatus` resolves to granted / pending / denied / not_requested with grantedAt + expiresAt; `AccessTab` renders the status at `ProductDetailPage.tsx:595, 654-658`. |
| Data quality signals (Priority 2) | Not implemented | Phase 5 |
| Versioning and change history (Priority 2) | Not implemented | Phase 5 |
| Contractual and compliance (Priority 2) | Not implemented | Phase 5 |
| Volume and performance (Priority 2) | Not implemented | Phase 5 |

---

## Domain 10: Self-Serve Infrastructure

> **PRD reframe note (2026-05-23).** F10.5, F10.6, F10.7, F10.8, F10.10 were reframed in the PRD v1.6 work to align with [ADR-011](../architecture/adr/ADR-011-configuration-brokerage.md)'s configuration-brokerage commitment. The substantive requirement: connection details capture *configuration* (host, catalog name, authentication method *declaration*) — never *user credentials*. An implementation review should inspect `apps/api/src/products/connection-details.schemas.ts` to confirm the per-interface-type Zod schemas capture method declarations only and that no credential material is stored in the connection-details payload; if any field captures a credential, plan a migration to remove it as part of the consumer-grade outbound work. The F10.14-F10.19 requirements are NEW work added by the same PRD v1.6 reshape; status entries below reflect implementation reality (none implemented yet except F10.17 partial via #166).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F10.1 | Self-Service User Registration | Implemented | Keycloak user signup + login verified end-to-end on dev.provenancelogic.com |
| F10.2 | Organization Creation at Registration | Implemented | POST /organizations/self-serve binds org + platform_admin principal + seeds default governance layer; Keycloak attribute merge writes provenance_* claims onto the user so refreshed tokens carry them |
| F10.3 | Invitation Flow | Implemented | `POST /organizations/:orgId/invitations` in `apps/api/src/organizations/invitations.controller.ts` creates rows in `identity.invitations` (entity at `invitations/entities/invitation.entity.ts`), sends email via `apps/api/src/email/templates/invitation.ts`, accepted at public `POST /invitations/:token/accept` which binds `role_assignments` and Keycloak `provenance_*` attributes. Frontend acceptance at `apps/web/src/features/onboarding/AcceptInvitePage.tsx`, public route `/accept-invite`. Unit tests in `invitations.service.spec.ts` cover create/resend/accept. E2E tests not yet written. |
| F10.4 | Domain Team Self-Management | Implemented | Shipped jointly with F7.22 (2026-05-14). Domain owners can invite by email, assign an existing org member to a domain role, and revoke per-role — all without Keycloak console access. Audit trail per mutation. Keycloak realm-role bindings are idempotent across scopes since Keycloak does not carry domain-scope (F10.4 acknowledges this; the Provenance app enforces domain scope at the API layer). |
| F10.5 | Connection Details Schema by Port Type | Implemented | Per-interface-type TypeScript + Zod schemas in `packages/types/src/products.ts` and `apps/api/src/products/connection-details.schemas.ts` (SQL/JDBC, REST, GraphQL, Kafka, File export). Backend validates on declare/update and rejects publication when output ports are missing details. Frontend `ConnectionDetailsFields` in `apps/web/src/features/publishing/ProductDetail.tsx` renders dynamic fields per interface type with required-field validation before submit. Semantic query endpoint is platform-populated — no user-facing schema. |
| F10.6 | Connection Details Confidentiality | Implemented | `EncryptionService` (AES-256-GCM, Secrets Manager ARN + dev-key fallback) at `apps/api/src/common/encryption.service.ts` encrypts at rest on port declare/update. `ProductEnrichmentService.disclosePortConnectionDetails` gates disclosure (owner/granted → full, authed-no-grant → redacted preview, unauth → null) and is called from both `get_product` and marketplace product detail. Marketplace `ConnectionDetailsPanel` renders the full credentials block (green) for grantees and a host/endpoint-only preview (gray, with "request access for full details") for non-grantees. End-to-end verified 2026-04-25 against dev across three personas — owner, authed-no-grant, granted-consumer — by hitting `GET /api/v1/organizations/:orgId/marketplace/products/:productId` with each principal's JWT and observing the expected `connectionDetails` vs `connectionDetailsPreview` shape; unit tests cover revoked / expired / no-port-details fallbacks. One adjacent SQL bug discovered while exercising the revoke transition: R-011 (broken `updated_at` trigger on `access_grants`) — fixed in V20. |
| F10.7 | Connection Details Validation | Partially implemented | `ConnectionProbeService` (`apps/api/src/products/connection-probes/`) dispatches per `(interfaceType, subkind)` to a registry of `ConnectionProbe` implementations. Real probes shipped 2026-04-25 for `rest_api` (HTTP GET, any HTTP response → success, network error → failure), `graphql` (POST `{ __typename }` introspection), and `streaming_topic` (kafkajs admin connect + listTopics, verifies declared topic exists). `sql_jdbc` and `file_object_export` return a typed `{ status: 'unsupported', message: '... mark validated manually ...' }` response (no longer a 501) — adding their probes is a one-call `registry.register(...)` because the contract supports `subkind` for postgres/mysql/snowflake and s3/gcs/adls. Successful probes persist `connectionDetailsValidated=true`; failure and unsupported leave it untouched. 10s default per-probe timeout. Frontend `ProbeStatusBadge` (`apps/web/src/features/publishing/ProductDetail.tsx`) renders the three-state enum with status-aware coloring: `success` → green "Reachable" + latency, `failure` → red "Unreachable", `unsupported` → slate "Not auto-validated". End-to-end verified 2026-04-25 across all four real-probe paths and the unsupported path. Remaining: per-driver SQL probes, per-storage file probes. |
| F10.8 | Connection Package Generation | Implemented | `ConnectionPackageService` at `apps/api/src/access/connection-package.service.ts` builds per-interface-type artifact bundles (JDBC URL + Python snippet + sample query + data dictionary for SQL/JDBC; curl + Postman + Python for REST; equivalent bundles for GraphQL, Kafka, and file exports). `AccessService.createGrant` and `approveRequest` call it and persist the payload to `access.access_grants.connection_package` (V17 migration). Grant responses surface the package. Agent integration guide (F10.9) attaches when any port is semantic. Failures in package generation log-and-continue so they never block grant issuance. |
| F10.9 | Agent Integration Package | Implemented | Generated inline by `ConnectionPackageService` whenever any output port on the product is `semantic_query_endpoint`. Guide carries MCP tool calls, an example prompt naming the product, and placeholders for trust score and governance policy version. Surfaced on the access grant response. |
| F10.10 | Connection Package Refresh | Implemented | `AccessService.refreshPackagesForProduct(orgId, productId)` enumerates active grants (revoked_at IS NULL AND not past expiry), regenerates the package via `ConnectionPackageService.generateForProduct`, and writes back per-grant with `packageVersion = (prior ?? 0) + 1`. `ProductsService.updatePort` calls it whenever the DTO carries `connectionDetails`; the call is best-effort wrapped in try/catch so a refresh failure cannot roll back the port edit. End-to-end verified 2026-04-25: created grant → packageVersion 1 with original host; PATCH'd port host → grant package auto-refreshed to packageVersion 2 with new host; description-only PATCH did not bump the version. Notification wiring (F11.27) remains for Domain 11. |
| F10.11 | Guided Schema Authoring | Not implemented | |
| F10.12 | Schema Import from Connector | Partially implemented | Basic import exists; guided experience not implemented |
| F10.13 | Schema Import from Upstream Product | Not implemented | |
| F10.14 | Catalog Name as User-Facing Primitive | **Implemented end-to-end (Phase 5.11 closed 2026-05-24)** | Backend closed 2026-05-24. Migration V36 adds `port_declarations.catalog_name TEXT NULL`. `Port` type / OpenAPI / DeclarePortRequest / UpdatePortRequest carry the field; `ProductsService` accepts it. **Snippet integration:** `buildSnippet` extended with a `catalogRef` parameter resolved per the precedence rule `catalogName > sourceObjectPath > schema.<table> placeholder`. `buildSqlJdbcPython` now emits a sample `SELECT * FROM <catalogRef> LIMIT 10;`. `buildSqlJdbcDbt` emits a commented `source('<profile>', '<catalogRef>')` hint when catalogRef is set. Power BI `.pbids` and Tableau `.tds` keep referencing the `database` field at the snippet level — consumers navigate to the view inside Power BI/Tableau after connecting (the source-side view IS the catalog name they see). **Endpoint:** `GET /organizations/:orgId/products/:productId/ports/:portId/source-view-ddl` (owner-only via service-layer ownership check; not cross-org) returns the `CREATE OR REPLACE VIEW <catalog_name> AS SELECT * FROM <source_object_path>;` DDL the producer pastes into their source system. Returns typed `reason` for unsupported_interface_type / missing_catalog_name / missing_source_object_path cases. Per Constraint 3, the platform never executes the DDL. 12 tests pin the resolution + DDL generation behavior. **Frontend closed 2026-05-24:** producer "Catalog name" text input in `AddPortForm` (optional, pattern-validated for SQL-identifier safety); `marketplaceApi.products.sourceViewDdl()` added to the client; "Copy source view DDL" button on each output `PortCard` (only renders when both `catalogName` and `sourceObjectPath` are set; clipboard-copies the DDL the backend returns; owner-only enforced server-side); consumer-side `PortsTab` in `ProductDetailPage.tsx` surfaces the catalog name above the description as a monospace badge — that is the identifier the consumer pastes into their tools. **Deferred:** `.pbids` / `.tds` embedding of the view name (per-source identifier rules); DDL emission for non-PG/Snowflake/Databricks SQL variants; view governance (drift detection, schema enforcement). |
| F10.15 | Situation Detection per Port | **Partially implemented — declaration layer (1 of 3) + consumer-side UI integration done** | Layer 1 (producer declaration) shipped 2026-05-23. Migration V34 adds `port_declarations.situation_a_eligibility BOOLEAN NOT NULL DEFAULT false` (with a partial index on open-access ports). `Port` type / OpenAPI / DeclarePortRequest / UpdatePortRequest carry the flag; `ProductsService.declarePort`/`updatePort` accept it. New `ConnectionPackageService.resolveSituationForPort` returns `{situation: 'A' \| 'B', recommendedNext: 'view_snippet' \| 'request_access', callerHasActiveGrant, declaredSituationAEligible}` — A when port declared open-access; B otherwise, with view_snippet if caller has a grant (or is the owner) and request_access otherwise. New `PortSituationController` mounts `GET /organizations/:orgId/products/:productId/ports/:portId/situation` with `@AllowCrossOrgRead`. Producer-side UI: new "Open to all source-system users" checkbox in `AddPortForm`. **Consumer-side UI integration (added 2026-05-23):** `SnippetPicker` on the marketplace product detail page calls `/situation` once per port; new `SituationBanner` component renders one of three states above the destination dropdown — Open access (emerald), Access granted (blue), Access required (amber). **F10.6 → F10.15 interaction:** `generateSnippetForPort` extended to bypass the grant gate when the port is Situation-A-eligible (the connection details aren't sensitive in the F10.6 sense for open-access ports — consumer uses their own credentials anyway). 12 tests pin the full flow (8 service-layer + 4 banner). **Remaining:** Layer 2 (probe-based verification — per-source-type non-side-effecting probe that catches mis-declarations); Layer 3 (directory integration / Situation C detection — deferred indefinitely per OS10.4). |
| F10.16 | Cross-Org Consumption Primitives per Source Type | Not implemented | New requirement landed with the 2026-05-23 PRD v1.6 work. Snowflake shares + Delta Sharing as primary cross-org primitives; S3 via bucket-policy; PG = contact-the-owner only. Anchored by anchor-decisions doc 6b. |
| F10.17 | Destination Snippet Generation | **Implemented for sql_jdbc across all 6 destinations; Python real for all 6 interface types** | `ConnectionPackageService.generateSnippetForPort` shipped 2026-05-22 (#166); Power BI added 2026-05-23 (#180); **Tableau added 2026-05-23 — Phase 5.10 complete for sql_jdbc.** Six destinations live: Python (all 6 interface types), dbt (sql_jdbc), sql_client + jdbc (sql_jdbc), **power_bi (sql_jdbc)**, **tableau (sql_jdbc)**. Tableau emits a `.tds` XML the consumer saves and double-clicks — Tableau Desktop launches with server / database / authentication-method pre-filled; class picked from host pattern (postgres / snowflake / databricks_aws / mysql). XML-escapes special characters in product slug + connection fields. Frontend tool-picker dropdown in `PortsTab` displays all 6 destinations. Remaining: integration with F10.14 catalog-name addressing; integration with F10.15 situation routing; databricks `.pbids` + `.tds` enrichment with SQL-warehouse path (needs a `warehousePath` field on the connection-details contract). |
| F10.18 | Connection Test from the Connect Flow | Not implemented | New requirement landed with the 2026-05-23 PRD v1.6 work. Runs as consumer's identity; never persists the consumer credential per ADR-011. Distinct from F10.7 publication-time reachability check. |
| F10.19 | Credential Lifespan UX | **Implemented end-to-end (backend + consumer renewal CTA)** | Backend half closed 2026-05-24 (#186). Frontend renewal CTA closed 2026-05-24. **Backend:** Migration V35 + 7d worker tier + `AccessService.renewGrant` + new POST endpoint (see #186 for the full write-up). **Frontend:** `ProductAccessStatus` now carries `grantId` (Uuid \| null) when status='granted' (avoids an extra grant-list roundtrip); `accessApi.grants.renew(orgId, grantId)` client method; `AccessTab` on the marketplace product detail page renders a "Renew access" button alongside the "You have access" card when the grant has a non-null `expiresAt` and `grantId`; on click, branches on `mode` — `auto_renewed` shows the new expiry date inline; `approval_required` shows "Renewal request sent…"; either case reloads the product so accessStatus reflects the new state. **Path from the notification inbox:** the existing `deepLink` on the expiry-warning notifications already routes to `/marketplace/products/:productId` — the AccessTab Renew button is the consumer's next click; no per-notification inline button needed. **Remaining for OSR:** none. Possible enhancement: per-organization configurable warning thresholds (14d / 7d are hardcoded constants today). |

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

New in PRD v1.5. Introduces universal per-use-case consent and runtime scope enforcement for all agent access. A connection reference composes with (does not replace) the existing access grant: both must be active for any agent action against a product. **Runtime enforcement shipped 2026-05-13** — `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true` is now the default on the Agent Query Layer. Depends on Domain 6 (Agent Integration Layer), Domain 8 (Operations and Workflow State), Domain 10 (Self-Serve Infrastructure), Domain 11 (Notifications). Architectural decisions in ADR-005 (composition), ADR-006 (runtime scope enforcement), ADR-007 (state propagation), ADR-008 (reference ↔ package relationship). Implementation plan in `documents/architecture/plans/domain-12-runtime-enforcement.md`.

**Runtime-enforcement arc shipped 2026-05-13 across PRs #77–#86:**

- **#77 (P0)** — locked the `ConnectionReferenceScope` payload shape (`{ ports: string[] }`) and `DataCategoryConstraints` shape (`{ allowed_categories?: string[] }`) per Decision 1.
- **#78 (PR #4)** — `scope-match.ts` pure-function subset check + `tool-scope-map.ts` (5 exempt MCP tools, 4 product-bound, unknown-tool safety belt).
- **#79 (PR #2)** — internal control-plane endpoints `/api/v1/internal/consent/connection-references/active` (cold-load) + `/active/lookup` (cache miss) with `InternalServiceGuard` + `AQL_INTERNAL_TOKEN`.
- **#80 (PR #1)** — outbox publisher worker drains `consent.connection_reference_outbox` to Redpanda topic `connection_reference.state` (1s tick, FOR UPDATE SKIP LOCKED, partition key = org_id).
- **#81 (PR #3)** — AQL in-memory `ConnectionReferenceCache` + `AccessGrantCache` (24h TTL), Redpanda consumer keeping the connection-ref cache aligned with state events, cold-load on boot via the internal endpoint.
- **#82 (PR #5a)** — internal active-grant lookup endpoint `/api/v1/internal/access/grants/active/lookup` for access-grant cache-miss fallback.
- **#83 (PR #5b)** — `ConnectionReferenceGuard` wired into the MCP tool dispatch path with all five denial codes (`ACCESS_GRANT_NOT_FOUND`, `CONNECTION_REFERENCE_NOT_FOUND`, `CONNECTION_REFERENCE_SUSPENDED`, `CONNECTION_REFERENCE_EXPIRED`, `CONNECTION_REFERENCE_SCOPE_VIOLATION`) plus `UNKNOWN_TOOL` safety belt; audit log row on every denial.
- **#84 (PR #5c)** — scope-violation notification fan-out via new `connection_reference_scope_violation` notification category; recipients = owning principal + every `governance_member` in the org; governance-mandatory.
- **#85 (F12.25)** — legacy-agent migration endpoint `POST /api/v1/internal/consent/legacy-agent-migration`. Provisions 30-day non-renewable legacy refs for existing agent-product grants without active refs; idempotent; V28 migration extends the `caused_by` CHECK constraint with `legacy_migration`; new notification category `connection_reference_legacy_provisioned`.
- **#86 (PR #6)** — flipped `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED` default to `true`. Fresh deployments enforce by default; shadow mode is opt-in. Upgrade runbook for existing installations: run F12.25 endpoint before deploy.

**Deferred (explicit — not OSR blockers):**

- Supervised oversight-hold sub-state between submission and owner routing.
- Governance override on activation (F12.14) and governance-initiated revocation (F12.20) — need a governance-role gate on the service.
- MAJOR-version suspension (F12.15) — Temporal workflow triggered by the product lifecycle event.
- Automatic expiration (F12.22) — Temporal expiration workflow with advance-notice notifications.
- Behavioral differences by trust classification at runtime (F12.17) and provenance-envelope verification (F12.18) — extend the existing Domain 6 paths.
- Remaining F12.21 cascade triggers: product deprecation/decommission, agent lifecycle transitions, owning-principal deactivation.
- Per-reference scope filtering on the connection package (ADR-008 "Scope Inheritance") — requires extending the Domain 10 package contract.
- Agent self-discovery of reference status (F12.8) via a new MCP tool.
- Frontend UI distinguishing legacy refs from properly requested refs (the data carries `caused_by` and a distinctive use-case category; the UI renders them the same today).

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| F12.1 | Connection Reference as Owned Entity | Implemented | V18 schema + entity + `ConsentService` state machine + REST surface. Audit trail captured by `audit.audit_log` writes on every transition. |
| F12.2 | Connection Reference Lifecycle States | Implemented | Pending / Active / Suspended / Expired / Revoked encoded as CHECK constraint; `ConsentService` enforces legal transitions; Expired and Revoked are terminal. |
| F12.3 | Connection Reference Ownership | Implemented | `owning_principal_id` NOT NULL; only the owning principal may approve / deny / revoke (enforced at the service row level). |
| F12.4 | Connection Reference Expiration | Partial | `expires_at` NOT NULL on every row; legacy-migration references use a 30-day default. **Deferred:** the automatic-expiration Temporal workflow (F12.22) and classification-based maximum enforcement. |
| F12.5 | Use-Case Declaration as Required Field | Implemented | Schema fields NOT NULL; `useCaseCategory` and `purposeElaboration` (≥50 chars) required at submit; Zod validation rejects malformed shape per PR #77's locked schema. |
| F12.6 | Use-Case Declaration Structure | Partial | Schema carries category, elaboration, scope (`{ ports: string[] }`), duration, optional constraints (`{ allowed_categories?: string[] }`). **Deferred:** governance-configurable taxonomy and the default 8-category seed. |
| F12.7 | Use-Case Declaration Preservation | Implemented | Approval preserves the original `intendedScope` alongside `approvedScope`; `modifiedByApprover` flagged on narrowing; audit row records every transition's `newValue` snapshot. |
| F12.8 | Agent Discovery of Connection Reference Status | Not implemented | No MCP tool today for an agent to query its own reference status. Deferred — not an OSR blocker; the guard returns distinct denial codes that agents can route on. |
| F12.9 | Request Initiation by Trust Classification | Implemented | `ConsentService.requestConnectionReference` with trust-classification gating: Observed cannot self-submit (human proxy required); Supervised and Autonomous may. Transactional write + outbox + audit. **Deferred:** Supervised oversight-hold sub-state. |
| F12.10 | Request Routing and Notification | Implemented | Fan-out to product owner with full use-case declaration in the payload; per-reference `dedupKey`. |
| F12.11 | Consent as an Immutable Record | Implemented | Every state transition writes an `audit.audit_log` row in the same transaction as the row update + outbox event. The full state of the reference at transition time is reconstructible from audit alone. |
| F12.12 | Denial Record | Implemented | `ConsentService.denyConnectionReference` transitions pending → revoked, captures `denial_reason` + `denied_by_principal_id`, transactional. Owner-only; non-null reason required. |
| F12.13 | Activation on Approval | Partial | Owner-only approval transitions pending → active, sets approved_* fields (inheriting or narrowing), recomputes `expires_at`, generates a per-reference connection package, transactional. **Deferred:** per-reference scope filtering on the package (ADR-008 "Scope Inheritance"). |
| F12.14 | Governance Override on Activation | Not implemented | Deferred — needs a governance-role gate at activation time. Not an OSR blocker. |
| F12.15 | Version Behavior on Product Republication | Not implemented | Deferred — MAJOR-version-triggered auto-suspension requires the product lifecycle event consumer + Temporal workflow. |
| F12.16 | Use-Case Scope Enforcement | Implemented | `ConnectionReferenceGuard` runs on every product-bound MCP tool call; checks active grant + active reference + scope-match via `matchesApprovedScope`; five distinct denial codes per Decision 3 plus the `UNKNOWN_TOOL` safety belt. ADR-006 fully realised. |
| F12.17 | Behavioral Differences by Trust Classification at Runtime | Not implemented | Deferred — extends Domain 6 F6.3 runtime path. Not an OSR blocker. |
| F12.18 | Connection Reference Verification in Provenance Envelopes | Not implemented | Deferred — extends F6.17 envelope. Not an OSR blocker. |
| F12.19 | Principal-Initiated Revocation | Implemented | Owner-only revocation transitions active/suspended → revoked; required reason recorded in audit; transactional outbox + audit. **Deferred:** frozen-state propagation for in-flight operations (F8.1 integration at the AQL — operations registry doesn't exist there yet). |
| F12.20 | Governance-Initiated Revocation | Not implemented | Deferred — needs a governance-role gate on the revocation path. Not an OSR blocker. |
| F12.21 | Automatic Revocation Triggers | Partial | Grant-revoke cascade implemented (`ConsentService.cascadeRevokeForGrant` wired into `AccessService.revokeGrant`). **Deferred:** product deprecation/decommission, agent lifecycle, and owning-principal deactivation cascades. |
| F12.22 | Expiration Behavior | Not implemented | Deferred — needs Temporal expiration workflow with advance-notice notifications. Not an OSR blocker. |
| F12.23 | Complete Audit Trail | Implemented | Every state transition writes audit + outbox + row in the same transaction. Denial paths additionally write a `connection_reference_denied` audit row carrying deny_code + deny_reason + enforcement_mode. Legacy provisioning writes `connection_reference_legacy_provisioned`. |
| F12.24 | Scope Violation Logging | Implemented | Every `CONNECTION_REFERENCE_SCOPE_VIOLATION` deny writes an audit row AND fans out a `connection_reference_scope_violation` notification to owning principal + every governance member (governance-mandatory). Runs regardless of enforcement mode. |
| F12.25 | Legacy Agent Migration on Enforcement Activation | Implemented | `POST /api/v1/internal/consent/legacy-agent-migration` provisions 30-day non-renewable legacy refs for every existing agent-product grant without an active reference. Idempotent. `caused_by='legacy_migration'` (V28 migration extends the CHECK). Fan-out via new `connection_reference_legacy_provisioned` category. |
| NF12.1 | Consent capture latency (5s) | Not measured | Architecture allows sub-second under normal load; no formal measurement run. |
| NF12.2 | Runtime scope enforcement p95 overhead (+50ms cap) | Not measured | Cache hit path is one Map lookup + pure scope-match. No formal latency benchmark. |
| NF12.3 | Revocation propagation (10s) | Not measured | Outbox publisher 1s tick + Redpanda delivery + consumer set — well within budget on paper. No formal end-to-end measurement. |
| NF12.4 | Automatic expiration propagation (60s) | Not implemented | Tied to F12.22 (deferred). |
| NF12.5 | Audit trail completeness | Implemented | Every transition + every denial writes an audit row inside the same transaction as the state change. Reconstructible from audit alone. |
| NF12.6 | Preventive scope violation detection (same-cycle) | Implemented | The guard runs before the tool handler dispatches; denied requests never reach the handler when enforcement is on. |
| NF12.7 | Request notification delivery (30s) | Implemented | Inherits from Domain 11 delivery path; sub-second in-platform; email subject to SMTP/SES. |
| NF12.8 | MAJOR version suspension propagation (60s) | Not implemented | Tied to F12.15 (deferred). |

---

## Open Source Readiness Summary

### Blockers (must be resolved before open source ready)

> **Correction posted 2026-05-21.** The previous version of this section said "active OSR blocker list is empty." That was wrong by the standard Matt restated at the end of the 2026-05-21 session: *"For this to be real, every single one of those connectors needs to actually work. EVERY ONE. This is not open source ready."* B-063 — connector framework is register-only beyond PG/S3/Databricks — was filed during the same session, elevated to **Blocker**, and is now the sole active OSR blocker. The whole "OSR blockers resolved + Stage 5 polish" framing below is preserved for context; the 2026-05-24 weekend PRD overhaul will reconcile.

**Active OSR blockers (as of 2026-05-21):**

- **[B-063](../bugs/open.md#B-063) — Connector framework completeness.** 3 of 12 advertised connector types do something meaningful (PG + S3 + Databricks); the other 9 register with synthetic-healthy fakery. The weekend conversation needs to decide whether OSR ships with all 12 implemented (~8–16 weeks of work per the Databricks lift), with a narrowed PRD scope, or with the unimplemented types hidden until they're real.

**Recently-resolved OSR-track work (preserved from the prior summary — accurate against the codebase, NOT a defense of the "OSR-ready" framing):**

F5.15 Lineage Visualization (#55, React Flow + Dagre per ADR-003), F7.5 / Domain 11 Notifications (12 trigger-bundle PRs + frontend + F11.17), Domain 9 Priority 1 completeness (P1 enrichment rendering #47 + lifecycle visibility #45 + real port contract schemas #46 + cross-org Request Access guard #43), Domain 10 Workstream B (mostly — F10.7 partial-but-deployed), Domain 12 Connection References and Per-Use-Case Consent — runtime enforcement shipped across PRs #77–#86, F7.7 Role Assignment UI, F7.22 / F10.4 Domain Team Management completion, and F7.46 Onboarding Experience. All five F7.46 wizard steps wire to real destinations as of 2026-05-15 via PRs [#97](https://github.com/provenance-logic/provenance/pull/97), [#98](https://github.com/provenance-logic/provenance/pull/98), [#100](https://github.com/provenance-logic/provenance/pull/100). Operational hardening: [#96](https://github.com/provenance-logic/provenance/pull/96), [#99](https://github.com/provenance-logic/provenance/pull/99).

**Tonight's 2026-05-21 session shipped 10 PRs:** B-060 parts 1+2 (operator tooling — softReset and demo-smoke-test), B-061 (cross-org information leak filing + JwtAuthGuard fix), and B-063 Layers 1–4 for Databricks (the first connector type to ship end-to-end). See [resolved.md](../bugs/resolved.md) for per-PR detail.

**2026-05-22 session shipped 12 PRs:** claim-vs-code audit (#148) + Domain 9 P1 reconciliation (#149) + B-060 verifier half (#150, seed-verifier CI job — closes the simpler half of B-060) + filed and closed B-064/B-065/B-066/B-067 same night across #151, #152, #153 + frontend bug fixes B-005 (#154), B-008 (#155), B-006 (#156) + connector lift survey (#157, per-type estimates reframing B-063 Option 1 from 8-16 weeks to ~41-86 hours) + ADR-010 RLS-by-default design pass (#158, Proposed status, closes the architectural question for B-062) + frontend test infrastructure (#159, Vitest + React Testing Library + jsdom + first test file pinning B-066 regression coverage). Net effect: low-severity bug count 10 → 7; medium-severity B-060 and B-062 both have meaningful progress without yet closing; two strategic input docs on main going into the 2026-05-24 weekend overhaul. See [resolved.md](../bugs/resolved.md) for per-PR detail.

**Deferred post-launch (no shame):**

- **F7.29 Access Request SLA and Escalation** — SLA notification triggers shipped in Domain 11 (F11.9 / F11.10); no SLA enforcement timer at the access-grant layer and no escalation path beyond the breach notification. Acceptable v1 per osr-roadmap "with no shame" deferral list.
- **F7.42 Human Review Queue** — Observed-class agent actions have no review surface. Only matters when Supervised agents are in active use, which is not an OSR launch capability. Documented as post-launch.

### Phase 5.6 (Developer Experience) — substantially shipped as of 2026-05-08

Shipped:
- **B-009 OpenSearch BM25 reliability** (#52) — synchronous double-write to `provenance-products` on every publish/update/decommission, plus a one-shot `pnpm reindex:search` command for backfill after dev resets. Marketplace keyword search no longer silently returns empty results when the broker queue resets.
- **In-product API reference** (#53) — `GET /api/v1/docs` serves an index of all 12 domain specs; `/api/v1/docs/:spec` renders Redoc; `/api/v1/docs/specs/:name.yaml` returns raw YAML. Reads from `packages/openapi/` at request time.
- **Working seed CLI** (#54) — eight idempotent `/api/v1/seed/*` endpoints behind `SeedGuard` (constant-time token check + `SEED_ENABLED` flag, 404 in production). `pnpm --filter @provenance/seed seed` now runs end-to-end and populates 2 orgs / 9 domains / 17 principals / 8 policies / 16 published products / 27 ports / 2 agents / 86 lineage emissions.
- **2026-05-07/08 fresh-laptop onboarding arc** (#65–#72) — 13 first-run blockers (B-010 through B-022) found by walking the README on a fresh Apple Silicon MacBook and all resolved. Container Node base-image bump 20 → 22 (#74). The fresh-laptop walkthrough is now the validated OSR test methodology.
- **Frontend test infrastructure** (#159) — Vitest + React Testing Library + jsdom + jest-dom matchers set up from scratch on `apps/web` (zero frontend tests existed before). New `test-web` CI job in `.github/workflows/ci.yml` mirrors the existing `test-api` shape. First test file at `apps/web/src/features/agents/AgentDetailPage.test.tsx` pins the B-066 ReferencesTab rendering (6 tests, ~23s CI run). Documented pattern for new contributors: prefer leaf-component extraction over full-page mounts that need router/auth/API mocking. Bigger page-level tests (ProductDetail, DomainDashboard) deferred until mocking infrastructure is worth investing in.
- **Seed-verifier CI** (#150) — closes the verifier half of B-060. `pnpm seed:verify:soft-reset` runs on push to main + PRs touching migrations/seed against a freshly-migrated Postgres + minimal fixture. Catches softReset SQL drift on the PR that introduces it. The full-stack smoke-test CI integration (the other B-060 half) is the deferred remaining piece.

Remaining (deferred to Stage 5 polish per [osr-roadmap.md](./osr-roadmap.md)):
- Final "under 30 minutes following only the README" timing run on a virgin contributor laptop. The May 7/8 arc found bugs against an intermediate state; no clean re-measurement has been done on a post-fix virgin laptop because the only available Apple Silicon hardware is the one the May 7/8 run used.

Newly shipped (2026-05-02):
- **Lineage emit idempotency** — `EmitLineageEventRequest.idempotency_key` plus a unique partial index on `(org_id, idempotency_key)` lets re-runs (seed, pipeline retries) skip the insert and the Neo4j edge merge. Verified locally: three back-to-back `pnpm seed` runs hold `emission_log` at 102 rows and Neo4j `LINEAGE_EDGE` at 100. Migration V27. SDKs can opt in for at-least-once dedup.
- **SLO declaration seeding** — new `POST /api/v1/seed/slos` endpoint (idempotent on `(org_id, product_id, name)`) plus a 20-declaration seed list (2 per published seed product, mix of freshness / completeness / latency). Two back-to-back seed runs hold `observability.slo_declarations` stable at 28. Each seed product now renders meaningful SLO cards on the observability dashboard out of the box. Sample evaluations not seeded yet — separate follow-up.
- **Access requests + grants seeding** — new `POST /api/v1/seed/access-requests` and `POST /api/v1/seed/access-grants` endpoints (idempotent on the natural keys) plus 5 cross-domain access requests (4 pending / 1 denied / 1 approved) and 7 active grants across both seed orgs, with two grants intentionally landing in the F11.11 expiring-soon window (≤14 days). The access page, governance review queue, and grant-expiring notification flow all have meaningful state on first seed.
- **Notification inbox seeding** — new `POST /api/v1/seed/notifications` endpoint (idempotent on `(org_id, recipient_principal_id, dedup_key)`) plus 15 notifications across both seed orgs and 9 distinct recipients, covering 9 categories (access, SLO violation, trust-score change, compliance drift, classification change, product published, connection reference, grant expiring). Mix of read and unread states with realistic recency. Two back-to-back seed runs hold `notifications.notifications` stable at 22. Closes the seed-data-richness leftover.
- **SLO evaluation seeding** — new `POST /api/v1/seed/slo-evaluations` endpoint (idempotent on `(slo_id, evaluated_at)` with midnight-UTC-rounded timestamps so re-runs are stable) plus a runner-side generator that emits 7 daily evaluations per seeded SLO declaration. Pattern: 6 passing days, 1 failing day 2 days ago (85.7% pass rate). Story per product: "one bad day, recovered." Two back-to-back seed runs hold `observability.slo_evaluations` stable at 533. Trust-score recompute runs at the end of seed pick up the new evaluations, so trust scores are now realistic on first seed instead of all-zero.

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
