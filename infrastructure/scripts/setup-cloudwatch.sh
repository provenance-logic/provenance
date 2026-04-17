#!/usr/bin/env bash
# Install and configure Amazon CloudWatch Agent for Provenance EC2 monitoring
#
# Monitors:
#   - Disk utilization (NF-IR.1: warn at 75%, alert at 90%)
#   - Memory utilization (NF-IR.2: warn at 80%)
#   - Container health (all provenance-ec2-* containers)
#
# Custom metrics are published to the "Provenance" CloudWatch namespace.
#
# Prerequisites:
#   - EC2 instance must have an IAM role with CloudWatchAgentServerPolicy attached
#   - Amazon Linux 2023
#
# Usage:
#   sudo ./infrastructure/scripts/setup-cloudwatch.sh
#
# Cost: ~$3-5/month for custom metrics at 5-minute resolution.

set -euo pipefail

NAMESPACE="Provenance"
CONFIG_FILE="/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json"
HEALTH_SCRIPT="/opt/provenance/infrastructure/scripts/emit-container-health.sh"

# ---------------------------------------------------------------------------
# 1. Install CloudWatch Agent
# ---------------------------------------------------------------------------
if ! command -v amazon-cloudwatch-agent-ctl &> /dev/null; then
  echo "Installing Amazon CloudWatch Agent..."
  dnf install -y amazon-cloudwatch-agent
else
  echo "CloudWatch Agent already installed"
fi

# ---------------------------------------------------------------------------
# 2. Write CloudWatch Agent configuration
# ---------------------------------------------------------------------------
echo "Writing CloudWatch Agent configuration..."

cat > "${CONFIG_FILE}" << 'CWCONFIG'
{
  "agent": {
    "metrics_collection_interval": 300,
    "logfile": "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"
  },
  "metrics": {
    "namespace": "Provenance",
    "metrics_collected": {
      "disk": {
        "measurement": ["used_percent"],
        "metrics_collection_interval": 300,
        "resources": ["/"],
        "drop_device": true
      },
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 300
      },
      "swap": {
        "measurement": ["swap_used_percent"],
        "metrics_collection_interval": 300
      }
    },
    "append_dimensions": {
      "InstanceId": "${aws:InstanceId}",
      "AutoScalingGroupName": "${aws:AutoScalingGroupName}"
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/opt/provenance/backups/backup.log",
            "log_group_name": "/provenance/backups",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 30
          }
        ]
      }
    }
  }
}
CWCONFIG

# ---------------------------------------------------------------------------
# 3. Create container health monitoring script
# ---------------------------------------------------------------------------
echo "Creating container health monitoring script..."

cat > "${HEALTH_SCRIPT}" << 'HEALTHSCRIPT'
#!/usr/bin/env bash
# Emits custom CloudWatch metrics for Provenance container health.
# Designed to run from cron every 5 minutes.
#
# Metrics emitted to the "Provenance" namespace:
#   - ContainerHealthy (1 = healthy, 0 = unhealthy/stopped) per container
#   - UnhealthyContainerCount (total unhealthy containers)
#   - DiskUsedPercent (root volume — matches NF-IR.1 thresholds)
#   - MemoryUsedPercent (matches NF-IR.2 thresholds)

set -euo pipefail

NAMESPACE="Provenance"
INSTANCE_ID=$(ec2-metadata --instance-id 2>/dev/null | awk '{print $2}' || echo "unknown")

CONTAINERS=(
  provenance-ec2-postgres
  provenance-ec2-keycloak
  provenance-ec2-opa
  provenance-ec2-neo4j
  provenance-ec2-opensearch
  provenance-ec2-redpanda
  provenance-ec2-api
  provenance-ec2-web
  provenance-ec2-embedding
  provenance-ec2-agent-query
)

UNHEALTHY=0

for CONTAINER in "${CONTAINERS[@]}"; do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo "stopped")

  if [ "${HEALTH}" = "healthy" ]; then
    VALUE=1
  else
    VALUE=0
    UNHEALTHY=$((UNHEALTHY + 1))
  fi

  aws cloudwatch put-metric-data \
    --namespace "${NAMESPACE}" \
    --metric-name "ContainerHealthy" \
    --dimensions "InstanceId=${INSTANCE_ID},ContainerName=${CONTAINER}" \
    --value "${VALUE}" \
    --unit "None" \
    2>/dev/null || true
done

aws cloudwatch put-metric-data \
  --namespace "${NAMESPACE}" \
  --metric-name "UnhealthyContainerCount" \
  --dimensions "InstanceId=${INSTANCE_ID}" \
  --value "${UNHEALTHY}" \
  --unit "Count" \
  2>/dev/null || true

# Disk utilization (NF-IR.1: warn 75%, alert 90%)
DISK_PERCENT=$(df / --output=pcent | tail -1 | tr -d '% ')
aws cloudwatch put-metric-data \
  --namespace "${NAMESPACE}" \
  --metric-name "DiskUsedPercent" \
  --dimensions "InstanceId=${INSTANCE_ID}" \
  --value "${DISK_PERCENT}" \
  --unit "Percent" \
  2>/dev/null || true

# Memory utilization (NF-IR.2: warn 80%)
MEM_PERCENT=$(free | awk '/Mem:/ {printf "%.1f", $3/$2 * 100}')
aws cloudwatch put-metric-data \
  --namespace "${NAMESPACE}" \
  --metric-name "MemoryUsedPercent" \
  --dimensions "InstanceId=${INSTANCE_ID}" \
  --value "${MEM_PERCENT}" \
  --unit "Percent" \
  2>/dev/null || true
HEALTHSCRIPT

chmod +x "${HEALTH_SCRIPT}"

# ---------------------------------------------------------------------------
# 4. Install health monitoring cron job (every 5 minutes)
# ---------------------------------------------------------------------------
HEALTH_CRON="*/5 * * * * ${HEALTH_SCRIPT} >> /opt/provenance/backups/cloudwatch-health.log 2>&1"

EXISTING=$(crontab -l 2>/dev/null || true)

if echo "${EXISTING}" | grep -qF "emit-container-health"; then
  echo "Container health cron job already installed"
else
  (echo "${EXISTING}"; echo "${HEALTH_CRON}") | crontab -
  echo "Container health cron job installed (every 5 minutes)"
fi

# ---------------------------------------------------------------------------
# 5. Start CloudWatch Agent
# ---------------------------------------------------------------------------
echo "Starting CloudWatch Agent..."

amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -c file:"${CONFIG_FILE}" \
  -s

echo ""
echo "=== CloudWatch Agent Setup Complete ==="
echo ""
echo "Metrics published to namespace: ${NAMESPACE}"
echo "  - disk/used_percent (NF-IR.1: warn 75%, alert 90%)"
echo "  - mem/mem_used_percent (NF-IR.2: warn 80%)"
echo "  - ContainerHealthy (per container)"
echo "  - UnhealthyContainerCount (aggregate)"
echo "  - DiskUsedPercent (custom, from emit-container-health.sh)"
echo "  - MemoryUsedPercent (custom, from emit-container-health.sh)"
echo ""
echo "Backup logs streamed to CloudWatch Logs: /provenance/backups"
echo ""
echo "Next steps:"
echo "  1. Create CloudWatch alarms in the AWS Console for NF-IR thresholds"
echo "  2. Configure SNS topic for alert notifications"
