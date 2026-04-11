# Provenance Platform — E2E Test Script

Manual verification commands for the Provenance API.
Run after `node tests/seed-data.js` has completed successfully.

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

# Get a fresh Keycloak token
export TOKEN=$(curl -sf -X POST \
  http://localhost:8080/realms/provenance/protocol/openid-connect/token \
  -d 'client_id=provenance-web' \
  -d 'grant_type=password' \
  -d 'username=testuser' \
  -d 'password=provenance_dev' | jq -r '.access_token')

# Helper: get domain ID by slug
get_domain_id() {
  curl -s "$API/organizations/$ORG_ID/domains" \
    -H "Authorization: Bearer $TOKEN" | \
  jq -r --arg slug "$1" '.items[] | select(.slug == $slug) | .id'
}

# Helper: get product ID by name (searches across all domains)
# Uses a for loop over an array to avoid subshell/SIGPIPE issues
# with piped while-read.
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

## Setup — Pre-fetched Product IDs

Avoids repeated API lookups during testing. Run once after setting
up shell variables above.

```bash
# Fetch domain IDs
export FINANCE_DOMAIN_ID=$(get_domain_id "finance")
export MARKETING_DOMAIN_ID=$(get_domain_id "marketing")
export OPS_DOMAIN_ID=$(get_domain_id "operations")

# Fetch product IDs
export REVENUE_PRODUCT_ID=$(get_product_id "Daily Revenue Report")
export FUNNEL_PRODUCT_ID=$(get_product_id "Customer Acquisition Funnel")
export FULFILLMENT_PRODUCT_ID=$(get_product_id "Order Fulfillment SLA")
export C360_PRODUCT_ID=$(get_product_id "Customer 360")

# Verify all IDs resolved
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

**Expected:** `{"status":"ok","info":{"database":{"status":"up"}}}`

---

## TC-02 — List All Products Across Domains

**Verify:** All seeded products are visible, organized by domain.

```bash
# Fetch all domains
DOMAINS=$(curl -s "$API/organizations/$ORG_ID/domains" \
  -H "Authorization: Bearer $TOKEN")
echo "$DOMAINS" | jq -r '.items[] | "\(.name) (\(.id))"'

# For each domain, list its products
echo "$DOMAINS" | jq -r '.items[].id' | while read domain_id; do
  DNAME=$(echo "$DOMAINS" | jq -r --arg id "$domain_id" \
    '.items[] | select(.id == $id) | .name')
  echo ""
  echo "=== $DNAME ==="
  curl -s "$API/organizations/$ORG_ID/domains/$domain_id/products" \
    -H "Authorization: Bearer $TOKEN" | \
  jq -r '.items[] | "  \(.name) — \(.status)"'
done
```

**Expected:** 4 seed products across Finance, Marketing, Operations:
- [Finance] Daily Revenue Report — published
- [Marketing] Customer Acquisition Funnel — published
- [Marketing] Customer 360 — published
- [Operations] Order Fulfillment SLA — published

---

## TC-03 — Get Single Product Detail

**Verify:** Product detail endpoint returns full product with ports.

```bash
DOMAIN_ID=$(get_domain_id "finance")
PRODUCT_ID=$(get_product_id "Daily Revenue Report")

curl -s "$API/organizations/$ORG_ID/domains/$DOMAIN_ID/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ name, slug, status, version, classification, ports: [.ports[].portType] }'
```

**Expected:** status=published, version=1.0.0, ports include "output" and "discovery".

---

## TC-04 — SLO Declarations and Evaluations

**Verify:** SLOs are attached to products and have evaluations.

```bash
PRODUCT_ID=$(get_product_id "Daily Revenue Report")

# List SLOs
curl -s "$API/organizations/$ORG_ID/products/$PRODUCT_ID/slos?status=active" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { name, slo_type, threshold_value }'

# Get evaluations for first SLO
SLO_ID=$(curl -s "$API/organizations/$ORG_ID/products/$PRODUCT_ID/slos?status=active" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')

curl -s "$API/organizations/$ORG_ID/products/$PRODUCT_ID/slos/$SLO_ID/evaluations" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items | length, [.[] | { measured_value, passed }]'
```

**Expected:** 2 SLOs on Daily Revenue Report. Each SLO has 7+ evaluations.

---

## TC-05 — Trust Score

**Verify:** Trust scores are computed for all products.

```bash
for name in "Daily Revenue Report" "Customer Acquisition Funnel" \
            "Order Fulfillment SLA" "Customer 360"; do
  PRODUCT_ID=$(get_product_id "$name")
  SCORE=$(curl -s "$API/organizations/$ORG_ID/products/$PRODUCT_ID/trust-score" \
    -H "Authorization: Bearer $TOKEN")
  echo "$name: $(echo $SCORE | jq -r '"score=\(.score) band=\(.band)"')"
done
```

**Expected:** All products have scores between 0.80–0.95, band=good.

---

## TC-06 — Lineage Graph

**Verify:** Lineage edges exist for seeded products.

```bash
PRODUCT_ID=$(get_product_id "Daily Revenue Report")

echo "=== Upstream (sources) ==="
curl -s "$API/organizations/$ORG_ID/lineage/products/$PRODUCT_ID/upstream" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.nodes[] | { display_name, node_type }'

echo ""
echo "=== Downstream (consumers) ==="
curl -s "$API/organizations/$ORG_ID/lineage/products/$PRODUCT_ID/downstream" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.nodes[] | { display_name, node_type }'
```

**Expected:**
- Upstream: Orders PostgreSQL DB (Source), Finance Data Warehouse (Source)
- Downstream: Customer 360 (DataProduct), Executive Dashboard (Consumer)

---

## TC-07 — Access Grants

**Verify:** Access grant system is operational.

```bash
# List grants for the org
curl -s "$API/organizations/$ORG_ID/access/grants" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | length'
```

**Expected:** Returns a list (may be empty if no grants were seeded).

---

## TC-08 — Governance Dashboard

**Verify:** Governance command center returns aggregate data.

```bash
curl -s "$API/organizations/$ORG_ID/governance/dashboard" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected:** Returns governance summary with compliance counts.

---

## TC-09 — Governance Compliance State

**Verify:** Compliance state is tracked per product.

```bash
curl -s "$API/organizations/$ORG_ID/governance/compliance" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { productId, state }'
```

**Expected:** Compliance entries for seeded products.

---

## TC-10 — Marketplace Product Listing

**Verify:** Published products appear in the marketplace.

```bash
curl -s "$API/organizations/$ORG_ID/marketplace/products" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { name, status, trust_score }'
```

**Expected:** All 4 published seed products visible with trust scores.

---

## TC-11 — Marketplace Product Detail

**Verify:** Full product detail available via marketplace endpoint.

```bash
PRODUCT_ID=$(get_product_id "Customer 360")

curl -s "$API/organizations/$ORG_ID/marketplace/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ name, status, trust_score, lineage_summary, slo_summary }'
```

**Expected:** Product detail with trust score, lineage, and SLO summary.

---

## TC-12 — Marketplace Search

**Verify:** Marketplace search returns matching products.

```bash
curl -s "$API/organizations/$ORG_ID/marketplace/search?q=revenue" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { name, score }'
```

**Expected:** Daily Revenue Report appears in results.

---

## TC-13 — Trust Score Recompute

**Verify:** Trust score can be recomputed on demand.

```bash
PRODUCT_ID=$(get_product_id "Order Fulfillment SLA")

curl -s -X POST "$API/organizations/$ORG_ID/products/$PRODUCT_ID/trust-score/recompute" \
  -H "Authorization: Bearer $TOKEN" | \
jq '{ score, band, computed_at }'
```

**Expected:** Returns fresh score with current timestamp.

---

## TC-14 — Trust Score History

**Verify:** Trust score history accumulates over recomputes.

```bash
PRODUCT_ID=$(get_product_id "Daily Revenue Report")

curl -s "$API/organizations/$ORG_ID/products/$PRODUCT_ID/trust-score/history?limit=5" \
  -H "Authorization: Bearer $TOKEN" | \
jq '.items[] | { score, band, computed_at }'
```

**Expected:** Multiple history entries with timestamps.

---

## TC-15 — Product Publish Idempotency

**Verify:** Publishing an already-published product returns an appropriate error.

```bash
DOMAIN_ID=$(get_domain_id "finance")
PRODUCT_ID=$(get_product_id "Daily Revenue Report")

curl -s -X POST "$API/organizations/$ORG_ID/domains/$DOMAIN_ID/products/$PRODUCT_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version":"2.0.0","change_summary":"Re-publish test"}' | jq .
```

**Expected:** 422 error — "Product must be in draft status to publish".
