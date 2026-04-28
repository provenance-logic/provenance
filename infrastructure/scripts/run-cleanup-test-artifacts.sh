#!/bin/bash
# Wrapper around cleanup-test-artifacts.sql so it can be invoked with one
# short command that doesn't line-wrap when pasted through a chat client.
#
#   bash infrastructure/scripts/run-cleanup-test-artifacts.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/cleanup-test-artifacts.sql"
CONTAINER=provenance-ec2-postgres

docker cp "$SQL_FILE" "$CONTAINER:/tmp/cleanup-test-artifacts.sql"
docker exec "$CONTAINER" psql -U provenance -d provenance -f /tmp/cleanup-test-artifacts.sql
docker exec "$CONTAINER" rm -f /tmp/cleanup-test-artifacts.sql
