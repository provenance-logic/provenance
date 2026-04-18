#!/usr/bin/env bash
# configure-keycloak-ec2.sh
#
# One-time Keycloak configuration for EC2 deployments.
# Fixes "HTTPS required" errors by setting sslRequired=none and
# configuring the frontendUrl to the EC2 public IP.
#
# Run this ONCE after first boot (or after wiping keycloak_data volume):
#
#   docker exec provenance-ec2-keycloak /bin/bash /scripts/configure-keycloak-ec2.sh
#
# Or from the host:
#
#   ./infrastructure/docker/scripts/configure-keycloak-ec2.sh
#
# Prerequisites:
#   - Keycloak container must be running and healthy
#   - KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD env vars (defaults: admin / provenance_dev_admin)
#   - KC_FRONTEND_URL env var (defaults to https://auth.provenancelogic.com)

set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-provenance-ec2-keycloak}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-provenance_dev_admin}"
KC_FRONTEND_URL="${KC_FRONTEND_URL:-https://auth.provenancelogic.com}"
KEYCLOAK_URL="http://localhost:8080"

# ---------------------------------------------------------------------------
# Detect execution context: inside the container or on the host?
# ---------------------------------------------------------------------------
if [ -f /opt/keycloak/bin/kcadm.sh ]; then
  # Running inside the Keycloak container
  KCADM="/opt/keycloak/bin/kcadm.sh"
  run_kcadm() { "$KCADM" "$@"; }
else
  # Running on the host — exec into the container
  KCADM="/opt/keycloak/bin/kcadm.sh"
  run_kcadm() { docker exec "$KEYCLOAK_CONTAINER" "$KCADM" "$@"; }
fi

# ---------------------------------------------------------------------------
# Wait for Keycloak to be ready
# ---------------------------------------------------------------------------
echo "Waiting for Keycloak to be ready..."
MAX_RETRIES=30
RETRY_INTERVAL=5
for i in $(seq 1 "$MAX_RETRIES"); do
  if run_kcadm config credentials \
    --server "$KEYCLOAK_URL" \
    --realm master \
    --user "$KEYCLOAK_ADMIN" \
    --password "$KEYCLOAK_ADMIN_PASSWORD" 2>/dev/null; then
    echo "Keycloak is ready."
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: Keycloak did not become ready after $((MAX_RETRIES * RETRY_INTERVAL))s" >&2
    exit 1
  fi
  echo "  Attempt $i/$MAX_RETRIES — retrying in ${RETRY_INTERVAL}s..."
  sleep "$RETRY_INTERVAL"
done

# ---------------------------------------------------------------------------
# Configure master realm
# ---------------------------------------------------------------------------
echo "Configuring master realm..."
run_kcadm update realms/master \
  -s "sslRequired=NONE" \
  -s "attributes.frontendUrl=$KC_FRONTEND_URL"
echo "  master realm: sslRequired=NONE, frontendUrl=$KC_FRONTEND_URL"

# ---------------------------------------------------------------------------
# Configure provenance realm (if it exists)
# ---------------------------------------------------------------------------
if run_kcadm get realms/provenance &>/dev/null; then
  echo "Configuring provenance realm..."
  run_kcadm update realms/provenance \
    -s "sslRequired=NONE" \
    -s "attributes.frontendUrl=$KC_FRONTEND_URL"
  echo "  provenance realm: sslRequired=NONE, frontendUrl=$KC_FRONTEND_URL"

  # -------------------------------------------------------------------------
  # Patch provenance-web client so the live realm has the production redirect
  # URIs and web origins without requiring a keycloak_data volume wipe + reimport.
  # Idempotent: rewrites the full arrays each run.
  # -------------------------------------------------------------------------
  CLIENT_ID="$(run_kcadm get clients -r provenance -q clientId=provenance-web --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
  if [ -n "$CLIENT_ID" ]; then
    echo "Updating provenance-web client (id=$CLIENT_ID) redirectUris and webOrigins..."
    run_kcadm update "clients/$CLIENT_ID" -r provenance \
      -s 'redirectUris=["http://localhost:3000/*","http://54.83.160.49:3000/*","https://dev.provenancelogic.com/*"]' \
      -s 'webOrigins=["http://localhost:3000","http://54.83.160.49:3000","https://dev.provenancelogic.com"]'
    echo "  provenance-web: added https://dev.provenancelogic.com to redirectUris and webOrigins"
  else
    echo "  provenance-web client not found — skipping redirect URI update."
  fi
else
  echo "  provenance realm does not exist yet — skipping."
fi

echo ""
echo "Keycloak EC2 configuration complete."
echo "Browser access: $KC_FRONTEND_URL"
