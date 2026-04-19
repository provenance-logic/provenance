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
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env.ec2"
DEMO_DOMAIN="${DEMO_DOMAIN:-demo.provenancelogic.com}"

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
# 2. Pull images and restart stack
# ---------------------------------------------------------------------------
log "pulling images"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull || fail "compose-pull" "docker compose pull failed"
log "restarting services"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans || fail "compose-up" "docker compose up failed"

# ---------------------------------------------------------------------------
# 3. Migrations
# ---------------------------------------------------------------------------
log "running flyway migrations"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm flyway migrate \
  || fail "migrations" "flyway migrate failed — inspect 'flyway info'"

# ---------------------------------------------------------------------------
# 4. Keycloak realm import
# ---------------------------------------------------------------------------
log "importing demo Keycloak realm"
KC_FRONTEND_URL="https://${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}" \
  bash "${REPO_ROOT}/infrastructure/docker/scripts/configure-keycloak-ec2.sh" \
  || fail "keycloak-configure" "Keycloak realm configuration failed"

# ---------------------------------------------------------------------------
# 5. Seed
# ---------------------------------------------------------------------------
log "running seed package"
( cd "$REPO_ROOT" && pnpm --filter @provenance/seed install --frozen-lockfile ) \
  || fail "seed-install" "pnpm install for @provenance/seed failed"
( cd "$REPO_ROOT" && pnpm --filter @provenance/seed run seed ) \
  || fail "seed" "seed run failed — check API and Keycloak logs"

# ---------------------------------------------------------------------------
# 6. Smoke test
# ---------------------------------------------------------------------------
log "running smoke test against https://${DEMO_DOMAIN}"
bash "${REPO_ROOT}/infrastructure/scripts/demo-smoke-test.sh" "https://${DEMO_DOMAIN}" \
  || fail "smoke-test" "smoke test exited non-zero — do not proceed to demo"

log "Sync complete. demo-smoke-test passed."
