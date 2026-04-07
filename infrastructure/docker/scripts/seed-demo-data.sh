#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# seed-demo-data.sh — Populate the Provenance platform with realistic
# sample data products for Phase 2 testing.
#
# Prerequisites:
#   - Keycloak, PostgreSQL, and the API container must be running
#   - The "testuser" account must exist in the provenance realm
#   - At least one organisation and the "Platform Analytics" domain
#     must already be created (done by first-run setup)
#
# Usage:
#   bash infrastructure/docker/scripts/seed-demo-data.sh
# ---------------------------------------------------------------------------
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — auto-detect EC2 public IP or fall back to localhost
# ---------------------------------------------------------------------------
EC2_IP=$(curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
if [ -n "$EC2_IP" ]; then
  KC_URL="http://${EC2_IP}:8080"
  API_URL="http://localhost:3001/api/v1"
else
  KC_URL="http://localhost:8080"
  API_URL="http://localhost:3001/api/v1"
fi

KC_REALM="provenance"
KC_CLIENT="provenance-web"
KC_USER="testuser"
KC_PASS="provenance_dev"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
get_token() {
  curl -sf -X POST "${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token" \
    -d "client_id=${KC_CLIENT}" \
    -d "grant_type=password" \
    -d "username=${KC_USER}" \
    -d "password=${KC_PASS}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
}

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    "${API_URL}${path}" "$@"
}

api_id() {
  # Call api and extract .id from response
  api "$@" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])"
}

echo "============================================"
echo "  Provenance Demo Data Seeder"
echo "============================================"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Authenticate
# ---------------------------------------------------------------------------
echo "[1/6] Authenticating as ${KC_USER}..."
TOKEN=$(get_token)
echo "       Got access token (${#TOKEN} chars)"

# ---------------------------------------------------------------------------
# Step 2 — Resolve org and domain
# ---------------------------------------------------------------------------
echo "[2/6] Resolving organisation and domain..."
ORG_ID=$(api GET "/organizations?limit=1&offset=0" | python3 -c "import sys,json; print(json.load(sys.stdin)['items'][0]['id'])")
echo "       Org ID:    ${ORG_ID}"

DOMAIN_JSON=$(api GET "/organizations/${ORG_ID}/domains?limit=10&offset=0" | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
# Prefer 'Platform Analytics', fall back to first domain
d = next((x for x in items if x['slug'] == 'platform-analytics'), items[0])
print(json.dumps({'id': d['id'], 'owner': d['ownerPrincipalId']}))
")
DOMAIN_ID=$(echo "$DOMAIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
OWNER_ID=$(echo "$DOMAIN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['owner'])")
echo "       Domain ID: ${DOMAIN_ID}"
echo "       Owner ID:  ${OWNER_ID}"

BASE="/organizations/${ORG_ID}/domains/${DOMAIN_ID}/products"

# Refresh token (in case earlier steps were slow)
TOKEN=$(get_token)

# ---------------------------------------------------------------------------
# Step 3 — Create data products
# ---------------------------------------------------------------------------
echo "[3/6] Creating data products..."

# --- Product 1: Customer Revenue Analytics (will be published) -----------
echo "       Creating 'Customer Revenue Analytics'..."
P1_ID=$(api_id POST "$BASE" -d '{
  "name": "Customer Revenue Analytics",
  "slug": "customer-revenue-analytics",
  "description": "Aggregated customer revenue metrics segmented by plan tier, region, and cohort. Refreshed daily from the billing pipeline. Designed for finance dashboards and churn-prediction models.",
  "classification": "confidential",
  "ownerPrincipalId": "'"${OWNER_ID}"'",
  "tags": ["revenue", "billing", "finance", "cohort-analysis"]
}')
echo "         ID: ${P1_ID}"

# --- Product 2: User Behavior Events (will be published) -----------------
echo "       Creating 'User Behavior Events'..."
P2_ID=$(api_id POST "$BASE" -d '{
  "name": "User Behavior Events",
  "slug": "user-behavior-events",
  "description": "Clickstream and in-app event stream capturing user interactions across web and mobile surfaces. Enriched with session context and device metadata. Powers product analytics and recommendation engines.",
  "classification": "internal",
  "ownerPrincipalId": "'"${OWNER_ID}"'",
  "tags": ["clickstream", "events", "product-analytics", "real-time"]
}')
echo "         ID: ${P2_ID}"

# --- Product 3: Platform Health Metrics (will be published) ---------------
echo "       Creating 'Platform Health Metrics'..."
P3_ID=$(api_id POST "$BASE" -d '{
  "name": "Platform Health Metrics",
  "slug": "platform-health-metrics",
  "description": "Infrastructure and application health metrics aggregated from Prometheus, CloudWatch, and synthetic monitors. Includes latency percentiles, error rates, and availability SLIs per service.",
  "classification": "public",
  "ownerPrincipalId": "'"${OWNER_ID}"'",
  "tags": ["observability", "SRE", "latency", "availability"]
}')
echo "         ID: ${P3_ID}"

# --- Product 4: ML Feature Store (draft only) ----------------------------
echo "       Creating 'ML Feature Store Catalog' (draft)..."
P4_ID=$(api_id POST "$BASE" -d '{
  "name": "ML Feature Store Catalog",
  "slug": "ml-feature-store-catalog",
  "description": "Curated feature definitions and materialised feature tables used by the ML platform team. Currently in design — schema and SLAs under review.",
  "classification": "internal",
  "ownerPrincipalId": "'"${OWNER_ID}"'",
  "tags": ["machine-learning", "features", "data-science"]
}')
echo "         ID: ${P4_ID}"

# ---------------------------------------------------------------------------
# Step 4 — Declare ports
# ---------------------------------------------------------------------------
echo "[4/6] Declaring ports..."

# -- P1 ports (Customer Revenue Analytics) --
api POST "${BASE}/${P1_ID}/ports" -d '{
  "portType": "output",
  "name": "Revenue Data Warehouse",
  "description": "Queryable via Redshift JDBC. Updated daily at 04:00 UTC.",
  "interfaceType": "sql_jdbc",
  "contractSchema": {
    "type": "object",
    "properties": {
      "customer_id":    { "type": "string",  "description": "Unique customer identifier" },
      "plan_tier":      { "type": "string",  "enum": ["free","starter","pro","enterprise"] },
      "region":         { "type": "string",  "description": "ISO 3166-1 alpha-2 country code" },
      "mrr_cents":      { "type": "integer", "description": "Monthly recurring revenue in cents" },
      "cohort_month":   { "type": "string",  "format": "date",  "description": "YYYY-MM signup cohort" },
      "churned":        { "type": "boolean", "description": "True if customer cancelled in period" },
      "snapshot_date":  { "type": "string",  "format": "date",  "description": "Date of the snapshot" }
    },
    "required": ["customer_id", "plan_tier", "mrr_cents", "snapshot_date"]
  },
  "slaDescription": "Freshness: T+1 day. Availability: 99.9%. Query latency p95 < 5 s."
}' > /dev/null
api POST "${BASE}/${P1_ID}/ports" -d '{
  "portType": "output",
  "name": "Revenue REST API",
  "description": "Read-only REST endpoint returning aggregated revenue summaries.",
  "interfaceType": "rest_api",
  "contractSchema": {
    "type": "object",
    "properties": {
      "period":      { "type": "string",  "description": "Reporting period (YYYY-MM)" },
      "total_mrr":   { "type": "integer", "description": "Total MRR in cents" },
      "customer_count": { "type": "integer" }
    }
  },
  "slaDescription": "Availability: 99.95%. Latency p99 < 200 ms."
}' > /dev/null
api POST "${BASE}/${P1_ID}/ports" -d '{
  "portType": "discovery",
  "name": "Revenue Catalog Entry",
  "description": "Indexed metadata for marketplace search and agent discovery."
}' > /dev/null
echo "       P1: 2 output ports + 1 discovery port"

# -- P2 ports (User Behavior Events) --
api POST "${BASE}/${P2_ID}/ports" -d '{
  "portType": "output",
  "name": "Clickstream Kafka Topic",
  "description": "Real-time event stream on Redpanda. Avro-encoded, partitioned by user_id.",
  "interfaceType": "streaming_topic",
  "contractSchema": {
    "type": "object",
    "properties": {
      "event_id":      { "type": "string",  "format": "uuid" },
      "user_id":       { "type": "string",  "format": "uuid" },
      "session_id":    { "type": "string",  "format": "uuid" },
      "event_type":    { "type": "string",  "description": "e.g. page_view, button_click, form_submit" },
      "page_url":      { "type": "string",  "format": "uri" },
      "device_type":   { "type": "string",  "enum": ["desktop","mobile","tablet"] },
      "timestamp":     { "type": "string",  "format": "date-time" },
      "properties":    { "type": "object",  "description": "Event-specific payload" }
    },
    "required": ["event_id", "user_id", "event_type", "timestamp"]
  },
  "slaDescription": "End-to-end latency p99 < 500 ms. Throughput: 50 k events/sec."
}' > /dev/null
api POST "${BASE}/${P2_ID}/ports" -d '{
  "portType": "output",
  "name": "Events GraphQL API",
  "description": "Paginated query API for historical event exploration and session replay.",
  "interfaceType": "graphql",
  "contractSchema": {
    "type": "object",
    "properties": {
      "event_id":   { "type": "string" },
      "user_id":    { "type": "string" },
      "event_type": { "type": "string" },
      "timestamp":  { "type": "string", "format": "date-time" }
    }
  },
  "slaDescription": "Availability: 99.9%. Query depth limited to 30 days."
}' > /dev/null
api POST "${BASE}/${P2_ID}/ports" -d '{
  "portType": "discovery",
  "name": "Behavior Events Catalog Entry",
  "description": "Indexed metadata for marketplace search."
}' > /dev/null
echo "       P2: 2 output ports + 1 discovery port"

# -- P3 ports (Platform Health Metrics) --
api POST "${BASE}/${P3_ID}/ports" -d '{
  "portType": "output",
  "name": "Metrics File Export",
  "description": "Daily Parquet export to S3 containing 1-minute resolution metric aggregations.",
  "interfaceType": "file_object_export",
  "contractSchema": {
    "type": "object",
    "properties": {
      "service_name": { "type": "string" },
      "metric_name":  { "type": "string" },
      "timestamp":    { "type": "string", "format": "date-time" },
      "p50":          { "type": "number" },
      "p95":          { "type": "number" },
      "p99":          { "type": "number" },
      "error_rate":   { "type": "number", "minimum": 0, "maximum": 1 },
      "availability": { "type": "number", "minimum": 0, "maximum": 1 }
    },
    "required": ["service_name", "metric_name", "timestamp"]
  },
  "slaDescription": "Freshness: T+1 day. Retention: 90 days. Format: Parquet on S3."
}' > /dev/null
api POST "${BASE}/${P3_ID}/ports" -d '{
  "portType": "output",
  "name": "Health Metrics Agent Endpoint",
  "description": "Semantic query endpoint for AI agents to ask natural-language questions about service health.",
  "interfaceType": "semantic_query_endpoint",
  "contractSchema": {
    "type": "object",
    "properties": {
      "query":    { "type": "string",  "description": "Natural language health question" },
      "response": { "type": "object",  "description": "Structured answer with citations" }
    }
  },
  "slaDescription": "Availability: 99.99%. Latency p95 < 2 s."
}' > /dev/null
api POST "${BASE}/${P3_ID}/ports" -d '{
  "portType": "discovery",
  "name": "Health Metrics Catalog Entry",
  "description": "Indexed metadata for marketplace search."
}' > /dev/null
echo "       P3: 2 output ports + 1 discovery port"

# P4 (draft) — one output port without contract schema, no discovery port.
# Left intentionally incomplete so it stays in draft.
api POST "${BASE}/${P4_ID}/ports" -d '{
  "portType": "output",
  "name": "Feature Table Access (WIP)",
  "description": "Planned JDBC endpoint — schema under review.",
  "interfaceType": "sql_jdbc"
}' > /dev/null
echo "       P4: 1 output port (no contract schema — draft)"

# ---------------------------------------------------------------------------
# Step 5 — Publish products 1-3
# ---------------------------------------------------------------------------
echo "[5/6] Publishing products..."

# Refresh token before publish calls
TOKEN=$(get_token)

api POST "${BASE}/${P1_ID}/publish" -d '{"changeDescription":"Initial publication — daily revenue aggregates from billing pipeline"}' > /dev/null
echo "       Published: Customer Revenue Analytics (v1.0.0)"

api POST "${BASE}/${P2_ID}/publish" -d '{"changeDescription":"Initial publication — real-time clickstream from web and mobile"}' > /dev/null
echo "       Published: User Behavior Events (v1.0.0)"

api POST "${BASE}/${P3_ID}/publish" -d '{"changeDescription":"Initial publication — infrastructure health metrics from Prometheus and CloudWatch"}' > /dev/null
echo "       Published: Platform Health Metrics (v1.0.0)"

echo "       Skipped:   ML Feature Store Catalog (remains draft)"

# ---------------------------------------------------------------------------
# Step 6 — Verify
# ---------------------------------------------------------------------------
echo "[6/6] Verifying marketplace..."

# Refresh token one more time
TOKEN=$(get_token)

MARKETPLACE=$(api GET "/marketplace/products?limit=20")
TOTAL=$(echo "$MARKETPLACE" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['total'])")
echo ""
echo "$MARKETPLACE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data['items']:
    score = round(p['trustScore'] * 100)
    ports = ', '.join(p['outputPortTypes']) if p['outputPortTypes'] else 'none'
    print(f\"  {p['status']:12s} | {p['name']:35s} | v{p['version']}  | trust {score:3d} | ports: {ports}\")
"

echo ""
echo "============================================"
echo "  Seeding complete! ${TOTAL} products in marketplace."
echo "  1 draft product not shown (ML Feature Store Catalog)."
echo "============================================"
