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
