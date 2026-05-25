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

set -euo pipefail

BASE_URL="${1:-https://demo.provenancelogic.com}"
AUTH_URL="${AUTH_URL:-${BASE_URL//demo./auth-demo.}}"

SMOKE_USER_EMAIL="${SMOKE_USER_EMAIL:-admin@acme.example.com}"
SMOKE_USER_PASSWORD="${SMOKE_USER_PASSWORD:-DemoPass123!}"
SMOKE_AGENT_CLIENT_ID="${SMOKE_AGENT_CLIENT_ID:-agent-acme-marketing-copilot}"
SMOKE_AGENT_SECRET="${SMOKE_AGENT_SECRET:-}"

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

# The global marketplace is the right surface for "how many products has this
# deployment got across all orgs?" — it pages over OpenSearch `provenance-products`
# (BM25 index), so a non-empty response also proves the keyword index is queryable.
PRODUCTS_JSON=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/marketplace/products?limit=50")
count=$(echo "$PRODUCTS_JSON" | jq -r '.items | length // 0')
[ "$count" -ge "$MIN_PRODUCTS" ] || fail "control-plane" "product count $count < minimum $MIN_PRODUCTS"
ok "seeded products present: count=${count}"

# Pick the first product that belongs to the smoke user's org — anything else
# can't be used by the lineage check downstream (the lineage cypher matches on
# org_id) and would only confuse a layer-3 failure message.
first_product_id=$(echo "$PRODUCTS_JSON" | jq -r --arg o "$ORG_ID" \
  '[.items[] | select(.orgId == $o)][0].id // empty')
[ -n "$first_product_id" ] || fail "control-plane" "marketplace returned no products in caller's org ${ORG_ID}"
DETAIL=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/marketplace/products/${first_product_id}")
for field in columnSchema owner freshness accessStatus; do
  echo "$DETAIL" | jq -e "has(\"${field}\")" >/dev/null \
    || fail "control-plane" "product detail missing field: ${field}"
done
ok "product detail returns columnSchema, owner, freshness, accessStatus"

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

# MCP handshake over SSE (JSON-RPC 2.0 transport).
#
# Protocol flow (MCP spec 2024-11-05):
#   1. GET /mcp/sse  → server streams events; first event is:
#        event: endpoint
#        data: /mcp/messages?sessionId=<id>
#   2. POST /mcp/messages?sessionId=<id>  with Content-Type application/json
#      for each JSON-RPC request. Results arrive on the SSE stream (not the
#      POST response). Each POST 202-accepts the message; the actual tool result
#      comes back as an SSE data event on the open GET connection.
#
# The old `/mcp/tools/call` REST shim does not exist — this was B-076 root
# cause #4.

SSE_TMP=$(mktemp)
# Open the SSE stream in the background; capture all events to the temp file.
curl -sN \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Accept: text/event-stream" \
  "${BASE_URL}/mcp/sse" >"${SSE_TMP}" 2>&1 &
SSE_PID=$!

# Poll for the endpoint event (up to 10 seconds).
MCP_ENDPOINT=""
for _i in $(seq 1 20); do
  sleep 0.5
  MCP_ENDPOINT=$(grep -m1 '^data: /mcp/messages' "${SSE_TMP}" 2>/dev/null | sed 's/^data: //' | tr -d '[:space:]')
  [ -n "${MCP_ENDPOINT}" ] && break
done

if [ -z "${MCP_ENDPOINT}" ]; then
  kill "${SSE_PID}" 2>/dev/null || true
  rm -f "${SSE_TMP}"
  fail "agent" "MCP SSE endpoint did not emit an endpoint event within 10s (auth or startup failure)"
fi
ok "MCP SSE endpoint accepted connection and emitted session endpoint"

MSG_URL="${BASE_URL}${MCP_ENDPOINT}"

# 1. Initialize the MCP session.
curl -sS -X POST "${MSG_URL}" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' \
  >/dev/null

# 2. Send notifications/initialized (required by MCP spec before calling tools).
curl -sS -X POST "${MSG_URL}" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  >/dev/null

# 3. Call list_products and collect the SSE response.
curl -sS -X POST "${MSG_URL}" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_products","arguments":{}}}' \
  >/dev/null

# Poll the SSE stream for the tools/call result (id:2, up to 10 seconds).
MCP_RESULT=""
for _i in $(seq 1 20); do
  sleep 0.5
  # SSE data lines starting with '{"jsonrpc"' and containing '"id":2'
  MCP_RESULT=$(grep '^data: {' "${SSE_TMP}" 2>/dev/null \
    | grep '"id":2' \
    | head -1 \
    | sed 's/^data: //' || true)
  [ -n "${MCP_RESULT}" ] && break
done

kill "${SSE_PID}" 2>/dev/null || true
rm -f "${SSE_TMP}"

if [ -z "${MCP_RESULT}" ]; then
  fail "agent" "list_products MCP call returned no response on the SSE stream within 10s"
fi

# The MCP result payload is JSON-RPC: .result.content[0].text is a JSON string
# containing the actual tool output. Parse it and verify at least one product.
PRODUCT_COUNT=$(echo "${MCP_RESULT}" \
  | jq -r '.result.content[0].text // ""' \
  | jq -r '.products | length // 0' 2>/dev/null || echo "0")
[ "${PRODUCT_COUNT}" -gt 0 ] \
  || fail "agent" "list_products returned 0 products (got: ${MCP_RESULT:0:200})"
ok "list_products MCP tool call succeeded end-to-end (${PRODUCT_COUNT} products)"

# ---------------------------------------------------------------------------
# 5. Data plane
# ---------------------------------------------------------------------------
section "data-plane"

# Lineage: walk the upstream side of the product picked in layer 3. The
# cypher matches on (node_id = product_id, org_id = caller's org), so a
# non-empty edge set proves both that Neo4j is reachable and that the
# product was projected into the graph by the seed.
LINEAGE=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/organizations/${ORG_ID}/lineage/products/${first_product_id}/upstream")
edge_count=$(echo "$LINEAGE" | jq -r '.edges | length // 0')
[ "$edge_count" -gt 0 ] \
  || fail "data-plane" "Neo4j returned no upstream edges for product ${first_product_id}"
ok "Neo4j returned ${edge_count} upstream edges for a seeded product"

# Semantic search hits the kNN index (`data_products`) via the embedding
# service. The marketplace listing above already proves the BM25 index
# (`provenance-products`) is queryable — together they cover both
# OpenSearch indices.
SEARCH=$(curl -sS -X POST \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"customer\",\"org_id\":\"${ORG_ID}\",\"limit\":10}" \
  "${BASE_URL}/api/v1/internal/search/semantic")
echo "$SEARCH" | jq -e '.results | length > 0' >/dev/null \
  || fail "data-plane" "semantic search returned no hits (kNN index empty or embedding service down)"
ok "OpenSearch kNN index returned hits for semantic query"

# Tenant isolation: the global marketplace returns products from across orgs
# (multi-tenant by design), while an org-scoped endpoint must return only the
# caller's own org's rows. If a service ever started returning cross-org data
# from a /organizations/:orgId/... endpoint, this assertion would catch it.
distinct_orgs=$(echo "$PRODUCTS_JSON" | jq -r '[.items[].orgId] | unique | length')
[ "$distinct_orgs" -ge 2 ] \
  || fail "data-plane" "global marketplace returned products from only ${distinct_orgs} org(s); expected ≥ 2 for a multi-tenant demo"
GRANTS=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/organizations/${ORG_ID}/access/grants")
cross_org=$(echo "$GRANTS" | jq -r --arg o "$ORG_ID" \
  '[.items[]? | select(.orgId != $o)] | length // 0')
[ "$cross_org" = "0" ] \
  || fail "data-plane" "org-scoped /access/grants returned ${cross_org} rows from other orgs — tenant filter failed"
ok "tenant isolation holds: marketplace spans ${distinct_orgs} orgs, org-scoped reads return only caller's org"

# Cross-org URL/JWT mismatch (B-061 regression check). The smoke user's JWT
# is scoped to ORG_ID; substituting any *other* org's UUID in an org-scoped
# URL must return 403. Pick a different org from the marketplace listing
# (we already know it spans ≥ 2 orgs from the assertion above).
foreign_org_id=$(echo "$PRODUCTS_JSON" | jq -r --arg o "$ORG_ID" \
  '[.items[].orgId | select(. != $o)] | first // empty')
[ -n "$foreign_org_id" ] \
  || fail "data-plane" "could not identify a foreign org id for cross-org regression check"
for path in "governance/dashboard" "governance/effective-policies"; do
  http_code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${USER_TOKEN}" \
    "${BASE_URL}/api/v1/organizations/${foreign_org_id}/${path}")
  [ "$http_code" = "403" ] \
    || fail "data-plane" "cross-org GET /organizations/${foreign_org_id}/${path} returned ${http_code}; expected 403 (B-061 regression)"
done
ok "cross-org URL/JWT mismatch correctly returns 403 (B-061 regression check)"

# ---------------------------------------------------------------------------
# 6. Observability
# ---------------------------------------------------------------------------
section "observability"

TRUST=$(curl -sS -H "Authorization: Bearer ${USER_TOKEN}" \
  "${BASE_URL}/api/v1/organizations/${ORG_ID}/products/${first_product_id}/trust-score")
echo "$TRUST" | jq -e '.score != null' >/dev/null \
  || fail "observability" "no trust score computed for product ${first_product_id}"
ok "trust score computed for at least one seeded product"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
ELAPSED=$(( $(date +%s) - STARTED_AT ))
echo
echo "smoke test passed in ${ELAPSED}s"
