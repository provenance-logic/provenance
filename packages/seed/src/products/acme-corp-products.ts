import type { SeedProduct } from '../types.js';

export const acmeCorpProducts: SeedProduct[] = [
  {
    slug: 'customer-360',
    name: 'Customer 360',
    description:
      'Unified customer profile combining transactional purchases, marketing engagement, and loyalty status.',
    orgSlug: 'acme-corp',
    domainSlug: 'marketing',
    ownerEmail: 'marketing-lead@acme.example.com',
    tags: ['customer', 'pii', 'gold'],
    lifecycleState: 'published',
    freshnessSla: '24h',
    refreshCadence: 'daily at 02:00 UTC',
    ports: [
      {
        slug: 'customer-360-sql',
        type: 'output',
        interfaceType: 'sql_jdbc',
        description: 'Read-only SQL view over the customer 360 dataset.',
        contract: {
          fields: [
            { name: 'customer_id', type: 'uuid', description: 'Stable customer identifier', nullable: false },
            { name: 'email_hash', type: 'text', description: 'SHA-256 hash of email (PII redacted)', pii: true },
            { name: 'lifetime_value_usd', type: 'numeric(14,2)', description: '30-day rolling LTV' },
            { name: 'last_purchase_at', type: 'timestamptz', description: 'Last completed order timestamp', nullable: true },
            { name: 'loyalty_tier', type: 'text', description: 'One of: bronze, silver, gold, platinum' },
          ],
          connectionDetails: {
            interfaceType: 'sql_jdbc',
            endpoint: 'jdbc:postgresql://warehouse.acme.example.com:5432/marketing',
            protocol: 'PostgreSQL 16 read replica',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "psql 'postgresql://warehouse.acme.example.com:5432/marketing?sslmode=require' -c 'SELECT * FROM customer_360 LIMIT 10'",
          },
          howToUse:
            'Request access via the marketplace. On approval, your Keycloak identity is mapped to a read-only Postgres role. Use any JDBC-compatible client.',
        },
      },
      {
        slug: 'customer-360-semantic',
        type: 'output',
        interfaceType: 'semantic_query',
        description: 'Agent-facing semantic query endpoint over customer 360.',
        contract: {
          fields: [
            { name: 'customer_id', type: 'uuid', description: 'Stable customer identifier' },
            { name: 'summary', type: 'text', description: 'LLM-ready natural language customer summary' },
            { name: 'signals', type: 'jsonb', description: 'Typed behavioural signals' },
          ],
          connectionDetails: {
            interfaceType: 'semantic_query',
            endpoint: 'https://dev.provenancelogic.com/mcp/sse',
            protocol: 'MCP over SSE',
            authMethod: 'keycloak_oidc',
            exampleClient: "mcp-cli call get_product 'acme-corp/customer-360'",
          },
        },
      },
    ],
  },
  {
    slug: 'campaign-attribution',
    name: 'Campaign Attribution',
    description: 'Multi-touch attribution model output joining marketing spend to customer conversion events.',
    orgSlug: 'acme-corp',
    domainSlug: 'marketing',
    ownerEmail: 'marketing-lead@acme.example.com',
    tags: ['marketing', 'attribution'],
    lifecycleState: 'published',
    freshnessSla: '12h',
    refreshCadence: 'every 6 hours',
    ports: [
      {
        slug: 'attribution-rest',
        type: 'output',
        interfaceType: 'rest_api',
        description: 'REST API returning attribution weights per campaign-customer pair.',
        contract: {
          fields: [
            { name: 'campaign_id', type: 'uuid', description: 'Campaign identifier' },
            { name: 'customer_id', type: 'uuid', description: 'Customer identifier' },
            { name: 'attribution_weight', type: 'numeric(5,4)', description: 'Weight between 0 and 1' },
            { name: 'touchpoint_sequence', type: 'jsonb', description: 'Ordered list of marketing touchpoints' },
          ],
          connectionDetails: {
            interfaceType: 'rest_api',
            endpoint: 'https://api.acme.example.com/attribution/v1',
            protocol: 'REST over HTTPS',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "curl -H 'Authorization: Bearer $TOKEN' https://api.acme.example.com/attribution/v1/weights?campaign_id=...",
          },
        },
      },
    ],
  },
  {
    slug: 'inventory-daily',
    name: 'Daily Inventory Snapshot',
    description: 'Daily snapshot of inventory levels across all warehouses and distribution centers.',
    orgSlug: 'acme-corp',
    domainSlug: 'supply-chain',
    ownerEmail: 'supply-lead@acme.example.com',
    tags: ['supply-chain', 'inventory'],
    lifecycleState: 'published',
    freshnessSla: '24h',
    refreshCadence: 'daily at 06:00 UTC',
    ports: [
      {
        slug: 'inventory-sql',
        type: 'output',
        interfaceType: 'sql_jdbc',
        description: 'SQL view over the daily inventory snapshot.',
        contract: {
          fields: [
            { name: 'snapshot_date', type: 'date', description: 'Snapshot date (UTC)' },
            { name: 'sku', type: 'text', description: 'Stock keeping unit' },
            { name: 'warehouse_id', type: 'text', description: 'Warehouse code' },
            { name: 'on_hand_units', type: 'integer', description: 'Units physically on hand' },
            { name: 'on_order_units', type: 'integer', description: 'Units committed to inbound POs' },
          ],
          connectionDetails: {
            interfaceType: 'sql_jdbc',
            endpoint: 'jdbc:postgresql://warehouse.acme.example.com:5432/supply_chain',
            protocol: 'PostgreSQL 16 read replica',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "psql 'postgresql://warehouse.acme.example.com:5432/supply_chain?sslmode=require' -c 'SELECT * FROM inventory_daily LIMIT 10'",
          },
        },
      },
    ],
  },
  {
    slug: 'supplier-performance',
    name: 'Supplier Performance',
    description: 'On-time delivery, quality defect rate, and cost variance metrics aggregated per supplier per week.',
    orgSlug: 'acme-corp',
    domainSlug: 'supply-chain',
    ownerEmail: 'supply-lead@acme.example.com',
    tags: ['supply-chain', 'suppliers'],
    lifecycleState: 'published',
    freshnessSla: '7d',
    refreshCadence: 'weekly on Monday 08:00 UTC',
    ports: [
      {
        slug: 'supplier-rest',
        type: 'output',
        interfaceType: 'rest_api',
        description: 'Supplier scorecard REST API.',
        contract: {
          fields: [
            { name: 'supplier_id', type: 'uuid', description: 'Supplier identifier' },
            { name: 'iso_week', type: 'text', description: 'ISO 8601 week code (e.g. 2026-W14)' },
            { name: 'on_time_delivery_rate', type: 'numeric(5,4)', description: 'Fraction of POs delivered on time' },
            { name: 'defect_rate', type: 'numeric(5,4)', description: 'Fraction of received units flagged defective' },
            { name: 'cost_variance_usd', type: 'numeric(14,2)', description: 'Variance vs. contract price' },
          ],
          connectionDetails: {
            interfaceType: 'rest_api',
            endpoint: 'https://api.acme.example.com/supply/v1/supplier-scorecards',
            protocol: 'REST over HTTPS',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "curl -H 'Authorization: Bearer $TOKEN' https://api.acme.example.com/supply/v1/supplier-scorecards?supplier_id=...",
          },
        },
      },
    ],
  },
  {
    slug: 'revenue-daily',
    name: 'Daily Revenue Recognition',
    description: 'Daily revenue recognized per product line, region, and channel with tax breakouts.',
    orgSlug: 'acme-corp',
    domainSlug: 'finance',
    ownerEmail: 'finance-lead@acme.example.com',
    tags: ['finance', 'revenue', 'sox-relevant'],
    lifecycleState: 'published',
    freshnessSla: '24h',
    refreshCadence: 'daily at 04:00 UTC',
    ports: [
      {
        slug: 'revenue-sql',
        type: 'output',
        interfaceType: 'sql_jdbc',
        description: 'SQL view over daily revenue by dimension.',
        contract: {
          fields: [
            { name: 'date', type: 'date', description: 'Revenue recognition date (UTC)' },
            { name: 'product_line', type: 'text', description: 'Product line code' },
            { name: 'region', type: 'text', description: 'Sales region code' },
            { name: 'channel', type: 'text', description: 'Direct, wholesale, or marketplace' },
            { name: 'net_revenue_usd', type: 'numeric(16,2)', description: 'Net revenue after discounts and returns' },
            { name: 'tax_usd', type: 'numeric(16,2)', description: 'Collected tax amount' },
          ],
          connectionDetails: {
            interfaceType: 'sql_jdbc',
            endpoint: 'jdbc:postgresql://warehouse.acme.example.com:5432/finance',
            protocol: 'PostgreSQL 16 read replica',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "psql 'postgresql://warehouse.acme.example.com:5432/finance?sslmode=require' -c 'SELECT * FROM revenue_daily LIMIT 10'",
          },
        },
      },
    ],
  },
  {
    slug: 'forecast-weekly',
    name: 'Weekly Revenue Forecast',
    description: 'Statistical forecast of revenue per product line over the next 13 weeks.',
    orgSlug: 'acme-corp',
    domainSlug: 'finance',
    ownerEmail: 'finance-lead@acme.example.com',
    tags: ['finance', 'forecast'],
    lifecycleState: 'published',
    freshnessSla: '7d',
    refreshCadence: 'weekly on Monday 10:00 UTC',
    ports: [
      {
        slug: 'forecast-graphql',
        type: 'output',
        interfaceType: 'graphql',
        description: 'GraphQL endpoint for weekly revenue forecast.',
        contract: {
          fields: [
            { name: 'forecast_week', type: 'text', description: 'ISO 8601 week code for which the forecast applies' },
            { name: 'product_line', type: 'text', description: 'Product line code' },
            { name: 'p50_usd', type: 'numeric(16,2)', description: 'Median forecast' },
            { name: 'p10_usd', type: 'numeric(16,2)', description: '10th percentile forecast' },
            { name: 'p90_usd', type: 'numeric(16,2)', description: '90th percentile forecast' },
          ],
          connectionDetails: {
            interfaceType: 'graphql',
            endpoint: 'https://api.acme.example.com/graphql',
            protocol: 'GraphQL over HTTPS',
            authMethod: 'keycloak_oidc',
            exampleClient:
              'curl -X POST -H "Authorization: Bearer $TOKEN" -d \'{"query":"{ forecast(productLine:\\"consumer\\"){ forecastWeek p50Usd }}"}\' https://api.acme.example.com/graphql',
          },
        },
      },
    ],
  },
];
