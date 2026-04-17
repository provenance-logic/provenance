#!/usr/bin/env bash
# Install Provenance backup cron job
#
# Installs a daily backup cron job that runs at 2:00 AM EC2 local time.
# Must be run as root (or with sudo).
#
# Usage:
#   sudo ./infrastructure/scripts/install-cron.sh
#
# To verify:
#   sudo crontab -l
#
# To remove:
#   sudo crontab -l | grep -v backup.sh | sudo crontab -

set -euo pipefail

BACKUP_SCRIPT="/opt/provenance/infrastructure/scripts/backup.sh"
CRON_SCHEDULE="0 2 * * *"
CRON_LINE="${CRON_SCHEDULE} ${BACKUP_SCRIPT} >> /opt/provenance/backups/backup.log 2>&1"

# Ensure backup script is executable
chmod +x "${BACKUP_SCRIPT}"

# Ensure cronie is installed (Amazon Linux 2023)
if ! command -v crontab &> /dev/null; then
  echo "Installing cronie..."
  dnf install -y cronie
  systemctl enable crond
  systemctl start crond
fi

# Create backup directories
mkdir -p /opt/provenance/backups/postgres /opt/provenance/backups/neo4j

# Add cron job if not already present
EXISTING=$(crontab -l 2>/dev/null || true)

if echo "${EXISTING}" | grep -qF "backup.sh"; then
  echo "Backup cron job already installed:"
  echo "${EXISTING}" | grep "backup.sh"
else
  (echo "${EXISTING}"; echo "${CRON_LINE}") | crontab -
  echo "Backup cron job installed:"
  echo "  ${CRON_LINE}"
fi

echo ""
echo "Current crontab:"
crontab -l
