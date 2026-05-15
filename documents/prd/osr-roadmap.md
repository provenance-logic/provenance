# Open Source Readiness Roadmap

**Last updated:** 2026-05-14 (Stage 4 closed; only Stage 5 polish remains)
**Authoritative blocker list:** [implementation-status.md](./implementation-status.md)
**Target definition:** Provenance functions properly without weird workarounds. Not full enterprise-ready (SOC 2, etc.) — that is Phase 6.

This document sequences the remaining Open Source Readiness work into discrete, checkpoint-able stages. Each stage is one or more PRs with a clear scope and a verification gate before moving to the next.

---

## Stage 0 — Recently shipped (already done)

For context on where we are coming from. Everything below this line still needs to happen.

- ✅ Temporal infrastructure on dev EC2 (PR `fix/temporal-runtime-on-ec2-dev`) — Temporal server now actually running, API base switched to glibc so the worker loads, `TEMPORAL_ENABLED` wired in code. Domain 12 timer work now has a runtime to schedule against.
- ✅ Hardware requirements documented (PR `docs/readme-hardware-requirements`) — Lite (8 GB) vs Full (16 GB) Compose profiles named, README sets expectations honestly.

---

## Stage 1 — Local-setup-time measurement ✅ Substantively shipped 2026-05-07/08

**The bug-discovery half is done.** Walking the README Getting Started path on a fresh Apple Silicon MacBook (PR #66 body) surfaced thirteen distinct OSR-blocking issues, all resolved across the 2026-05-07/08 arc (PRs #65–#72: B-010 OPA distroless healthcheck, B-012 .ts path mapping, B-013 packages/types prebuild, B-014 missing flyway-migrate service, B-015 flyway baselineVersion, B-016 Keycloak realm-admin roles, B-017 seed interface_type mismatch, B-018 unmanagedAttributePolicy, B-019 issuer-URL realm path, B-020 VITE_API_BASE_URL pointing at empty Kong, B-021 README paper cuts, B-022 api/minio healthcheck binaries). Post-fix verification ran as cumulative fresh-clone simulations in `/tmp/...` on the same machine and passed every other service `(healthy)`. The fresh-laptop walkthrough is now the validated OSR test methodology.

**Caveat left for Stage 5.** The final "under 30 minutes following only the README" timing run on a *virgin* contributor laptop has not been done — Matt's laptop is the only fresh-Apple-Silicon platform available, and the May 7/8 run found bugs against an intermediate state rather than the post-fix state. Re-measurement options for Stage 5: (a) clean re-clone into `/tmp/` on the same laptop (closest available proxy to a virgin install; catches regressions, not first-install issues like missing Homebrew packages), (b) borrowed laptop or clean VM (definitive but logistically harder). Treating this as a Stage 5 polish item rather than a Stage 1 blocker so it doesn't gate Stage 2.

---

## Stage 2 — Role and team management UI (1–2 weeks)

**Why now:** the highest-impact "stop telling people to open the Keycloak admin console" work. Two PRs back-to-back since they share the same admin surface area.

**PR A — F7.7 Role Assignment UI** (3–5 days)
- List principals in the org with their current platform roles.
- Assign and revoke platform roles (governance, domain owner, consumer, etc.) from the UI.
- Wire to the existing Keycloak admin API patterns already established in invitations.
- Audit log entry on every role change.

**PR B — F7.22 Domain Team Management completion** (2–3 days)
- Domain-scoped membership view (currently the listing is org-scoped, which leaks principals across domains).
- Add and remove principals from a domain team from the UI.
- Audit log entry on every membership change.

**Checkpoint:** End-to-end manual test from the UI — invite a new user, assign them a domain owner role, add them to a domain team, confirm they can publish a product without anyone touching Keycloak.

---

## Stage 3 — Domain 12 runtime enforcement ✅ Shipped 2026-05-13

**The arc that closed the platform's "agents with per-use-case consent" narrative.** Shadow-mode-then-flip rollout across nine PRs (#77–#86). `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true` is now the default; every product-bound MCP tool call is gated on an active access grant AND an active connection reference AND a scope match.

**What landed (in merge order):**

- **#77 (P0)** — locked the `ConnectionReferenceScope` payload shape (`{ ports: string[] }`, with `'*'` wildcard) and `DataCategoryConstraints` (`{ allowed_categories?: string[] }`) per the plan's Decision 1.
- **#78 (PR #4)** — pure-function `scope-match.ts` + `tool-scope-map.ts` (5 exempt MCP tools, 4 product-bound, unknown-tool safety belt). 27 truth-table tests.
- **#79 (PR #2)** — internal control-plane endpoints `/api/v1/internal/consent/connection-references/active` (cold-load) + `/active/lookup` (cache miss). New `InternalServiceGuard` + `AQL_INTERNAL_TOKEN` env var.
- **#80 (PR #1)** — outbox publisher worker drains `consent.connection_reference_outbox` to Redpanda topic `connection_reference.state` (1-second tick, `FOR UPDATE SKIP LOCKED`, partition key = `org_id`). Strict-publish primitive added to `KafkaProducerService`.
- **#81 (PR #3)** — AQL in-memory `ConnectionReferenceCache` + `AccessGrantCache` (24h TTL), Redpanda consumer keeping the cache aligned with state events, cold-load on AQL boot via the internal endpoint.
- **#82 (PR #5a)** — internal active-grant lookup endpoint `/api/v1/internal/access/grants/active/lookup` for access-grant cache-miss fallback.
- **#83 (PR #5b)** — `ConnectionReferenceGuard` wired into the MCP tool dispatch path. Five distinct denial codes (`ACCESS_GRANT_NOT_FOUND`, `CONNECTION_REFERENCE_NOT_FOUND`, `CONNECTION_REFERENCE_SUSPENDED`, `CONNECTION_REFERENCE_EXPIRED`, `CONNECTION_REFERENCE_SCOPE_VIOLATION`) plus `UNKNOWN_TOOL` safety belt. Audit row on every denial. Shadow-mode flag at config layer.
- **#84 (PR #5c)** — scope-violation notification fan-out. New `connection_reference_scope_violation` category, governance-mandatory, recipients = owning principal + every `governance_member`. Runs regardless of enforcement mode per "never silent."
- **#85 (F12.25)** — legacy-agent migration endpoint. Provisions 30-day non-renewable legacy refs for existing agent-product grants with no active reference; idempotent; V28 migration extends `caused_by` CHECK with `legacy_migration`; new `connection_reference_legacy_provisioned` notification category.
- **#86 (PR #6)** — flipped `CONNECTION_REFERENCE_ENFORCEMENT_ENABLED` default from `false` to `true`. Fresh deployments enforce by default; shadow mode is opt-in. Upgrade runbook for existing installations: run F12.25 endpoint before deploying.

**Retrospective.** The plan estimated 3–4 weeks. The arc landed in roughly one session because (a) the implementation plan locked all four design decisions before any code was written, (b) splitting PR #5 into 5a/5b/5c kept review surface tractable, and (c) every PR had a scout pass before coding to avoid silent bonus scope.

**Deliberately deferred (not OSR blockers, tracked in implementation-status.md Domain 12 section):** Supervised oversight-hold sub-state, governance override on activation (F12.14) and governance-initiated revocation (F12.20), MAJOR-version suspension (F12.15), automatic-expiration Temporal workflow (F12.22), behavioral differences at runtime (F12.17), provenance-envelope verification (F12.18), the remaining F12.21 cascade triggers (product lifecycle, agent lifecycle, owner deactivation), per-reference scope filtering on the connection package (ADR-008 "Scope Inheritance"), and a UI that visually distinguishes legacy refs from properly requested ones.

---

## Stage 4 — F7.46 Onboarding flow ✅ Shipped 2026-05-14, fully wired 2026-05-15

**What landed.** Inline first-run wizard at the top of `/dashboard` with five steps backed by per-principal preferences (`identity.principal_preferences` table + `GET/PATCH /me/preferences`):

1. **Confirm your organization** — display-only summary of the org name, slug, description. "Looks good — continue" advances; "Skip" skips. The confirm-org step also hosts the optional **Populate sample data** affordance (B-027 close-out) that seeds the workspace with one domain and two products so the rest of the wizard has something to point at.
2. **Invite teammates** — primary CTA links to the OrgRolesPage shipped earlier the same day in F7.7; "Mark done" after sending an invite, or skip if flying solo.
3. **Register a connector** — links to the new `/connectors` page (B-025 close-out, [#98](https://github.com/provenance-logic/provenance/pull/98)). PrimaryButton → connectors page + Mark-done + Skip.
4. **Publish your first data product** — if no domain yet, links to the existing domain-creation flow; otherwise links straight to `NewProductForm` scoped to the first available domain.
5. **Invite an AI agent** — links to the new `/agents` page (B-026 close-out, [#97](https://github.com/provenance-logic/provenance/pull/97)). PrimaryButton → agents page + Mark-done + Skip.

The wizard is skippable per step, dismissible globally ("Dismiss for now" sets `dismissedAt`), and resumable across sessions. Once all five steps are completed or skipped, `completedAt` is set and the wizard never auto-opens again.

**Skip-only steps remaining: zero** (as of 2026-05-15). The 2026-05-14 ship landed steps 1, 2, 4 wired; the 2026-05-15 follow-on session closed steps 3, 5, and the sample-data affordance via PRs [#97](https://github.com/provenance-logic/provenance/pull/97) (B-026 agents UI), [#98](https://github.com/provenance-logic/provenance/pull/98) (B-025 connectors UI), and [#100](https://github.com/provenance-logic/provenance/pull/100) (B-027 sample-data button).

**Files of record:**
- Migration: `apps/api/migrations/V29__create_principal_preferences.sql`
- Backend (preferences): `apps/api/src/preferences/`
- Backend (sample-data): `apps/api/src/sample-data/`
- Frontend wizard: `apps/web/src/features/onboarding/OnboardingWizard.tsx`
- Frontend pages: `apps/web/src/features/agents/AgentsPage.tsx`, `apps/web/src/features/connectors/ConnectorsPage.tsx`
- Integration: `apps/web/src/features/publishing/DashboardRedirect.tsx`

**Walk-through checkpoint (from this stage's original spec).** A first-time user (Matt or a friend) walks the wizard. Bugs filed inline in `documents/bugs/open.md`. With all five steps wired and the sample-data affordance live, the natural next demo-prep item is standing up `demo.provenancelogic.com` so investors can be walked through against a populated environment rather than the daily dev box.

---

## Stage 5 — Pre-launch sweep (2–3 days)

**Why:** the difference between "looks abandoned" and "looks alive" on GitHub is often this stage.

**Tasks:**
- README polish — re-read the whole thing as a stranger.
- Link-check across all docs (broken doc links destroy trust fast).
- "You are here" navigation in `documents/` — index pages, breadcrumbs.
- Smoke-test on a clean checkout one more time. Same procedure as Stage 1.
- Update the project status badges in the README.
- Tag a release: `v0.1.0-osr` or similar. Cut release notes that summarize what landed since Phase 4.

---

## Total wall-clock estimate

**Roughly 2 weeks remaining** at current cadence with one developer (Matt + Claude pair). Down from the original 5–7-week estimate after Domain 12 closed 2026-05-13.

| Stage | Effort | Status |
| --- | --- | --- |
| 1. Setup-time measurement + fixes | 1–4 days (actual: 2 days) | ✅ Substantively shipped 2026-05-07/08; final under-30-min timing deferred to Stage 5 |
| 2. Role + team UI | 1–2 weeks | Outstanding |
| 3. Domain 12 runtime enforcement | 3–4 weeks (actual: one session) | ✅ Shipped 2026-05-13 |
| 4. Onboarding flow | 1 week (actual: one session) | ✅ Shipped 2026-05-14 |
| 5. Pre-launch sweep | 2–3 days | Outstanding |

---

## Explicitly deferred to "Roadmap" with no shame

These were originally on the OSR blocker list but are honest deferrals — the platform functions properly without them, and shipping with each as a documented future item is acceptable.

- **F7.29 Access Request SLA escalation** — notifications fire (Domain 11), no auto-escalation. Acceptable v1.
- **F7.42 Human Review Queue** — only matters when Supervised agents are in active use. Document that the Supervised classification needs the queue (post-launch).
- **5.5 Anomaly Detection** — additive observability, not load-bearing.
- **5.7 SOC 2 Foundations** — enterprise track, not OSR.

---

## What happens after Stage 5

A live `v0.1.0-osr` release with:
- README that is true on a fresh laptop.
- Working full and lite Compose profiles.
- Self-serve onboarding from signup to first product.
- Per-use-case consent enforced at runtime.
- Notification system across in-platform / email / webhook.
- Lineage visualization with deterministic layout.
- Comprehensive seed data for first-run exploration.
- Honest gap documentation for the deferred items above.

That is "Provenance functions properly without weird workarounds" — the bar Matt set on 2026-05-02.
