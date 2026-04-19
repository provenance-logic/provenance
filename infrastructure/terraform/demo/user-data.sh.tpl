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

COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | jq -r '.tag_name')
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL \
  "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

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
