#!/usr/bin/env bash
# demo-bootstrap.sh
#
# One-time bootstrap for a freshly provisioned demo EC2 instance. Idempotent
# where possible — safe to re-run if a previous invocation failed partway.
#
# Responsibilities:
#   1. Verify the repo is cloned at /opt/provenance (user-data handles the clone)
#   2. Seed .env.ec2 from the template and pin Caddy hostnames to demo values
#   3. Bring up the EC2 docker compose stack (Caddy runs as a container in
#      the stack — see PRIMARY_DOMAIN / AUTH_DOMAIN in .env.ec2)
#   4. Wait for Keycloak health, then run configure-keycloak-ec2.sh
#
# After this script, the operator runs demo-sync.sh <sha> to seed.
#
# Expects:
#   DEMO_DOMAIN              (e.g. demo.provenancelogic.com)
#   AUTH_DEMO_DOMAIN         (e.g. auth-demo.provenancelogic.com)
#
# Prints "Bootstrap complete. Ready for demo-sync." on success.

set -euo pipefail

REPO_ROOT="/opt/provenance"
DEMO_DOMAIN="${DEMO_DOMAIN:-demo.provenancelogic.com}"
AUTH_DEMO_DOMAIN="${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}"
COMPOSE_FILE="${REPO_ROOT}/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env.ec2"
ENV_TEMPLATE="${REPO_ROOT}/infrastructure/docker/.env.example"

log() {
  echo "[demo-bootstrap $(date '+%H:%M:%S')] $*"
}

fail() {
  echo "[demo-bootstrap FATAL] $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
[ -d "$REPO_ROOT" ] || fail "repo not found at $REPO_ROOT — user-data should have cloned it"
[ -f "$COMPOSE_FILE" ] || fail "compose file missing: $COMPOSE_FILE"

command -v docker >/dev/null || fail "docker not installed — user-data should have installed it"
command -v pnpm >/dev/null || fail "pnpm not installed — user-data should have installed it via corepack"

# ---------------------------------------------------------------------------
# 0. Workspace install — builds packages/types/dist via root postinstall.
#
# Several services (notably agent-query) bind-mount packages/types into the
# container and `import` from `@provenance/types` whose package.json points at
# `./dist/index.js`. A fresh `git clone` ships no dist/, so the container will
# crash-loop with "Cannot find module '@provenance/types'" if we bring up the
# stack before the host has built it. `pnpm install` at the workspace root
# triggers the root postinstall (`pnpm --filter @provenance/types build`).
# Idempotent — pnpm short-circuits when the lockfile and node_modules are
# already in sync, so re-running the bootstrap is cheap.
# ---------------------------------------------------------------------------
log "running pnpm install at workspace root (builds @provenance/types via postinstall)"
( cd "$REPO_ROOT" && pnpm install --frozen-lockfile ) \
  || fail "workspace install failed — check pnpm output above"

# ---------------------------------------------------------------------------
# 1. Env file from template + demo-specific overrides
#
# Caddy runs inside the compose stack (provenance-ec2-caddy, image
# caddy:2-alpine). Its Caddyfile uses {$PRIMARY_DOMAIN:dev.provenancelogic.com}
# / {$AUTH_DOMAIN:auth.provenancelogic.com} syntax — the defaults work for the
# dev environment unchanged, and we override them here for demo.
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_TEMPLATE" ]; then
    log "seeding $ENV_FILE from template"
    cp "$ENV_TEMPLATE" "$ENV_FILE"
  else
    fail "no env template at $ENV_TEMPLATE — cannot continue"
  fi
else
  log "$ENV_FILE already present — leaving as-is"
fi

# Force every dev/auth-domain-shaped env var to demo values. The compose file
# defaults all of these to the dev hostnames, so the demo path has to override
# them explicitly. Idempotent — strips prior lines for these keys, then appends
# fresh ones. Leaves all other vars in $ENV_FILE untouched.
log "writing demo URL/hostname overrides into $ENV_FILE"
sed -i \
  -e '/^PRIMARY_DOMAIN=/d' \
  -e '/^AUTH_DOMAIN=/d' \
  -e '/^KC_HOSTNAME=/d' \
  -e '/^KC_FRONTEND_URL=/d' \
  -e '/^KEYCLOAK_ISSUER_URL=/d' \
  -e '/^APP_BASE_URL=/d' \
  -e '/^VITE_API_BASE_URL=/d' \
  -e '/^VITE_KEYCLOAK_URL=/d' \
  "$ENV_FILE"
{
  echo "PRIMARY_DOMAIN=${DEMO_DOMAIN}"
  echo "AUTH_DOMAIN=${AUTH_DEMO_DOMAIN}"
  echo "KC_HOSTNAME=${AUTH_DEMO_DOMAIN}"
  echo "KC_FRONTEND_URL=https://${AUTH_DEMO_DOMAIN}"
  echo "KEYCLOAK_ISSUER_URL=https://${AUTH_DEMO_DOMAIN}/realms/provenance"
  echo "APP_BASE_URL=https://${DEMO_DOMAIN}"
  echo "VITE_API_BASE_URL=https://${DEMO_DOMAIN}/api/v1"
  echo "VITE_KEYCLOAK_URL=https://${AUTH_DEMO_DOMAIN}"
} >> "$ENV_FILE"

# ---------------------------------------------------------------------------
# 2. Compose up
# ---------------------------------------------------------------------------
log "bringing up docker compose stack"
cd "$REPO_ROOT"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ---------------------------------------------------------------------------
# 3. Wait for Keycloak, then configure
# ---------------------------------------------------------------------------
log "waiting for Keycloak readiness"
for i in $(seq 1 60); do
  if docker exec provenance-ec2-keycloak /opt/keycloak/bin/kcadm.sh \
      config credentials --server http://localhost:8080 --realm master \
      --user admin --password "${KEYCLOAK_ADMIN_PASSWORD:-provenance_dev_admin}" \
      >/dev/null 2>&1; then
    log "Keycloak responding"
    break
  fi
  sleep 5
  if [ "$i" -eq 60 ]; then
    fail "Keycloak did not become ready within 5 minutes"
  fi
done

log "configuring Keycloak for demo"
KC_FRONTEND_URL="https://${AUTH_DEMO_DOMAIN}" \
  bash "${REPO_ROOT}/infrastructure/docker/scripts/configure-keycloak-ec2.sh"

log "Bootstrap complete. Ready for demo-sync."
