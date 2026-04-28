# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

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
