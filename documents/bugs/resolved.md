# Resolved Bugs

Reference log of bugs that have been fixed. Kept so patterns and root causes are searchable without digging through git history. Each entry links to the fix commit.

Entries are ordered newest first. When opening a bug in [open.md](./open.md), check this file first — the same root cause may have already been diagnosed.

---

## B-004 — .gitignore pattern silently ignores future realm JSONs

- **Fixed:** 2026-04-23 — commit `<commit>`
- **Area:** Infrastructure / git hygiene
- **Severity:** was Low

**Symptom.** `.gitignore` contained `infrastructure/docker/config/keycloak/realms/*.json`, yet `provenance-realm.json` was tracked — it was added to the index before the ignore rule. A developer who adds a second realm file (e.g. a staging or demo realm) to the same directory will see it silently ignored with no warning. `git add` will succeed without tracking the file unless they force-add.

**Root cause.** The ignore pattern was intended to block environment-specific overrides (like `realms/local.json`) but was too broad — it also matched the canonical committed realm. The previous state relied on the accident that the canonical file was added first.

**Proposed fix.** Flip the pattern to an exclusion list. Either:
- Replace `*.json` + `!.gitkeep` with an explicit allowlist: `*.json` + `!provenance-realm.json` + `!.gitkeep`.
- Or rename the ignored pattern to a narrower convention, e.g. `realms/*.local.json`, and ignore only that.

Verify by trying `touch infrastructure/docker/config/keycloak/realms/demo.json && git status` — it must show the file as untracked (visible), not as ignored.

**Resolution.** Narrowed the pattern from `realms/*.json` to `realms/*.local.json`. New canonical realm files (staging, demo, test) now surface as untracked on `git status` — a loud failure mode instead of a silent one — while environment-specific overrides matching `*.local.json` stay ignored. The `!.gitkeep` negation line was removed because `.gitkeep` no longer matches the narrower ignore pattern; the file itself stays in place. Rejected the allowlist approach (`*.json` + `!provenance-realm.json` + `!.gitkeep`) because it would re-create the same silent-ignore trap the moment a second canonical realm is added — the next contributor would hit the identical bug. Verified by `touch realms/demo.json` (shows `??`) and `touch realms/dev.local.json` (shows `!!` under `git status --ignored`).

**Status:** Resolved
**Resolved:** 2026-04-23
**Fix commit:** `<commit>`

---

## R-010 — API container unhealthy after Workstream B deploy: EncryptionService missing key

- **Fixed:** 2026-04-19 — commit `<pending>`
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
