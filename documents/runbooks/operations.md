# Provenance Operations Runbook

This runbook covers daily operations, backup verification, restore procedures, failure recovery, and infrastructure threshold responses for the Provenance EC2 deployment.

## Daily Backup Verification

Backups run automatically at 2:00 AM EC2 local time via cron.

**Verify the last backup succeeded:**

```bash
tail -20 /opt/provenance/backups/backup.log
```

You should see a line like:
```
[2026-04-17 02:00:45] === Backup complete ===
```

**Verify backup files exist:**

```bash
ls -lh /opt/provenance/backups/postgres/
ls -lh /opt/provenance/backups/neo4j/
```

Each directory should contain up to 7 daily backups. PostgreSQL dumps are typically 1-10 MB for development data; Neo4j archives are typically 5-50 MB.

**If the backup failed:**

1. Check the log for the specific error: `tail -50 /opt/provenance/backups/backup.log`
2. Verify the PostgreSQL container is running: `docker inspect --format='{{.State.Health.Status}}' provenance-ec2-postgres`
3. Verify disk space: `df -h /`
4. Run the backup manually: `sudo /opt/provenance/infrastructure/scripts/backup.sh`

---

## Restore Procedure

**Estimated time:** Under 30 minutes for typical development data volumes.

### List Available Backups

```bash
sudo /opt/provenance/infrastructure/scripts/restore.sh --list
```

### Restore PostgreSQL Only

```bash
sudo /opt/provenance/infrastructure/scripts/restore.sh \
  --postgres /opt/provenance/backups/postgres/provenance-YYYYMMDD-HHMMSS.sql.gz
```

### Restore Neo4j Only

```bash
sudo /opt/provenance/infrastructure/scripts/restore.sh \
  --neo4j /opt/provenance/backups/neo4j/neo4j-YYYYMMDD-HHMMSS.tar.gz
```

### Full Restore (Both Databases)

```bash
sudo /opt/provenance/infrastructure/scripts/restore.sh \
  --postgres /opt/provenance/backups/postgres/provenance-YYYYMMDD-HHMMSS.sql.gz \
  --neo4j /opt/provenance/backups/neo4j/neo4j-YYYYMMDD-HHMMSS.tar.gz
```

### Post-Restore Verification

```bash
curl -s http://localhost:3001/api/v1/health | jq .
curl -s http://localhost:3002/health | jq .
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

All three should return healthy responses (200 OK).

---

## Restarting a Failed Service

### Check Which Services Are Unhealthy

```bash
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  ps --format "table {{.Name}}\t{{.Status}}"
```

### Restart a Single Service

```bash
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  restart <service-name>
```

Service names: `postgres`, `keycloak`, `opa`, `neo4j`, `opensearch`, `redpanda`, `api`, `web`, `embedding`, `agent-query`

### Restart the Entire Stack

```bash
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  down && \
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  up -d
```

### Service Won't Start — Check Logs

```bash
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  logs --tail 50 <service-name>
```

### Rebuild a Service (After Code Changes)

```bash
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  up -d --build <service-name>
```

---

## Disk Cleanup

### Check Current Disk Usage

```bash
df -h /
sudo du -sh /opt/provenance/backups/
sudo docker system df
```

### Prune Docker Build Cache

This is the single largest reclaimable space (often 10+ GB):

```bash
sudo docker builder prune -f
```

### Prune Unused Docker Images

```bash
sudo docker image prune -a -f --filter "until=168h"
```

This removes images not used in the last 7 days.

### Prune Unused Docker Volumes

**Warning:** Only run this when all services are stopped, or it will remove data volumes.

```bash
# Safe — only removes truly orphaned volumes:
sudo docker volume prune -f
```

### Emergency Disk Recovery

If disk is above 90% and services are failing:

1. Prune build cache: `sudo docker builder prune -f`
2. Prune old images: `sudo docker image prune -a -f --filter "until=72h"`
3. Remove old backups manually: `rm /opt/provenance/backups/postgres/provenance-2026040*.sql.gz`
4. Check for large log files: `sudo find /var/lib/docker/containers -name "*.log" -size +100M`

---

## Keycloak Configuration

The realm import (`provenance-realm.json`) only runs on a fresh `keycloak_data` volume. Everything that can't be captured by the import — per-environment frontend URL, live client redirect URIs, protocol mappers, unmanaged-attribute policy, and the `testuser` attribute seed — is applied by `infrastructure/docker/scripts/configure-keycloak-ec2.sh`. The script is idempotent and safe to run repeatedly.

**Normal run:**

```bash
bash /opt/provenance/infrastructure/docker/scripts/configure-keycloak-ec2.sh
```

Expected tail:

```
provenance-web: added https://dev.provenancelogic.com to redirectUris and webOrigins
provenance-web: mapper 'provenance_principal_id' already exists — skipping
provenance-web: mapper 'provenance_org_id' already exists — skipping
provenance-web: mapper 'provenance_principal_type' already exists — skipping
Setting testuser attributes from identity.principals row...
```

### Gotcha — protocol mapper attributes after a fresh volume wipe

On a truly fresh install (both `keycloak_data` **and** `postgres_data` volumes recreated), the `identity.principals` row for `testuser` does not exist until the API has bootstrapped — it is created by the first authenticated login / org bootstrap flow, not by the realm import. The configure script will print:

```
identity.principals row for testuser not found — skipping attribute seed.
(This is expected on a truly fresh install before first bootstrap.)
```

When this happens, the protocol mappers are in place but they have no user attributes to project, so access tokens will not carry `provenance_principal_id` / `provenance_org_id` / `provenance_principal_type`. Downstream effects in the API: `RequestContext.orgId = ''` (empty string), role lookup short-circuited, org-scoped queries return nothing.

**Recovery:**

1. Log in to https://dev.provenancelogic.com once as `testuser` to trigger the principal-row bootstrap.
2. Confirm the row exists:

   ```bash
   docker exec provenance-ec2-postgres psql -U provenance -d provenance \
     -c "SELECT id, org_id, principal_type FROM identity.principals WHERE keycloak_subject='<testuser-sub>';"
   ```
3. Re-run the configure script:

   ```bash
   bash /opt/provenance/infrastructure/docker/scripts/configure-keycloak-ec2.sh
   ```
4. Confirm a fresh token carries the claims:

   ```bash
   TOKEN=$(curl -sf -X POST https://auth.provenancelogic.com/realms/provenance/protocol/openid-connect/token \
     -d client_id=provenance-web -d grant_type=password \
     -d username=testuser -d password=provenance_dev \
     | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
   echo "$TOKEN" | python3 -c "import sys,base64,json; p=sys.stdin.read().strip().split('.')[1]; p+='='*(-len(p)%4); c=json.loads(base64.urlsafe_b64decode(p)); print({k:c.get(k) for k in ['provenance_principal_id','provenance_org_id','provenance_principal_type']})"
   ```

Any environment-specific overrides (different admin password, different Keycloak container name, different public hostname) are passed as env vars to the script — see the script header comment for names.

---

## NF-IR Threshold Responses

These thresholds are defined in the PRD (Infrastructure Readiness section). Each threshold indicates when Phase 6 planning must begin.

### NF-IR.1 — Disk Utilization

| Level | Threshold | Action |
|---|---|---|
| Normal | Below 75% | No action required |
| Warning | 75% sustained 7 days | Begin Phase 6 planning. Run disk cleanup (see above). Consider expanding EBS volume. |
| Critical | 90% | Phase 6 urgent. Immediately run disk cleanup. Expand EBS volume. Evaluate migration to managed services. |

**Check:** `df -h /`

**CloudWatch metric:** `Provenance/DiskUsedPercent`

### NF-IR.2 — Memory Pressure

| Level | Threshold | Action |
|---|---|---|
| Normal | Below 80% | No action required |
| Warning | 80% sustained 72 hours | Begin Phase 6 planning. Review container memory limits. Consider upgrading EC2 instance type. |
| Critical | OOM restarts > 2 in 30 days | Phase 6 urgent. Upgrade instance type immediately. Review which service is consuming excess memory. |

**Check:** `free -h` and `docker stats --no-stream`

**Check OOM restarts:** `sudo dmesg | grep -i oom`

**CloudWatch metric:** `Provenance/MemoryUsedPercent`

### NF-IR.3 — API Response Time Degradation

| Level | Threshold | Action |
|---|---|---|
| Normal | p95 within baseline | No action required |
| Warning | p95 > 3x baseline sustained 48 hours | Begin Phase 6 planning. Profile slow queries. Check PostgreSQL connection pool. Review index usage. |

**Note:** Baseline measurement requires Phase 5.1 monitoring to be in place first.

### NF-IR.4 — MCP Query Degradation

| Level | Threshold | Action |
|---|---|---|
| Normal | p95 single-product query < 2s | No action required |
| Warning | p95 > 5s sustained 24 hours | Begin Phase 6 planning. Profile agent-query service. Check embedding service latency. Review OpenSearch cluster health. |

**Quick check:** `time curl -s http://localhost:3002/health`

### NF-IR.5 — Recovery Time Objective

| Level | Threshold | Action |
|---|---|---|
| Normal | Recovery < 4 hours | No action required |
| Critical | Any recovery > 4 hours | Phase 6 urgent. Document what failed and why. Simplify restore procedure. Evaluate managed database services. |

**Note:** Validate quarterly by running a test restore (see Restore Procedure above).

### NF-IR.6 — Tenant Scale

| Level | Threshold | Action |
|---|---|---|
| Normal | < 10 orgs, < 5,000 products | No action required |
| Warning | 10 orgs OR 5,000 products | Begin Phase 6 planning regardless of performance metrics. |

**Check:** `curl -s http://localhost:3001/api/v1/health | jq .`
(Add org/product count queries when available)

### NF-IR.7 — Backup Restore Validation

Run a test restore at least once per quarter. If the restore fails or takes more than 2 hours, begin Phase 6 planning.

See the Restore Procedure section above.

### NF-IR.8 — Concurrent MCP Sessions

| Level | Threshold | Action |
|---|---|---|
| Normal | < 50 concurrent sessions | No action required |
| Warning | 50+ sessions sustained 24 hours | Benchmark against NF6.1 targets. If targets not met, begin Phase 6 planning. |

---

## Monitoring Dashboard

CloudWatch metrics are published to the `Provenance` namespace. Key metrics to monitor:

| Metric | Source | Interval |
|---|---|---|
| `disk/used_percent` | CloudWatch Agent | 5 min |
| `mem/mem_used_percent` | CloudWatch Agent | 5 min |
| `DiskUsedPercent` | emit-container-health.sh | 5 min |
| `MemoryUsedPercent` | emit-container-health.sh | 5 min |
| `ContainerHealthy` | emit-container-health.sh | 5 min |
| `UnhealthyContainerCount` | emit-container-health.sh | 5 min |

Backup logs are streamed to CloudWatch Logs group `/provenance/backups`.

### Recommended CloudWatch Alarms

| Alarm | Metric | Condition | SNS Action |
|---|---|---|---|
| Disk Warning | DiskUsedPercent | >= 75 for 7 days | Notify |
| Disk Critical | DiskUsedPercent | >= 90 for 1 hour | Page |
| Memory Warning | MemoryUsedPercent | >= 80 for 72 hours | Notify |
| Container Down | UnhealthyContainerCount | >= 1 for 15 min | Page |

---

## Credential Rotation

### Rotation Schedule

| Credential | Rotation Interval | Procedure |
|---|---|---|
| MCP API key | Every 90 days | Automated script (see below) |
| PostgreSQL password | Every 90 days | Manual — update `.env.ec2`, restart all services |
| Neo4j password | Every 90 days | Manual — update `.env.ec2`, restart all services |
| Keycloak admin password | Every 90 days | Manual — update `.env.ec2`, restart keycloak |
| Anthropic API key | Per Anthropic policy | Rotate in Anthropic console, update `.env.ec2`, restart api and agent-query |

### MCP API Key Rotation

The MCP API key authenticates requests between the API and the agent-query layer. It should be rotated every 90 days.

**Automated rotation:**

```bash
sudo /opt/provenance/infrastructure/scripts/rotate-mcp-key.sh
```

This script:
1. Generates a new 32-byte random key via `openssl rand`
2. Updates `MCP_API_KEY` in `/opt/provenance/infrastructure/docker/.env.ec2`
3. Restarts only the `api` and `agent-query` containers (other services are unaffected)
4. Logs the rotation date to `/opt/provenance/backups/key-rotation.log`

**Manual rotation (if the script is unavailable):**

```bash
# 1. Generate a new key
NEW_KEY=$(openssl rand -hex 32)
echo "New MCP API key: ${NEW_KEY}"

# 2. Update .env.ec2
sed -i "s/^MCP_API_KEY=.*/MCP_API_KEY=${NEW_KEY}/" /opt/provenance/infrastructure/docker/.env.ec2

# 3. Restart affected services
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  restart api agent-query

# 4. Verify
curl -s http://localhost:3001/api/v1/health | jq .
curl -s http://localhost:3002/health | jq .
```

**Important:** Never reuse an MCP API key from git history. The key `provenance-mcp-dev-key-2026` was committed in early development and must not be reused in any environment.

### PostgreSQL / Neo4j Password Rotation

These passwords are shared across multiple services and require a full stack restart.

```bash
# 1. Generate new password
NEW_PW=$(openssl rand -base64 24)

# 2. Update .env.ec2
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${NEW_PW}/" /opt/provenance/infrastructure/docker/.env.ec2
sed -i "s/^NEO4J_PASSWORD=.*/NEO4J_PASSWORD=${NEW_PW}/" /opt/provenance/infrastructure/docker/.env.ec2

# 3. Update the running database password BEFORE restarting
docker exec provenance-ec2-postgres psql -U provenance -c "ALTER USER provenance PASSWORD '${NEW_PW}';"

# 4. Restart all services
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  down && \
sudo docker compose -f /opt/provenance/infrastructure/docker/docker-compose.ec2-dev.yml \
  --env-file /opt/provenance/infrastructure/docker/.env.ec2 \
  up -d

# 5. Log the rotation
echo "[$(date '+%Y-%m-%d %H:%M:%S')] PostgreSQL and Neo4j passwords rotated" >> /opt/provenance/backups/key-rotation.log
```
