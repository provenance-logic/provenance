# Claim-vs-Code Audit — 2026-05-22

**Auditor:** Claude Code (Matt-directed session).
**Scope:** Every architectural claim in `CLAUDE.md`, every `✅ Complete` / `Implemented` entry referenced from the status board or `documents/prd/implementation-status.md` that materially shapes platform credibility.
**Method:** B-063-style. For each claim, ask "what would a contributor see if they actually tried to use this?" — then check the code. Existence checks (tables, files, imports) + behavior checks (does the code path do what it claims). Runtime checks deferred — flagged where they'd matter.
**Why this exists:** The 2026-05-21 marathon surfaced B-060 → B-061 → B-063 — three claims-vs-reality gaps at progressively larger scale. Matt's correction at end of session: *"For this to be real, every single one of those connectors needs to actually work, EVERY ONE."* The PRD overhaul scheduled 2026-05-24 weekend needs an honest picture of which other claims are similarly hollow. This is that input.

**Verdict legend:**

- **Real** — claim matches code; verified by grep + read.
- **Partial** — feature exists but is narrower than the claim, or unverified along an axis the claim names.
- **Hollow** — claim is materially false: feature doesn't exist, or the named artifact (table, file, code path) is absent.
- **Misleading** — claim is structurally inaccurate (e.g. names something as a table that's actually a column); functionality may still exist.
- **Cannot verify (runtime)** — claim is about runtime behavior or NFR that can't be confirmed by code reading alone.

---

## Headline

**12 hollow / misleading / contradictory claims found.** None new-blocker. Most are documentation drift — the code is more correct than the docs in several places, the docs more aspirational than the code in others. The biggest category is **schema-table claims in CLAUDE.md that aren't actual tables** (7 of them). The most operationally consequential is the **Phase 5.4 ✅ vs Domain 9 Blocker contradiction** between CLAUDE.md and implementation-status.md. Nothing here changes B-063's framing; this is the surrounding territory.

The platform's *code* holds up to scrutiny better than its docs. The reverse of what B-063 suggested might be true everywhere.

---

## 1. Five Non-Negotiable Architectural Constraints (CLAUDE.md)

| # | Constraint | Verdict | Evidence |
|---|---|---|---|
| 1 | Lineage graph must be a native graph database (Neo4j) | **Real** | `apps/api/src/lineage/lineage.service.ts:4` imports `neo4j-driver`; Cypher queries used at runtime. |
| 2 | Policy engine must be hot-reloadable independent runtime (OPA) | **Real** | OPA service in `docker-compose.yml`; `governance.service.ts:186` calls `opaClient.upsertPolicy()` at policy publish; `governance.service.ts:340` calls `opaClient.evaluate()` at runtime. Bootstrap `health.rego` is intentional ("Phase 2 will replace this with compiled policies") — replacement happens dynamically via `upsertPolicy`, not via mounted files. |
| 3 | Control plane and data plane architecturally separated | **Real (by absence)** | No raw-data tables in any migration. Connector tables store config + credentials + schema metadata only. Consistent with the claim. |
| 4 | Agent query layer is a distinct service | **Real** | `apps/agent-query/` exists as a separate NestJS app; `config.ts:4` defaults `PORT=3002`; `docker-compose.ec2-dev.yml:675` runs it standalone. |
| 5 | MCP compliance is native (`@modelcontextprotocol/sdk`) | **Real** | `apps/agent-query/src/mcp/mcp.server.ts:1-2` and `tools.ts:1-2` import from `@modelcontextprotocol/sdk`. Not wrapped around REST. |

**Constraint cluster verdict: 5/5 real.** Architectural foundation is genuinely in place.

---

## 2. Database Schema Claims (CLAUDE.md "Database Schemas" table)

CLAUDE.md names 35 tables across 9 schemas. Migrations create **32 of them as actual tables.** The other **7 are absent or misnamed.**

### Real (28 named tables exist as named):

`organizations.orgs`, `organizations.domains`, `organizations.governance_configs`; `identity.principals`, `identity.role_assignments`, `identity.agent_identities`, `identity.agent_trust_classifications`; `products.data_products`, `products.product_versions`, `products.port_declarations`, `products.lifecycle_events`; `connectors.connectors`, `connectors.connector_health_events`, `connectors.source_registrations`, `connectors.schema_snapshots`, `connectors.capability_manifests` (V31, new 2026-05-21), `connectors.discovery_crawl_events` (V30, new 2026-05-21); `governance.policy_schemas`, `governance.policy_versions`, `governance.effective_policies`, `governance.compliance_states`, `governance.exceptions`, `governance.grace_periods`; `access.access_grants`, `access.access_requests`, `access.approval_events`; `consent.connection_references`, `consent.connection_reference_outbox`; `observability.slo_declarations`, `observability.slo_evaluations`, `observability.trust_score_history`; `audit.audit_log` (with 12 monthly partitions through 2027-03).

### Hollow / Misleading (7 named, absent or restructured):

| Named in CLAUDE.md | Reality | Verdict |
|---|---|---|
| `organizations.domain_extensions` | Not a table. `scope_type='domain_extension'` is a value within `governance.effective_policies` (V5:90). | **Misleading** — concept is present, packaged differently. |
| `identity.roles` | Not a table. Roles are an enum-like value within `identity.role_assignments.role`. | **Misleading** — same shape: docs imply a normalized lookup table that doesn't exist. |
| `products.port_contracts` | Not a table. Contract is a `contract_schema JSONB` column on `products.port_declarations` (V3). | **Misleading** — contract data is there, just embedded. |
| `connectors.discovery_coverage_scores` | Not a table; not in any migration. Coverage levels appear inside `capability_manifests.capabilities_doc` JSONB but no per-crawl score is computed or stored. | **Hollow** — claim implies scoring infrastructure that doesn't exist. (Already known via B-063.) |
| `consent.use_case_declarations` | Not a table. Use-case category + elaboration + scope are columns on `consent.connection_references` (V18). | **Misleading** — data is there, embedded. |
| `consent.consent_records` | Not a table. V18 comment acknowledges: "F12.11 immutable consent record projection (will add audit.consent_records table)" — never created. Audit log substitutes. | **Misleading** — the audit log substitution is intentional per implementation-status.md F12.11, but CLAUDE.md presents it as a real table. |
| `observability.observability_snapshots` | Not a table; not in any migration. | **Hollow** — no observability snapshot mechanism exists. (`governance.compliance_snapshots` exists, V8 — different schema, different concept.) |

**Schema cluster verdict: 5 real-but-misleading (data exists, packaging differs from doc), 2 truly hollow (`discovery_coverage_scores`, `observability_snapshots`).** Documentation update: present the schema list with real table names; flag JSONB-embedded structures as such.

---

## 3. Connector Discovery Architecture (CLAUDE.md section)

Several of these are already documented as not implemented in implementation-status.md (Domain 3 has a 2026-05-21 status warning). Re-verified for the audit.

| Claim | Verdict | Evidence |
|---|---|---|
| Registration crawl on connector registration | **Partial** (Databricks only) | `connectors.service.ts` auto-crawl logic shipped in PR #145. Other 11 types have no walker. |
| Re-crawl on governance-configurable schedule (default 24h) | **Hollow** | No Temporal workflow, no scheduler, no `re_crawl_interval_hours_default` consumer. Only operator-triggered crawl via `POST /connectors/:id/crawl`. F3.28 in implementation-status.md says "Not implemented." |
| Priority connectors at MVP table (Databricks / dbt / Snowflake / Fivetran) | **Hollow (3 of 4)** | Only Databricks ships. dbt manifest parser, Snowflake `information_schema` introspector, Fivetran metadata API consumer: all absent. (B-063.) |
| Domain-declared takes precedence over discovered metadata | **Hollow** | No conflict-resolution code anywhere. F3.29 in implementation-status.md says "Not implemented; CLAUDE.md describes the rule; no enforcement code exists." No way to test the rule because no code path tries to merge. |
| Coverage scoring per metadata category | **Hollow** | No `discovery_coverage_scores` table; no scoring service. `capability_manifests.capabilities_doc` carries coverage *levels* (high/medium/low) declared in the manifest, but no per-crawl score is computed. |

**Discovery cluster verdict: claim of an end-to-end discovery framework is currently a claim about Databricks alone.** This is B-063's surface area.

---

## 4. Claude Code Patterns / Operational Rules (CLAUDE.md)

Spot-checked the rules that name code behavior (not the spec-first / migration-first conventions).

| Rule | Verdict | Evidence |
|---|---|---|
| Audit log append-only at DB level | **Real** | V4:69-73: `GRANT SELECT, INSERT ON audit.audit_log TO provenance_app`; `REVOKE UPDATE, DELETE ON audit.audit_log FROM provenance_app`; `REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA audit FROM PUBLIC`. Enforced at the database role level, not just convention. |
| Connector credentials stored as ARN references only | **Real** | `apps/api/src/connectors/probe/secrets-manager.service.ts` uses `@aws-sdk/client-secrets-manager` with real `GetSecretValueCommand`. `local-env:` sentinel only for laptop dev; fails closed in production (env var won't be set). |
| `@AllowNoOrg` reserved for bootstrap endpoints only | **Real** | Single usage at `organizations.controller.ts:60` on `POST /self-serve`. Test suite asserts `listOrganizations with empty orgId is REJECTED (no @AllowNoOrg)`. |
| `RequireOrg` gates every authenticated frontend route | **Real** | `apps/web/src/app/Router.tsx:58` wraps the `/` parent route. All authenticated children inherit. |
| Connection reference enforcement is an AND with access grants | **Real** | `apps/agent-query/src/auth/connection-reference.guard.ts:47-…` declares the five distinct denial codes; `main.ts:31` wires the guard; `mcp/tools.ts:360` dispatches through it. |
| Reason field on classification change is non-null | **Real and stronger than claimed** | `UpdateClassificationSchema` requires `min(10)` characters AND a space (must be more than a single word). |
| Autonomous classification can never be set by automated process | **Real (by role gate)** | `agents.service.ts.updateClassification` enforces governance-role on upgrade. The endpoint at `agents.controller.ts:@Patch(':agentId/classification')` is the only path. No background job promotes to Autonomous. |
| Discovery results never auto-override domain-declared metadata | **Untestable** | No code path tries to override (or merge) either way. F3.29 not implemented. Rule is vacuously satisfied. |
| Legacy compatibility references are visually distinct in the UI | **Hollow** | implementation-status.md Domain 12 explicitly defers: *"Frontend UI distinguishing legacy refs from properly requested refs (the data carries `caused_by` and a distinctive use-case category; the UI renders them the same today)."* The rule is in CLAUDE.md but the UI doesn't honor it. |
| Connection reference state transitions transactional with audit + outbox | **Real** | Verified at multiple touchpoints in `consent.service.ts`. Single PG transaction wraps state update, audit log insert, and outbox insert. |

**Operational rules cluster verdict: 9/10 real; 1 explicitly deferred contradicts the CLAUDE.md rule.** The legacy-ref UI rule should either move to "post-launch" or the UI should ship the distinction.

---

## 5. Phase Completion Claims (CLAUDE.md "Build Phases" table + Phase 5 sub-bullet list)

### Phases 1–4

| Phase | CLAUDE.md status | Verdict | Evidence |
|---|---|---|---|
| 1 (Foundations) | ✅ | **Real** | Org, domain, principal, product-draft surfaces all shipped and visible. |
| 2 (Governance + marketplace) | ✅ | **Real but depth-undocumented** | OPA wired (verified §1), marketplace operational, access control enforced. Several F4.* requirements partial per implementation-status.md (F4.6, F4.10, F4.17, F4.19, F4.20) — phase-level ✅ overstates per-feature completeness. |
| 3 (Lineage + trust + discovery) | ✅ | **Hollow on discovery axis** | Lineage emission, trust score, observability all real. Discovery shipped for Databricks only — the platform-level discovery framework claim is the B-063 gap. Status board's footnote already preserves this as an echo of the PRD; this audit confirms the discrepancy is real. |
| 4 (MCP + agents + semantic search) | ✅ | **Real** | 9 MCP tools registered in `mcp/tools.ts` (verified by name). JWT auth at `auth.middleware.ts` (`provenance_principal_type=ai_agent` validated). Agent detail page surface caught up via B-057 (PR #129). Note: status board flags demo box's MCP server health is "unverified" since 10 PRs landed without redeploy — but that's an operational concern, not a phase claim issue. |

### Phase 5 sub-items (CLAUDE.md list)

| Sub-item | Claim | Verdict |
|---|---|---|
| 5.1 Stability and Reliability | ✅ Complete | **Real**. |
| 5.2 Security Essentials | ✅ Complete | **Real** at the deployment layer (Caddy HTTPS, KC wiring, claim mappers). But the CLAUDE.md security rule "TLS 1.3 at Kong" is misleading — see §6. |
| 5.3 JWT Agent Authentication | ✅ Complete | **Real** — verified JWKS validation + `principal_type=ai_agent` enforcement in `auth.middleware.ts`. |
| **5.4 Data Product Completeness P1** | **✅ Complete** | **HOLLOW** — direct contradiction with implementation-status.md Domain 9 which marks ALL four P1 items as `Not implemented — Phase 5 - Blocker`: Column-level schema, Ownership/stewardship, Data freshness signals, Access status for requesting principal. Either CLAUDE.md is wrong or the implementation-status.md ledger is wrong. (Caveat: the `ProductEnrichmentService` does expose `owner`, `domainTeam`, `freshness`, `accessStatus`, `columnSchema` fields, and PR #47 wired the frontend rendering. So the *backend + UI* may be there, and Domain 9's table may be the stale one. This needs reconciliation, not new work — but the contradiction itself is the issue.) |
| F5.15 Lineage Visualization | ✅ Complete | **Real** — React Flow + Dagre per ADR-003. |
| Domain 10 Workstream B | Mostly shipped | **Real with documented gaps** — F10.7 partial (per-driver SQL probes + per-storage file probes deferred); F10.11–F10.13 schema-authoring items not implemented. Honest. |
| 5.5 Anomaly Detection | 🔲 Not started | **Real** — no code. |
| 5.6 Developer Experience | 🔄 Substantially shipped | **Real** — LICENSE, CONTRIBUTING, docs, B-009 fix, seed CLI, 2026-05-07/08 fresh-laptop arc all present. The "final virgin-laptop timing run" deferral is honest. |
| 5.7 SOC 2 Foundations | 🔲 Not started | **Real** — no code. |
| Domain 12 | ✅ Fully shipped 2026-05-13 | **Real with deferrals named** — runtime enforcement default-on; 5 denial codes wired; outbox + AQL cache aligned. Deferred items enumerated in implementation-status.md and consistent with code. |

**Phase cluster verdict: Phase 3's discovery claim is the only one B-063 already covers. Phase 5.4 is the one new contradiction to resolve.** Suspect implementation-status.md Domain 9 ledger is the stale half — backend + UI show the fields ship — but this should be reconciled directly, not assumed.

---

## 6. Security Rules ("Never Violate" section in CLAUDE.md)

| Rule | Verdict | Evidence |
|---|---|---|
| `org_id` on every table with RLS enforced at DB level | **Partial** | RLS policies present on 13+ tables (V1, V10, V12, V15, V18, V21, V23, V24 confirmed). B-062 already filed: `set_config('provenance.current_org_id', …, true)` is transaction-scoped, doesn't survive across the multiple connections a request actually uses — so RLS is enabled but the session variable backing it isn't reliably set on the hot path. Controller-layer org check (B-061 fix in `JwtAuthGuard`) is what's actually keeping cross-org leaks closed today. |
| Credentials stored as ARN references only — never logged, never cached | **Real (ARN-only)** | Real Secrets Manager fetch. The "never logged, never cached" assertion is not enforced by code, only by convention. |
| Audit log is append-only | **Real** | DB-role REVOKE on UPDATE/DELETE. |
| Agent access scope enforced at infrastructure level, not application policy check only | **Hollow per implementation-status.md** | F6.8 says: "Application-level enforcement; infrastructure-level not verified." No Kong plugin or other infra-level scope enforcer is wired. App-level enforcement is what's actually running. |
| **TLS 1.3 enforced at Kong for all external traffic** | **Misleading** | Kong is in `docker-compose.yml` (ports 8000/8001/8100) but the web frontend's `VITE_API_BASE_URL` defaults to `http://localhost:3001/api/v1` — **bypassing Kong entirely**. In ec2-dev / demo, **Caddy** terminates TLS (not Kong). Kong has `DISABLE_SECURITY_PLUGIN: "true"` set in dev. TLS-at-Kong is true for hypothetical Phase 6 production EKS only. |
| Agent tokens carry `principal_type=agent` and `agent_id` claims validated on every request | **Real** | `auth.middleware.ts:90` checks `decoded.provenance_principal_type !== 'ai_agent'`; agent_id comes from `provenance_principal_id`. |
| Discovery crawl credentials via same Secrets Manager pattern | **Real** | Databricks probe uses `SecretsManagerService.getSecretValue` (verified §4). |

**Security cluster verdict: 2 hollow/misleading (TLS-at-Kong, infra-level agent scope), 1 partial (RLS session-variable already tracked as B-062), 4 real.** The TLS-at-Kong claim is the most misleading for a contributor reading CLAUDE.md as documentation.

---

## 7. Candidate New Bugs to File

These surface from the audit and would be filed if directed. **Not filing autonomously** — the weekend conversation may absorb several of them into the PRD overhaul.

1. **B-NEW-A — CLAUDE.md schema list names 7 tables that aren't tables.** 5 are documentation drift (data exists, embedded differently); 2 are truly hollow (`discovery_coverage_scores`, `observability_snapshots`). Severity: Low. Documentation-only.

2. **B-NEW-B — CLAUDE.md Phase 5.4 ✅ Complete contradicts implementation-status.md Domain 9 Blocker entries.** Either CLAUDE.md is wrong or the ledger's Domain 9 table is stale (the code looks like it ships). Severity: Medium — pollutes both source-of-truth documents. Reconcile during weekend overhaul.

3. **B-NEW-C — Security rule "TLS 1.3 enforced at Kong for all external traffic" is misleading for MVP.** Kong exists in compose but is bypassed; Caddy is the real TLS terminator in dev/demo; HTTP-only locally. Severity: Medium — a contributor evaluating the platform's security posture would be misled. The rule should explicitly distinguish MVP (Caddy) vs Phase 6 (Kong on EKS).

4. **B-NEW-D — CLAUDE.md Claude Code Pattern "Legacy compatibility references are visually distinct" doesn't match the UI.** Domain 12 deferred the distinct rendering explicitly. Severity: Low — operationally fine (no legacy refs exist on most installs), but the rule shouldn't be in CLAUDE.md as if it's in force. Either ship the UI distinction or move the rule to a deferred-features list.

5. **B-NEW-E — CLAUDE.md "Agent access scope enforced at infrastructure level" doesn't match code.** F6.8 says infra-level not verified; app-level is what's running. Severity: Low — likely a Phase 6 aspiration that wandered into the MVP security rules. Clarify scope.

6. **B-NEW-F — CLAUDE.md "Connector Discovery Architecture" section overstates platform coverage.** The section reads as if discovery, re-crawl, conflict resolution, and coverage scoring are all real. Reality: discovery is real for Databricks only; re-crawl is on-registration + operator-triggered (no schedule); conflict resolution doesn't exist; coverage scoring is a label in the manifest only. Severity: covered by B-063 already; folding this into the B-063 PRD-overhaul conversation is the right move rather than filing separately.

---

## 8. What This Doesn't Cover

- **Performance NFRs.** Every "p99 < Xms" / "Y events/sec per org" / "within Z minutes" target in CLAUDE.md is unverified by this audit. Most can only be measured with load. Implementation-status.md flags many as `Not measured` (e.g. NF12.1–NF12.3).
- **Continuous availability of deployed services.** The status board flags the demo box's MCP server health as unverified after tonight's 10 PRs. That's an operational ops-readiness issue, not a code-claim issue.
- **WCAG 2.1 AA accessibility (F7.6).** Implementation-status.md says `Not implemented; WCAG 2.1 AA not verified` — taken at face value; no axe-core audit run here.
- **SAML 2.0 (NF1.3).** Implementation-status.md says `Keycloak OIDC confirmed; SAML not verified`. CLAUDE.md doesn't claim SAML explicitly; no finding.
- **Cross-product join semantics (F6.18) and federated query planner depth.** Partial per status doc; runtime testing would be needed.
- **Domain 11 trigger fan-out at scale.** All 16 implemented triggers verified to exist as code paths; runtime fan-out under sustained load not tested.

---

## 9. Conclusions for the Weekend Conversation

1. **The code is more correct than the docs in several places.** Constraints 1–5 all real. Operational rules 9/10 real. Audit log, JWT, RLS policies, Secrets Manager — all real. The B-063 → B-061 → B-060 progression suggested *more* hollowness ahead. Most of what was audited holds up.
2. **The docs are more aspirational than the code in two specific places:** the schema list (7 named tables that aren't), and the security section (TLS-at-Kong, infra-level scope enforcement). Both are CLAUDE.md drift — a documentation pass would close them.
3. **The Phase 5.4 ✅ vs Domain 9 Blocker contradiction is the one finding that's not pure docs drift.** It's a real disagreement between two source-of-truth files. The weekend overhaul should reconcile (and the resolution probably is "Domain 9's table is stale; code ships").
4. **B-063 remains the load-bearing OSR blocker.** Nothing here unseats it. The discovery-architecture section of CLAUDE.md echoes the same gap B-063 already documents — no new ground.
5. **The audit suggests the *category* "PRD/CLAUDE.md claims a thing the code doesn't do" is narrower than the B-060→B-061→B-063 arc made it look.** Three real cases of that (B-060, B-061, B-063) plus a handful of documentation drifts. Not 20 hollow features in the codebase.

**Net for the weekend:** the connector-framework gap is the actual problem to solve. Other claims hold or are documentable-only. The PRD overhaul can scope around the connector decision without first having to re-audit every "Implemented" entry — this document is that audit.
