#!/usr/bin/env bash
# dev-sync.sh
#
# Deploys merged `main` (or a given git SHA) to the standing DEV box, the way
# demo-sync.sh does for demo — but tailored to dev:
#
#   - DEV carries long-lived, ad-hoc state (real users, products, lineage).
#     So this script does CODE + MIGRATIONS ONLY. It does NOT reseed, reset,
#     or re-import the Keycloak realm — those would destroy dev state. (That's
#     the demo-sync job, where the seed is authoritative.)
#   - Dev runs from a single compose file (docker-compose.ec2-dev.yml) with the
#     auto-loaded .env — no demo override, no .env.ec2.
#
# It fixes the recurring "deployed but running stale code" trap the same way
# demo-sync does: the api/web/agent-query services bind-mount /opt/provenance
# and build locally, so `git pull` + `docker compose pull`/`up -d` does NOT
# deploy app code. This force-recreates them and then VERIFIES they actually
# restarted (fails loudly if not). See documents/runbooks/demo-environment.md
# "Updating a standing box" and the deploying-dev/demo notes.
#
# Usage:
#   bash dev-sync.sh [git-sha]     # defaults to main

set -euo pipefail

REPO_ROOT="/opt/provenance"
TARGET_SHA="${1:-main}"
COMPOSE_FILE="${REPO_ROOT}/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env"
DEV_DOMAIN="${DEV_DOMAIN:-dev.provenancelogic.com}"

# Wall-clock at deploy start — the integrity check asserts the bind-mounted
# app containers restarted AFTER this; an older StartedAt means stale code.
DEPLOY_START_EPOCH="$(date +%s)"

# Services that bind-mount /opt/provenance and run the source directly. These
# MUST be force-recreated to pick up new code (a plain `up -d` won't recreate
# an unchanged locally-built image; `pull` is a no-op for them).
BIND_MOUNT_APP_SERVICES="api agent-query web"

# Dev uses a single compose file + the auto-loaded .env (no demo override).
dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

log()  { echo "[dev-sync $(date '+%H:%M:%S')] $*"; }
fail() { echo "[dev-sync FAIL: $1] $2" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Checkout + fast-forward
# ---------------------------------------------------------------------------
log "fetching and checking out ${TARGET_SHA}"
cd "$REPO_ROOT"
git fetch --all --tags --prune || fail "git-fetch" "git fetch failed"
git checkout "$TARGET_SHA" || fail "git-checkout" "could not check out $TARGET_SHA"
# Fast-forward if TARGET_SHA is a branch (e.g. main). Harmless no-op for a
# detached SHA checkout (origin/<sha> doesn't exist).
git merge --ff-only "origin/${TARGET_SHA}" >/dev/null 2>&1 || true
log "on commit $(git rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
# 2. Refresh images and (re)start the stack
#
# `pull` refreshes the REGISTRY-based infra images only; it is a no-op for the
# locally-built app images and does NOT deploy app code. The force-recreate
# below is what loads the checked-out source.
# ---------------------------------------------------------------------------
log "pulling infra images (no-op for locally-built app images)"
dc pull || fail "compose-pull" "docker compose pull failed"
log "starting / refreshing the stack"
dc up -d --remove-orphans || fail "compose-up" "docker compose up failed"

# CRITICAL — the trap this script exists to avoid. Force-recreate the
# bind-mounted app services so the Node processes reload the checked-out
# source; a plain `up -d` leaves them running the code they loaded last start.
log "force-recreating bind-mounted app services: ${BIND_MOUNT_APP_SERVICES}"
# shellcheck disable=SC2086
dc up -d --force-recreate --no-deps ${BIND_MOUNT_APP_SERVICES} \
  || fail "compose-recreate" "force-recreate of app services failed"

# Caddy caches upstream container IPs; restart it after the app containers move.
log "restarting Caddy (it caches upstream container IPs)"
dc restart caddy || fail "caddy-restart" "caddy restart failed"

# ---------------------------------------------------------------------------
# 2b. Deploy integrity check — fail loudly if app code did NOT reload
# ---------------------------------------------------------------------------
log "verifying deploy integrity (app containers reloaded this run)"
for svc in ${BIND_MOUNT_APP_SERVICES}; do
  cid="$(dc ps -q "$svc")"
  [ -n "$cid" ] || fail "deploy-verify" "service '$svc' has no running container after recreate"
  started_at="$(docker inspect -f '{{.State.StartedAt}}' "$cid")"
  started_epoch="$(date -d "$started_at" +%s 2>/dev/null || echo 0)"
  if [ "$started_epoch" -lt "$DEPLOY_START_EPOCH" ]; then
    fail "deploy-verify" "'$svc' did not restart this deploy (StartedAt=$started_at predates deploy start) — it is running STALE code. Re-run: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d --force-recreate --no-deps $svc"
  fi
done
log "deploy integrity OK — app services reloaded onto $(git rev-parse --short HEAD)"

# ---------------------------------------------------------------------------
# 3. Migrations (dev DB is long-lived; flyway applies only the new ones)
# ---------------------------------------------------------------------------
log "running flyway migrations"
dc run --rm flyway-migrate || fail "migrations" "flyway-migrate run failed"

# ---------------------------------------------------------------------------
# 4. Health gate
#
# Dev is NOT seed-deterministic (ad-hoc state), so we do NOT run the
# seed-asserting demo-smoke-test here — just confirm the stack came back
# healthy and reachable after the recreate. Combined with the integrity check
# above, that's "new code deployed and serving."
# ---------------------------------------------------------------------------
log "waiting for API health at https://${DEV_DOMAIN}/api/v1/health"
health_code=""
for _ in $(seq 1 30); do
  health_code="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DEV_DOMAIN}/api/v1/health" || true)"
  [ "$health_code" = "200" ] && break
  sleep 4
done
[ "$health_code" = "200" ] || fail "health" "API health did not return 200 within ~2min (last=${health_code})"

web_code="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DEV_DOMAIN}/" || true)"
[ "$web_code" = "200" ] || fail "health" "web root returned ${web_code} (expected 200) — check Caddy restarted"

log "dev sync complete — API + web healthy on $(git rev-parse --short HEAD)"
