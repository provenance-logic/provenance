# Provenance Platform — E2E Test Script

Manual verification commands for the Provenance API.
Run after `node tests/seed-data.js` has completed successfully.

All commands and field names verified against the live API on 2026-04-11.

## Prerequisites

```bash
# Stack running on EC2
sudo bash start-ec2.sh up -d

# Seed data loaded
node tests/seed-data.js
```

## Setup — Shell Variables

```bash
export API="http://localhost:3001/api/v1"
export ORG_ID="e9213d00-264f-40ff-b1ee-52241bfe033e"

# Get a fresh Keycloak token. The realm is configured with
# registrationEmailAsUsername=true, so the direct-grant `username` field
# must be the email address — the legacy `testuser` handle returns
# `user_not_found`.
export TOKEN=$(curl -sf -X POST \
  http://localhost:8080/realms/provenance/protocol/openid-connect/token \
  -d 'client_id=provenance-web' \
  -d 'grant_type=password' \
  -d 'username=test@provenance.dev' \
  -d 'password=provenance_dev' | jq -r '.access_token')

# Helper: get domain ID by slug
get_domain_id() {
  curl -s "$API/organizations/$ORG_ID/domains" \
    -H "Authorization: Bearer $TOKEN" | \
  jq -r --arg slug "$1" '.items[] | select(.slug == $slug) | .id'
}

# Helper: get product ID by name (searches across all domains)
get_product_id() {
  local name="$1"
  local domain_ids
  domain_ids=( $(curl -s "$API/organizations/$ORG_ID/domains" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.items[].id') )
  for domain_id in "${domain_ids[@]}"; do
    local result
    result=$(curl -s "$API/organizations/$ORG_ID/domains/$domain_id/products" \
      -H "Authorization: Bearer $TOKEN" | \
    jq -r --arg name "$name" '.items[] | select(.name == $name) | .id')
    if [[ -n "$result" ]]; then
      echo "$result"
      return
    fi
  done
}
```

## Setup — Pre-fetched IDs

Run once after setting up shell variables above.

```bash
export FINANCE_DOMAIN_ID=$(get_domain_id "finance")
export MARKETING_DOMAIN_ID=$(get_domain_id "marketing")
export OPS_DOMAIN_ID=$(get_domain_id "operations")

export REVENUE_PRODUCT_ID=$(get_product_id "Daily Revenue Report")
export FUNNEL_PRODUCT_ID=$(get_product_id "Customer Acquisition Funnel")
export FULFILLMENT_PRODUCT_ID=$(get_product_id "Order Fulfillment SLA")
export C360_PRODUCT_ID=$(get_product_id "Customer 360")

echo "Finance domain:  $FINANCE_DOMAIN_ID"
echo "Marketing domain: $MARKETING_DOMAIN_ID"
echo "Ops domain:       $OPS_DOMAIN_ID"
echo "Revenue product:  $REVENUE_PRODUCT_ID"
echo "Funnel product:   $FUNNEL_PRODUCT_ID"
echo "Fulfillment:      $FULFILLMENT_PRODUCT_ID"
echo "Customer 360:     $C360_PRODUCT_ID"
```

---

## TC-01 — Health Check

**Verify:** API is running and database is connected.

```bash
curl -s "$API/health" | jq .
```

**Expected:** `{"status":"ok","info":{"database":{"status":"up"}},...}`

---

## TC-02 — List All Products Across Domains

**Verify:** All seeded products are visible, organized by domain.

Response shape: `{items: [{id, name, slug, status, ...}], meta: {total, limit, offset}}`

```bash
DOMAINS=$(curl -s "$API/organizations/$ORG_ID/domains" \
  -H "Authorization: Bearer $TOKEN")

echo "$DOMAINS" | jq -r '.items[].id' | while read domain_id; do
  DNAME=$(echo "$DOMAINS" | jq -r --arg id "$domain_id" \
    '.items[] | select(.id == $id) | .name')
  echo "=== $DNAME ==="
  curl -s "$API/organizations/$ORG_ID/domains/$domain_id/products" \
    -H "Authorization: Bearer $TOKEN" | \
  jq -r '.items[] | "  \(.name) — \(.status)"'
done
```

**Expected:** 4 seed products, all published:
- [Finance] Daily Revenue Report — published
- [Marketing] Customer Acquisition Funnel — published
- [Marketing] Customer 360 — published
- [Operations] Order Fulfillment SLA — published

---

## TC-03 — Get Single Product Detail

**Verify:** Product detail returns full object with ports.

Response shape: `{id, name, slug, status, version, classification, domainId, orgId, tags, ports: [{portType, name, interfaceType, ...}], ...}`

```bash
curl -s "$API/organizations/$ORG_ID/domains/$FINANCE_DOMAIN_ID/products/$REVENUE_PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ name, slug, status, version, classification, ports: [.ports[] | {portType, name}] }'
```

**Expected:** status=published, version=1.0.0, ports include output and discovery types.

---

## TC-04 — SLO Declarations and Evaluations

**Verify:** SLOs are attached to products and have evaluations.

SLO list shape: `{items: [{id, name, slo_type, metric_name, threshold_operator, threshold_value, threshold_unit, pass_rate_7d, pass_rate_30d, ...}]}`

SLO evaluations shape: raw array `[{id, slo_id, measured_value, passed, evaluated_at, evaluated_by, ...}]`

```bash
# List SLOs
curl -s "$API/organizations/$ORG_ID/products/$REVENUE_PRODUCT_ID/slos?status=active" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { name, slo_type, metric_name, threshold_value }'

# Get evaluations for first SLO (response is a raw array, not {items:[]})
SLO_ID=$(curl -s "$API/organizations/$ORG_ID/products/$REVENUE_PRODUCT_ID/slos?status=active" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')

curl -s "$API/organizations/$ORG_ID/products/$REVENUE_PRODUCT_ID/slos/$SLO_ID/evaluations" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ count: length, sample: [limit(3; .[]) | { measured_value, passed, evaluated_at }] }'
```

**Expected:** 2 SLOs on Daily Revenue Report. Each has 7+ evaluations.

---

## TC-05 — Trust Score

**Verify:** Trust scores are computed for all products.

Response shape: `{product_id, org_id, score, band, components: {...}, computed_at}`
Score is a 0–1 decimal (e.g. 0.895 = 89.5%).

```bash
for pid_name in \
  "$REVENUE_PRODUCT_ID|Daily Revenue Report" \
  "$FUNNEL_PRODUCT_ID|Customer Acquisition Funnel" \
  "$FULFILLMENT_PRODUCT_ID|Order Fulfillment SLA" \
  "$C360_PRODUCT_ID|Customer 360"; do
  PID=$(echo "$pid_name" | cut -d'|' -f1)
  PNAME=$(echo "$pid_name" | cut -d'|' -f2)
  curl -s "$API/organizations/$ORG_ID/products/$PID/trust-score" \
    -H "Authorization: Bearer $TOKEN" | \
  jq -r --arg name "$PNAME" '"\($name): score=\(.score) band=\(.band)"'
done
```

**Expected:** All products have scores between 0.80–0.95, band=good.

---

## TC-06 — Lineage Graph

**Verify:** Lineage edges exist for seeded products.

Response shape: `{productId, depth, nodes: [{id, type, label, metadata}], edges: [{id, source, target, edgeType, confidence}]}`

Note: node fields are `type` and `label` (not `node_type`/`display_name`).

```bash
echo "=== Upstream (sources) ==="
curl -s "$API/organizations/$ORG_ID/lineage/products/$REVENUE_PRODUCT_ID/upstream" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.nodes[] | select(.id != "'$REVENUE_PRODUCT_ID'") | { label, type }'

echo ""
echo "=== Downstream (consumers) ==="
curl -s "$API/organizations/$ORG_ID/lineage/products/$REVENUE_PRODUCT_ID/downstream" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.nodes[] | select(.id != "'$REVENUE_PRODUCT_ID'") | { label, type }'
```

**Expected:**
- Upstream: Orders PostgreSQL DB (Source), Finance Data Warehouse (Source)
- Downstream: Customer 360 (DataProduct), Executive Dashboard (Consumer)

---

## TC-07 — SLO Summary

**Verify:** Per-product SLO health summary is available.

Response shape: `{product_id, org_id, total_slos, active_slos, pass_rate_7d, pass_rate_30d, slos_with_no_data, last_evaluated_at, slo_health}`

```bash
curl -s "$API/organizations/$ORG_ID/products/$REVENUE_PRODUCT_ID/slo-summary" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ total_slos, active_slos, pass_rate_7d, slo_health }'
```

**Expected:** total_slos=2, active_slos=2, slo_health is "yellow" or "green".

---

## TC-08 — Governance Dashboard

**Verify:** Governance command center returns aggregate data.

Response shape: `{summary: {totalPublished, compliant, driftDetected, gracePeriod, nonCompliant}, domainHealth: [...], recentEvents: [...], activeExceptions: [...], activeGracePeriods: [...]}`

```bash
curl -s "$API/organizations/$ORG_ID/governance/dashboard" \
  -H "Authorization: Bearer $TOKEN" | jq '.summary'
```

**Expected:** `totalPublished` >= 4, `compliant` >= 4.

---

## TC-09 — Governance Compliance State

**Verify:** Compliance state is tracked per product.

Response shape: `{items: [{id, productId, state, orgId, policyVersionId, evaluatedAt, violations, ...}], meta: {...}}`

```bash
curl -s "$API/organizations/$ORG_ID/governance/compliance" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { productId, state }'
```

**Expected:** Compliance entries with state "compliant" for seeded products.

---

## TC-10 — Marketplace Product Listing

**Verify:** Published products appear in the marketplace.

Response shape: `{items: [{id, name, slug, status, trustScore, domainName, complianceState, sloHealthIndicator, outputPortTypes, ...}], meta: {...}}`

Note: field is `trustScore` (camelCase, integer 0–100) and `domainName`.

```bash
curl -s "$API/organizations/$ORG_ID/marketplace/products" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { name, status, trustScore, domainName }'
```

**Expected:** All published products visible with trustScore and domainName.

---

## TC-11 — Marketplace Product Detail

**Verify:** Full product detail available via marketplace endpoint.

Response shape: `{id, name, status, trustScore, trustScoreBreakdown: {composite, dimensions: {...}}, complianceState, sloHealthIndicator, activeConsumerCount, ports: [...], ...}`

```bash
curl -s "$API/organizations/$ORG_ID/marketplace/products/$C360_PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ name, status, trustScore, complianceState, sloHealthIndicator, activeConsumerCount }'
```

**Expected:** Product detail with trustScore, complianceState, sloHealthIndicator.

---

## TC-12 — Marketplace Search

**Verify:** Marketplace search endpoint is operational.

Response shape: `{total, page, limit, results: [...]}`

Note: Search depends on OpenSearch. In dev stacks without OpenSearch,
results will be empty. This test verifies the endpoint responds without error.

```bash
curl -s "$API/organizations/$ORG_ID/marketplace/search?q=revenue" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ total, page, limit, result_count: (.results | length) }'
```

**Expected:** Response with `total`, `page`, `limit`, and `results` array.
Results may be empty if OpenSearch is not running.

---

## TC-13 — Trust Score Recompute

**Verify:** Trust score can be recomputed on demand.

Response shape: `{product_id, org_id, score, band, components: {...}, computed_at}`

```bash
curl -s -X POST "$API/organizations/$ORG_ID/products/$FULFILLMENT_PRODUCT_ID/trust-score/recompute" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ score, band, computed_at }'
```

**Expected:** Returns fresh score with current timestamp.

---

## TC-14 — Trust Score History

**Verify:** Trust score history accumulates over recomputes.

Response shape: raw array `[{id, product_id, score, band, components, computed_at}, ...]`

Note: response is a plain JSON array, not `{items: []}`.

```bash
curl -s "$API/organizations/$ORG_ID/products/$REVENUE_PRODUCT_ID/trust-score/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | \
jq '[ limit(3; .[]) | { score, band, computed_at } ]'
```

**Expected:** Multiple history entries with timestamps.

---

## TC-15 — Product Publish Idempotency

**Verify:** Publishing an already-published product returns an appropriate error.

```bash
curl -s -X POST \
  "$API/organizations/$ORG_ID/domains/$FINANCE_DOMAIN_ID/products/$REVENUE_PRODUCT_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version":"2.0.0"}' | jq .
```

**Expected:** 409 error — "Product must be in draft status to publish".
