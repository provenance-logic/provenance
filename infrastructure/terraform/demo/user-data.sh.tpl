#!/bin/bash
set -euo pipefail
exec > /var/log/provenance-bootstrap.log 2>&1

# Installs Docker, clones the repo, and hands off to demo-bootstrap.sh which
# configures Caddy, brings the stack up, imports the Keycloak realm, and runs
# the seed package. The smoke test is run separately by the operator after
# DNS has propagated.

dnf install -y docker git jq e2fsprogs util-linux
systemctl enable --now docker
usermod -aG docker ec2-user

# ---------------------------------------------------------------------------
# Mount the persistent Caddy data EBS volume.
#
# Terraform attaches the volume tagged `provenance-demo-caddy-data` to this
# instance at request-name /dev/sdf, which AL2023's NVMe driver exposes as
# /dev/nvme1n1 (the second NVMe device — root is nvme0n1). The volume is
# preserved across `terraform destroy` so Caddy's TLS cert files survive
# every demo cycle, sidestepping Let's Encrypt's 5-cert-per-7-day rate limit
# for the demo hostnames.
#
# Device discovery: find a 1 GB block device that is NOT the root device.
# Wait up to 2 minutes for the attachment race (Terraform fires the attach
# concurrent with user-data startup).
# ---------------------------------------------------------------------------
CADDY_DEV=""
for i in $(seq 1 60); do
  CADDY_DEV=$(lsblk -dnpo NAME,SIZE,TYPE | awk '$2 == "1G" && $3 == "disk" { print $1; exit }')
  if [ -n "$CADDY_DEV" ]; then break; fi
  sleep 2
done

if [ -z "$CADDY_DEV" ]; then
  echo "user-data ERROR: persistent Caddy data EBS volume did not appear within 120s" >&2
  exit 1
fi

# Format only on first cycle — every subsequent destroy/apply preserves the
# filesystem and the cert files within. `blkid` returning non-zero means no
# filesystem signature exists yet.
if ! blkid "$CADDY_DEV" >/dev/null 2>&1; then
  echo "user-data: no filesystem on $CADDY_DEV — formatting (first cycle)"
  mkfs.ext4 -L caddy-data "$CADDY_DEV"
fi

mkdir -p /var/lib/caddy-data
# `sync` mount option forces every write to be flushed to disk synchronously,
# closing the ext4 dirty-page-cache window between Caddy writing a cert and
# Terraform's force_detach yanking the volume. Performance cost is negligible
# because Caddy's cert workload is bytes per renewal (every ~60 days). The
# safety guarantee is worth more than the throughput.
mount -o sync "$CADDY_DEV" /var/lib/caddy-data

# Persist across reboots via UUID. Device names can shift on subsequent boots
# if multiple EBS volumes are attached; UUID is stable. `nofail` so a missing
# volume doesn't block boot to a degraded recoverable state; `sync` mirrors
# the mount above.
CADDY_UUID=$(blkid -s UUID -o value "$CADDY_DEV")
if ! grep -q "$CADDY_UUID" /etc/fstab 2>/dev/null; then
  echo "UUID=$CADDY_UUID /var/lib/caddy-data ext4 defaults,sync,nofail 0 2" >> /etc/fstab
fi

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
