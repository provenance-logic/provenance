# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-059 — Access-request approve/deny endpoints don't verify the caller owns the product

- **Severity:** Medium (authorization gap, not a complete bypass — caller must already hold `domain_owner` or `org_admin` role, but within those roles the "you can only act on *your* products" boundary is missing)
- **Status:** Open
- **Area:** Access service — `apps/api/src/access/access.service.ts` and the controller decorators
- **Discovered:** 2026-05-17, surfaced as bonus-scope while building B-055's Pending Access Requests page (PR [#127](https://github.com/provenance-logic/provenance/pull/127)). Not exploited in the seeded demo.

**Symptom.** The `POST /api/v1/organizations/:orgId/access/requests/:requestId/approve` and `…/:requestId/deny` endpoints carry `@Roles('org_admin', 'domain_owner')` on the controller. The service method (`approveRequest`, `denyRequest` in `access.service.ts`) checks that the request exists and is pending, then resolves it — but **never verifies the calling principal owns the data product the request is for.** Any `domain_owner` in the org can approve any pending request on any product, regardless of which domain they own.

Concrete walkthrough: in the seeded demo, Maya is the `domain_owner` of the marketing domain. Samuel is the `domain_owner` of supply-chain. Per current behavior, Samuel could `curl -X POST .../access/requests/<id>/approve` against a pending request for Maya's Customer 360 product, and the API would approve it — generating a grant with `granted_by_principal_id = samuel`. The audit log would record Samuel as the approver of a product he doesn't own.

**Why this is Medium, not High.** The bypass requires the caller to already hold a role-bearing principal (`domain_owner` or `org_admin`); it isn't an unauthenticated or guest-accessible defect. The exposure is "inside the org, cross-domain authority is wider than the data-mesh model intends." The Pending Access Requests page (PR [#127](https://github.com/provenance-logic/provenance/pull/127)) is correctly scoped via `forApprover=me` (joins `data_products.owner_principal_id = caller`), so the *UI* won't surface other domains' requests. But a direct API call bypasses the UI scope.

**Why it isn't Low.** Federated data mesh governance is *the* differentiator. The platform's claim is "domain teams own their data products end-to-end, including who gets access" (PRD Domain 1, federated computational governance). A cross-domain authority leak undermines that claim. A SOC 2 access-control review would flag this as a least-privilege violation even if no one had exploited it.

**Fix path.** Two options, both at the service layer (not the controller — controller-level Guards can't see the request's product without an extra DB lookup):

1. **Inline ownership check in `approveRequest` / `denyRequest`.** After loading the request, load the product, and reject if `product.ownerPrincipalId !== approvedByPrincipalId` *unless* the caller holds `org_admin` role. The `org_admin` carve-out keeps the existing "platform admin can act anywhere" semantic intact.

2. **Compose a `ProductOwnershipGuard`.** A Nest guard that runs after `RolesGuard`, reads `:requestId` from the route param, loads the request → product, and asserts ownership. Cleaner separation, more reusable, but more plumbing for a single endpoint pair.

Either option needs:
- A `RoleAssignmentService.hasRole(principalId, 'org_admin')` lookup (probably already exists for `RolesGuard`).
- A regression test in `access.service.spec.ts` that proves a non-owning domain_owner gets 403.
- Audit-log entry on the rejection so attempted cross-domain approval attempts are visible.

**Impact today.** None operationally — the seed has friendly tenants and the UI naturally scopes the queue. But it's a real defect that gates a "federated governance is real" claim. Should land before the next external demo where someone could ask "what stops domain A from approving domain B's requests?"

**Pattern.** Anywhere the platform makes a federation claim (this product is owned by this domain, this org is isolated from that org), the corresponding *enforcement* must live below the role guard, in the service layer where the resource identity is resolvable. Role guards say "you're allowed to *act*"; ownership/scope checks say "*on this specific thing*." Easy to miss both halves when the controller decoration looks complete.

---

## B-056 — Logout from `/agents` returns raw JSON 404 instead of redirecting to login

- **Severity:** Medium (UX + security-adjacent — exposes API error shapes to end users on logout)
- **Status:** Open
- **Area:** Auth flow + frontend router config
- **Discovered:** 2026-05-17, during the solo investor-demo rehearsal walkthrough.

**Symptom.** Logged in at `/agents` as any persona. Click logout. Instead of landing on the Keycloak login page, the browser displays a raw JSON 404 body: `{"message":"Cannot GET /agents","statusCode":404,"error":"Not Found"}`. The response shape is NestJS — the request is reaching the NestJS API on port 3001, not the React app on port 3000.

**Root cause hypothesis.** Two places to check:

1. **Post-logout redirect URI** in the `provenance-web` Keycloak client. If the logout `redirect_uri` is unset or points at the wrong host, Keycloak doesn't redirect cleanly, and the browser ends up at whatever URL it was on before logout — but with no auth header.
2. **Frontend route guard on `/agents`** — does the route have an auth guard that redirects to login when the user is unauthenticated, or does it fall through to a 404? Combined with the NestJS shape of the response, it suggests Caddy is proxying `/agents` to the API as a fallback when the frontend isn't authoritative for that path.

**Fix path.** Set the Keycloak `provenance-web` client `frontchannelLogout.url` (or whatever the v24+ equivalent is) to redirect to `/` post-logout. On the frontend, add an auth guard at the route level so any authenticated path renders a "redirecting to login" component when unauthenticated, instead of falling through. Both fixes together; either alone leaves the other class of paths exposed.

**Impact.** Worst possible last impression in a demo: a raw JSON error after the audience just saw a polished app. Workaround during a live demo: do not log out from `/agents`; navigate to `/` first, then log out.

---

## B-057 — Agent registry has no detail page; access grants and connection references are nowhere in the agent UI

- **Severity:** Medium (major demo gap — affects all three audience scripts in the inventory; backend has the data, UI hasn't caught up)
- **Status:** Open
- **Area:** Agent UI — `apps/web/src/features/agents/`
- **Discovered:** 2026-05-17, during the solo investor-demo rehearsal walkthrough.

**Symptom.** As `governance@acme.example.com`, navigate to Agent Registry. Marketing Copilot appears as a row with Display Name, Model, Classification, Oversight Contact, and Registered date. Clicking the row does not navigate anywhere — there is no agent detail page. As a result, there is no surface anywhere in the UI that shows:

- Which products the agent has access to (active access grants where the agent is the principal)
- The agent's active connection references (Domain 12 — required for any agent action)
- The agent's audit trail / activity history
- The agent's classification change history (which exists in `audit.audit_log` per the seed but has no UI)

**Root cause hypothesis.** Agent list rows are not wired to a route, and the agent detail route + page component may not exist at all in the frontend (or it exists but is unlinked). Backend has the data — `GET /api/v1/agents/:agentId` returns the agent record, `/api/v1/access?principalId=...&principalType=ai_agent` returns the grants, the connection references endpoint exists from the Domain 12 work. UI just hasn't been built to assemble them.

**Why this matters disproportionately.** This single missing surface affects the strongest moment in *every* audience demo script:

- **Investor (Section 10A Steps 6–7):** "Click Marketing Copilot → show classification, oversight contact, audit trail" becomes "the agent list shows... names." The "agents are first-class participants" claim is supposed to be provable in one click. It currently isn't.
- **Technical (Section 10B Step 7):** same problem; the trust-tier story has no visual anchor.
- **Governance (Section 10C Step 5):** same problem; the federated-governance-for-agents story is also blunted.

Plus the Domain 12 story (connection references + per-use-case consent) has no UI surface at all — it's a backend-only feature today.

**Fix path.** Build the agent detail page. Minimum viable: identity fields (already in the row) + a tab strip with Access Grants, Connection References, Audit Trail tabs. Each tab is a simple table backed by the existing endpoints. Estimate: 1–2 days of frontend work given the data is all available; longer if the connection-reference list endpoint isn't yet wired through the agent-id filter.

**Impact today.** All three demo scripts need partial rewrites. Workaround per the inventory: collapse the agent beat to "show the row, point at classification + oversight, narrate the audit story." Loses the visual punch.

This entry **subsumes** what was originally written up as a separate "agent detail page missing access grants" bug — same root surface; once the detail page exists, that content becomes part of it. Tracked together here to avoid double-counting.

---

## B-058 — Trust-score-drop notification missing from `governance@acme.example.com` inbox

- **Severity:** Low (seed data fix; trivial PR. Kills one specific demo beat but the workaround is identical-content for `finance-lead@acme.example.com`.)
- **Status:** Open
- **Area:** Seed — `packages/seed/src/notifications/acme-corp-notifications.ts`
- **Discovered:** 2026-05-17, during the solo investor-demo rehearsal walkthrough.

**Symptom.** As `governance@acme.example.com`, the notification inbox contains three items: Access Request SLA Breach, Compliance Drift Detected (unread), Classification Changed (read). The Daily Revenue Recognition trust-score drop notification (0.91 → 0.78) — listed in `documents/demo-scripts/demo-asset-inventory.md` Section 6 as a `governance@acme` signal — is absent.

**Root cause.** The trust-score-drop notification is seeded only for `finance-lead@acme.example.com` (where it makes sense — the owner of the affected product). The asset inventory's Section 6 incorrectly lists it under the `governance@acme.example.com` signals; the seed itself never had a corresponding entry for the governance principal.

**Fix path.** Two options:

1. **Add a `governance@acme.example.com` recipient** to the trust-score-drop notification in `packages/seed/src/notifications/acme-corp-notifications.ts`. Honest defense: governance roles should be aware of significant trust-score regressions across all products in their org, not just the owning domain. Smallest diff. Use `seedKey: 'acme:governance:trust:revenue-daily'` to keep idempotency safe.
2. **Correct the asset inventory** to remove the trust-score-drop signal from the `governance@acme` list and add a redirect to log in as `finance-lead` for that beat.

Option 1 is the better answer — governance *should* see this — and it preserves the demo script as written.

**Impact.** The investor demo's strongest single moment (per the inventory: *"the platform tells you something is wrong before you ask"*) requires switching personas. Workaround: log in as `finance-lead@acme.example.com` for that beat. No correctness implication.

---

## B-050 — Smoke-test layer 2 step 3 hits a non-existent `/api/v1/organizations/me` route

- **Severity:** Low (smoke-test gap, not a product-surface bug)
- **Status:** Open
- **Area:** Smoke test / API surface
- **Discovered:** 2026-05-16, during the post-B-048 verification cycle when smoke-test layer 2 step 3 reached the authenticated API call check.

**Symptom.** `demo-smoke-test.sh` layer 2 (auth) step 3 issues `curl -H "Authorization: Bearer $USER_TOKEN" $BASE_URL/api/v1/organizations/me`. The API returns HTTP 500. NestJS pattern-matches `me` as the `:orgId` path parameter of `/organizations/:orgId`, passes the literal string `"me"` to PostgreSQL as a UUID, and the DB throws `invalid input syntax for type uuid: "me"`. The exception bubbles up as the 500.

**Root cause.** The smoke test was written against an API endpoint that doesn't ship. Routes on `OrganizationsController` (apps/api/src/organizations/organizations.controller.ts) are: `@Get()` (list), `@Get(':orgId')`, `@Get(':orgId/domains')`, `@Get(':orgId/domains/:domainId')`, `@Get(':orgId/members')`, `@Get(':orgId/domains/:domainId/members')`. No `/me` route.

**Two fix paths:**

1. **Update the smoke test.** Decode the JWT's `provenance_org_id` claim and call `/api/v1/organizations/$ORG_ID` directly. No API change. Smallest diff — and arguably more honest, since the JWT already carries the answer.
2. **Add `/organizations/me` route to the API.** New controller action that reads the request principal's org from the JWT and returns the org row. Tiny addition, but adds a route table entry and a duplicated lookup path to maintain.

Path 1 is the simpler choice unless `/me` is wanted as a convenience for other future smoke tests / client code.

**Impact today.** None on B-048 verification (verified manually by decoding the JWT inside the demo box, bypassing the smoke test). Will need to be resolved before `demo-smoke-test.sh` can run end-to-end as a CI / pre-demo gate.

---

## B-029 — EC2 dev box: Vite HMR bind-mount staleness; `restart` not enough, `--force-recreate` needed

- **Severity:** Low
- **Status:** Open
- **Area:** Operations / EC2 dev box
- **Discovered:** 2026-05-14, immediately after B-028 was fixed and while verifying a frontend nav change.

**Symptom.** A source edit to `apps/web/src/shared/components/NavShell.tsx` was applied on the host (visible via `grep` from `/opt/provenance`), and Vite was running in dev mode inside the web container with a `:cached` bind mount of the source. Expected: Vite's HMR fires an `[vite] hmr update` log and the browser updates. Actual: no HMR update, the web container's view of the file was still the pre-edit content (confirmed by `docker exec provenance-ec2-web cat /app/apps/web/src/shared/components/NavShell.tsx`).

**Root cause.** Docker bind mounts on Linux can drop inotify events that Vite's file watcher relies on, particularly under certain combinations of host filesystem and Docker storage driver. `docker compose restart web` does NOT cure this — it stops and starts the same container with the same stale mount state. Only `docker compose up -d --force-recreate web` creates a fresh container with a fresh bind mount, which then reads the current host file.

**Why it matters.** Without `--force-recreate`, a frontend code change can appear deployed (file is on disk, branch is checked out) but the dev box's browser keeps serving the old version. Easy to think "my fix didn't work" and chase phantom bugs.

**Proposed fix.** Same as B-028 fix 1: a runbook paragraph noting that frontend code changes on the dev box require `docker compose up -d --force-recreate web`, not `restart web`. Pair with B-028 in `operations.md`.

A more invasive fix would be enabling Vite's `server.watch.usePolling` config, which works around inotify gaps at the cost of constant CPU polling. Not worth it for a dev environment that's shut down most of the time; skip unless this bites repeatedly.

---

## B-023 — F7.7 Role Assignment UI: `platform_admin` and `platform_observer` roles not modeled

- **Severity:** Low
- **Status:** Open
- **Area:** Identity / role model
- **Discovered:** 2026-05-14, during F7.7 implementation.

**Symptom.** PRD F7.7 names two role types — Platform Admin and Platform Observer — that do not exist in the `RoleType` enum (`packages/types/src/organizations.ts`). The current enum has `org_admin`, `domain_owner`, `data_product_owner`, `consumer`, `governance_member`.

**Resolution chosen for F7.7 v1.** Treat `org_admin` as the Platform Admin function; skip Platform Observer entirely. No migration, no Keycloak realm change, no RolesGuard update. The Roles UI shows the existing five roles only.

**When this matters.** If/when the platform grows a distinction between organization-scope administration (`org_admin`) and platform-instance-scope administration (a single principal who governs across all orgs on the deployment), we will need to:

1. Add `platform_admin` and `platform_observer` to the `RoleType` enum.
2. Migration extending the `identity.role_assignments` CHECK constraint.
3. Seed the new realm roles in `infrastructure/docker/config/keycloak/realm-export.json`.
4. RolesGuard checks at platform-level endpoints (cross-org listing, audit access).
5. Update the F7.7 UI to surface them.

**Impact today.** None — Provenance's MVP is single-tenant-per-deployment, and `org_admin` is functionally Platform Admin. This is a forward-compatibility seam, not a user-facing gap.

---

## B-024 — F7.7 Role Assignment UI: governance acknowledgment gate not implemented for `governance_member` assignment

- **Severity:** Low
- **Status:** Open
- **Area:** Governance / role assignment
- **Discovered:** 2026-05-14, during F7.7 implementation.

**Symptom.** PRD F7.7 states: "Governance role assignment requires governance layer acknowledgment." The F7.7 v1 UI allows any `org_admin` to assign `governance_member` immediately, without requiring sign-off from an existing governance member.

**Resolution chosen for F7.7 v1.** Defer. Per `documents/prd/osr-roadmap.md`'s "deferred with no shame" pattern, the acknowledgment gate is acceptable v1 — an org_admin who assigns governance is auditable through the existing `role_assigned` audit-log entry, so misuse is detectable even without preventive control.

**Proposed fix path.** When governance acknowledgment is built, the natural shape is a "pending governance approval" state on `identity.role_assignments` (new column or sibling table), with:

1. `addMember` for `role='governance_member'` creates a pending row + notification to existing governance members.
2. New endpoint for governance to approve/deny.
3. UI surface in the governance command center.
4. RolesGuard sees pending assignments as inactive until approval.

Composes naturally with Domain 11 notifications and Domain 4 governance flows; this is a Phase 6 follow-on, not OSR-blocking.

---

## B-011 — OPA 0.63.0 image is amd64-only; Apple Silicon contributors run under emulation

- **Severity:** Medium
- **Status:** Open
- **Area:** Infrastructure / developer experience
- **Discovered:** 2026-05-07, during the first external-developer onboarding test on a fresh Apple Silicon MacBook.

**Symptom.** On `arm64/v8` hosts (Apple Silicon — M1/M2/M3/M4 Macs), `docker compose up -d` emits the warning `The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8) and no specific platform was requested`. Docker pulls and runs the OPA container under amd64 emulation. With the B-010 healthcheck fix in place the stack does come up, but every OPA call carries emulation overhead.

**Root cause.** `openpolicyagent/opa:0.63.0`'s manifest contains only `linux/amd64`. OPA did not publish multi-arch (amd64 + arm64) images until the 1.16.x line — earlier 0.x and 1.0–1.15 tags are amd64-only. Confirmed via Docker Hub manifest inspection on 2026-05-07.

**Impact.** Functional: stack works. Performance: OPA is ~3–5× slower under emulation than native, which inflates policy-evaluation latency on contributor laptops. None of this affects the EC2 dev box or the production target (both amd64). The user-visible cost is slower local feedback for Apple Silicon contributors and a confusing-looking platform-mismatch warning during first run.

**Proposed fix.** Bump the OPA image to a multi-arch tag — `openpolicyagent/opa:1.16.x` or later. Two complications to investigate before merging:

1. **Rego v1 default.** OPA 1.x changed the default Rego language version from v0 to v1. Our bootstrap policy at `infrastructure/docker/config/opa/policies/health.rego` uses v0 syntax (`default ok = true` rather than `default ok := true`) and would need either a `import rego.v1` directive, a syntax migration, or invoking OPA with `--v0-compatible`. Any Rego that the platform compiles at runtime (governance policy compiler) needs the same audit.
2. **Behavioral compatibility.** A 0.63 → 1.16 jump skips ~3 years of OPA changes. We need to run the existing governance test suite against the new image before flipping the dev compose default, even if no Rego syntax errors surface.

**Workaround until fix.** Apple Silicon contributors can run the stack as-is once B-010 is fixed — emulation is slow but functional. No action required from contributors; the warning is cosmetic.

---

## B-001 — Mailhog dev email not surfaced in UI

- **Severity:** Medium
- **Status:** Open
- **Area:** Onboarding / developer experience
- **Environment:** EC2 dev (`https://dev.provenancelogic.com`)

**Symptom.** New users who trigger any flow that sends email (self-serve signup welcome email, invitation accept link, UPDATE_PASSWORD link) cannot see the email from the UI — they must have shell access on the EC2 host and `curl http://localhost:8025` to read Mailhog's inbox. Non-engineering stakeholders evaluating the platform cannot complete onboarding.

**Root cause.** `infrastructure/docker/docker-compose.ec2-dev.yml` runs Mailhog with port `8025` bound only to the host loopback; Caddy does not expose it on `dev.provenancelogic.com`. There is no in-app "dev inbox" viewer.

**Proposed fix.** Two options:
1. Add a Caddy route `/mailhog/*` (behind basic auth or a dev-only IP allowlist) that proxies to `mailhog:8025`. Lowest-effort.
2. Embed a minimal React inbox viewer in the frontend that queries Mailhog's `/api/v2/messages` endpoint. Better UX but more code.

Option 1 is acceptable for dev. Not an issue for production (real SES there).

---

## B-002 — Two-view inconsistency: dashboard vs marketplace product views

- **Severity:** Medium
- **Status:** Open
- **Area:** Discovery / publishing

**Symptom.** The same data product renders different information depending on which surface the user lands on:
- `apps/web/src/features/publishing/ProductDetail.tsx` (reached from `/dashboard/:orgId/domains/:domainId/products/:productId`) shows one set of fields.
- `apps/web/src/features/discovery/ProductDetailPage.tsx` (reached from `/marketplace/:orgId/:productId`) shows a different set.

Domain owners see one shape of truth while consumers see another, leading to confusion about what a product actually exposes (ownership, freshness, column schema, access status).

**Root cause.** The two pages grew independently — the publishing view was written first for domain teams; the marketplace view was written later and adopted a different get-product shape. Neither was consolidated when the 5.4 P1 enrichment work landed.

**Proposed fix.** Both pages should consume the same product-detail hook backed by a single `get_product` response shape. The PRD v1.5 "Domain 9 Priority 1 completeness" gap is adjacent — resolve together.

---

## B-003 — WCAG 2.1 AA compliance unverified

- **Severity:** Medium (Blocker for public open-source launch per the accessibility commitment)
- **Status:** Open

**Symptom.** The frontend has not been audited against WCAG 2.1 AA. Known gaps spotted casually: no skip-links, inconsistent focus outlines after Tailwind reset, some icon-only buttons without `aria-label`, form validation error text associated by proximity rather than `aria-describedby`.

**Proposed fix.** Run `axe-core` against every top-level route, fix hard failures, and add a lint-time a11y check (`eslint-plugin-jsx-a11y` is already pulled in; raise its rules from warn to error). Add a `documents/architecture/accessibility.md` that names the target, the audit tooling, and the sign-off criteria before a release can ship.

---

## B-005 — Decommissioned products still visible in domain dashboard

- **Severity:** Low
- **Status:** Open
- **Area:** Publishing / lifecycle
- **Environment:** EC2 dev (`https://dev.provenancelogic.com`)

**Symptom.** "Phase 4b Verification Product" was decommissioned but still appears in the domain dashboard product list. The marketplace correctly hides decommissioned products from consumers, but domain owners see the full lifecycle history (including decommissioned rows) in the authoring surface.

**Root cause (suspected).** `apps/web/src/features/publishing/DomainDashboard.tsx` calls `productsApi.list(...)` without passing a `status` filter, and the API returns every row regardless of lifecycle state. The marketplace path filters server-side to `published | deprecated` only.

**Proposed fix.** Either (a) hide decommissioned rows by default in the domain dashboard with an "Include decommissioned" toggle, or (b) visually demote decommissioned rows (greyed out, grouped at the bottom) so they remain discoverable for audit purposes without cluttering the primary workflow.

Related to the broader Domain 9 lifecycle-visibility gap noted in CLAUDE.md (Phase 5 walkthrough findings).

---

## B-006 — Add Port UI does not enforce contract schema on output ports

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / port authoring

**Symptom.** When adding an output port via the Add Port form in `apps/web/src/features/publishing/ProductDetail.tsx`, the contract schema textarea is not required. A user can save an output port with no contract schema, then only discover the gap at publish time when the API rejects with `Output ports must have a contract schema: <names>`. By that point the user has moved on from port authoring and the feedback is disconnected from the action that caused it.

**Root cause.** The Add Port form marks the contract schema field with a `required` label prop (cosmetic) but the submit handler does not enforce non-empty contract schema for output ports before calling `productsApi.ports.declare()`. Backend validation in `ProductsService.publishProduct()` is correct and authoritative — the frontend simply doesn't mirror it at authoring time.

**Proposed fix.** In the Add Port form submit handler, when `portType === 'output'`, reject submission (display inline error, keep the form open) if `contractSchemaRaw.trim() === ''` or the parsed schema lacks a `properties` / columns shape. Same check applies to any future Edit Port form. Consider refactoring the validation into a shared `validateOutputPortDraft(dto)` helper that both frontend and tests can share.

This is analogous to — and should share scaffolding with — the new connection-details field validation added in Workstream B.

---

## B-007 — Ports not editable after creation

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / port authoring

**Symptom.** Port cards in `apps/web/src/features/publishing/ProductDetail.tsx` only expose a Remove button. There is no Edit affordance, so a user who notices a typo in a port's name, description, contract schema, or (now) connection details has to delete the port and re-add it from scratch. The backend already supports port edits (`PATCH /organizations/:orgId/domains/:domainId/products/:productId/ports/:portId`) — this is a frontend-only gap.

**Root cause.** When the port card was built for Phase 1, ports were mostly declarative metadata and "remove + re-add" was acceptable friction. With Workstream B landing, ports now carry a non-trivial connection-details payload (host, port, database, credentials, etc.) — deleting and re-typing all of that to fix one field is a real papercut.

**Proposed fix.** Add an inline Edit mode to the port card that reuses the Add Port form's fields (including `ConnectionDetailsFields`). Submit via `productsApi.ports.update(...)`. Only author-surface state should be editable — generated artifacts like `connectionDetailsValidated` stay read-only. Consider also auto-resetting `connectionDetailsValidated` to false when any connection-details field changes (the backend already does this per `ProductsService.updatePort()`).

Blocks comfortable authoring now that connection details are required.

---

## B-008 — Request Access button shown to product owner in dashboard view

- **Severity:** Medium
- **Status:** Open
- **Area:** Publishing / access
- **Related:** B-002

**Symptom.** On the dashboard product detail page (`apps/web/src/features/publishing/ProductDetail.tsx`), an authenticated product owner sees a "Request Access" button for their own product. The marketplace product detail page (`apps/web/src/features/discovery/ProductDetailPage.tsx`) handles the same case correctly — it shows "You own this product" and suppresses the access request affordance.

**Root cause.** Two independent ownership-detection code paths. The marketplace view derives effective access state from `product.ownerPrincipalId === ctx.principalId`. The dashboard view renders the access request CTA unconditionally once the product is published. This is a manifestation of the broader two-view inconsistency tracked in B-002 — neither page pulls ownership/access status from a shared hook.

**Proposed fix.** Fold both views onto the same `useProductAccessState(productDto, principal)` hook that returns an enum `{ owner | granted | pending | denied | not_requested }` and lets each page render the appropriate CTA. The hook should be the single source of truth for "can this principal act on this product?" Resolve together with B-002 when the shared product-detail hook lands.
