#!/bin/bash
# Bootstrap script for Provenance primary EC2 instance.
# Installs Docker, Docker Compose plugin, and AWS CLI.
# The application is deployed via the CI/CD pipeline — this script only prepares the host.

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
apt-get update -q
apt-get install -yq \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  unzip \
  awscli

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# ---------------------------------------------------------------------------
# Application directory
# ---------------------------------------------------------------------------
mkdir -p /opt/provenance
chown ubuntu:ubuntu /opt/provenance

echo "Bootstrap complete — environment: ${environment}"
