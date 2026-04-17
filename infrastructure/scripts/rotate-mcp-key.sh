#!/usr/bin/env bash
# Rotate the MCP API key used between the API and agent-query services.
#
# Generates a new random key, updates .env.ec2, restarts only the affected
# containers, and logs the rotation.
#
# Usage:
#   sudo ./infrastructure/scripts/rotate-mcp-key.sh
#
# Recommended schedule: every 90 days.

set -euo pipefail

ENV_FILE="/opt/provenance/infrastructure/docker/.env.ec2"
COMPOSE_FILE="/opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml"
LOG_FILE="/opt/provenance/backups/key-rotation.log"
DOCKER_COMPOSE="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

# ---------------------------------------------------------------------------
# 1. Generate new key
# ---------------------------------------------------------------------------
NEW_KEY=$(openssl rand -hex 32)

log "MCP API key rotation started"

# ---------------------------------------------------------------------------
# 2. Update .env.ec2
# ---------------------------------------------------------------------------
if ! grep -q "^MCP_API_KEY=" "${ENV_FILE}"; then
  echo "MCP_API_KEY=${NEW_KEY}" >> "${ENV_FILE}"
else
  sed -i "s/^MCP_API_KEY=.*/MCP_API_KEY=${NEW_KEY}/" "${ENV_FILE}"
fi

log "Updated MCP_API_KEY in ${ENV_FILE}"

# ---------------------------------------------------------------------------
# 3. Restart only api and agent-query
# ---------------------------------------------------------------------------
log "Restarting api and agent-query services..."

${DOCKER_COMPOSE} restart api agent-query 2>/dev/null

# ---------------------------------------------------------------------------
# 4. Wait for health checks
# ---------------------------------------------------------------------------
log "Waiting for services to become healthy..."

for CONTAINER in provenance-ec2-api provenance-ec2-agent-query; do
  for i in $(seq 1 30); do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo "starting")
    if [ "${STATUS}" = "healthy" ]; then
      log "${CONTAINER} is healthy"
      break
    fi
    sleep 5
  done
done

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
API_HEALTH=$(curl -sf http://localhost:3001/api/v1/health 2>/dev/null | grep -o '"status":"ok"' || echo "FAILED")
MCP_HEALTH=$(curl -sf http://localhost:3002/health 2>/dev/null | grep -o '"status":"ok"' || echo "FAILED")

if [ "${API_HEALTH}" = '"status":"ok"' ] && [ "${MCP_HEALTH}" = '"status":"ok"' ]; then
  log "MCP API key rotation complete — both services healthy"
else
  log "WARNING: rotation complete but health check issue — API: ${API_HEALTH}, MCP: ${MCP_HEALTH}"
  exit 1
fi
