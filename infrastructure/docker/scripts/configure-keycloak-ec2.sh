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
    -s "attributes.frontendUrl=$KC_FRONTEND_URL" \
    -s "registrationAllowed=true" \
    -s "registrationEmailAsUsername=true" \
    -s "verifyEmail=true" \
    -s "loginWithEmailAllowed=true" \
    -s "resetPasswordAllowed=true"
  echo "  provenance realm: sslRequired=NONE, frontendUrl=$KC_FRONTEND_URL, registrationAllowed=true, verifyEmail=true"

  # -------------------------------------------------------------------------
  # SMTP configuration for the provenance realm.
  # Dev / EC2: Mailhog captures everything locally.
  # Production: override KC_SMTP_* env vars to point at SES or equivalent.
  # Idempotent — kcadm merges the smtpServer object on each run.
  # -------------------------------------------------------------------------
  KC_SMTP_HOST="${KC_SMTP_HOST:-mailhog}"
  KC_SMTP_PORT="${KC_SMTP_PORT:-1025}"
  KC_SMTP_FROM="${KC_SMTP_FROM:-noreply@provenancelogic.com}"
  KC_SMTP_FROM_NAME="${KC_SMTP_FROM_NAME:-Provenance}"
  KC_SMTP_AUTH="${KC_SMTP_AUTH:-false}"
  KC_SMTP_SSL="${KC_SMTP_SSL:-false}"
  KC_SMTP_STARTTLS="${KC_SMTP_STARTTLS:-false}"
  KC_SMTP_USER="${KC_SMTP_USER:-}"
  KC_SMTP_PASSWORD="${KC_SMTP_PASSWORD:-}"

  SMTP_JSON="$(printf '{"host":"%s","port":"%s","from":"%s","fromDisplayName":"%s","replyTo":"%s","envelopeFrom":"%s","auth":"%s","ssl":"%s","starttls":"%s"' \
    "$KC_SMTP_HOST" "$KC_SMTP_PORT" "$KC_SMTP_FROM" "$KC_SMTP_FROM_NAME" "$KC_SMTP_FROM" "$KC_SMTP_FROM" \
    "$KC_SMTP_AUTH" "$KC_SMTP_SSL" "$KC_SMTP_STARTTLS")"
  if [ "$KC_SMTP_AUTH" = "true" ] && [ -n "$KC_SMTP_USER" ]; then
    SMTP_JSON="$SMTP_JSON$(printf ',"user":"%s","password":"%s"' "$KC_SMTP_USER" "$KC_SMTP_PASSWORD")"
  fi
  SMTP_JSON="$SMTP_JSON}"

  run_kcadm update realms/provenance -s "smtpServer=$SMTP_JSON" >/dev/null
  echo "  provenance realm: smtpServer -> host=$KC_SMTP_HOST port=$KC_SMTP_PORT from=$KC_SMTP_FROM"

  # -------------------------------------------------------------------------
  # Keycloak 24 ships with declarative user profile enabled by default, which
  # silently drops any user attributes not declared in the profile schema
  # (username/email/firstName/lastName). The provenance_* claims are projected
  # from user attributes, so we must allow unmanaged attributes for admins.
  # ADMIN_EDIT = admins can read/write; regular users cannot see them.
  # -------------------------------------------------------------------------
  run_kcadm update users/profile -r provenance \
    -s 'unmanagedAttributePolicy="ADMIN_EDIT"' >/dev/null
  echo "  provenance realm: unmanagedAttributePolicy=ADMIN_EDIT"

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

    # -----------------------------------------------------------------------
    # Ensure protocol mappers exist on provenance-web so access tokens carry
    # provenance_principal_id, provenance_org_id, provenance_principal_type
    # (projected from the corresponding user attributes).
    # Idempotent: checks by mapper name before creating.
    # -----------------------------------------------------------------------
    existing_mappers="$(run_kcadm get "clients/$CLIENT_ID/protocol-mappers/models" -r provenance --fields name --format csv --noquotes 2>/dev/null || true)"
    for claim in provenance_principal_id provenance_org_id provenance_principal_type; do
      if echo "$existing_mappers" | grep -qx "$claim"; then
        echo "  provenance-web: mapper '$claim' already exists — skipping"
      else
        run_kcadm create "clients/$CLIENT_ID/protocol-mappers/models" -r provenance \
          -s "name=$claim" \
          -s 'protocol=openid-connect' \
          -s 'protocolMapper=oidc-usermodel-attribute-mapper' \
          -s 'consentRequired=false' \
          -s "config.\"user.attribute\"=$claim" \
          -s "config.\"claim.name\"=$claim" \
          -s 'config."jsonType.label"=String' \
          -s 'config."id.token.claim"=true' \
          -s 'config."access.token.claim"=true' \
          -s 'config."userinfo.token.claim"=true' >/dev/null
        echo "  provenance-web: created mapper '$claim'"
      fi
    done
  else
    echo "  provenance-web client not found — skipping redirect URI and mapper update."
  fi

  # -------------------------------------------------------------------------
  # Grant realm-management service account roles to the provenance-admin
  # confidential client. These are required by KeycloakAdminService to:
  #   - Create Keycloak users on invitation acceptance (manage-users)
  #   - Look up users by email (query-users)
  #   - Create dedicated Keycloak clients per agent per ADR-002 (manage-clients)
  #   - Look up agent clients by clientId (query-clients)
  # Idempotent: kcadm add-roles is a no-op when the role is already bound.
  # -------------------------------------------------------------------------
  ADMIN_CLIENT_ID="$(run_kcadm get clients -r provenance -q clientId=provenance-admin --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
  if [ -n "$ADMIN_CLIENT_ID" ]; then
    ADMIN_SA_USER_ID="$(run_kcadm get "clients/$ADMIN_CLIENT_ID/service-account-user" -r provenance --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
    REALM_MGMT_CLIENT_ID="$(run_kcadm get clients -r provenance -q clientId=realm-management --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
    if [ -n "$ADMIN_SA_USER_ID" ] && [ -n "$REALM_MGMT_CLIENT_ID" ]; then
      echo "Granting realm-management roles to provenance-admin service account..."
      for role in manage-users query-users manage-clients query-clients view-users view-realm; do
        run_kcadm add-roles -r provenance \
          --uusername "service-account-provenance-admin" \
          --cclientid realm-management \
          --rolename "$role" 2>/dev/null || echo "    role '$role' already granted (or not available) — skipping"
      done
      echo "  provenance-admin: realm-management roles granted"
    else
      echo "  provenance-admin service account or realm-management client not found — skipping role grant"
    fi
  else
    echo "  provenance-admin client not found — skipping service account role grant"
  fi

  # -------------------------------------------------------------------------
  # Populate testuser's Keycloak user attributes from the platform DB so the
  # protocol mappers have values to project. We look up the principal row by
  # keycloak_subject and write its UUIDs back as user attributes. This makes
  # the attributes reproducible across environments — UUIDs come from the DB
  # of truth (identity.principals), not hardcoded.
  # -------------------------------------------------------------------------
  TESTUSER_ID="$(run_kcadm get users -r provenance -q username=testuser --fields id --format csv --noquotes 2>/dev/null | tail -n 1 | tr -d '\r')"
  if [ -n "$TESTUSER_ID" ]; then
    # Keycloak user's sub is the user id itself
    PRINCIPAL_ROW="$(docker exec "${POSTGRES_CONTAINER:-provenance-ec2-postgres}" \
      psql -U provenance -d provenance -t -A -F '|' -c \
      "SELECT id, org_id, principal_type FROM identity.principals WHERE keycloak_subject='$TESTUSER_ID';" 2>/dev/null | tr -d '\r' | head -n 1)"
    if [ -n "$PRINCIPAL_ROW" ]; then
      P_ID="$(echo "$PRINCIPAL_ROW" | cut -d'|' -f1)"
      O_ID="$(echo "$PRINCIPAL_ROW" | cut -d'|' -f2)"
      P_TYPE="$(echo "$PRINCIPAL_ROW" | cut -d'|' -f3)"
      echo "Setting testuser attributes from identity.principals row..."
      # Keycloak user attributes are stored as JSON arrays of strings. The
      # kcadm dot-notation -s 'attributes.foo=bar' silently no-ops for user
      # attributes on Keycloak 24, so we pass the full JSON object instead.
      USER_ATTRS="$(printf '{"provenance_principal_id":["%s"],"provenance_org_id":["%s"],"provenance_principal_type":["%s"]}' "$P_ID" "$O_ID" "$P_TYPE")"
      run_kcadm update "users/$TESTUSER_ID" -r provenance \
        -s "attributes=$USER_ATTRS"
      echo "  testuser: provenance_principal_id=$P_ID"
      echo "  testuser: provenance_org_id=$O_ID"
      echo "  testuser: provenance_principal_type=$P_TYPE"
    else
      echo "  identity.principals row for testuser not found — skipping attribute seed."
      echo "  (This is expected on a truly fresh install before first bootstrap.)"
    fi
  else
    echo "  testuser not found in Keycloak — skipping attribute seed."
  fi
else
  echo "  provenance realm does not exist yet — skipping."
fi

echo ""
echo "Keycloak EC2 configuration complete."
echo "Browser access: $KC_FRONTEND_URL"
