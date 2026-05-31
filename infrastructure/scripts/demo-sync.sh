#!/usr/bin/env bash
# demo-sync.sh
#
# Syncs an already-bootstrapped demo instance to the target git SHA, runs
# migrations, imports the demo Keycloak realm, runs the seed package, and
# runs the smoke test. Exits non-zero and identifies the failing step if
# anything breaks.
#
# Usage:
#   bash demo-sync.sh [git-sha]
#
# If no SHA is given, defaults to main (only acceptable when T-24h checklist
# confirms main is stable).

set -euo pipefail

REPO_ROOT="/opt/provenance"
TARGET_SHA="${1:-main}"
COMPOSE_FILE="${REPO_ROOT}/infrastructure/docker/docker-compose.ec2-dev.yml"
COMPOSE_OVERRIDE="${REPO_ROOT}/infrastructure/docker/docker-compose.demo.yml"
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env.ec2"
DEMO_DOMAIN="${DEMO_DOMAIN:-demo.provenancelogic.com}"

# Wall-clock at deploy start. The integrity check (step 2b) asserts the
# bind-mounted app containers restarted *after* this — a container with an
# older StartedAt kept running stale code (the recurring "deployed but not
# reloaded" trap; see documents/runbooks/demo-environment.md).
DEPLOY_START_EPOCH="$(date +%s)"

# App services that bind-mount /opt/provenance and run the source directly.
# These MUST be force-recreated to pick up newly-checked-out code — a plain
# `up -d` won't recreate a locally-built image whose layers didn't change, and
# `docker compose pull` is a no-op for them (no registry; built locally).
BIND_MOUNT_APP_SERVICES="api agent-query web"

# Demo override redirects Caddy's caddy_data volume to /var/lib/caddy-data
# (persistent EBS). Every compose invocation passes both files.

log() {
  echo "[demo-sync $(date '+%H:%M:%S')] $*"
}

fail() {
  echo "[demo-sync FAIL: $1] $2" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1. Checkout SHA
# ---------------------------------------------------------------------------
log "fetching and checking out ${TARGET_SHA}"
cd "$REPO_ROOT"
git fetch --all --tags --prune || fail "git-fetch" "git fetch failed"
git checkout "$TARGET_SHA" || fail "git-checkout" "could not check out $TARGET_SHA"
log "on commit $(git rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
# 2. Refresh images and (re)start the stack
#
# `pull` refreshes the REGISTRY-based infra images (postgres, keycloak,
# flyway, redpanda, opensearch, neo4j, temporal). It is a no-op for the app
# images, which are built locally — so it does NOT deploy app code. The
# force-recreate below is what actually loads the checked-out source.
# ---------------------------------------------------------------------------
log "pulling infra images (no-op for locally-built app images)"
docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" pull || fail "compose-pull" "docker compose pull failed"
log "starting / refreshing the stack"
docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" up -d --remove-orphans || fail "compose-up" "docker compose up failed"

# CRITICAL — the trap this script exists to avoid. api/web/agent-query
# bind-mount /opt/provenance and run the source directly, so the running Node
# process keeps executing whatever code it loaded at its last start. A plain
# `up -d` will NOT recreate them (their locally-built image ID didn't move),
# so the freshly-checked-out code would silently NOT deploy. Force-recreate
# them so the processes reload the bind-mounted source.
log "force-recreating bind-mounted app services to load the checked-out source: ${BIND_MOUNT_APP_SERVICES}"
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" \
  up -d --force-recreate --no-deps ${BIND_MOUNT_APP_SERVICES} \
  || fail "compose-recreate" "force-recreate of app services failed"

# Caddy caches upstream container IPs; once the app containers move, the proxy
# points at stale IPs until Caddy restarts (symptom: 502 / ERR_SSL_PROTOCOL_ERROR).
log "restarting Caddy (it caches upstream container IPs)"
docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" restart caddy \
  || fail "caddy-restart" "caddy restart failed"

# ---------------------------------------------------------------------------
# 2b. Deploy integrity check — fail loudly if app code did NOT actually reload
#
# Catches the recurring "deployed but running stale code" bug at the source:
# the working tree must be at the target commit, AND each bind-mounted app
# container must have (re)started during THIS run. A container whose StartedAt
# predates DEPLOY_START_EPOCH never reloaded — it's serving old code.
# ---------------------------------------------------------------------------
log "verifying deploy integrity (checkout + app containers reloaded)"
TARGET_FULL_SHA="$(git rev-parse HEAD)"
for svc in ${BIND_MOUNT_APP_SERVICES}; do
  cid="$(docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" ps -q "$svc")"
  [ -n "$cid" ] || fail "deploy-verify" "service '$svc' has no running container after recreate"
  started_at="$(docker inspect -f '{{.State.StartedAt}}' "$cid")"
  started_epoch="$(date -d "$started_at" +%s 2>/dev/null || echo 0)"
  if [ "$started_epoch" -lt "$DEPLOY_START_EPOCH" ]; then
    fail "deploy-verify" "'$svc' did not restart this deploy (StartedAt=$started_at predates deploy start) — it is running STALE code. Re-run: docker compose -f $COMPOSE_FILE -f $COMPOSE_OVERRIDE --env-file $ENV_FILE up -d --force-recreate --no-deps $svc"
  fi
done
log "deploy integrity OK — checkout at ${TARGET_FULL_SHA}; api/web/agent-query reloaded"

# ---------------------------------------------------------------------------
# 3. Migrations
# ---------------------------------------------------------------------------
log "running flyway migrations"
docker compose -f "$COMPOSE_FILE" -f "$COMPOSE_OVERRIDE" --env-file "$ENV_FILE" run --rm flyway-migrate \
  || fail "migrations" "flyway-migrate run failed"

# ---------------------------------------------------------------------------
# 4. Keycloak realm import
# ---------------------------------------------------------------------------
log "importing demo Keycloak realm"
KC_FRONTEND_URL="https://${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}" \
  bash "${REPO_ROOT}/infrastructure/docker/scripts/configure-keycloak-ec2.sh" \
  || fail "keycloak-configure" "Keycloak realm configuration failed"

# ---------------------------------------------------------------------------
# 5. Seed
#
# `docker compose build` runs as root and creates root-owned files under
# /opt/provenance/*/node_modules. Without this chown, the host-side pnpm
# install below fails with EACCES on symlink creation. The seed CLI also
# reads its config from process env (SEED_API_KEY, DATABASE_URL,
# KEYCLOAK_ADMIN_CLIENT_SECRET) — source $ENV_FILE so those values land in
# the subshell.
# ---------------------------------------------------------------------------
log "normalizing /opt/provenance ownership before host-side pnpm install"
sudo chown -R ec2-user:ec2-user "$REPO_ROOT"

log "running seed package"
# --ignore-scripts: even with `--filter @provenance/seed`, pnpm runs the root
# workspace's postinstall (`pnpm --filter @provenance/types build`). tsc
# rewrites packages/types/dist/* in the bind-mounted source tree, which
# fires the api container's nest watcher and restarts it mid-seed-call.
# Bootstrap already builds types before bringing the stack up, and the seed
# step is run on the *same* checkout — no source has changed since bootstrap,
# so the postinstall rebuild is wasted work anyway. See B-051.
( cd "$REPO_ROOT" && pnpm --filter @provenance/seed install --frozen-lockfile --ignore-scripts ) \
  || fail "seed-install" "pnpm install for @provenance/seed failed"
(
  cd "$REPO_ROOT"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  pnpm --filter @provenance/seed run seed
) || fail "seed" "seed run failed — check API and Keycloak logs"

# ---------------------------------------------------------------------------
# 6. Resolve agent client secret for smoke test (B-076)
#
# The seed provisions the Keycloak client via the /seed/agents endpoint (which
# calls KeycloakAdminService.createAgentClient). The client secret is generated
# by Keycloak and stored there — not echoed back to the seed runner. Resolve it
# here via the Keycloak Admin API so the smoke test's agent layer is
# self-sufficient and does not require a manual SMOKE_AGENT_SECRET export.
#
# Step 5 sourced ENV_FILE only inside its seed subshell, so those vars did NOT
# survive to here — under `set -u` the first reference to the unset
# KEYCLOAK_ADMIN_CLIENT_SECRET aborted the whole sync (deploy + seed had already
# succeeded, but the smoke test never ran). Source ENV_FILE at top level so the
# admin/agent credentials are available for the secret resolution below.
# ---------------------------------------------------------------------------
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

AUTH_DEMO_DOMAIN="${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}"
KEYCLOAK_ADMIN_CLIENT_ID="${KEYCLOAK_ADMIN_CLIENT_ID:-provenance-admin}"
SMOKE_AGENT_CLIENT_ID="${SMOKE_AGENT_CLIENT_ID:-agent-acme-marketing-copilot}"

log "resolving ${SMOKE_AGENT_CLIENT_ID} client secret from Keycloak"

_KC_ADMIN_TOKEN=$(curl -sS -X POST \
  "https://${AUTH_DEMO_DOMAIN}/realms/provenance/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=${KEYCLOAK_ADMIN_CLIENT_ID}" \
  -d "client_secret=${KEYCLOAK_ADMIN_CLIENT_SECRET}" \
  | jq -r '.access_token // empty')
[ -n "${_KC_ADMIN_TOKEN}" ] \
  || fail "agent-secret-resolve" "Keycloak admin token exchange failed (check KEYCLOAK_ADMIN_CLIENT_SECRET in ${ENV_FILE})"

_KC_CLIENT_UUID=$(curl -sS \
  -H "Authorization: Bearer ${_KC_ADMIN_TOKEN}" \
  "https://${AUTH_DEMO_DOMAIN}/admin/realms/provenance/clients?clientId=${SMOKE_AGENT_CLIENT_ID}" \
  | jq -r '.[0].id // empty')
[ -n "${_KC_CLIENT_UUID}" ] \
  || fail "agent-secret-resolve" "Keycloak client '${SMOKE_AGENT_CLIENT_ID}' not found — did the seed run successfully?"

_KC_CLIENT_SECRET=$(curl -sS \
  -H "Authorization: Bearer ${_KC_ADMIN_TOKEN}" \
  "https://${AUTH_DEMO_DOMAIN}/admin/realms/provenance/clients/${_KC_CLIENT_UUID}/client-secret" \
  | jq -r '.value // empty')
[ -n "${_KC_CLIENT_SECRET}" ] \
  || fail "agent-secret-resolve" "Could not retrieve client secret for '${SMOKE_AGENT_CLIENT_ID}'"

export SMOKE_AGENT_SECRET="${_KC_CLIENT_SECRET}"
unset _KC_ADMIN_TOKEN _KC_CLIENT_UUID _KC_CLIENT_SECRET
log "agent client secret resolved (not logged)"

# ---------------------------------------------------------------------------
# 7. Smoke test
# ---------------------------------------------------------------------------
log "running smoke test against https://${DEMO_DOMAIN}"
bash "${REPO_ROOT}/infrastructure/scripts/demo-smoke-test.sh" "https://${DEMO_DOMAIN}" \
  || fail "smoke-test" "smoke test exited non-zero — do not proceed to demo"

log "Sync complete. demo-smoke-test passed."
