#!/bin/bash
# Wrapper around seed-real-port-contracts.sql so it runs with one short
# command that doesn't line-wrap when pasted.
#
#   bash infrastructure/scripts/run-seed-real-port-contracts.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/seed-real-port-contracts.sql"
CONTAINER=provenance-ec2-postgres

docker cp "$SQL_FILE" "$CONTAINER:/tmp/seed-real-port-contracts.sql"
docker exec "$CONTAINER" psql -U provenance -d provenance -f /tmp/seed-real-port-contracts.sql
docker exec "$CONTAINER" rm -f /tmp/seed-real-port-contracts.sql
