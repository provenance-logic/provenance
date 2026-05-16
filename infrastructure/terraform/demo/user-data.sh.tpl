#!/bin/bash
set -euo pipefail
exec > /var/log/provenance-bootstrap.log 2>&1

# Installs Docker, clones the repo, and hands off to demo-bootstrap.sh which
# configures Caddy, brings the stack up, imports the Keycloak realm, and runs
# the seed package. The smoke test is run separately by the operator after
# DNS has propagated.

dnf install -y docker git jq
systemctl enable --now docker
usermod -aG docker ec2-user

# Node 22 + pnpm via corepack — demo-sync.sh runs the seed CLI from the host
# (not inside a container), and the project requires Node >= 22.13.
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs
corepack enable

COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | jq -r '.tag_name')
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL \
  "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# `dnf install docker` on Amazon Linux 2023 ships buildx 0.12.x; recent
# docker-compose plugin needs buildx >= 0.17 for `compose build`. Pull the
# current buildx release straight from upstream so compose can build the
# api/web/agent-query/embedding images at bootstrap time.
BUILDX_VERSION=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | jq -r '.tag_name')
curl -fsSL \
  "https://github.com/docker/buildx/releases/download/$${BUILDX_VERSION}/buildx-$${BUILDX_VERSION}.linux-amd64" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

git clone https://github.com/provenance-logic/provenance /opt/provenance
chown -R ec2-user:ec2-user /opt/provenance

cd /opt/provenance
sudo -u ec2-user git fetch --all
sudo -u ec2-user git checkout ${git_sha} || sudo -u ec2-user git checkout main

export DEMO_DOMAIN="${demo_domain}"
export AUTH_DEMO_DOMAIN="${auth_domain}"

sudo -u ec2-user \
  DEMO_DOMAIN="$DEMO_DOMAIN" AUTH_DEMO_DOMAIN="$AUTH_DEMO_DOMAIN" \
  bash /opt/provenance/infrastructure/scripts/demo-bootstrap.sh

echo "user-data complete"
