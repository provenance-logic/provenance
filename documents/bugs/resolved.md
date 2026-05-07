# Resolved Bugs

Reference log of bugs that have been fixed. Kept so patterns and root causes are searchable without digging through git history. Each entry links to the fix commit.

Entries are ordered newest first. When opening a bug in [open.md](./open.md), check this file first — the same root cause may have already been diagnosed.

---

## B-013 — `packages/types/dist/` not pre-built; workspace package resolution falls through to broken path mapping

- **Fixed:** 2026-05-07 — commit `<pending>`
- **Severity:** was Blocker
- **Area:** Build / monorepo

**Symptom.** On a fresh clone, after `pnpm install`, `apps/api/node_modules/@provenance/types/dist/` did not exist. The package's `package.json` declares `"main": "./dist/index.js"`, so any consumer doing `require('@provenance/types')` got a missing-module error from Node's package resolver. Combined with B-012, this surfaced as a confusing `.ts` path in the require.

**Root cause.** `pnpm install` from the repo root does not run a recursive `build` — it only installs and links workspace packages. `packages/types` has its own `build` script (`tsc`) that generates `dist/`, but nothing invoked it before the API tried to consume the package. The README did not mention building shared packages either.

**Fix.** Two coordinated changes:

1. **Root `package.json`:** added `"postinstall": "pnpm --filter @provenance/types build"`. Pnpm runs the project's own `postinstall` script after every install, so the host's `pnpm install` (the step the README directs the user to before `docker compose up -d`) now produces `packages/types/dist/`. Containers volume-mount `packages/types/` from the host, so the freshly-built dist is visible to `apps/api`'s `nest start --watch` and `apps/web`'s Vite dev server at runtime.

2. **`apps/{api,web,agent-query}/Dockerfile` deps stages:** added `--ignore-scripts` to `pnpm install --frozen-lockfile`. The deps stages copy only the `package.json` files (not `packages/types/src`), so a postinstall that calls `tsc` would fail at docker build time. The flag suppresses lifecycle scripts during the deps stage; the install itself is unaffected.

Considered alternative: `predev` / `prebuild` scripts on each consumer (`apps/api`, `apps/web`) that build types before invoking the consumer's own build. Rejected because (a) it would need extra Dockerfile changes to put `pnpm-workspace.yaml` into the development stage so `pnpm --filter` can resolve, (b) it pushes per-package responsibility for a workspace-wide concern, and (c) the host postinstall is more robust against new consumers being added later.

Considered alternative: `infrastructure/scripts/dev-bootstrap.sh` that wraps `pnpm install` + types build + `docker compose up -d`. Rejected because the OSR target is "function properly without weird workarounds" — a wrapper script *is* a weird workaround when the workspace root's `package.json` can carry the responsibility. The B-013 writeup originally favored option 2 partly because it would also slot in B-016/B-018 fixes — both of those landed declaratively in PR #66 and no longer motivate a bootstrap script.

**Verified.** Removed `packages/types/dist/`, ran `pnpm install` from root, confirmed dist reappeared in 1.2s with `index.js` and `index.d.ts` resolvable through the `apps/api/node_modules/@provenance/types` symlink.

**Pattern.** Pnpm workspaces do not auto-build shared packages on install. If a workspace package emits artifacts that consumers import via the package's `main` field (rather than via TypeScript path mappings to source), the workspace root must build that package after install — either via `postinstall`, an explicit `bootstrap` script, or a turbo task that runs at install time. Path mappings to `src/` work only at type-check time and break at runtime once the consumer is bundled or compiled.

**Related (still open).** None — fresh-clone build resolution for `@provenance/types` is now complete with PR #66 (B-012, the `.ts`-extension path mapping) plus this fix.

---

## B-020 — `VITE_API_BASE_URL` defaults to Kong (`localhost:8000`), but Kong has no API routes provisioned in default compose

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / frontend

**Symptom.** Frontend at `http://localhost:3000` loaded but every API call from the browser failed with a Kong 404. `curl http://localhost:8000/api/v1/health` confirmed Kong returned 404 for every path. `curl http://localhost:8001/services` showed Kong had zero services configured.

**Root cause.** `infrastructure/docker/docker-compose.yml:593` set `VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:8000/api/v1}` — pointing the frontend at Kong. Kong was up and healthy (its own DB migration ran), but no routes had been declared for the Provenance API. On the EC2 stack Kong has Caddy in front of it and a separately-provisioned route table; on the default compose Kong was effectively decorative — it accepted connections but routed nothing.

**Fix.** Repointed the frontend at the API directly — changed the default to `http://localhost:3001/api/v1`. The API container already exposes 3001 to the host and CORS is already permissive in dev (the `provenance-web` Keycloak client lists `http://localhost:3000` as an allowed origin). Kong is now inert in the local stack. Considered alternative: provision Kong routes at startup via a `kong-routes-bootstrap` one-shot service (preserves the production-shaped frontend → Kong → API topology). Deferred — if production-shape rehearsal is needed locally, a `docker-compose.kong-local.yml` overlay is the appropriate place rather than the default compose.

**Pattern.** A default that points at infrastructure with no provisioning is worse than a default that points at the actual service. If a layer (Kong, a load balancer, a sidecar) only earns its keep with additional configuration, do not wire the default through it — wire the default to the canonical underlying service and add the layer as an explicit overlay when needed.

---

## B-019 — `KEYCLOAK_ISSUER_URL` default in `docker-compose.yml` lacks `/realms/{realm}` path; API rejects every JWT with 401

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / API

**Symptom.** With B-018 fixed and a JWT now correctly carrying `provenance_org_id`, every authenticated API call returned 401. Nothing in the API logs at warn or above — the rejection happened silently inside passport-jwt's issuer validation.

**Root cause.** `infrastructure/docker/docker-compose.yml:442` set `KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080}`. The matching JWT issuer claim is `http://localhost:8080/realms/provenance` (Keycloak always issues with the full realm path). `apps/api/src/auth/jwt.strategy.ts:25-31` documents that `KEYCLOAK_ISSUER_URL` must be the *full* issuer including `/realms/{realm}`. The EC2 compose had it correct; the local default and `docker-compose.dev.yml` did not.

**Fix.** Patched the default in both `docker-compose.yml` and `docker-compose.dev.yml` to include the realm path: `KEYCLOAK_ISSUER_URL: ${KEYCLOAK_ISSUER_URL:-http://localhost:8080/realms/provenance}`.

**Follow-up not yet shipped.** A Zod check in `apps/api/src/config.ts` that rejects a `KEYCLOAK_ISSUER_URL` lacking `/realms/` would prevent this exact bug recurring. Currently the config validates the value as `z.string().url().optional()` only — no realm-path assertion. File a small follow-up if recurrence is a concern.

**Pattern.** Per CLAUDE.md, "A new env var must land in every config layer at once." This is the inverse — an existing env var with inconsistent defaults across compose files. Same root cause: the EC2 compose drifted ahead and the local defaults were not kept in sync.

---

## B-018 — Realm `unmanagedAttributePolicy` not enabled in import; `provenance_*` user attributes silently dropped

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Identity / Keycloak

**Symptom.** With B-016 fixed, the seed CLI ran to completion and apparently wrote `provenance_org_id` and `provenance_principal_type` as user attributes on each seeded principal. But a subsequent password-grant token contained neither claim. The frontend's `RequireOrg` guard reads `keycloak.tokenParsed.provenance_org_id` to decide if a user has joined an org — without this claim every login landed on `/onboarding/org` regardless of seeded state. The API's tenant-isolation middleware also rejected every request for missing `provenance_org_id`.

**Root cause.** Keycloak 24's User Profile feature (enabled by default for new realms) refuses to persist any attribute not declared in the realm's user-profile schema — unless `unmanagedAttributePolicy` is set. The realm JSON did not set this, so Keycloak silently dropped the seed's `provenance_org_id` write on user create. The protocol mappers on the `provenance-web` client were correctly defined, but they mapped from an attribute that did not exist on the user. The EC2 dev box `configure-keycloak-ec2.sh` (line 124) sets `unmanagedAttributePolicy=ADMIN_EDIT` after import; no equivalent ran for the local Compose stack. CLAUDE.md notes this Keycloak-24 quirk for the EC2 setup but it was never propagated to the local realm import.

**Fix.** Added `unmanagedAttributePolicy: "ADMIN_EDIT"` to the realm JSON top-level (`infrastructure/docker/config/keycloak/realms/provenance-realm.json`). Keycloak's RealmRepresentation accepts the field at import time. Considered alternative: declaring each `provenance_*` attribute explicitly in a `userProfile.attributes` block — more declarative but more verbose. Chose the lighter-weight policy setting because the attribute set is still evolving.

**Pattern.** Keycloak silently drops unknown user attributes by default in v24+. Any feature that writes custom attributes (`provenance_*`, future namespaces) must verify the realm's `unmanagedAttributePolicy` is set, or declare the attributes in the user-profile schema. Test this end-to-end on a fresh realm import — the bug is invisible in unit tests because they don't exercise the import path.

---

## B-017 — Seed data uses `interface_type: 'semantic_query'` but DB CHECK constraint expects `'semantic_query_endpoint'`

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker (for the seed flow specifically)
- **Area:** Seed / data product schema

**Symptom.** Once Keycloak admin worked (B-016 fixed), the seed CLI failed at the products step with `QueryFailedError: new row for relation "port_declarations" violates check constraint "port_declarations_interface_type_check"`. The offending insert had `"interface_type": "semantic_query"`. The DB CHECK constraint (defined in V3) accepts `'sql_jdbc' | 'rest_api' | 'graphql' | 'streaming_topic' | 'file_object_export' | 'semantic_query_endpoint'` — note the `_endpoint` suffix.

**Root cause.** Two code locations in the seed package used the short form `'semantic_query'` instead of the canonical `'semantic_query_endpoint'`:

- `packages/seed/src/types.ts:52` — the `PortInterfaceType` union
- `packages/seed/src/products/acme-corp-products.ts:45,54` — two output port declarations on the customer-360 product

Nothing else in the codebase used the short form (CLAUDE.md and the architecture document use `Semantic query endpoint`). Typo introduced when the seed package was authored and never caught because the seed CLI was added late in Phase 5.6 and never ran end-to-end against a fresh DB (the EC2 dev DB had its products manually inserted before the seed package existed).

**Fix.** Renamed `'semantic_query'` to `'semantic_query_endpoint'` at both locations in the seed.

**Pattern.** Any seed value that lands in a CHECK-constrained column should be derived from the same TypeScript union the API uses, not redeclared in the seed package. Worth a follow-up: have `packages/seed/src/types.ts` import `PortInterfaceType` from `@provenance/types` rather than maintaining its own copy.

---

## B-016 — `provenance-admin` Keycloak service account had no realm-management roles in realm import

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Identity / Keycloak

**Symptom.** With migrations applied and the API up, the seed CLI failed at the second step with `Keycloak admin GET /users?email=... -> 403`. Any platform code path that called Keycloak Admin REST as the `provenance-admin` client (seed user creation, invitation acceptance, agent client provisioning per ADR-002) hit the same 403.

**Root cause.** `infrastructure/docker/config/keycloak/realms/provenance-realm.json` declared the `provenance-admin` confidential client with `serviceAccountsEnabled: true` and the correct secret, but did not assign any `realm-management` client roles to its service account user. Keycloak by default gives a service account zero admin permissions. The EC2 dev box `infrastructure/docker/scripts/configure-keycloak-ec2.sh` (lines 222–226) granted the required roles via `kcadm add-roles` after import, but no equivalent ran for the local Compose stack. The roles required (per the EC2 script) are `manage-users`, `query-users`, `manage-clients`, `query-clients`, `view-users`, `view-realm`.

**Fix.** Encoded the role grants directly in the realm JSON. Keycloak's RealmRepresentation supports a top-level `users` array entry for `service-account-provenance-admin` with `clientRoles: { "realm-management": ["manage-users", "query-users", ...] }`. Considered alternative: a one-shot `keycloak-bootstrap` compose service that depends on `keycloak: service_healthy` and runs the relevant subset of `configure-keycloak-ec2.sh`. Chose the in-realm-JSON approach because (a) it keeps the local stack declarative with no extra moving parts, and (b) Keycloak 24.0.3's import handles the ordering correctly when `serviceAccountsEnabled: true` and the service-account user are co-declared.

**Pattern.** Service accounts in Keycloak start with zero admin permissions. Any client with `serviceAccountsEnabled: true` that needs to call the Admin REST API must have explicit `realm-management` role grants in the same realm artifact that defines it. Don't rely on a post-import script to bootstrap permissions for the default stack — the script will exist for prod and someone will forget local.

---

## B-015 — `flyway.conf` `baselineVersion=8` causes V9 to fail on a fresh database

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Infrastructure / database

**Symptom.** Even when Flyway was run against a fresh, empty Postgres, migration failed at V9: `ERROR: Migration of schema "organizations" to version "9 - create lineage schema" failed! SQL State : 42P01 — relation "organizations.orgs" does not exist`. V1–V8 were reported as "skipped" — Flyway saw the empty `flyway_schema_history` table, stamped it at version 8 per `flyway.baselineVersion=8` in the conf, then jumped straight to V9 which depended on tables created in V1.

**Root cause.** `apps/api/flyway.conf` set `flyway.baselineVersion=8` and `flyway.baselineOnMigrate=true`. The intent (presumably) was to handle a one-time historical migration where an existing database had V1–V8 applied via some other path and Flyway was bolted on starting at V9. That assumption did not hold for any new install — on a fresh DB the baseline was wrong by definition.

**Fix.** Dropped the baseline configuration entirely from `apps/api/flyway.conf` (removed `flyway.baselineVersion=8` and `flyway.baselineOnMigrate=true`). V1–V27 now apply in order from a fresh DB. Existing EC2 / demo databases that already have the V1–V8 schema applied will need a one-time `DELETE FROM organizations.flyway_schema_history WHERE version <= 8` and re-run, or an explicit Flyway `repair` — verify carefully against any live database before reapplying. The dev-EC2 box was confirmed unaffected (its history is already populated through V27).

**Pattern.** `flyway.baselineVersion` is a production-migration tool, not a default. Setting it as the default in `flyway.conf` poisons every fresh install. If a baseline is needed for a one-time historical migration, do it via the Flyway CLI invocation for that specific run, not in the persistent conf file.

---

## B-012 — `apps/api/tsconfig.json` path mapping has literal `.ts` extension; API container crashes on startup

- **Fixed:** 2026-05-06 — commit `d8f73c4` (PR #66)
- **Severity:** was Blocker
- **Area:** Build / API
- **Discovered:** 2026-05-07, during the first external-developer onboarding test on a fresh Apple Silicon MacBook.

**Symptom.** Following the README "Getting Started" path on a fresh clone, the `provenance-api` container crashed immediately after `docker compose up -d` with `Error: Cannot find module '../../../../packages/types/src/index.ts'`. Container went into a restart loop. Every authenticated path was unreachable; the frontend rendered its login page but couldn't reach the backend.

**Root cause.** `apps/api/tsconfig.json:10` declared the path mapping with a literal `.ts` extension: `"paths": { "@provenance/types": ["../../packages/types/src/index.ts"] }`. `nest build` (which the dev container runs via `pnpm dev` → `nest start --watch`) inlines this path verbatim into emitted requires — so `import { ... } from '@provenance/types'` in `notifications.service.ts` became `require("../../../../packages/types/src/index.ts")` in `dist/.../notifications.service.js`. Node's CommonJS resolver does not load `.ts` files; the require threw `MODULE_NOT_FOUND` and the entire module graph failed to load.

The reason this was not caught on the EC2 dev box is that EC2 also has `packages/types/dist/` pre-built on disk (from a prior `pnpm -r build` or similar), so the symlink at `apps/api/node_modules/@provenance/types/dist/index.js` resolves and Node's normal package resolution kicks in — masking the path-mapping bug. On a fresh clone the dist is missing (B-013, still open) and the path-mapping bug surfaces.

**Fix.** Dropped the `.ts` extension from the paths mapping: `"paths": { "@provenance/types": ["../../packages/types/src/index"] }`. The emitted require is now the unmangled `require("@provenance/types")`, which Node resolves through `node_modules` via the package's own `main` field.

**Pattern.** TypeScript path mappings should never carry file extensions. Even when the mapping resolves correctly at type-check time, Nest's webpack-mode build inlines the literal string at emit time, and a `.ts` extension means the dist is unloadable. Applies to any future workspace package mapping in any tsconfig file.

**Related (still open).** B-013 — `packages/types/dist/` not pre-built on a fresh clone. Even with the path mapping fixed, the package needs a built `dist/` for Node to resolve via the package's `main` field. Tracked separately.

---

## B-010 — `docker-compose.yml` OPA healthcheck unrunnable in distroless image

- **Fixed:** 2026-05-07 — commit `<pending>`
- **Area:** Infrastructure / developer experience
- **Severity:** was Blocker (every dependent service blocked on OPA `service_healthy`)
- **Discovered:** During the first external-developer onboarding test on a fresh Apple Silicon MacBook (2026-05-07).

**Symptom.** Following the README "Getting Started" path on a fresh machine — `git clone` → `pnpm install` → `cd infrastructure/docker && docker compose up -d` — the stack failed to come up with `dependency failed to start: container provenance-opa is unhealthy`. Every service that declared `depends_on: opa: { condition: service_healthy }` (api, agent-query, etc.) blocked behind it, so the whole stack was unusable on a fresh clone.

**Root cause.** `infrastructure/docker/docker-compose.yml:285` declared the OPA healthcheck as `["CMD-SHELL", "wget -qO- http://localhost:8181/health || exit 1"]`. The `openpolicyagent/opa:0.63.0` image is built on a distroless base — it has **no shell, no busybox, no wget, no curl**. The healthcheck command therefore cannot execute on any platform. The reason this was not noticed on the EC2 dev box is that the EC2 stack runs from `docker-compose.ec2-dev.yml`, which uses a different (working) healthcheck `["CMD", "/opa", "eval", "true"]`. No one had ever exercised the main `docker-compose.yml` end-to-end, since the team's daily workflow is the EC2 deployment.

The bug was unmasked when an Apple Silicon contributor tried the README path — on arm64, `openpolicyagent/opa:0.63.0` is amd64-only and runs under emulation, which surfaces every latent issue immediately. The actual blocker is the healthcheck itself, not the architecture (the healthcheck would equally fail to execute on amd64 native).

**Fix.** Replace the healthcheck in `docker-compose.yml` with the same one used in `docker-compose.ec2-dev.yml` — invoking the OPA binary directly to evaluate a trivial Rego expression. The OPA binary is always present in the image (it's the entrypoint), so the check is reliable on every platform and adds negligible overhead.

```yaml
healthcheck:
  test: ["CMD", "/opa", "eval", "true"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 10s
```

**Pattern.** When using a distroless image, healthchecks **cannot** rely on shell utilities (curl, wget, nc, bash). They must invoke the image's primary binary or a static binary baked into the image. If two compose variants disagree on a healthcheck for the same image, the discrepancy is a sign one of them is wrong — reconcile to the working version. Beyond OPA: any future move to distroless images for our own services (api, agent-query) requires auditing every healthcheck for shell dependencies before the cutover.

**Related (still open).** OPA 0.63.0's image is amd64-only — Apple Silicon Macs run it under emulation. Tracked separately as B-011.

---

## B-009 — OpenSearch `provenance-products` BM25 index empty; marketplace keyword search returns nothing

- **Fixed:** 2026-04-30 — commit `<pending>`
- **Area:** Search / discovery
- **Severity:** was Medium

**Symptom.** Marketplace keyword search (`MarketplaceService.searchProducts`, hitting `provenance-products` over BM25) returned zero results regardless of query, while marketplace browse (`listProducts`, hitting PostgreSQL) correctly showed 7 real products. The BM25 index had 0 documents while the kNN index (`data_products`) had 7. CLAUDE.md describes both indices as "active and complementary," so this was a real gap, not legacy code.

**Root cause.** BM25 indexing relied solely on `KafkaConsumerService` consuming `product.lifecycle` events from Redpanda and calling `ProductIndexService.indexProduct`. The kNN index, by contrast, gets a synchronous double-write from `ProductsService` itself (`searchIndexingService.indexProduct(...).catch(...)` at the publish/update sites). On every dev-stack rebuild the Redpanda queue resets, so the BM25 index started empty and stayed empty until a new product publish flowed through the broker — which essentially never happens in dev. There was no PostgreSQL→OpenSearch backfill path either.

**Fix.** Two parts:
1. **Synchronous double-write.** Added `ProductIndexService.indexProductById(productId, orgId)` mirroring `SearchIndexingService.indexProduct`'s lookup-and-index pattern. `ProductsService` now calls it alongside the existing kNN call at every publish, every update where searchable fields change, and every decommission (the latter as `removeProduct`). The Kafka consumer is unchanged and continues as a backup. Both writes are best-effort with `.catch(() => {})` — index failures must never block lifecycle ops.
2. **One-shot reindex script.** `apps/api/src/scripts/reindex-search.ts` walks `products.data_products` for every published or deprecated product and re-writes both OpenSearch indices via the same services. Runs as `pnpm --filter @provenance/api reindex:search` from inside the api container after `nest build`. Idempotent (uses upsert with stable IDs) — safe to re-run after every dev-stack rebuild or seed-data refresh.

End-to-end verified 2026-04-30: ran `pnpm reindex:search` in the dev container — log line `Done. BM25: 7/7 succeeded (0 failed). kNN: 7/7 succeeded (0 failed).` `curl /_cat/indices` now reports `provenance-products` with 7 docs (up from 0). A BM25 query for "revenue" returns the 2 expected products ("Customer Revenue Analytics" and "Daily Revenue Report").

**Pattern.** When OpenSearch (or any external store with non-durable propagation) sits behind a domain database, a single broker-only write path is fragile in dev — broker queues reset on rebuild, dev volumes drift, and the index silently loses sync with PostgreSQL. The fix is always (a) synchronous write on the operation that updates the source of truth, plus (b) an idempotent backfill command for after the inevitable drift event. Out-of-scope but adjacent: deprecate-on-product behavior diverges between the two indices (kNN deletes on deprecate via `searchIndexingService.deleteFromIndex`; BM25 keeps the doc per the Kafka consumer's deliberate "no index change" comment). The newly-shipped marketplace lifecycle visibility in PR #45 makes the kNN delete the wrong call — deprecated products should remain searchable in both — but fixing it is a separate change.

---

## R-011 — Access grant revocation fails at the database due to broken `updated_at` trigger

- **Fixed:** 2026-04-25 — commit `<pending>`
- **Area:** Access / governance
- **Severity:** was High
- **Discovered:** During F10.6 end-to-end disclosure verification

**Symptom.** Any UPDATE against `access.access_grants` failed with PostgreSQL `record "new" has no field "updated_at"` raised from the shared `update_updated_at()` trigger function. `AccessService.revokeGrant` (`apps/api/src/access/access.service.ts:142-157`) sets `revoked_at`/`revoked_by` and calls `grantRepo.save()`, generating an UPDATE — so the `POST /organizations/:orgId/access/grants/:grantId/revoke` endpoint was broken at the SQL level since the access schema was created. The Domain 12 grant-revoke cascade introduced in #26 also depends on `revokeGrant` succeeding, so this bug would have blocked F12.21 as well. The application unit tests passed because they mock the repo and never exercise a real UPDATE through the trigger.

**Root cause.** `apps/api/migrations/V7__create_access_schema.sql:131-133` created `CREATE TRIGGER access_grants_updated_at BEFORE UPDATE ON access.access_grants FOR EACH ROW EXECUTE FUNCTION update_updated_at();`, but the `access_grants` table definition (lines 16-29) was missing the `updated_at` column. The sibling `access_requests` table includes the column (line 59), so its symmetric trigger worked.

**Fix.** `V20__access_grants_add_updated_at.sql` adds the column with `NOT NULL DEFAULT NOW()` and backfills existing rows from `COALESCE(revoked_at, granted_at)`. End-to-end verified by inserting a grant, calling the marketplace product detail endpoint as the grantee (full credentials), revoking via `UPDATE`, calling again (preview only), re-activating, and revoking again.

**Pattern.** Any `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION update_updated_at()` trigger requires the target table to have an `updated_at TIMESTAMPTZ NOT NULL` column. Adding the trigger without the column lies dormant until the first UPDATE, and unit tests with mocked repos won't catch it. Audit all `BEFORE UPDATE` triggers against their tables before adding new mutable schemas.

---

## B-004 — .gitignore pattern silently ignores future realm JSONs

- **Fixed:** 2026-04-23 — commit `c0cd732`
- **Area:** Infrastructure / git hygiene
- **Severity:** was Low

**Symptom.** `.gitignore` contained `infrastructure/docker/config/keycloak/realms/*.json`, yet `provenance-realm.json` was tracked — it was added to the index before the ignore rule. A developer who adds a second realm file (e.g. a staging or demo realm) to the same directory will see it silently ignored with no warning. `git add` will succeed without tracking the file unless they force-add.

**Root cause.** The ignore pattern was intended to block environment-specific overrides (like `realms/local.json`) but was too broad — it also matched the canonical committed realm. The previous state relied on the accident that the canonical file was added first.

**Proposed fix.** Flip the pattern to an exclusion list. Either:
- Replace `*.json` + `!.gitkeep` with an explicit allowlist: `*.json` + `!provenance-realm.json` + `!.gitkeep`.
- Or rename the ignored pattern to a narrower convention, e.g. `realms/*.local.json`, and ignore only that.

Verify by trying `touch infrastructure/docker/config/keycloak/realms/demo.json && git status` — it must show the file as untracked (visible), not as ignored.

**Resolution.** Narrowed the pattern from `realms/*.json` to `realms/*.local.json`. New canonical realm files (staging, demo, test) now surface as untracked on `git status` — a loud failure mode instead of a silent one — while environment-specific overrides matching `*.local.json` stay ignored. The `!.gitkeep` negation line was removed because `.gitkeep` no longer matches the narrower ignore pattern; the file itself stays in place. Rejected the allowlist approach (`*.json` + `!provenance-realm.json` + `!.gitkeep`) because it would re-create the same silent-ignore trap the moment a second canonical realm is added — the next contributor would hit the identical bug. Verified by `touch realms/demo.json` (shows `??`) and `touch realms/dev.local.json` (shows `!!` under `git status --ignored`).

---

## R-010 — API container unhealthy after Workstream B deploy: EncryptionService missing key

- **Fixed:** 2026-04-19 — commit `fb387c3`
- **Area:** Infrastructure / docker-compose

**Symptom.** `provenance-ec2-api` stuck in `unhealthy` after merging PR #10 (Domain 10 Workstream B). `docker logs` shows NestFactory aborting during provider instantiation:
`Error: EncryptionService: one of CONNECTION_DETAILS_SECRET_ARN or CONNECTION_DETAILS_DEV_KEY must be set`.

**Root cause.** Workstream B added a required env pair to the API's Zod schema (`CONNECTION_DETAILS_SECRET_ARN` / `CONNECTION_DETAILS_DEV_KEY`) and wired it into `EncryptionService`, which throws at construction if neither is set. The test env (`apps/api/src/test.env.ts`) was updated, but none of the docker-compose files (`docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.ec2-dev.yml`) or `.env.example` propagate the vars to the running container. The API boots fine in `jest` and in any env that loads `.env` with these vars present, but a fresh `docker compose up` after the merge crashes at startup.

**Fix.** Pass both vars to the API service in all three compose files with a documented throwaway default for `CONNECTION_DETAILS_DEV_KEY` so the dev stack boots without cloud credentials. `CONNECTION_DETAILS_SECRET_ARN` stays optional — production stacks set it to an AWS Secrets Manager ARN and leave the dev key empty. Added the pair to `.env.example` with the same documentation.

**Pattern.** Any new required env var introduced in the API must be added to every layer that sources config: `apps/api/src/config.ts` (Zod), `apps/api/src/test.env.ts` (jest), all three `infrastructure/docker/docker-compose*.yml`, and `.env.example`. Missing one of the compose files silently breaks deployed environments the next time a stack is rebuilt.

---

## R-009 — testuser email-as-username lookup silently failing in configure-keycloak-ec2.sh

- **Fixed:** 2026-04-19 — commit `e287e58`
- **Area:** Infrastructure / Keycloak

**Symptom.** `configure-keycloak-ec2.sh`'s `kcadm get users -q username=testuser` returned empty results on every run after the first, and the testuser attribute seed block was silently skipped. The script's output said `testuser not found in Keycloak — skipping attribute seed`, which masked the fact that nothing was being configured.

**Root cause.** The script itself applies `registrationEmailAsUsername=true` to the realm. Once that flag is on, the next update to any user (including the attribute write the script does immediately after) causes Keycloak to rewrite the user's `username` field to match `email`. The legacy `testuser` handle stops resolving.

**Fix.** Look up the user by email (new `TESTUSER_EMAIL` variable, default `test@provenance.dev`) instead of by username. Email is the stable identifier. Docs updated to use email-as-username everywhere direct-grant examples appear.

---

## R-008 — testuser role_assignments seeding drift

- **Fixed:** 2026-04-19 — commit `e287e58`
- **Area:** Infrastructure / seed

**Symptom.** On a fresh EC2 environment, testuser had `realmRoles: ["org_admin"]` in the Keycloak realm import but no matching row in `identity.role_assignments`. `JwtStrategy` reads roles from the DB (not from Keycloak realm roles), so `RolesGuard` 403'd every `@Roles`-gated endpoint — invitations, member management, classification changes. Manually seeding a row unblocked invitation-flow testing during R-006/R-007.

**Root cause.** `configure-keycloak-ec2.sh` synced Keycloak attributes from `identity.principals` but never inserted a platform role_assignment. The realm import and the DB seed lived separate lives.

**Fix.** Added a SQL `INSERT ... WHERE NOT EXISTS` step inside the existing testuser attribute block. Idempotent. Filters psql's `INSERT 0 N` command tag from stdout with `awk` so `set -eo pipefail` doesn't abort the script on the no-op path.

---

## R-007 — `EntityMetadataNotFoundError` for InvitationEntity + GovernanceConfigEntity

- **Fixed:** 2026-04-19 — commit `be62daf`
- **Area:** API / TypeORM wiring

**Symptom.** Every invitation endpoint (`POST /organizations/:orgId/invitations`, `POST /invitations/:token/accept`) returned 500 with `EntityMetadataNotFoundError: No metadata for "InvitationEntity" was found`. The invitation row was persisted but the HTTP response was 500.

**Root cause.** `InvitationEntity` and `GovernanceConfigEntity` were registered via `TypeOrmModule.forFeature(...)` inside `OrganizationsModule` but never added to the root DataSource's `entities` array in `database.module.ts`. Repositories for both entities couldn't find metadata.

**Fix.** Added both entities to the root DataSource's `entities` list. The convention elsewhere in the codebase is that every entity is in both lists; these two were the outliers.

---

## R-006 — `z.coerce.boolean()` treats `"false"` as `true` for `SMTP_SECURE`

- **Fixed:** 2026-04-19 — commit `be62daf`
- **Area:** API / config

**Symptom.** With `SMTP_SECURE=false` in the env, nodemailer was configured with `secure: true` and initiated an immediate TLS handshake against plaintext Mailhog. The resulting `"SSL routines: ssl3_get_record: wrong version number"` caused invitation email sends to throw and the invitation-create endpoint to return 500 after persisting the row.

**Root cause.** Zod's `z.coerce.boolean()` uses JavaScript's `Boolean(value)`, and `Boolean("false") === true`. Any non-empty string coerces to `true`, making the Zod boolean coercion unsafe for env-var input.

**Fix.** Replaced with `z.string().default('false').transform(v => v.toLowerCase() === 'true')`. Explicit literal parse, no surprises.

**Pattern:** Never use `z.coerce.boolean()` on env vars. Parse the literal string.

---

## R-005 — nodemailer missing from the API container after volume reuse

- **Fixed:** Resolved operationally (no code change) — no commit reference
- **Area:** Infrastructure / Docker

**Symptom.** `require('nodemailer')` threw `MODULE_NOT_FOUND` at API startup on one particular EC2 instance, even though `package.json` declared the dep and `pnpm install` had completed. Affected only that host.

**Root cause.** The compose file mounts `node_modules` via an anonymous volume (`- /app/apps/api/node_modules`) to shadow the host bind mount. The volume was created from an earlier image build that predated the nodemailer dependency, and the dep wasn't reinstalled when the image was rebuilt — the anonymous volume preserved the stale node_modules.

**Fix.** `docker compose down -v` on the affected host (removes named + anonymous volumes) followed by `docker compose up --build`. Package-json state was already correct.

**Prevention.** Runbook entry explaining when to blow away volumes. If this repeats, consider flipping the node_modules strategy: install inside a named image layer rather than masking with an anonymous volume. Tracked for follow-up when it happens again.

---

## R-004 — `updateUserAttributes` PUT was a full-replace, destroying required Keycloak fields

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / Keycloak Admin integration

**Symptom.** After self-serve org creation, the post-transaction `keycloakAdmin.updateUserAttributes(...)` call to bind `provenance_org_id` / `provenance_principal_id` / `provenance_principal_type` returned 400 `error-user-attribute-required: email`. The attributes never made it onto the user, so refreshed tokens had no `provenance_*` claims and the next API call 401'd.

**Root cause.** Keycloak's `PUT /admin/realms/{realm}/users/{id}` is a full-replace operation, not a merge. Sending only `{ attributes: {...} }` in the body drops `email`, `username`, `firstName`, `lastName`, etc. The user-profile validator then rejects the payload because `email` is declared required.

**Fix.** `GET` the current user, merge incoming attributes into `user.attributes`, then `PUT` the complete object. Implemented in `apps/api/src/auth/keycloak-admin.service.ts`.

**Pattern:** Any Keycloak Admin-API PUT of a user must be GET-merge-PUT. Never send a partial body.

---

## R-003 — `SET LOCAL "param" = $1` is not parameterizable in PostgreSQL

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / PostgreSQL RLS

**Symptom.** First call that tried to set a per-transaction RLS context threw `syntax error at or near "$1"`. Hit `selfServeOrganization`, `jwt.strategy.seedPrincipal`, `invitations.service.acceptInvitation`, and the `org-context.middleware`.

**Root cause.** Postgres `SET LOCAL config_param = value` requires a literal constant. The `$1` placeholder is not expanded — Postgres treats it as a syntactic token and rejects the statement.

**Fix.** Replace every call site with `SELECT set_config('provenance.current_org_id', $1, true)` — `set_config(name, value, is_local)` is the parameterizable equivalent, and `is_local=true` scopes to the current transaction like `SET LOCAL`.

**Pattern:** Never use `SET LOCAL` with a bind parameter. Always use `set_config(...)`.

---

## R-002 — Issuer URL double-nested to `/realms/provenance/realms/provenance`

- **Fixed:** 2026-04-19 — commit `847f5b9`
- **Area:** API / JWT validation

**Symptom.** Every Keycloak-issued token failed passport-jwt's `iss` check. The browser saw a 401 with no corresponding Nest-level log entry because passport rejects before `canActivate` runs. Even endpoints marked `@AllowNoOrg` (self-serve) returned 401.

**Root cause.** `jwt.strategy.ts` computed the expected issuer as `${KEYCLOAK_ISSUER_URL ?? KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}`. The ec2 `.env` already set `KEYCLOAK_ISSUER_URL=https://auth.provenancelogic.com/realms/provenance`, so the strategy appended `/realms/provenance` on top, producing a double-nested path that no real token matched.

**Fix.** Treat `KEYCLOAK_ISSUER_URL` as the FULL issuer (matches what Keycloak emits in the `iss` claim). Only construct the URL from `AUTH_SERVER_URL + realm` when `ISSUER_URL` is not set. Aligned the compose default accordingly.

**Pattern:** `KEYCLOAK_ISSUER_URL` is the literal `iss` claim value — including `/realms/{realm}`. See the operations runbook for the gotcha.

---

## R-001 — `GET /organizations` returned every tenant's orgs to any caller (tenant-isolation regression)

- **Fixed:** 2026-04-19 — commit `531b724`
- **Area:** API / tenant scoping
- **Severity:** was Blocker (security + onboarding)

**Symptom.** A newly registered user with no org was landing on the dashboard seeing Acme Corp's products instead of being routed to the onboarding flow. Investigation showed every authenticated caller received every org in the database from `GET /organizations`.

**Root cause.** `OrganizationsService.listOrganizations` ran `findAndCount({})` with no `where` clause scoping by the caller's `orgId`. `DashboardRedirect` used an empty-list response to decide whether to redirect to `/onboarding/org`; because the list was never empty, the redirect never fired, and the new user saw another tenant's data.

**Fix.** Pass `RequestContext` through from the controller into the service. Return `{ items: [], meta: { total: 0 } }` when `ctx.orgId` is falsy; otherwise filter by `where: { id: ctx.orgId }`. Service and controller both updated; tests cover both branches.

**Pattern:** Every endpoint that queries a tenant-scoped table must be scoped by `ctx.orgId`. No cross-tenant reads.
