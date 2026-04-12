/**
 * Backfill script: indexes all published data products into the
 * data_products OpenSearch kNN index with embedding vectors.
 *
 * Usage:
 *   npx tsx infrastructure/scripts/backfill-embeddings.ts
 *
 * Requires environment variables:
 *   DATABASE_HOST, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
 *   EMBEDDING_SERVICE_URL  (default: http://localhost:8001)
 *   OPENSEARCH_NODE        (default: http://localhost:9200)
 */

import pg from 'pg';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const { Client: PgClient } = pg;

const EMBEDDING_URL = process.env.EMBEDDING_SERVICE_URL ?? 'http://localhost:8001';
const OPENSEARCH_NODE = process.env.OPENSEARCH_NODE ?? 'http://localhost:9200';
const INDEX_NAME = 'data_products';

interface Product {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  tags: string[];
  status: string;
  domain_id: string;
}

interface Domain {
  id: string;
  name: string;
}

function buildEmbeddingText(name: string, description: string | null, tags: string[]): string {
  const parts = [name];
  if (description) parts.push(description);
  if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`);
  return parts.join('. ');
}

async function fetchEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDING_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Embedding service returned ${res.status}`);
  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const pgClient = new PgClient({
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? 'provenance',
    user: process.env.DATABASE_USER ?? 'provenance',
    password: process.env.DATABASE_PASSWORD ?? 'provenance_dev_password',
  });
  await pgClient.connect();

  const osClient = new OpenSearchClient({ node: OPENSEARCH_NODE });

  // Fetch all published products
  const productRes = await pgClient.query<Product>(
    `SELECT id, org_id, name, description, tags, status, domain_id
     FROM products.data_products
     WHERE status = 'published'
     ORDER BY created_at`,
  );
  const products = productRes.rows;

  // Fetch all domains for name lookup
  const domainRes = await pgClient.query<Domain>(
    `SELECT id, name FROM organizations.domains`,
  );
  const domainMap = new Map(domainRes.rows.map((d) => [d.id, d.name]));

  const total = products.length;
  let succeeded = 0;
  let failed = 0;

  console.log(`Found ${total} published products to index.\n`);

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    try {
      const embeddedText = buildEmbeddingText(product.name, product.description, product.tags);
      const embedding = await fetchEmbedding(embeddedText);

      await osClient.index({
        index: INDEX_NAME,
        id: product.id,
        body: {
          product_id: product.id,
          org_id: product.org_id,
          name: product.name,
          description: product.description ?? '',
          domain: domainMap.get(product.domain_id) ?? product.domain_id,
          tags: product.tags,
          trust_score: null,
          lifecycle_state: product.status,
          embedding,
          embedded_at: new Date().toISOString(),
          embedded_text: embeddedText,
        },
        refresh: true,
      });

      succeeded++;
      console.log(`Indexed ${i + 1} of ${total}: ${product.name}`);
    } catch (err) {
      failed++;
      console.error(`FAILED ${i + 1} of ${total}: ${product.name} — ${(err as Error).message}`);
    }

    // 100ms delay between calls to avoid hammering the embedding service
    if (i < products.length - 1) {
      await sleep(100);
    }
  }

  console.log(`\n--- Backfill Summary ---`);
  console.log(`Total attempted: ${total}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);

  await pgClient.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
