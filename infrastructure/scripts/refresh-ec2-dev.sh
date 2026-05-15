#!/usr/bin/env bash
# refresh-ec2-dev.sh
#
# Canonical "I pulled new code on the EC2 dev box" workflow in one command.
# Wraps `git pull` and `docker compose up -d --force-recreate api agent-query web`,
# which is the safe rebuild path after any pull that may have touched compose
# env vars (B-028) or frontend source (B-029). Other services (postgres,
# keycloak, opa, neo4j, opensearch, redpanda, temporal, embedding) rarely
# need a recreate after a pull and are left alone — recreate them by hand
# if a compose-file change names them explicitly.
#
# Usage:
#   sudo /opt/provenance/infrastructure/scripts/refresh-ec2-dev.sh
#
# Flags:
#   --no-pull            Skip the git pull (use when the repo is already at
#                        the desired ref or you're testing a local change).
#   --services "a b c"   Override the default service list (api agent-query web).
#   --skip-healthcheck   Don't poll /api/health after the recreate.
#
# Exits non-zero if the pull, the recreate, or the post-recreate health
# check fails.

set -euo pipefail

REPO_ROOT="/opt/provenance"
COMPOSE_FILE="${REPO_ROOT}/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env.ec2"
DEFAULT_SERVICES="api agent-query web"
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/v1/health}"

DO_PULL=1
DO_HEALTHCHECK=1
SERVICES="${DEFAULT_SERVICES}"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull)          DO_PULL=0; shift ;;
    --skip-healthcheck) DO_HEALTHCHECK=0; shift ;;
    --services)         SERVICES="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *) echo "[refresh-ec2-dev] unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[refresh-ec2-dev $(date '+%H:%M:%S')] $*"; }

[ -d "${REPO_ROOT}/.git" ]    || { log "FAIL: ${REPO_ROOT} is not a git checkout"; exit 1; }
[ -f "${COMPOSE_FILE}" ]      || { log "FAIL: compose file missing at ${COMPOSE_FILE}"; exit 1; }
[ -f "${ENV_FILE}" ]          || { log "FAIL: env file missing at ${ENV_FILE} — copy from .env.ec2.example and fill secrets"; exit 1; }

# ---------------------------------------------------------------------------
# 1. git pull
# ---------------------------------------------------------------------------
if [ "${DO_PULL}" = "1" ]; then
  log "git pull (branch: $(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD))"
  git -C "${REPO_ROOT}" pull --ff-only
  log "now at $(git -C "${REPO_ROOT}" rev-parse --short HEAD): $(git -C "${REPO_ROOT}" log -1 --format='%s')"
else
  log "skipping git pull (--no-pull); current ref: $(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
fi

# ---------------------------------------------------------------------------
# 2. force-recreate the volatile services
# ---------------------------------------------------------------------------
# shellcheck disable=SC2086  # SERVICES is an intentional word-split list
log "docker compose up -d --force-recreate ${SERVICES}"
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" \
  up -d --force-recreate ${SERVICES}

# ---------------------------------------------------------------------------
# 3. post-recreate health check
# ---------------------------------------------------------------------------
if [ "${DO_HEALTHCHECK}" = "0" ]; then
  log "skipping health check (--skip-healthcheck); recreate complete"
  exit 0
fi

log "waiting for API health (${HEALTH_URL})"
for attempt in $(seq 1 30); do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${HEALTH_URL}" || echo "000")
  if [ "${code}" = "200" ]; then
    log "API healthy after ${attempt}s — refresh complete"
    exit 0
  fi
  sleep 1
done

log "FAIL: API did not return 200 within 30s (last code: ${code})"
log "      inspect with: docker logs --tail 80 provenance-ec2-api"
exit 1
