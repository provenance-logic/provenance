-- Replace placeholder `{ id: string }` port contract schemas on the four
-- Acme Corp seed products that shipped with stub contracts. The other
-- three published products (Customer Revenue Analytics, User Behavior
-- Events, Platform Health Metrics) already have real schemas — those
-- ports are left untouched.
--
-- Authoring philosophy: contracts mirror the product description, give
-- a viewer a realistic sense of "what columns will I get if I query
-- this," and use JSON-Schema-compatible types so the existing
-- frontend SchemaTab renders them without code changes.
--
-- Idempotent — safe to re-run; final SELECT verifies state.
--
-- Usage (against dev EC2 stack):
--   docker exec -i provenance-ec2-postgres \
--     psql -U provenance -d provenance \
--     < infrastructure/scripts/seed-real-port-contracts.sql
--
-- Or via the wrapper:
--   bash infrastructure/scripts/run-seed-real-port-contracts.sh

\set ON_ERROR_STOP on

BEGIN;

-- ------------------------------------------------------------------
-- Customer 360 — unified customer profile (sql_jdbc)
-- ------------------------------------------------------------------
UPDATE products.port_declarations
   SET contract_schema = $json$
{
  "type": "object",
  "description": "Per-customer unified profile, one row per customer_id",
  "required": ["customer_id", "created_at", "lifetime_value_cents"],
  "properties": {
    "customer_id":          { "type": "string", "description": "Stable platform customer identifier (UUID)" },
    "email":                { "type": "string", "format": "email", "description": "Primary email on file" },
    "first_name":           { "type": "string" },
    "last_name":            { "type": "string" },
    "created_at":           { "type": "string", "format": "date-time", "description": "Account creation timestamp" },
    "last_active_at":       { "type": "string", "format": "date-time", "description": "Most recent session start" },
    "last_order_at":        { "type": "string", "format": "date-time", "description": "Most recent completed order" },
    "lifetime_value_cents": { "type": "integer", "description": "Total revenue from this customer to date, in cents" },
    "total_orders":         { "type": "integer", "description": "Lifetime completed-order count" },
    "support_ticket_count": { "type": "integer", "description": "Lifetime support tickets opened" },
    "marketing_segment":    { "type": "string", "description": "Marketing segmentation label (e.g. high_value, churn_risk)" },
    "preferred_channel":    { "type": "string", "enum": ["email", "sms", "push", "none"], "description": "Marketing channel preference" }
  }
}
$json$::jsonb,
       updated_at = now()
 WHERE name = 'customer-360-output'
   AND product_id = (SELECT id FROM products.data_products WHERE name = 'Customer 360' LIMIT 1);

-- ------------------------------------------------------------------
-- Customer Acquisition Funnel — campaign/channel funnel metrics
-- ------------------------------------------------------------------
UPDATE products.port_declarations
   SET contract_schema = $json$
{
  "type": "object",
  "description": "Daily funnel metrics, one row per (campaign_id, channel, date)",
  "required": ["campaign_id", "channel", "date", "impressions"],
  "properties": {
    "campaign_id":     { "type": "string", "description": "Campaign identifier" },
    "campaign_name":   { "type": "string", "description": "Human-readable campaign name" },
    "channel":         { "type": "string", "enum": ["organic", "paid_search", "paid_social", "email", "referral", "direct"], "description": "Acquisition channel" },
    "date":            { "type": "string", "format": "date", "description": "Reporting day (UTC)" },
    "impressions":     { "type": "integer" },
    "clicks":          { "type": "integer" },
    "signups":         { "type": "integer", "description": "First-time account creations attributed to this row" },
    "qualified_leads": { "type": "integer", "description": "Signups meeting the qualification rule" },
    "closed_deals":    { "type": "integer" },
    "spend_cents":     { "type": "integer", "description": "Channel spend in cents (0 for organic)" },
    "ctr":             { "type": "number", "description": "Click-through rate (0–1)" },
    "cvr":             { "type": "number", "description": "Conversion rate, signups / clicks" },
    "cpa_cents":       { "type": "integer", "description": "Cost per acquisition in cents" }
  }
}
$json$::jsonb,
       updated_at = now()
 WHERE name = 'customer-acquisition-funnel-output'
   AND product_id = (SELECT id FROM products.data_products WHERE name = 'Customer Acquisition Funnel' LIMIT 1);

-- ------------------------------------------------------------------
-- Daily Revenue Report — daily aggregated revenue
-- ------------------------------------------------------------------
UPDATE products.port_declarations
   SET contract_schema = $json$
{
  "type": "object",
  "description": "One row per (report_date, product_line, region, channel)",
  "required": ["report_date", "product_line", "region", "channel", "gross_revenue_cents"],
  "properties": {
    "report_date":            { "type": "string", "format": "date", "description": "Day the revenue is recognised on (UTC)" },
    "product_line":           { "type": "string", "description": "Product line code (e.g. SMB, ENT, MARKETPLACE)" },
    "region":                 { "type": "string", "description": "ISO 3166-1 alpha-2 region code" },
    "channel":                { "type": "string", "enum": ["direct", "partner", "self_serve", "marketplace"], "description": "Revenue channel" },
    "currency":               { "type": "string", "description": "ISO 4217 currency code; revenue fields are in cents of this currency" },
    "gross_revenue_cents":    { "type": "integer", "description": "Gross revenue before refunds and adjustments" },
    "refund_cents":           { "type": "integer", "description": "Refunds issued on the day" },
    "net_revenue_cents":      { "type": "integer", "description": "Gross minus refunds" },
    "order_count":            { "type": "integer" },
    "unique_customer_count":  { "type": "integer", "description": "Distinct customers who placed an order" },
    "avg_order_value_cents":  { "type": "integer", "description": "net_revenue_cents / order_count, rounded" },
    "is_finalised":           { "type": "boolean", "description": "False until end-of-day reconciliation is complete" }
  }
}
$json$::jsonb,
       updated_at = now()
 WHERE name = 'daily-revenue-report-output'
   AND product_id = (SELECT id FROM products.data_products WHERE name = 'Daily Revenue Report' LIMIT 1);

-- ------------------------------------------------------------------
-- Order Fulfillment SLA — pick/pack/ship + SLA compliance
-- ------------------------------------------------------------------
UPDATE products.port_declarations
   SET contract_schema = $json$
{
  "type": "object",
  "description": "One row per shipped order, including fulfillment timing and SLA outcome",
  "required": ["order_id", "warehouse_id", "carrier", "order_received_at", "sla_target_hours", "sla_met"],
  "properties": {
    "order_id":                  { "type": "string", "description": "Order identifier" },
    "warehouse_id":              { "type": "string", "description": "Originating warehouse code" },
    "carrier":                   { "type": "string", "description": "Outbound carrier (e.g. UPS, FedEx, DHL, USPS)" },
    "carrier_service_level":     { "type": "string", "enum": ["ground", "two_day", "express", "overnight"], "description": "Selected service level" },
    "order_received_at":         { "type": "string", "format": "date-time", "description": "When the order entered the fulfillment queue" },
    "pick_completed_at":         { "type": "string", "format": "date-time" },
    "pack_completed_at":         { "type": "string", "format": "date-time" },
    "shipped_at":                { "type": "string", "format": "date-time", "description": "Carrier label scan timestamp" },
    "delivered_at":              { "type": "string", "format": "date-time", "description": "Final delivery timestamp; null until carrier confirms" },
    "pick_minutes":              { "type": "integer", "description": "order_received_at → pick_completed_at" },
    "pack_minutes":              { "type": "integer", "description": "pick_completed_at → pack_completed_at" },
    "ship_minutes":              { "type": "integer", "description": "pack_completed_at → shipped_at" },
    "total_fulfillment_minutes": { "type": "integer", "description": "order_received_at → shipped_at" },
    "sla_target_hours":          { "type": "integer", "description": "Contractual fulfillment SLA for this service level" },
    "sla_met":                   { "type": "boolean", "description": "True iff total_fulfillment_minutes ≤ sla_target_hours * 60" }
  }
}
$json$::jsonb,
       updated_at = now()
 WHERE name = 'order-fulfillment-sla-output'
   AND product_id = (SELECT id FROM products.data_products WHERE name = 'Order Fulfillment SLA' LIMIT 1);

-- Summary
\echo 'Post-state — property counts for all published Acme output ports:'
SELECT p.name AS product,
       pd.name AS port,
       jsonb_array_length(coalesce(pd.contract_schema->'required', '[]'::jsonb)) AS required_count,
       (SELECT COUNT(*)::int FROM jsonb_object_keys(coalesce(pd.contract_schema->'properties', '{}'::jsonb))) AS prop_count
  FROM products.port_declarations pd
  JOIN products.data_products p ON p.id = pd.product_id
 WHERE p.status = 'published'
   AND pd.port_type = 'output'
 ORDER BY prop_count, p.name;

COMMIT;
