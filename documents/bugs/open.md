# Open Issues

Known bugs and unresolved issues on the Provenance platform. Sorted by severity (high → low). Resolved items move to [resolved.md](./resolved.md) with the commit that fixed them.

**Triage conventions**

- **Severity** — Blocker (breaks a P0 flow for real users), High (breaks a P0 flow only in non-prod, or a P1 flow in prod), Medium (UX friction, workaround exists), Low (cosmetic / doc / dev ergonomics).
- **Status** — Open, In progress, Needs repro. Every fix PR must close the entry with the commit hash and move it to `resolved.md`.

---

## B-012 — `apps/api/tsconfig.json` path mapping has literal `.ts` extension; API container crashes on startup

- **Severity:** Blocker
- **Status:** Open
- **Area:** Build / API
- **Discovered:** 2026-05-07, during the first external-developer onboarding test on a fresh Apple Silicon MacBook.

**Symptom.** Following the README "Getting Started" path on a fresh clone, the `provenance-api` container crashes immediately after `docker compose up -d` with:

```
Error: Cannot find module '../../../../packages/types/src/index.ts'
Require stack:
- /app/apps/api/dist/apps/api/src/notifications/notifications.service.js
- /app/apps/api/dist/apps/api/src/observability/slo.service.js
...
```

The container goes into a restart loop. Every authenticated path is unreachable. The frontend can render its login page but cannot reach the backend.

**Root cause.** `apps/api/tsconfig.json:10` declares the path mapping with a literal `.ts` extension:

```json
"paths": { "@provenance/types": ["../../packages/types/src/index.ts"] }
```

`nest build` (which the dev container runs via `pnpm dev` → `nest start --watch`) inlines this path verbatim into emitted requires — so `import { ... } from '@provenance/types'` in `notifications.service.ts` becomes `require("../../../../packages/types/src/index.ts")` in `dist/apps/api/src/notifications/notifications.service.js`. Node's CommonJS resolver does not load `.ts` files; the require throws `MODULE_NOT_FOUND` and the entire module graph fails to load.

The reason this was not caught on the EC2 dev box is that EC2 also has `packages/types/dist/` pre-built on disk (from a prior `pnpm -r build` or similar), so the symlink at `apps/api/node_modules/@provenance/types/dist/index.js` resolves and Node's normal package resolution kicks in — masking the path-mapping bug. On a fresh clone the dist is missing (see B-013) and the path-mapping bug surfaces.

**Proposed fix.** Drop the `.ts` extension from the paths mapping:

```json
"paths": { "@provenance/types": ["../../packages/types/src/index"] }
```

After this change the emitted require is the unmangled `require("@provenance/types")`, which Node resolves through `node_modules` via the package's own `main` field. Verify after fix that `dist/apps/api/src/notifications/notifications.service.js` contains `require("@provenance/types")` and not a relative path.

**Pattern.** TypeScript path mappings should never carry file extensions. Even when the mapping resolves correctly at type-check time, Nest's webpack-mode build inlines the literal string at emit time, and a `.ts` extension means the dist is unloadable. This applies to any future workspace package mapping in any of our tsconfig files.

**Related.** B-013 (packages/types not pre-built) compounds the failure mode — even without B-012, a fresh checkout would hit the missing `dist/` issue.

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

## B-015 — `flyway.conf` `baselineVersion=8` causes V9 to fail on a fresh database

- **Severity:** Blocker
- **Status:** Open
- **Area:** Infrastructure / database

**Symptom.** Even when Flyway is run against a fresh, empty Postgres (manually or via the `flyway-migrate` service from B-014), migration fails at V9:

```
ERROR: Migration of schema "organizations" to version "9 - create lineage schema" failed!
SQL State : 42P01 — relation "organizations.orgs" does not exist
```

V1–V8 are reported as "skipped" — Flyway sees the empty `flyway_schema_history` table, stamps it at version 8 per `flyway.baselineVersion=8` in the conf, then jumps straight to V9 which depends on tables created in V1.

**Root cause.** `apps/api/flyway.conf` sets `flyway.baselineVersion=8` and `flyway.baselineOnMigrate=true`. The intent (presumably) was to handle a one-time historical migration where an existing database had V1–V8 applied via some other path and Flyway was bolted on starting at V9. That assumption does not hold for any new install. On a fresh DB the baseline is wrong by definition.

**Proposed fix.** Drop the baseline configuration entirely. The conf should be:

```
flyway.url=jdbc:postgresql://${FLYWAY_HOST:localhost}:${FLYWAY_PORT:5432}/${FLYWAY_DATABASE:provenance}
flyway.user=${FLYWAY_USER:provenance}
flyway.password=${FLYWAY_PASSWORD:provenance_dev_password}
flyway.locations=filesystem:./migrations
flyway.schemas=organizations,identity,products,audit,governance,connectors,access,consent,lineage,observability
flyway.defaultSchema=organizations
flyway.validateOnMigrate=true
flyway.outOfOrder=false
```

V1–V27 will then apply in order from a fresh DB. Existing EC2 / demo databases that already have the V1–V8 schema applied need a one-time `DELETE FROM organizations.flyway_schema_history WHERE version <= 8` and a re-run, or an explicit Flyway `repair` — but verify this carefully against the live EC2 dev box before rolling out.

**Related.** B-014 (no migrate service in default compose). Together these are the "fresh DB cannot be initialized" story.

---

## B-016 — `provenance-admin` Keycloak service account has no realm-management roles in realm import

- **Severity:** Blocker
- **Status:** Open
- **Area:** Identity / Keycloak

**Symptom.** With migrations applied and the API up, the seed CLI fails at the second step:

```
[INFO] seed: orgs
[INFO] seed: users
[ERROR] Keycloak admin GET /users?email=admin%40acme.example.com&exact=true -> 403: {"error":"unknown_error",...}
```

Any platform code path that calls Keycloak Admin REST as the `provenance-admin` client (seed user creation, invitation acceptance, agent client provisioning per ADR-002) hits the same 403.

**Root cause.** `infrastructure/docker/config/keycloak/realms/provenance-realm.json` declares the `provenance-admin` confidential client with `serviceAccountsEnabled: true` and the correct secret, but does not assign any `realm-management` client roles to its service account user. Keycloak by default gives a service account zero admin permissions — querying users, creating users, listing/creating clients all require explicit role grants. The EC2 dev box `infrastructure/docker/scripts/configure-keycloak-ec2.sh` (lines 222–226) grants the required roles via `kcadm add-roles` after import, but no equivalent runs for the local Compose stack.

The roles required (per the EC2 script) are `manage-users`, `query-users`, `manage-clients`, `query-clients`, `view-users`, `view-realm`.

**Proposed fix.** Two options:

1. **Encode the role grants in the realm JSON.** Keycloak's RealmRepresentation supports a top-level `users` array entry for `service-account-provenance-admin` with `clientRoles: { "realm-management": ["manage-users", "query-users", ...] }`. The catch: this user is created automatically by Keycloak when the client is imported with `serviceAccountsEnabled: true`, and asserting it in the JSON requires careful ordering. Worth verifying against Keycloak 24.0.3 import behavior.

2. **Run a post-import hook from compose.** Add a one-shot `keycloak-bootstrap` service to `docker-compose.yml` that depends on `keycloak: service_healthy` and runs the relevant subset of `configure-keycloak-ec2.sh` (the parts not specific to the EC2 hostname / TLS wiring). This is the same pattern as B-018 below — both bugs are missing post-import steps and could share one bootstrap service.

Option 2 is more flexible and gives us a single home for "things Keycloak needs after first boot." Option 1 is purer (everything in the realm JSON, declarative) but has more import-ordering footguns.

**Related.** B-018 (unmanagedAttributePolicy not enabled) is a sibling Keycloak post-import gap. Fix together.

---

## B-017 — Seed data uses `interface_type: 'semantic_query'` but DB CHECK constraint expects `'semantic_query_endpoint'`

- **Severity:** Blocker (for the seed flow specifically)
- **Status:** Open
- **Area:** Seed / data product schema

**Symptom.** Once Keycloak admin works (B-016 fixed), the seed CLI fails at the products step with:

```
QueryFailedError: new row for relation "port_declarations" violates check constraint "port_declarations_interface_type_check"
```

The offending insert has `"interface_type": "semantic_query"`. The DB CHECK constraint (defined in V3) accepts `'sql_jdbc' | 'rest_api' | 'graphql' | 'streaming_topic' | 'file_object_export' | 'semantic_query_endpoint'` — note the `_endpoint` suffix.

**Root cause.** Two code locations in the seed package use the short form `'semantic_query'` instead of the canonical `'semantic_query_endpoint'`:

- `packages/seed/src/types.ts:52` — the `PortInterfaceType` union
- `packages/seed/src/products/acme-corp-products.ts:45,54` — two output port declarations on the customer-360 product

Nothing else in the codebase uses the short form (CLAUDE.md and the architecture document use `Semantic query endpoint`). This is a typo introduced when the seed package was authored and never caught because the seed CLI was added late in Phase 5.6 and never ran end-to-end against a fresh DB (the EC2 dev DB had its products manually inserted before the seed package existed).

**Proposed fix.** Rename `'semantic_query'` to `'semantic_query_endpoint'` at both locations in the seed. Trivial. Verify after the fix that the seed runs cleanly against a fresh DB and that the seeded customer-360 product exposes a semantic-query endpoint visible in the marketplace.

**Pattern.** Any seed value that lands in a CHECK-constrained column should be derived from the same TypeScript union the API uses, not redeclared in the seed package. Worth a follow-up: have `packages/seed/src/types.ts` import `PortInterfaceType` from `@provenance/types` rather than maintaining its own copy.

---

## B-018 — Realm `unmanagedAttributePolicy` not enabled in import; provenance_* user attributes silently dropped

- **Severity:** Blocker
- **Status:** Open
- **Area:** Identity / Keycloak

**Symptom.** With B-016 fixed, the seed CLI runs to completion and creates Keycloak users for the seeded principals — apparently writing `provenance_org_id` and `provenance_principal_type` as user attributes. But a subsequent password-grant token for any seeded user contains *neither* claim:

```json
{
  "preferred_username": "admin@acme.example.com",
  "email": "admin@acme.example.com",
  "name": "Ada Admin"
  // no provenance_org_id, no provenance_principal_type
}
```

The frontend's `RequireOrg` guard reads `keycloak.tokenParsed.provenance_org_id` to decide if a user has joined an org — without this claim every login lands on `/onboarding/org` regardless of seeded state. The API's tenant-isolation middleware also rejects every request for missing `provenance_org_id`.

**Root cause.** Keycloak 24's User Profile feature (enabled by default for new realms) refuses to persist any attribute not declared in the realm's user-profile schema — unless `unmanagedAttributePolicy` is set. The realm JSON does not set this, so Keycloak silently drops the seed's `provenance_org_id` write on user create. The protocol mappers on the `provenance-web` client are correctly defined, but they map from an attribute that does not exist on the user. The EC2 dev box `configure-keycloak-ec2.sh` (line 124) sets `unmanagedAttributePolicy=ADMIN_EDIT` after import; no equivalent runs for the local Compose stack.

CLAUDE.md notes this Keycloak-24 quirk for the EC2 setup but it was never propagated to the local realm import.

**Proposed fix.** Add `unmanagedAttributePolicy: "ADMIN_EDIT"` to the realm JSON top-level (`infrastructure/docker/config/keycloak/realms/provenance-realm.json`). Keycloak's RealmRepresentation accepts the field at import time. Alternatively, declare each `provenance_*` attribute explicitly in a `userProfile.attributes` block — more declarative but more verbose.

This pairs with B-016 — both are "missing post-import Keycloak config." If we go with the bootstrap-service approach there (option 2), this one slots into the same place. If we go with the in-realm-JSON approach for B-016, do this in the same JSON.

---

## B-019 — `KEYCLOAK_ISSUER_URL` default in `docker-compose.yml` lacks `/realms/{realm}` path; API rejects every JWT with 401

- **Severity:** Blocker
- **Status:** Open
- **Area:** Infrastructure / API

**Symptom.** With B-018 fixed and a JWT now correctly carrying `provenance_org_id`, every authenticated API call returns 401:

```
GET /api/v1/organizations/.../domains
{"message":"Unauthorized","statusCode":401}
```

There is nothing in the API logs at warn or above — the rejection happens silently in passport-jwt's issuer validation.

**Root cause.** `infrastructure/docker/docker-compose.yml:442` sets `KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080}`. The matching JWT issuer claim is `http://localhost:8080/realms/provenance` (Keycloak always issues with the full realm path). `apps/api/src/auth/jwt.strategy.ts:25-31` documents that `KEYCLOAK_ISSUER_URL` must be the *full* issuer including the realm path:

```ts
// KEYCLOAK_ISSUER_URL is the FULL issuer as it appears in the JWT `iss`
// claim, including the /realms/{realm} suffix. Appending /realms/{realm}
// to an already-full issuer URL double-nests …
```

The default in the compose file violates this contract. The EC2 compose has it correct (`https://auth.provenancelogic.com/realms/provenance`); the local default and `docker-compose.dev.yml` do not.

**Proposed fix.** Patch the default in both `docker-compose.yml:442` and `docker-compose.dev.yml:153`:

```yaml
KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080/realms/provenance}
```

Add a Zod check in `apps/api/src/config.ts` that rejects a `KEYCLOAK_ISSUER_URL` that does not include `/realms/`. Cheap, prevents this exact bug recurring.

**Related.** Per CLAUDE.md, "A new env var must land in every config layer at once." This is the inverse — an existing env var with inconsistent defaults across compose files. Same root cause.

---

## B-020 — `VITE_API_BASE_URL` defaults to Kong (`localhost:8000`), but Kong has no API routes provisioned in default compose

- **Severity:** Blocker
- **Status:** Open
- **Area:** Infrastructure / frontend

**Symptom.** With API auth now working, the frontend at `http://localhost:3000` loads but every API call from the browser fails with a Kong 404. `curl http://localhost:8000/api/v1/health` confirms Kong returns 404 for every path. `curl http://localhost:8001/services` shows Kong has zero services configured.

**Root cause.** `infrastructure/docker/docker-compose.yml:593` sets `VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:8000/api/v1}` — pointing the frontend at Kong, the API gateway. Kong is up and healthy (its own DB migration ran), but no routes have been declared for the Provenance API. On the EC2 stack Kong has Caddy in front of it and a separately-provisioned route table; on the default compose Kong is essentially decorative — it accepts connections but routes nothing.

**Proposed fix.** Two paths:

1. **Repoint the frontend at the API directly.** Change the default to `http://localhost:3001/api/v1`. The API container already exposes 3001 to the host. CORS is already permissive in dev (the `provenance-web` Keycloak client lists `http://localhost:3000` as an allowed origin). This is the minimal-change fix — the frontend talks to `:3001` for everything and Kong becomes inert in the local stack.

2. **Provision Kong routes at startup.** Add a `kong-routes-bootstrap` one-shot service to the compose that POSTs the API service and route definitions via Kong Admin API once Kong is healthy. This preserves the production-shaped topology (frontend → Kong → API) at the cost of more moving parts to maintain.

Option 1 is the right call for the local stack — it matches what most developers actually want during contribution and keeps the README path simple. If we later need to rehearse Kong-mediated traffic locally, that's a `docker-compose.kong-local.yml` overlay, not the default. Either way, the current state (frontend points at empty Kong) is broken.

---

## B-021 — README onboarding paper cuts: stale Node version, npm/pnpm mismatch, wrong frontend port, broken healthcheck path, sparse seed instructions

- **Severity:** Medium (cumulative impact on first-time developer experience)
- **Status:** Open
- **Area:** Documentation / developer experience

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
