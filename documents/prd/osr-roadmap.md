# Open Source Readiness Roadmap

**Last updated:** 2026-05-02
**Authoritative blocker list:** [implementation-status.md](./implementation-status.md)
**Target definition:** Provenance functions properly without weird workarounds. Not full enterprise-ready (SOC 2, etc.) — that is Phase 6.

This document sequences the remaining Open Source Readiness work into discrete, checkpoint-able stages. Each stage is one or more PRs with a clear scope and a verification gate before moving to the next.

---

## Stage 0 — Recently shipped (already done)

For context on where we are coming from. Everything below this line still needs to happen.

- ✅ Temporal infrastructure on dev EC2 (PR `fix/temporal-runtime-on-ec2-dev`) — Temporal server now actually running, API base switched to glibc so the worker loads, `TEMPORAL_ENABLED` wired in code. Domain 12 timer work now has a runtime to schedule against.
- ✅ Hardware requirements documented (PR `docs/readme-hardware-requirements`) — Lite (8 GB) vs Full (16 GB) Compose profiles named, README sets expectations honestly.

---

## Stage 1 — Local-setup-time measurement (1–4 days)

**Why first:** cheap to do, and whatever it surfaces becomes additional must-fix scope. We do not yet know what a fresh contributor actually hits when they clone the repo and try to run it. The 4 GB RAM measurement we did was on the dev EC2 box — it tells us what already-working containers consume, not whether the install path works on a fresh machine.

**What to do:**
1. Provision a clean machine (Linux VM or borrowed laptop, 16 GB RAM minimum to use the full profile).
2. Time `git clone` → `pnpm install` → `docker compose up -d` → first successful login.
3. Document every workaround required: missing env vars, undocumented dependencies, port conflicts, broken first-run scripts, anything where you have to read code to make it work.
4. Open one bug per workaround in `documents/bugs/open.md`.

**Exit criteria:** A fresh contributor can clone and run the full stack in under 30 minutes following only the README. Every blocker found is either fixed or has a tracked bug.

**Checkpoint:** Review the bug list with Matt before deciding which ones must be fixed pre-launch vs which can be post-launch.

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

## Stage 3 — Domain 12 runtime enforcement (3–4 weeks, long pole)

**Why this is the biggest single piece:** the platform's narrative is "agents are first-class participants with per-use-case consent." Today the consent model is described in the data layer and state machine but not enforced at runtime. Shipping Open Source Ready without runtime enforcement undercuts the platform's whole story.

**Sequenced PRs (each with its own tests + verification):**

**PR 1 — Outbox publisher** (3 days)
- Redpanda producer that drains `consent.connection_reference_outbox`.
- Publishes `connection_reference.state` events on every state transition.
- Nothing else can react to state changes until this exists.

**PR 2 — Agent Query Layer in-memory cache + invalidation** (3 days)
- Per-(agent, product) connection-reference cache at the AQL.
- Subscribed to the outbox topic for invalidation per [ADR-006](../architecture/adr/ADR-006-runtime-scope-enforcement.md).
- Cache populated lazily on first request, evicted on state-change events.

**PR 3 — Enforcement check on every MCP request** (3 days)
- The actual AND-check: active grant AND active reference AND scope match.
- Four distinct denial reasons per CLAUDE.md rules: no grant, no active reference, scope violation, reference expired.
- Audit log entry on every denial. Notification to owning principal on scope violation.
- **This is the moment enforcement goes live.** Land it behind a per-org feature flag.

**PR 4 — Automatic expiration + MAJOR-version suspension** (5 days)
- Temporal workflow that fires on connection reference expiration (F12.22).
- Event-driven Temporal workflow that suspends all active references for a product on MAJOR version publication (F12.15).
- Both write audit + outbox + notification.

**PR 5 — Legacy-agent migration** (2 days)
- One-shot migration that auto-provisions 30-day legacy-compatibility references for every existing agent at enforcement activation (F12.25).
- Visually distinct in the UI, non-renewable. On expiry the agent must submit a proper request.
- Without this, flipping the enforcement flag denies every existing agent on day one.

**PR 6 — Governance override + Supervised oversight-hold + remaining cascade triggers** (1 week)
- Governance role can override consent decisions per F12.14 / F12.20.
- Supervised oversight-hold sub-state for Supervised-class agents.
- Cascade triggers for product lifecycle and owner deactivation per F12.21.
- Polish PRs to close out the domain.

**Checkpoint after PR 1, 3, and 5.** PR 3 is the largest decision moment — flipping the enforcement flag changes platform behavior for every agent.

---

## Stage 4 — F7.46 Onboarding flow (1 week)

**Why last among the must-dos:** a guided tour through a half-finished platform wastes the work. Build the tour over the path you actually want contributors to walk.

**Scope:**
- First-run wizard triggered when a user lands on an empty org.
- Steps: confirm org details → invite teammates → register a connector → publish a draft product → invite an agent.
- Skippable, dismissible, resumable. Save progress per principal.
- "Sample data" button that runs the seed CLI from the UI for users who want a populated environment instead of an empty one.

**Checkpoint:** Walk a first-time user (Matt or a friend) through the tour. Stop the moment something is unclear; that is the bug.

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

**5–7 weeks** at current cadence with one developer (Matt + Claude pair).

| Stage | Effort |
| --- | --- |
| 1. Setup-time measurement + fixes | 1–4 days |
| 2. Role + team UI | 1–2 weeks |
| 3. Domain 12 runtime enforcement | 3–4 weeks |
| 4. Onboarding flow | 1 week |
| 5. Pre-launch sweep | 2–3 days |

Domain 12 is two-thirds of the wall-clock time. Everything else is deliberately small and fast so visible progress lands weekly leading up to the long Domain 12 stretch.

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
