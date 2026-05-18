#!/usr/bin/env bash
# demo-smoke-test.sh
#
# Six-layer smoke test for a demo environment. Target runtime under 60s.
# Exits non-zero on the first failure and identifies the layer + specific check.
#
# Usage:
#   bash demo-smoke-test.sh https://demo.provenancelogic.com
#
# Requires on PATH: curl, jq.
# Honors env:
#   SMOKE_USER_EMAIL        (default admin@acme.example.com)
#   SMOKE_USER_PASSWORD     (default DemoPass123!)
#   SMOKE_AGENT_CLIENT_ID   (default agent-acme-marketing-copilot)
#   SMOKE_AGENT_SECRET      (required — export from seed output)
#   MCP_API_KEY             (required — service-to-service token)

set -euo pipefail

BASE_URL="${1:-https://demo.provenancelogic.com}"
AUTH_URL="${AUTH_URL:-${BASE_URL//demo./auth-demo.}}"

SMOKE_USER_EMAIL="${SMOKE_USER_EMAIL:-admin@acme.example.com}"
SMOKE_USER_PASSWORD="${SMOKE_USER_PASSWORD:-DemoPass123!}"
SMOKE_AGENT_CLIENT_ID="${SMOKE_AGENT_CLIENT_ID:-agent-acme-marketing-copilot}"
SMOKE_AGENT_SECRET="${SMOKE_AGENT_SECRET:-}"
MCP_API_KEY="${MCP_API_KEY:-}"

REALM="${REALM:-provenance}"
MIN_PRODUCTS="${MIN_PRODUCTS:-8}"
STARTED_AT=$(date +%s)

ok()   { echo "  ok: $*"; }
fail() { echo "[smoke FAIL: $1] $2" >&2; exit 1; }
section() { echo; echo "== $* =="; }

require() {
  command -v "$1" >/dev/null || fail "precondition" "missing command: $1"
}
require curl
require jq

# ---------------------------------------------------------------------------
# 1. Infrastructure
# ---------------------------------------------------------------------------
section "infrastructure"

http_code=$(curl -sS -o /tmp/smoke-api-health.json -w "%{http_code}" "${BASE_URL}/api/v1/health") \
  || fail "infrastructure" "GET ${BASE_URL}/api/v1/health failed to connect"
[ "$http_code" = "200" ] || fail "infrastructure" "API health returned $http_code (expected 200)"
ok "API health returned 200 with valid TLS"

oidc_code=$(curl -sS -o /tmp/smoke-oidc.json -w "%{http_code}" \
  "${AUTH_URL}/realms/${REALM}/.well-known/openid-configuration") \
  || fail "infrastructure" "Keycloak OIDC endpoint unreachable"
[ "$oidc_code" = "200" ] || fail "infrastructure" "Keycloak OIDC returned $oidc_code (expected 200)"
ok "Keycloak OIDC configuration returned 200"

unhealthy=$(docker ps --filter health=unhealthy --format '{{.Names}}' 2>/dev/null || true)
[ -z "$unhealthy" ] || fail "infrastructure" "unhealthy containers: $unhealthy"
ok "no containers reporting unhealthy"

# ---------------------------------------------------------------------------
# 2. Auth
# ---------------------------------------------------------------------------
section "auth"

USER_TOKEN=$(curl -sS -X POST \
  -d "grant_type=password" \
  -d "client_id=provenance-web" \
  -d "username=${SMOKE_USER_EMAIL}" \
  -d "password=${SMOKE_USER_PASSWORD}" \
  "${AUTH_URL}/realms/${REALM}/protocol/openid-connect/token" | jq -r '.access_token // empty')
[ -n "$USER_TOKEN" ] || fail "auth" "direct grant for ${SMOKE_USER_EMAIL} returned no access_token"
ok "user ${SMOKE_USER_EMAIL} obtained JWT"

# Decode the JWT payload. JWT segments are base64url-encoded and may need
# padding to a multiple of 4 before standard base64 can parse them.
PAYLOAD_B64=$(echo "$USER_TOKEN" | awk -F. '{print $2}' | tr '_-' '/+')
case $(( ${#PAYLOAD_B64} % 4 )) in
  2) PAYLOAD_B64="${PAYLOAD_B64}==" ;;
  3) PAYLOAD_B64="${PAYLOAD_B64}=" ;;
esac
PAYLOAD_JSON=$(echo "$PAYLOAD_B64" | base64 -d 2>/dev/null) \
  || fail "auth" "could not base64-decode JWT payload"

for claim in provenance_org_id provenance_principal_id provenance_principal_type; do
  echo "$PAYLOAD_JSON" | jq -e --arg c "$claim" 'has($c)' >/dev/null \
    || fail "auth" "JWT missing claim: $claim"
done
ok "JWT contains all expected provenance_* claims"

# There is no /organizations/me endpoint — the JWT already carries the answer.
# Resolve the caller's org id from the provenance_org_id claim and call the
# existing /organizations/:orgId route directly. See B-050 in resolved.md.
ORG_ID=$(echo "$PAYLOAD_JSON" | jq -r '.provenance_org_id')
me_code=$(curl -sS -o /tmp/smoke-org.json -w "%{http_code}" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/organizations/${ORG_ID}")
[ "$me_code" = "200" ] || fail "auth" "authenticated GET /organizations/${ORG_ID} returned $me_code"
ok "authenticated API call succeeded (org resolved from JWT claim)"

# ---------------------------------------------------------------------------
# 3. Control plane
# ---------------------------------------------------------------------------
section "control-plane"

org_slug=$(jq -r '.slug // empty' /tmp/smoke-org.json)
[ -n "$org_slug" ] || fail "control-plane" "GET /organizations/${ORG_ID} returned no slug"
ok "seeded org present: ${org_slug}"

PRODUCTS_JSON=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/products?limit=50")
count=$(echo "$PRODUCTS_JSON" | jq -r '.items | length // 0')
[ "$count" -ge "$MIN_PRODUCTS" ] || fail "control-plane" "product count $count < minimum $MIN_PRODUCTS"
ok "seeded products present: count=${count}"

first_product_id=$(echo "$PRODUCTS_JSON" | jq -r '.items[0].id // empty')
[ -n "$first_product_id" ] || fail "control-plane" "could not identify first product id"
DETAIL=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/products/${first_product_id}")
for field in schema ownership freshness accessStatus; do
  echo "$DETAIL" | jq -e ".enrichment.${field}" >/dev/null \
    || fail "control-plane" "product detail missing enrichment.${field}"
done
ok "product detail returns schema, ownership, freshness, accessStatus"

# ---------------------------------------------------------------------------
# 4. Agent
# ---------------------------------------------------------------------------
section "agent"

[ -n "$SMOKE_AGENT_SECRET" ] || fail "agent" "SMOKE_AGENT_SECRET not set"
AGENT_TOKEN=$(curl -sS -X POST \
  -d "grant_type=client_credentials" \
  -d "client_id=${SMOKE_AGENT_CLIENT_ID}" \
  -d "client_secret=${SMOKE_AGENT_SECRET}" \
  "${AUTH_URL}/realms/${REALM}/protocol/openid-connect/token" | jq -r '.access_token // empty')
[ -n "$AGENT_TOKEN" ] || fail "agent" "agent client_credentials exchange returned no token"
ok "agent ${SMOKE_AGENT_CLIENT_ID} obtained JWT"

# SSE handshake — we accept the first chunk then disconnect.
if ! curl -sS --max-time 5 -H "Accept: text/event-stream" \
    -H "Authorization: Bearer ${AGENT_TOKEN}" \
    "${BASE_URL}/mcp/sse" 2>/dev/null | head -c 1 >/dev/null; then
  fail "agent" "MCP SSE endpoint did not accept agent JWT"
fi
ok "MCP SSE endpoint accepted connection"

MCP_RESULT=$(curl -sS -X POST \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tool":"list_products","input":{}}' \
  "${BASE_URL}/mcp/tools/call")
echo "$MCP_RESULT" | jq -e '.result.products | length > 0' >/dev/null \
  || fail "agent" "list_products returned no products"
ok "list_products MCP tool call succeeded end-to-end"

# ---------------------------------------------------------------------------
# 5. Data plane
# ---------------------------------------------------------------------------
section "data-plane"

[ -n "$MCP_API_KEY" ] || fail "data-plane" "MCP_API_KEY not set (service-to-service token required for data plane checks)"

LINEAGE=$(curl -sS -H "x-mcp-api-key: ${MCP_API_KEY}" \
  "${BASE_URL}/api/v1/lineage/smoke?productSlug=customer-360")
echo "$LINEAGE" | jq -e '.edges | length > 0' >/dev/null \
  || fail "data-plane" "Neo4j returned no edges for customer-360"
ok "Neo4j returned lineage edges for a seeded product"

SEARCH=$(curl -sS -H "x-mcp-api-key: ${MCP_API_KEY}" \
  "${BASE_URL}/api/v1/search/smoke?q=Customer%20360")
echo "$SEARCH" | jq -e '.semantic.hits > 0 and .keyword.hits > 0' >/dev/null \
  || fail "data-plane" "OpenSearch missing hits in one of the two indices"
ok "OpenSearch returned hits from both data_products and provenance-products"

RLS=$(curl -sS -H "x-mcp-api-key: ${MCP_API_KEY}" \
  "${BASE_URL}/api/v1/governance/rls-probe?assumeOrg=beta-industries")
echo "$RLS" | jq -e '.crossOrgRowCount == 0' >/dev/null \
  || fail "data-plane" "row-level security is not blocking cross-org reads"
ok "PostgreSQL row-level security blocks cross-org reads"

# ---------------------------------------------------------------------------
# 6. Observability
# ---------------------------------------------------------------------------
section "observability"

TRUST=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/products/${first_product_id}/trust-score")
echo "$TRUST" | jq -e '.score != null' >/dev/null \
  || fail "observability" "no trust score computed for first product"
ok "trust score computed for at least one seeded product"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
ELAPSED=$(( $(date +%s) - STARTED_AT ))
echo
echo "smoke test passed in ${ELAPSED}s"
