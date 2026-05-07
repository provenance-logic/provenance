# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-013 — `packages/types/dist/` not pre-built; workspace package resolution falls through to broken path mapping

- **Severity:** Blocker
- **Status:** Open
- **Area:** Build / monorepo

**Symptom.** On a fresh clone, after `pnpm install`, `apps/api/node_modules/@provenance/types/dist/` does not exist. The package's `package.json` declares `"main": "./dist/index.js"`, so any consumer doing `require('@provenance/types')` gets a missing-module error from Node's package resolver. Combined with B-012, this surfaces as a confusing `.ts` path in the require.

**Root cause.** `pnpm install` from the repo root does not run a recursive `build` — it only installs and links workspace packages. `packages/types` has its own `build` script (`tsc`) that generates `dist/`, but nothing invokes it before the API tries to consume the package. The README does not mention building shared packages either.

**Proposed fix.** Two paths, not mutually exclusive:

1. **Add a postinstall (or prepare) script at the repo root** that runs `pnpm --filter '@provenance/types' build`. Subtle: postinstall on a workspace install can be brittle; `prepare` runs only when installed as a package. A simpler approach is a `prebuild` / `predev` in each consumer (`apps/api/package.json`'s `dev` script becomes `pnpm --filter @provenance/types build && nest start --watch`).

2. **Add a startup script** referenced from the README — `infrastructure/scripts/dev-bootstrap.sh` — that does `pnpm install && pnpm --filter @provenance/types build && cd infrastructure/docker && docker compose up -d` in sequence. The README directs users to this script rather than to the raw `docker compose up -d`.

Option 2 also gives us a place to slot in the missing `flyway-migrate` step (see B-014) and the Keycloak post-import config (B-016, B-018).

**Related.** B-012 (tsconfig `.ts` extension) — fixing B-012 alone makes the require path clean, but B-013 still leaves the resolution to find a missing `dist/`. Both must be fixed for a fresh-clone start to work.

---

## B-014 — Default `docker-compose.yml` has no migration service; fresh DB has no schema

- **Severity:** Blocker
- **Status:** Open
- **Area:** Infrastructure / database

**Symptom.** A user following the README ("clone → `cd infrastructure/docker && docker compose up -d` → run seed") hits an opaque 500 from the seed CLI on the very first call:

```
[ERROR] POST /seed/organizations -> 500: {"statusCode":500,"message":"Internal server error"}
```

API logs reveal `relation "organizations.orgs" does not exist`. The Postgres container is healthy and accepting connections, but no platform schema has ever been applied.

**Root cause.** `infrastructure/docker/docker-compose.yml` (the file the README directs users to) declares no migration service. `infrastructure/docker/docker-compose.ec2-dev.yml` does have a `flyway-migrate` service (`flyway/flyway:10-alpine`, `restart: "no"`, runs `flyway baseline && flyway migrate` on startup) — but the EC2 file is not what the README points to. The default compose was authored on the assumption that schema would be in place "somehow," and on the EC2 dev box it always was.

**Proposed fix.** Port the `flyway-migrate` service from `docker-compose.ec2-dev.yml` into `docker-compose.yml`. Strip the EC2-specific naming/logging options. Wire `api` and `web` to depend on `flyway-migrate: condition: service_completed_successfully`. Verify the same change in `docker-compose.dev.yml` (the lite stack), which also currently has no migration step.

**Related.** B-015 (flyway baselineVersion=8 problem). The migrate service alone is not enough — even with the service present, a fresh DB will fail at V9 because of B-015. Both must be fixed together.

---

## B-021 — README onboarding paper cuts: stale Node version, npm/pnpm mismatch, wrong frontend port, broken healthcheck path, sparse seed instructions

- **Severity:** Medium (cumulative impact on first-time developer experience)
- **Status:** Open — items 1, 2, 3, 5 below remain.
- **Area:** Documentation / developer experience

**Note (2026-05-06):** Item 4 (broken API healthcheck path) shipped in commit `d8f73c4` (PR #66). The compose healthcheck now probes `/api/v1/health`. Items 1, 2, 3, and 5 remain open and will be addressed together in the README rewrite PR.

**Symptom.** Several small, independent inaccuracies in the README "Getting Started" section that, together, make the first ten minutes of contribution materially harder than they should be. None on its own is a blocker; collectively they are a thousand paper cuts:

1. **Stale Node version.** README line 221 says "Node.js 20+ and pnpm." Homebrew's current `pnpm` formula requires Node 22.13+ as of early 2026. A developer following the prereqs and installing `pnpm` via `brew` cannot run anything until they upgrade Node.

2. **npm vs pnpm mismatch.** README steps 3 and 4 instruct the user to run `cd apps/api && npm install && npm run start:dev` and `cd apps/web && npm install && npm run dev`. Two problems: (a) the repo is a `pnpm` workspace (`pnpm-workspace.yaml` at root, `workspace:*` deps), and `npm install` inside an app directory creates a divergent tree that ignores the workspace lockfile; (b) the same `docker compose up -d` from step 2 already runs `provenance-api` and `provenance-web` containers — running `npm run start:dev` in step 3 attempts to bind to port 3001 on top of the running container.

3. **Wrong frontend port.** README line 278 says the frontend is at `http://localhost:5173` (Vite default). The containerized Vite dev server in the compose stack is bound to `:3000` (which is what the Keycloak `provenance-web` client lists in its redirect URIs). A user following the README opens `:5173`, gets connection-refused, gives up.

4. **Broken healthcheck path.** `infrastructure/docker/docker-compose.yml:489` declares the API healthcheck as `wget -qO- http://localhost:3001/health` — but the actual health route is `/api/v1/health`. The container is functionally healthy after ~30s but Compose marks it as `(health: starting)` indefinitely, then `(unhealthy)`. Misleading for anyone debugging.

5. **Sparse seed instructions.** README step 6 is an 8-line `ENV=value … pnpm --filter @provenance/seed seed` block with no surrounding explanation. The dev credentials it expects (`KEYCLOAK_ADMIN_CLIENT_SECRET=provenance-admin-dev-secret`, the seed-token, etc.) are derived from defaults baked into the compose file but never explained. A user who doesn't already understand the architecture cannot tell which of the eight env vars are required vs. derivable.

**Proposed fix.** All in one README rewrite:

1. Bump prereq to "Node.js 22.13+ (matches Homebrew `pnpm`'s minimum)." Optionally pin a specific minor in `package.json#engines` and link to it.
2. Delete README steps 3 and 4 entirely. The compose stack already runs the API and web. Add a separate "Hot-reload outside Docker" section for contributors who specifically want that, and use `pnpm` (not `npm`) commands there.
3. Change "Frontend: `http://localhost:5173`" to "Frontend: `http://localhost:3000`."
4. Fix the API healthcheck in the compose to probe `http://localhost:3001/api/v1/health`. (This is a one-line fix in the compose, not in the README — fold into the same PR.)
5. Rewrite the seed instructions as: `pnpm --filter @provenance/seed seed` (one line) with a note that the env vars are read from `.env.example` defaults if not set. Add the missing defaults to `.env.example` — currently most are baked into the compose only.

None of these is hard individually. They have stayed broken because the team's daily workflow is the EC2 dev box, which never exercises the README path.

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
