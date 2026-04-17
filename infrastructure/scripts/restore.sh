#!/usr/bin/env bash
# Provenance restore script
#
# Restores PostgreSQL and/or Neo4j from backup files created by backup.sh.
#
# Usage:
#   Restore PostgreSQL only:
#     sudo ./infrastructure/scripts/restore.sh --postgres /opt/provenance/backups/postgres/provenance-20260417-020000.sql.gz
#
#   Restore Neo4j only:
#     sudo ./infrastructure/scripts/restore.sh --neo4j /opt/provenance/backups/neo4j/neo4j-20260417-020000.tar.gz
#
#   Restore both:
#     sudo ./infrastructure/scripts/restore.sh \
#       --postgres /opt/provenance/backups/postgres/provenance-20260417-020000.sql.gz \
#       --neo4j /opt/provenance/backups/neo4j/neo4j-20260417-020000.tar.gz
#
#   List available backups:
#     sudo ./infrastructure/scripts/restore.sh --list
#
# WARNING: This is a destructive operation. The current database contents will
# be replaced with the backup. The API and agent-query services will be stopped
# during restore and restarted afterward.
#
# Estimated restore time: under 30 minutes for typical development data volumes.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKUP_ROOT="/opt/provenance/backups"
COMPOSE_FILE="/opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="/opt/provenance/infrastructure/docker/.env.ec2"

PG_CONTAINER="provenance-ec2-postgres"
PG_USER="provenance"
PG_DB="provenance"
NEO4J_CONTAINER="provenance-ec2-neo4j"

DOCKER_COMPOSE="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE}"

PG_FILE=""
NEO4J_FILE=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fail() {
  log "FAILURE: $*"
  exit 1
}

usage() {
  echo "Usage: $0 [--postgres <file.sql.gz>] [--neo4j <file.tar.gz>] [--list]"
  echo ""
  echo "Options:"
  echo "  --postgres <file>   Restore PostgreSQL from a gzipped pg_dump file"
  echo "  --neo4j <file>      Restore Neo4j from a gzipped tar archive"
  echo "  --list              List available backup files"
  echo "  --help              Show this help message"
  exit 1
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
if [ $# -eq 0 ]; then
  usage
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --postgres)
      PG_FILE="$2"
      shift 2
      ;;
    --neo4j)
      NEO4J_FILE="$2"
      shift 2
      ;;
    --list)
      echo "=== PostgreSQL backups ==="
      ls -lh "${BACKUP_ROOT}/postgres/"*.sql.gz 2>/dev/null || echo "  (none)"
      echo ""
      echo "=== Neo4j backups ==="
      ls -lh "${BACKUP_ROOT}/neo4j/"*.tar.gz 2>/dev/null || echo "  (none)"
      exit 0
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

if [ -z "${PG_FILE}" ] && [ -z "${NEO4J_FILE}" ]; then
  echo "Error: specify at least one of --postgres or --neo4j"
  usage
fi

# ---------------------------------------------------------------------------
# Validate backup files exist
# ---------------------------------------------------------------------------
if [ -n "${PG_FILE}" ] && [ ! -f "${PG_FILE}" ]; then
  fail "PostgreSQL backup file not found: ${PG_FILE}"
fi
if [ -n "${NEO4J_FILE}" ] && [ ! -f "${NEO4J_FILE}" ]; then
  fail "Neo4j backup file not found: ${NEO4J_FILE}"
fi

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
echo ""
echo "WARNING: This will replace current data with the backup."
if [ -n "${PG_FILE}" ]; then
  echo "  PostgreSQL: ${PG_FILE}"
fi
if [ -n "${NEO4J_FILE}" ]; then
  echo "  Neo4j:      ${NEO4J_FILE}"
fi
echo ""
read -r -p "Type YES to proceed: " CONFIRM
if [ "${CONFIRM}" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

# ---------------------------------------------------------------------------
# Stop dependent services
# ---------------------------------------------------------------------------
log "Stopping API and agent-query services..."
${DOCKER_COMPOSE} stop api agent-query 2>/dev/null || true

# ---------------------------------------------------------------------------
# Restore PostgreSQL
# ---------------------------------------------------------------------------
if [ -n "${PG_FILE}" ]; then
  log "Restoring PostgreSQL from ${PG_FILE}..."

  # Drop and recreate the database
  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${PG_DB}' AND pid <> pg_backend_pid();" \
    > /dev/null 2>&1 || true

  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres \
    -c "DROP DATABASE IF EXISTS ${PG_DB};" \
    || fail "Could not drop database ${PG_DB}"

  docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres \
    -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" \
    || fail "Could not create database ${PG_DB}"

  # Restore from dump
  gunzip -c "${PG_FILE}" | docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" --quiet \
    || fail "PostgreSQL restore failed"

  log "PostgreSQL restore complete"

  # Re-run Flyway migrations to ensure schema is current
  log "Running Flyway migrations..."
  ${DOCKER_COMPOSE} run --rm flyway-migrate 2>/dev/null \
    || log "WARNING: Flyway migration returned non-zero (may be expected if backup is current)"
fi

# ---------------------------------------------------------------------------
# Restore Neo4j
# ---------------------------------------------------------------------------
if [ -n "${NEO4J_FILE}" ]; then
  log "Restoring Neo4j from ${NEO4J_FILE}..."

  # Stop Neo4j to safely replace data files
  ${DOCKER_COMPOSE} stop neo4j 2>/dev/null || true

  NEO4J_VOLUME=$(docker volume inspect provenance-ec2_neo4j_data --format '{{.Mountpoint}}') \
    || fail "Could not locate Neo4j data volume"

  # Clear existing data and extract backup
  rm -rf "${NEO4J_VOLUME:?}"/*
  tar -xzf "${NEO4J_FILE}" -C "${NEO4J_VOLUME}" \
    || fail "Neo4j tar extraction failed"

  # Restart Neo4j
  ${DOCKER_COMPOSE} up -d neo4j
  log "Neo4j restore complete — waiting for health check..."

  # Wait for Neo4j to become healthy
  for i in $(seq 1 30); do
    if docker inspect --format='{{.State.Health.Status}}' "${NEO4J_CONTAINER}" 2>/dev/null | grep -q healthy; then
      log "Neo4j is healthy"
      break
    fi
    sleep 5
  done
fi

# ---------------------------------------------------------------------------
# Restart services
# ---------------------------------------------------------------------------
log "Restarting API and agent-query services..."
${DOCKER_COMPOSE} up -d api agent-query

log "=== Restore complete ==="
log "Verify the platform is healthy:"
log "  curl -s http://localhost:3001/api/v1/health | jq ."
log "  curl -s http://localhost:3002/health | jq ."
