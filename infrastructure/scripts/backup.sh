#!/usr/bin/env bash
# Provenance daily backup script
#
# Backs up PostgreSQL (pg_dump) and Neo4j (file copy) to timestamped directories.
# Retains the last 7 daily backups and deletes older ones.
# Exits non-zero on any failure.
#
# Usage:
#   sudo ./infrastructure/scripts/backup.sh
#
# Designed to run from cron (see install-cron.sh) or manually.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BACKUP_ROOT="/opt/provenance/backups"
PG_BACKUP_DIR="${BACKUP_ROOT}/postgres"
NEO4J_BACKUP_DIR="${BACKUP_ROOT}/neo4j"
LOG_FILE="${BACKUP_ROOT}/backup.log"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

COMPOSE_FILE="/opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="/opt/provenance/infrastructure/docker/.env.ec2"

# PostgreSQL connection (matches docker-compose.ec2-dev.yml)
PG_CONTAINER="provenance-ec2-postgres"
PG_USER="provenance"
PG_DB="provenance"

# Neo4j
NEO4J_CONTAINER="provenance-ec2-neo4j"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

fail() {
  log "FAILURE: $*"
  exit 1
}

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
mkdir -p "${PG_BACKUP_DIR}" "${NEO4J_BACKUP_DIR}"
touch "${LOG_FILE}"

log "=== Backup started (${TIMESTAMP}) ==="

# ---------------------------------------------------------------------------
# 1. PostgreSQL backup via pg_dump
# ---------------------------------------------------------------------------
PG_DUMP_FILE="${PG_BACKUP_DIR}/provenance-${TIMESTAMP}.sql.gz"

log "Backing up PostgreSQL to ${PG_DUMP_FILE}..."

docker exec "${PG_CONTAINER}" \
  pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --no-privileges \
  | gzip > "${PG_DUMP_FILE}" \
  || fail "PostgreSQL pg_dump failed"

PG_SIZE=$(du -h "${PG_DUMP_FILE}" | cut -f1)
log "PostgreSQL backup complete (${PG_SIZE})"

# Also dump the keycloak database
KC_DUMP_FILE="${PG_BACKUP_DIR}/keycloak-${TIMESTAMP}.sql.gz"

log "Backing up Keycloak database to ${KC_DUMP_FILE}..."

docker exec "${PG_CONTAINER}" \
  pg_dump -U "${PG_USER}" -d keycloak --no-owner --no-privileges \
  | gzip > "${KC_DUMP_FILE}" \
  || fail "Keycloak pg_dump failed"

KC_SIZE=$(du -h "${KC_DUMP_FILE}" | cut -f1)
log "Keycloak backup complete (${KC_SIZE})"

# ---------------------------------------------------------------------------
# 2. Neo4j backup (file-level copy of data directory)
# ---------------------------------------------------------------------------
NEO4J_ARCHIVE="${NEO4J_BACKUP_DIR}/neo4j-${TIMESTAMP}.tar.gz"

log "Backing up Neo4j data to ${NEO4J_ARCHIVE}..."

# Get the Docker volume mount path for neo4j data
NEO4J_VOLUME=$(docker volume inspect provenance-ec2_neo4j_data --format '{{.Mountpoint}}') \
  || fail "Could not locate Neo4j data volume"

tar -czf "${NEO4J_ARCHIVE}" -C "${NEO4J_VOLUME}" . \
  || fail "Neo4j tar backup failed"

NEO4J_SIZE=$(du -h "${NEO4J_ARCHIVE}" | cut -f1)
log "Neo4j backup complete (${NEO4J_SIZE})"

# ---------------------------------------------------------------------------
# 3. Retention — delete backups older than RETENTION_DAYS
# ---------------------------------------------------------------------------
log "Pruning backups older than ${RETENTION_DAYS} days..."

PG_DELETED=$(find "${PG_BACKUP_DIR}" -name "*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
NEO4J_DELETED=$(find "${NEO4J_BACKUP_DIR}" -name "*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)

log "Pruned ${PG_DELETED} PostgreSQL and ${NEO4J_DELETED} Neo4j old backups"

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
PG_COUNT=$(find "${PG_BACKUP_DIR}" -name "provenance-*.sql.gz" | wc -l)
NEO4J_COUNT=$(find "${NEO4J_BACKUP_DIR}" -name "neo4j-*.tar.gz" | wc -l)

log "=== Backup complete ==="
log "  PostgreSQL backups on disk: ${PG_COUNT}"
log "  Neo4j backups on disk:      ${NEO4J_COUNT}"
log "  Backup root:                ${BACKUP_ROOT}"
