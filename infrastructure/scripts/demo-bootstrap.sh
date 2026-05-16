#!/usr/bin/env bash
# demo-bootstrap.sh
#
# One-time bootstrap for a freshly provisioned demo EC2 instance. Idempotent
# where possible — safe to re-run if a previous invocation failed partway.
#
# Responsibilities:
#   1. Verify the repo is cloned at /opt/provenance (user-data handles the clone)
#   2. Install Caddy for TLS termination on demo.provenancelogic.com and
#      auth-demo.provenancelogic.com
#   3. Write Caddyfile and start Caddy under systemd
#   4. Write .env.demo from the template if not already present
#   5. Bring up the EC2 docker compose stack
#   6. Wait for Keycloak health, then run configure-keycloak-ec2.sh
#
# After this script, the operator runs demo-sync.sh <sha> to seed.
#
# Expects:
#   DEMO_DOMAIN              (e.g. demo.provenancelogic.com)
#   AUTH_DEMO_DOMAIN         (e.g. auth-demo.provenancelogic.com)
#
# Prints "Bootstrap complete. Ready for demo-sync." on success.

set -euo pipefail

REPO_ROOT="/opt/provenance"
DEMO_DOMAIN="${DEMO_DOMAIN:-demo.provenancelogic.com}"
AUTH_DEMO_DOMAIN="${AUTH_DEMO_DOMAIN:-auth-demo.provenancelogic.com}"
COMPOSE_FILE="${REPO_ROOT}/infrastructure/docker/docker-compose.ec2-dev.yml"
ENV_FILE="${REPO_ROOT}/infrastructure/docker/.env.ec2"
ENV_TEMPLATE="${REPO_ROOT}/infrastructure/docker/.env.example"

log() {
  echo "[demo-bootstrap $(date '+%H:%M:%S')] $*"
}

fail() {
  echo "[demo-bootstrap FATAL] $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
[ -d "$REPO_ROOT" ] || fail "repo not found at $REPO_ROOT — user-data should have cloned it"
[ -f "$COMPOSE_FILE" ] || fail "compose file missing: $COMPOSE_FILE"

command -v docker >/dev/null || fail "docker not installed — user-data should have installed it"

# ---------------------------------------------------------------------------
# 1. Caddy install
# ---------------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  log "installing Caddy"
  # The @caddy/caddy Copr repo does not publish AmazonLinux 2023 builds (only
  # Fedora + EPEL), so we install the static release binary from GitHub and
  # wire up the systemd unit ourselves. This is the install path Caddy's own
  # docs recommend for distros without a packaged build.
  CADDY_VERSION=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | jq -r '.tag_name' | sed 's/^v//')
  log "installing Caddy ${CADDY_VERSION} from GitHub release"
  TMPDIR_CADDY=$(mktemp -d)
  trap 'rm -rf "$TMPDIR_CADDY"' EXIT
  curl -fsSL -o "$TMPDIR_CADDY/caddy.tar.gz" \
    "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
  sudo tar -xzf "$TMPDIR_CADDY/caddy.tar.gz" -C /usr/bin caddy
  sudo chmod +x /usr/bin/caddy
  sudo getent group caddy >/dev/null || sudo groupadd --system caddy
  id caddy >/dev/null 2>&1 || sudo useradd --system --gid caddy \
    --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin \
    --comment "Caddy web server" caddy
  sudo mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
  sudo chown -R caddy:caddy /var/lib/caddy /var/log/caddy
  sudo curl -fsSL -o /etc/systemd/system/caddy.service \
    https://raw.githubusercontent.com/caddyserver/dist/master/init/caddy.service
  sudo systemctl daemon-reload
else
  log "caddy already installed"
fi

# ---------------------------------------------------------------------------
# 2. Caddyfile
# ---------------------------------------------------------------------------
CADDYFILE="/etc/caddy/Caddyfile"
log "writing Caddyfile for ${DEMO_DOMAIN} and ${AUTH_DEMO_DOMAIN}"
sudo tee "$CADDYFILE" >/dev/null <<CADDY
${DEMO_DOMAIN} {
  encode zstd gzip
  reverse_proxy /api/* http://127.0.0.1:3001
  reverse_proxy /mcp/* http://127.0.0.1:3002
  reverse_proxy http://127.0.0.1:3000
}

${AUTH_DEMO_DOMAIN} {
  encode zstd gzip
  reverse_proxy http://127.0.0.1:8080
}
CADDY

sudo systemctl enable --now caddy
sudo systemctl reload caddy || sudo systemctl restart caddy
log "caddy active"

# ---------------------------------------------------------------------------
# 3. Env file from template
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_TEMPLATE" ]; then
    log "seeding $ENV_FILE from template"
    cp "$ENV_TEMPLATE" "$ENV_FILE"
  else
    fail "no env template at $ENV_TEMPLATE — cannot continue"
  fi
else
  log "$ENV_FILE already present — leaving as-is"
fi

# ---------------------------------------------------------------------------
# 4. Compose up
# ---------------------------------------------------------------------------
log "bringing up docker compose stack"
cd "$REPO_ROOT"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

# ---------------------------------------------------------------------------
# 5. Wait for Keycloak, then configure
# ---------------------------------------------------------------------------
log "waiting for Keycloak readiness"
for i in $(seq 1 60); do
  if docker exec provenance-ec2-keycloak /opt/keycloak/bin/kcadm.sh \
      config credentials --server http://localhost:8080 --realm master \
      --user admin --password "${KEYCLOAK_ADMIN_PASSWORD:-provenance_dev_admin}" \
      >/dev/null 2>&1; then
    log "Keycloak responding"
    break
  fi
  sleep 5
  if [ "$i" -eq 60 ]; then
    fail "Keycloak did not become ready within 5 minutes"
  fi
done

log "configuring Keycloak for demo"
KC_FRONTEND_URL="https://${AUTH_DEMO_DOMAIN}" \
  bash "${REPO_ROOT}/infrastructure/docker/scripts/configure-keycloak-ec2.sh"

log "Bootstrap complete. Ready for demo-sync."
