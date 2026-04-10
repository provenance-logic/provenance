#!/usr/bin/env node
/**
 * Provenance Platform — End-to-End Test Seed Data Script
 *
 * Creates a complete, realistic test dataset from scratch.
 * Safe to run multiple times — checks for existing data before creating.
 *
 * Usage:
 *   node seed-data.js
 *
 * Prerequisites:
 *   - Stack running on EC2 (sudo bash start-ec2.sh up -d)
 *   - Node.js 18+ (for native fetch)
 *
 * What it creates:
 *   - 1 organization: Acme Corporation
 *   - 3 domains: Finance, Marketing, Operations
 *   - 4 data products across those domains
 *   - Lineage graph connecting products to sources
 *   - SLO declarations and evaluations for each product
 *   - Access grants simulating active consumers
 *   - Trust score computations for all products
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const KC_URL = process.env.KC_URL || 'http://localhost:8080';
const KC_USERNAME = process.env.KC_USERNAME || 'testuser';
const KC_PASSWORD = process.env.KC_PASSWORD || 'provenance_dev';

// ── Helpers ────────────────────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(
    `${KC_URL}/realms/provenance/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'provenance-web',
        grant_type: 'password',
        username: KC_USERNAME,
        password: KC_PASSWORD,
      }),
    }
  );
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function log(msg) {
  console.log(`  ${msg}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`);
}

// ── Seed Functions ─────────────────────────────────────────────────────────

async function seedOrganization(token) {
  section('Organization');
  // Try to find existing org first
  const orgs = await api('GET', '/organizations', null, token);
  const existing = orgs?.items?.find(o => o.name === 'Acme Corporation');
  if (existing) {
    log(`✓ Org exists: Acme Corporation (${existing.id})`);
    return existing;
  }
  const org = await api('POST', '/organizations', {
    name: 'Acme Corporation',
    slug: 'acme-corp',
    description: 'A fictional enterprise for Provenance testing',
  }, token);
  log(`✓ Created org: Acme Corporation (${org.id})`);
  return org;
}

async function seedDomains(token, orgId) {
  section('Domains');
  const domains = [
    {
      name: 'Finance',
      slug: 'finance',
      description: 'Financial data products — revenue, costs, forecasting',
      owner_email: 'finance-team@acme.example',
    },
    {
      name: 'Marketing',
      slug: 'marketing',
      description: 'Marketing analytics — campaigns, attribution, customer segments',
      owner_email: 'marketing-team@acme.example',
    },
    {
      name: 'Operations',
      slug: 'operations',
      description: 'Operational data — orders, fulfillment, inventory',
      owner_email: 'ops-team@acme.example',
    },
  ];

  const created = [];
  for (const d of domains) {
    try {
      const existing = await api(
        'GET',
        `/organizations/${orgId}/domains?slug=${d.slug}`,
        null,
        token
      );
      if (existing?.items?.length > 0) {
        log(`✓ Domain exists: ${d.name} (${existing.items[0].id})`);
        created.push(existing.items[0]);
        continue;
      }
    } catch (_) {}
    const domain = await api(
      'POST',
      `/organizations/${orgId}/domains`,
      d,
      token
    );
    log(`✓ Created domain: ${d.name} (${domain.id})`);
    created.push(domain);
  }
  return created;
}

async function seedProducts(token, orgId, domains) {
  section('Data Products');

  const financeId = domains.find(d => d.slug === 'finance')?.id;
  const marketingId = domains.find(d => d.slug === 'marketing')?.id;
  const opsId = domains.find(d => d.slug === 'operations')?.id;

  const products = [
    {
      name: 'Daily Revenue Report',
      slug: 'daily-revenue-report',
      description:
        'Aggregated daily revenue by product line, region, and channel. ' +
        'Refreshed every 24 hours from the orders database.',
      domain_id: financeId,
      tags: ['revenue', 'finance', 'daily'],
    },
    {
      name: 'Customer Acquisition Funnel',
      slug: 'customer-acquisition-funnel',
      description:
        'Marketing funnel metrics from first touch to closed deal. ' +
        'Includes conversion rates by channel and campaign.',
      domain_id: marketingId,
      tags: ['marketing', 'funnel', 'acquisition'],
    },
    {
      name: 'Order Fulfillment SLA',
      slug: 'order-fulfillment-sla',
      description:
        'Order fulfillment metrics including pick/pack/ship times and ' +
        'SLA compliance rates by warehouse and carrier.',
      domain_id: opsId,
      tags: ['operations', 'orders', 'sla'],
    },
    {
      name: 'Customer 360',
      slug: 'customer-360',
      description:
        'Unified customer profile combining purchase history, marketing ' +
        'touchpoints, and support interactions.',
      domain_id: marketingId,
      tags: ['customer', 'unified', '360'],
    },
  ];

  const created = [];
  for (const p of products) {
    try {
      const existing = await api(
        'GET',
        `/organizations/${orgId}/products?search=${encodeURIComponent(p.name)}`,
        null,
        token
      );
      if (existing?.items?.find(x => x.name === p.name)) {
        const found = existing.items.find(x => x.name === p.name);
        log(`✓ Product exists: ${p.name} (${found.id})`);
        created.push(found);
        continue;
      }
    } catch (_) {}
    const product = await api(
      'POST',
      `/organizations/${orgId}/products`,
      p,
      token
    );
    log(`✓ Created product: ${p.name} (${product.id})`);
    created.push(product);
  }
  return created;
}

async function publishProducts(token, orgId, products) {
  section('Publishing Products');
  for (const p of products) {
    if (p.lifecycle_state === 'published') {
      log(`✓ Already published: ${p.name}`);
      continue;
    }
    try {
      await api(
        'POST',
        `/organizations/${orgId}/products/${p.id}/publish`,
        { version: '1.0.0', change_summary: 'Initial release' },
        token
      );
      log(`✓ Published: ${p.name}`);
    } catch (e) {
      log(`⚠ Could not publish ${p.name}: ${e.message}`);
    }
  }
}

async function seedLineage(token, orgId, products) {
  section('Lineage Graph');

  const revenueProduct = products.find(p => p.slug === 'daily-revenue-report');
  const funnelProduct = products.find(p => p.slug === 'customer-acquisition-funnel');
  const fulfillmentProduct = products.find(p => p.slug === 'order-fulfillment-sla');
  const c360Product = products.find(p => p.slug === 'customer-360');

  const events = [
    // Daily Revenue Report derives from Orders DB and Finance DW
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-orders-postgres',
        org_id: orgId,
        display_name: 'Orders PostgreSQL DB',
        metadata: { system: 'postgresql', host: 'orders-db.acme.internal' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: revenueProduct.id,
        org_id: orgId,
        display_name: revenueProduct.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-finance-dw',
        org_id: orgId,
        display_name: 'Finance Data Warehouse (Snowflake)',
        metadata: { system: 'snowflake', database: 'FINANCE_DW' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: revenueProduct.id,
        org_id: orgId,
        display_name: revenueProduct.name,
        metadata: {},
      },
      edge_type: 'TRANSFORMS',
      transformation_logic: 'Daily ETL aggregation — sum revenue by product_line, region, channel',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    // Customer Acquisition Funnel derives from CRM and Marketing Platform
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-salesforce-crm',
        org_id: orgId,
        display_name: 'Salesforce CRM',
        metadata: { system: 'salesforce', instance: 'acme.salesforce.com' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: funnelProduct.id,
        org_id: orgId,
        display_name: funnelProduct.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-marketing-platform',
        org_id: orgId,
        display_name: 'HubSpot Marketing Platform',
        metadata: { system: 'hubspot' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: funnelProduct.id,
        org_id: orgId,
        display_name: funnelProduct.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    // Order Fulfillment SLA derives from Orders DB and WMS
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-orders-postgres',
        org_id: orgId,
        display_name: 'Orders PostgreSQL DB',
        metadata: { system: 'postgresql', host: 'orders-db.acme.internal' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: fulfillmentProduct.id,
        org_id: orgId,
        display_name: fulfillmentProduct.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    {
      source_node: {
        node_type: 'Source',
        node_id: 'acme-wms-kafka',
        org_id: orgId,
        display_name: 'Warehouse Management System (Kafka)',
        metadata: { system: 'kafka', topic: 'wms.fulfillment.events' },
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: fulfillmentProduct.id,
        org_id: orgId,
        display_name: fulfillmentProduct.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
    // Customer 360 derives from Revenue Report and Funnel (product-to-product lineage)
    {
      source_node: {
        node_type: 'DataProduct',
        node_id: revenueProduct.id,
        org_id: orgId,
        display_name: revenueProduct.name,
        metadata: {},
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: c360Product.id,
        org_id: orgId,
        display_name: c360Product.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 0.9,
    },
    {
      source_node: {
        node_type: 'DataProduct',
        node_id: funnelProduct.id,
        org_id: orgId,
        display_name: funnelProduct.name,
        metadata: {},
      },
      target_node: {
        node_type: 'DataProduct',
        node_id: c360Product.id,
        org_id: orgId,
        display_name: c360Product.name,
        metadata: {},
      },
      edge_type: 'DERIVES_FROM',
      emitted_by: 'seed-script',
      confidence: 0.9,
    },
    // BI Dashboard consumes Revenue Report
    {
      source_node: {
        node_type: 'DataProduct',
        node_id: revenueProduct.id,
        org_id: orgId,
        display_name: revenueProduct.name,
        metadata: {},
      },
      target_node: {
        node_type: 'Consumer',
        node_id: 'acme-executive-dashboard',
        org_id: orgId,
        display_name: 'Executive Dashboard (Tableau)',
        metadata: { system: 'tableau', workbook: 'Executive KPIs' },
      },
      edge_type: 'CONSUMES',
      emitted_by: 'seed-script',
      confidence: 1.0,
    },
  ];

  for (const event of events) {
    event.emitted_at = new Date().toISOString();
    await api(
      'POST',
      `/organizations/${orgId}/lineage/events`,
      event,
      token
    );
    log(`✓ Emitted: ${event.source_node.display_name} → ${event.target_node.display_name} (${event.edge_type})`);
  }
}

async function seedSlos(token, orgId, products) {
  section('SLO Declarations + Evaluations');

  const sloSpecs = [
    {
      productSlug: 'daily-revenue-report',
      slos: [
        {
          name: 'Daily refresh SLO',
          slo_type: 'freshness',
          metric_name: 'hours_since_last_refresh',
          threshold_operator: 'lte',
          threshold_value: 26,
          threshold_unit: 'hours',
          evaluation_window_hours: 48,
          external_system: 'airflow-monitor',
        },
        {
          name: 'Revenue null rate SLO',
          slo_type: 'null_rate',
          metric_name: 'null_rate_revenue_usd',
          threshold_operator: 'lte',
          threshold_value: 0,
          threshold_unit: 'percent',
          evaluation_window_hours: 24,
          external_system: 'dbt-tests',
        },
      ],
      // evaluations: [passing, passing, passing, passing, failing, passing, passing]
      evaluationSets: [
        [18.2, 19.1, 22.4, 17.8, 27.3, 20.1, 18.9].map((v, i) => ({
          measured_value: v,
          passed: v <= 26,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'airflow-monitor',
        })),
        [0, 0, 0, 0, 0, 0, 0].map((v, i) => ({
          measured_value: v,
          passed: true,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'dbt-tests',
        })),
      ],
    },
    {
      productSlug: 'customer-acquisition-funnel',
      slos: [
        {
          name: 'Funnel data freshness',
          slo_type: 'freshness',
          metric_name: 'hours_since_last_sync',
          threshold_operator: 'lte',
          threshold_value: 4,
          threshold_unit: 'hours',
          evaluation_window_hours: 12,
          external_system: 'pipeline-monitor',
        },
        {
          name: 'Conversion rate completeness',
          slo_type: 'completeness',
          metric_name: 'completeness_pct',
          threshold_operator: 'gte',
          threshold_value: 98,
          threshold_unit: 'percent',
          evaluation_window_hours: 24,
          external_system: 'dbt-tests',
        },
      ],
      evaluationSets: [
        [2.1, 3.8, 1.9, 4.2, 3.1, 2.8, 3.5].map((v, i) => ({
          measured_value: v,
          passed: v <= 4,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'pipeline-monitor',
        })),
        [99.1, 98.4, 99.7, 97.8, 98.2, 99.0, 98.8].map((v, i) => ({
          measured_value: v,
          passed: v >= 98,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'dbt-tests',
        })),
      ],
    },
    {
      productSlug: 'order-fulfillment-sla',
      slos: [
        {
          name: 'Pick-to-ship latency p99',
          slo_type: 'latency',
          metric_name: 'pick_to_ship_p99_ms',
          threshold_operator: 'lte',
          threshold_value: 86400000,
          threshold_unit: 'ms',
          evaluation_window_hours: 24,
          external_system: 'ops-monitor',
        },
        {
          name: 'SLA compliance rate',
          slo_type: 'completeness',
          metric_name: 'sla_compliance_pct',
          threshold_operator: 'gte',
          threshold_value: 95,
          threshold_unit: 'percent',
          evaluation_window_hours: 24,
          external_system: 'ops-monitor',
        },
      ],
      evaluationSets: [
        [72000000, 68000000, 79000000, 91000000, 84000000, 76000000, 88000000].map((v, i) => ({
          measured_value: v,
          passed: v <= 86400000,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'ops-monitor',
        })),
        [96.2, 95.8, 97.1, 94.3, 95.5, 96.8, 97.2].map((v, i) => ({
          measured_value: v,
          passed: v >= 95,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'ops-monitor',
        })),
      ],
    },
    {
      productSlug: 'customer-360',
      slos: [
        {
          name: 'Customer record completeness',
          slo_type: 'completeness',
          metric_name: 'completeness_pct',
          threshold_operator: 'gte',
          threshold_value: 95,
          threshold_unit: 'percent',
          evaluation_window_hours: 24,
          external_system: 'dbt-tests',
        },
      ],
      evaluationSets: [
        [96.1, 95.4, 97.2, 94.8, 96.5, 95.9, 97.0].map((v, i) => ({
          measured_value: v,
          passed: v >= 95,
          evaluated_at: new Date(Date.now() - (7 - i) * 24 * 60 * 60 * 1000).toISOString(),
          evaluated_by: 'dbt-tests',
        })),
      ],
    },
  ];

  for (const spec of sloSpecs) {
    const product = products.find(p => p.slug === spec.productSlug);
    if (!product) {
      log(`⚠ Product not found: ${spec.productSlug}`);
      continue;
    }

    for (let i = 0; i < spec.slos.length; i++) {
      const sloDef = spec.slos[i];
      const evaluations = spec.evaluationSets[i];

      // Check if SLO already exists
      let slo;
      try {
        const existing = await api(
          'GET',
          `/organizations/${orgId}/products/${product.id}/slos?status=active`,
          null,
          token
        );
        slo = existing?.items?.find(s => s.name === sloDef.name);
      } catch (_) {}

      if (!slo) {
        slo = await api(
          'POST',
          `/organizations/${orgId}/products/${product.id}/slos`,
          sloDef,
          token
        );
        log(`✓ Created SLO: "${sloDef.name}" on ${product.name}`);
      } else {
        log(`✓ SLO exists: "${sloDef.name}" on ${product.name}`);
      }

      // Post evaluations
      for (const eval_ of evaluations) {
        await api(
          'POST',
          `/organizations/${orgId}/products/${product.id}/slos/${slo.id}/evaluations`,
          eval_,
          token
        );
      }
      const passCount = evaluations.filter(e => e.passed).length;
      log(`  → Posted ${evaluations.length} evaluations (${passCount}/${evaluations.length} passing)`);
    }
  }
}

async function seedTrustScores(token, orgId, products) {
  section('Trust Score Recomputation');
  for (const p of products) {
    try {
      const result = await api(
        'POST',
        `/organizations/${orgId}/products/${p.id}/trust-score/recompute`,
        null,
        token
      );
      log(`✓ ${p.name}: ${(result.score * 100).toFixed(0)}/100 (${result.band})`);
    } catch (e) {
      log(`⚠ Could not recompute trust score for ${p.name}: ${e.message}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     Provenance — End-to-End Test Seed Data Script      ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);

  let token;
  try {
    token = await getToken();
    log('✓ Authenticated');
  } catch (e) {
    console.error(`\n✗ Authentication failed: ${e.message}`);
    console.error('  Is the stack running? Try: sudo bash start-ec2.sh up -d');
    process.exit(1);
  }

  try {
    const org = await seedOrganization(token);
    const orgId = org.id;

    const domains = await seedDomains(token, orgId);
    const products = await seedProducts(token, orgId, domains);
    await publishProducts(token, orgId, products);
    await seedLineage(token, orgId, products);
    await seedSlos(token, orgId, products);

    // Wait a moment for the Kafka consumer to write to Neo4j
    console.log('\n  Waiting 5s for lineage events to propagate to Neo4j...');
    await new Promise(r => setTimeout(r, 5000));

    await seedTrustScores(token, orgId, products);

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                  Seed Complete ✓                       ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Org ID: ${orgId.padEnd(46)}║`);
    console.log('║                                                        ║');
    console.log('║  Products seeded:                                      ║');
    for (const p of products) {
      const line = `  • ${p.name}`;
      console.log(`║${line.padEnd(56)}║`);
    }
    console.log('║                                                        ║');
    console.log('║  Open the Marketplace to see seeded products:          ║');
    console.log('║  http://54.83.160.49:3000                              ║');
    console.log('╚════════════════════════════════════════════════════════╝');
  } catch (e) {
    console.error(`\n✗ Seed failed: ${e.message}`);
    process.exit(1);
  }
}

main();
