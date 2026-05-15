# Changelog

All notable changes to Provenance are tracked here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are in `YYYY-MM-DD` and refer to the date the work merged to `main`.

This file picks up after **Phase 4 — Agent Integration** completed and tracks the **Phase 5 — Open Source Ready** push. Earlier history lives in the git log and the PRD's implementation-status document.

---

## [Unreleased] — toward v0.1.0-osr

The active OSR blocker list is empty for the first time since the launch push began on 2026-04-30. Remaining work for the `v0.1.0-osr` tag: a final fresh-laptop timing run and the release tag itself.

### Added

- **`refresh-ec2-dev.sh`** ops script at `infrastructure/scripts/refresh-ec2-dev.sh`. Wraps `git pull` plus `docker compose up -d --force-recreate api agent-query web` plus a 30-second `/api/v1/health` poll into one sudo-able command. Closes B-028 proposed fix 2; `operations.md` updated to recommend the script as the default post-`git pull` workflow on the EC2 dev box. B-028 entry stays Open pending fix 3 (the CI env-validator pre-flight).
- **Agents page** at `apps/web/src/features/agents/AgentsPage.tsx` plus `agentsApi` client. Lists every agent in the active org with display name, model, trust-classification pill, oversight contact, and registration date. Registration form binds to `POST /agents` and surfaces the Keycloak client secret exactly once in a dismissable banner with a Copy button (the API only returns it on create; recovery is `POST /agents/:agentId/rotate-secret`). The OnboardingWizard's `invite_agent` step is upgraded from a skip-only placeholder to PrimaryButton → `/agents` plus Mark-done plus Skip, mirroring `publish_product`. Closes **B-026**. Trust-classification mutations and a "last activity" column are explicit deferrals (see resolved.md entry).
- **Connectors page** at `apps/web/src/features/connectors/ConnectorsPage.tsx` plus `connectorsApi` client. Lists every connector in the active org with name, type, domain, validation-status pill, and registration date. Registration form binds to `POST /organizations/:orgId/connectors` with a 13-option connector-type dropdown, real domain picker (fetched from the org), optional credential ARN, and a JSON-validated connection-config textarea. `NavShell` gains a "Connectors" entry between Dashboard and Marketplace. The OnboardingWizard's `register_connector` step is upgraded from skip-only to the same PrimaryButton → `/connectors` + Mark-done + Skip triad. **Closes B-025, which also closes the last skip-only step in the F7.46 onboarding wizard — every guided step now wires to a real destination.** Per-connector-type config schemas, validation/source-registration workflows, and a secrets-manager picker are explicit deferrals.

---

## 2026-05-14 — Stage 2, Stage 4, and dev-site outage fix

Six PRs in one session: closing the last three active OSR blockers (F7.7, F7.22 / F10.4, F7.46), the documentation-reconciliation that unblocked them, the Stage 5 polish pass, and a same-day operational fix for the dev box.

### Added

- **Bug entries B-028 and B-029** ([#95](https://github.com/provenance-logic/provenance/pull/95)) in `documents/bugs/open.md`. B-028 (compose env-var drift) and B-029 (Vite HMR bind-mount staleness) both surfaced during the dev.provenancelogic.com outage debug; entries include proposed fixes so future operators don't re-discover them.
- **Runbook subsection "When `restart` Isn't Enough — Use `--force-recreate`"** ([#95](https://github.com/provenance-logic/provenance/pull/95)) in `documents/runbooks/operations.md`. Documents the post-`git pull` workflow that prevents recurrence of the B-028 / B-029 failure modes.

### Changed

- **`/agents` route placeholder copy** ([#95](https://github.com/provenance-logic/provenance/pull/95)). The previous "Coming in a later phase" was misleading — the agent backend is shipped (MCP `register_agent`, identity model, trust classifications, audit on every tool call). Replaced with copy that names B-026 (the missing UI) and points to the available MCP path. `ComingSoon` component generalised to accept an optional `detail` prop.

### Added

- **CHANGELOG.md** ([#93](https://github.com/provenance-logic/provenance/pull/93)). This file. Starts at the Phase 4 → Phase 5 boundary; pre-Phase-5 history points at the git log.
- **Documentation index files** ([#93](https://github.com/provenance-logic/provenance/pull/93)). `documents/README.md`, `documents/prd/README.md`, and `documents/architecture/README.md` — previously 1-byte empty files; now navigation by audience (evaluator / contributor / OSR planner) plus a directory map and the precedence rule for when status docs disagree.
- **CI workflow badge** ([#93](https://github.com/provenance-logic/provenance/pull/93)) in README.

### Fixed

- **README "Project Status" section** ([#93](https://github.com/provenance-logic/provenance/pull/93)). Blocker count refreshed (5 → 0 as of 2026-05-14); F7.7 / F7.22 / F7.46 shipping wave acknowledged; F7.29 / F7.42 named as explicit deferrals.
- **README badge hrefs** ([#93](https://github.com/provenance-logic/provenance/pull/93)). PRD and Architecture badges now point at the rendered `.md` files instead of folder listings; Status badge links to `osr-roadmap.md` instead of an empty href.
- **EC2 dev box Flyway baseline conflict** ([#94](https://github.com/provenance-logic/provenance/pull/94)). `docker-compose.ec2-dev.yml`'s flyway-migrate service was running `flyway baseline && flyway migrate`. PR #69 had dropped the `baseline &&` prefix from the other two compose files but missed this one. On a DB whose schema history was previously baselined at v8, the new `baseline` call failed → flyway-migrate exited 1 → API container couldn't start → every request to dev.provenancelogic.com returned 502. Aligning the ec2-dev compose with the other two restored the API.
- **Duplicate Data Products nav** ([#94](https://github.com/provenance-logic/provenance/pull/94)). `NavShell` had both `Dashboard → /dashboard` and `Data Products → /products`, and the router redirected `/products` straight back to `/dashboard`. Two nav entries rendering the same page. Dropped the nav entry and the dead redirect route.

### Added

- **F7.46 Onboarding Experience** ([#92](https://github.com/provenance-logic/provenance/pull/92)). Inline five-step first-run wizard at the top of `/dashboard` with per-principal progress persistence backed by a new `identity.principal_preferences` table and `GET/PATCH /me/preferences` endpoints. Three steps wire to live destinations (org confirm, invite team, publish first product); two render skip-only "Coming soon" panels with bug-tracked follow-ons (B-025 connector registration UI, B-026 agent registration UI). The "Sample data" button from the roadmap scope is deferred as B-027.
- **F7.22 / F10.4 Domain Team Management completion** ([#91](https://github.com/provenance-logic/provenance/pull/91)). Three new domain-scoped endpoints (`GET/POST` `/organizations/:orgId/domains/:domainId/members`, `DELETE .../members/:principalId/roles/:role`) gated to `org_admin` OR `domain_owner`. Every mutation writes an audit row carrying the domainId and syncs Keycloak realm-role bindings idempotently across scopes. The Domain Team page now filters by `domainId`, supports per-(principal, domain, role) revoke instead of the previous destructive whole-principal revoke, and offers an "Assign existing org member" form. A Team link surfaces from the Domain Dashboard so the page is reachable without URL knowledge.
- **F7.7 Role Assignment UI** ([#90](https://github.com/provenance-logic/provenance/pull/90)). Org-level Roles page at `/dashboard/:orgId/roles` listing members grouped by principal with their org-level role pills, assigning a role to an existing member, inviting by email at a chosen role, and per-role revoke via a new `DELETE /organizations/:orgId/members/:principalId/roles/:role` endpoint. Every role mutation writes an audit-log row and syncs to Keycloak (`KeycloakAdminService.removeRealmRoles` added as a sibling of `assignRealmRoles`). Two minor deferrals filed as B-023 (Platform Admin / Platform Observer roles not modeled in v1) and B-024 (governance acknowledgment gate on `governance_member` assignment deferred to a Phase 6 follow-on).

### Changed

- **Documentation reconciliation** ([#89](https://github.com/provenance-logic/provenance/pull/89)). Updated the three OSR-tracking documents so they tell the same story: `osr-roadmap.md` Stage 1 marked substantively shipped (bug-discovery work from 2026-05-07/08), F7.29 and F7.42 dropped from the active blocker list in `implementation-status.md` per the roadmap's deferral, and `CLAUDE.md` blocker count + Stage 1 phrasing aligned.

---

## 2026-05-13 — Domain 12 runtime enforcement

The full per-use-case consent and runtime scope enforcement arc shipped across nine PRs, with `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true` becoming the default for fresh deployments.

### Added

- **Connection Reference state machine and REST surface** ([#77](https://github.com/provenance-logic/provenance/pull/77)–[#83](https://github.com/provenance-logic/provenance/pull/83)). Locked `ConnectionReferenceScope` shape (`{ ports: string[] }` with `'*'` wildcard) and `DataCategoryConstraints` (`{ allowed_categories?: string[] }`). Pure-function `scope-match.ts` + `tool-scope-map.ts` (5 exempt MCP tools, 4 product-bound, unknown-tool safety belt). Internal control-plane endpoints `/api/v1/internal/consent/connection-references/active` (cold-load) and `/active/lookup` (cache miss). Outbox publisher drains `consent.connection_reference_outbox` to Redpanda topic `connection_reference.state`. AQL in-memory `ConnectionReferenceCache` + `AccessGrantCache` (24h TTL), Redpanda consumer keeping the cache aligned, cold-load on AQL boot. `ConnectionReferenceGuard` wired into the MCP tool dispatch path with five distinct denial codes plus `UNKNOWN_TOOL` safety belt and audit row on every denial. Architecture decisions captured in [ADR-005](./documents/architecture/adr/ADR-005-connection-reference-composition.md), [ADR-006](./documents/architecture/adr/ADR-006-runtime-scope-enforcement.md), [ADR-007](./documents/architecture/adr/ADR-007-connection-reference-state-propagation.md), [ADR-008](./documents/architecture/adr/ADR-008-connection-reference-and-package-relationship.md).
- **Scope-violation notification fan-out** ([#84](https://github.com/provenance-logic/provenance/pull/84)). New `connection_reference_scope_violation` notification category, governance-mandatory; recipients are the owning principal plus every `governance_member`. Runs regardless of enforcement mode per "never silent."
- **F12.25 Legacy-agent migration** ([#85](https://github.com/provenance-logic/provenance/pull/85)). `POST /api/v1/internal/consent/legacy-agent-migration` provisions 30-day non-renewable legacy references for every existing agent-product grant without an active reference. Idempotent. V28 migration extends `caused_by` CHECK with `legacy_migration`. New `connection_reference_legacy_provisioned` notification category.

### Changed

- **Enforcement default flipped to on** ([#86](https://github.com/provenance-logic/provenance/pull/86)). `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true` is now the default. Fresh deployments enforce by default; shadow mode is opt-in. Existing installations should run the F12.25 endpoint before deploying.

---

## 2026-05-07–05-08 — Fresh-laptop onboarding arc

Walking the README Getting Started path on a fresh Apple Silicon MacBook surfaced thirteen distinct OSR-blocking issues. All resolved.

### Fixed

- **B-010** OPA `wget` healthcheck unrunnable on distroless image ([#65](https://github.com/provenance-logic/provenance/pull/65)).
- **B-012 / B-015 / B-016 / B-017 / B-018 / B-019 / B-020 / B-021 item 4** Fresh Apple Silicon clone path: `.ts`-extension TypeScript path mapping in the API tsconfig, Flyway baselineVersion override skipping V1–V8, missing realm-management roles on `provenance-admin`, seed `interface_type` mismatch with DB CHECK, unmanagedAttributePolicy on the Keycloak realm, missing `/realms/{realm}` on `KEYCLOAK_ISSUER_URL`, `VITE_API_BASE_URL` pointing at empty Kong, broken `/health` healthcheck path ([#66](https://github.com/provenance-logic/provenance/pull/66)).
- **B-013** `packages/types/dist/` not pre-built on host install ([#68](https://github.com/provenance-logic/provenance/pull/68)).
- **B-014** Default compose files had no `flyway-migrate` service; fresh DB had no schema ([#69](https://github.com/provenance-logic/provenance/pull/69)).
- **B-021 items 1, 2, 3, 5** README onboarding paper cuts: stale Node version, npm/pnpm mismatch, wrong frontend port, sparse seed instructions ([#70](https://github.com/provenance-logic/provenance/pull/70)).
- **B-022** API and MinIO healthchecks called HTTP tools their container images didn't ship ([#71](https://github.com/provenance-logic/provenance/pull/71), [#72](https://github.com/provenance-logic/provenance/pull/72)).
- **Container Node base-image bump from 20 to 22** ([#74](https://github.com/provenance-logic/provenance/pull/74)). Aligns with `engines.node` requirement raised in #70.

---

## 2026-04-28 to 2026-05-02 — Phase 5.6 Developer Experience

### Added

- **B-009 OpenSearch BM25 reliability** ([#52](https://github.com/provenance-logic/provenance/pull/52)). Synchronous double-write to `provenance-products` on every publish/update/decommission, plus a one-shot `pnpm reindex:search` for backfill.
- **In-product API reference** ([#53](https://github.com/provenance-logic/provenance/pull/53)). `GET /api/v1/docs` serves an index of all 12 domain specs; `/api/v1/docs/:spec` renders Redoc; `/api/v1/docs/specs/:name.yaml` returns raw YAML.
- **Working seed CLI** ([#54](https://github.com/provenance-logic/provenance/pull/54)). Eight idempotent `/api/v1/seed/*` endpoints behind `SeedGuard` (constant-time token check + `SEED_ENABLED` flag, 404 in production). `pnpm --filter @provenance/seed seed` populates 2 orgs, 9 domains, 17 principals, 8 policies, 16 published products, 27 ports, 2 agents, 86 lineage emissions.
- **Lineage emit idempotency, SLO declarations + evaluations seeding, access requests + grants seeding, notifications seeding** ([#57](https://github.com/provenance-logic/provenance/pull/57)–[#61](https://github.com/provenance-logic/provenance/pull/61)). Seed CLI now produces realistic SLO cards, trust scores, access flows, and notifications out of the box.

---

## 2026-04 — Domain 11 Notifications and F5.15 Lineage Visualization

Twelve trigger-bundle PRs plus notification-center frontend ([#42](https://github.com/provenance-logic/provenance/pull/42)) and F11.17 trust-score-significant-change ([#50](https://github.com/provenance-logic/provenance/pull/50)) shipped the complete notification surface across in-platform / email / webhook channels with per-(principal, category) preferences. All 27 PRD trigger requirements wired or explicitly deferred. Architecture captured in [ADR-009](./documents/architecture/adr/ADR-009-notification-architecture.md).

**F5.15 Lineage Visualization** ([#55](https://github.com/provenance-logic/provenance/pull/55)) replaced the previous Cytoscape implementation with React Flow + Dagre per [ADR-003](./documents/architecture/adr/ADR-003-lineage-visualization-react-flow.md), giving the lineage explorer a deterministic left-to-right DAG layout with custom node cards (name, type, trust score) and humanized edge labels.

---

## Earlier Phase 5 work

Domain 10 Workstream A self-serve registration, Workstream B port connection details and connection packages, Domain 9 priority-1 completeness, and the Phase 5.1–5.4 stability and security essentials all landed before 2026-04-28. See `documents/prd/implementation-status.md` for the per-feature breakdown and the git log for commit-level history.

---

## Pre-Phase 5

Phase 1 (Foundation), Phase 2 (Governance & Publishing), Phase 3 (Lineage & Observability), and Phase 4 (Agent Integration) are recorded in the git log. No changelog was maintained for those phases.
