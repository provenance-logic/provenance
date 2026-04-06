#!/usr/bin/env bash
# Start Provenance on EC2 using the EC2-specific environment overrides.
# Usage: ./start-ec2.sh [docker compose args...]
# Example: ./start-ec2.sh up -d

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/.env.ec2" ]]; then
  echo "Error: $SCRIPT_DIR/.env.ec2 not found" >&2
  exit 1
fi

exec docker compose --env-file "$SCRIPT_DIR/.env.ec2" -f "$SCRIPT_DIR/docker-compose.yml" "$@"
