import type { Client } from 'pg';
import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';
import { withDb } from './db-client.js';
import { seedProducts } from './products/index.js';
import { seedAgents } from './agents/index.js';

interface Check {
  name: string;
  run(db: Client): Promise<void>;
}

export async function verify(config: SeedConfig, logger: Logger): Promise<void> {
  const checks: Check[] = [
    {
      name: 'every output port has connection details',
      async run(db) {
        const expectedOutputPorts = seedProducts.flatMap((p) =>
          p.ports.filter((port) => port.type === 'output').map((port) => ({ product: p.slug, port: port.slug }))
        );
        const { rows } = await db.query<{
          product_slug: string;
          port_slug: string;
          has_connection: boolean;
        }>(
          `SELECT p.slug AS product_slug,
                  pd.slug AS port_slug,
                  pc.connection_details IS NOT NULL AS has_connection
             FROM products.data_products p
             JOIN products.port_declarations pd ON pd.product_id = p.id
             JOIN products.port_contracts pc ON pc.port_id = pd.id
            WHERE pd.port_type = 'output'`
        );
        const missing = rows.filter((r) => !r.has_connection);
        if (missing.length > 0) {
          throw new Error(
            `ports missing connection_details: ${missing.map((r) => `${r.product_slug}/${r.port_slug}`).join(', ')}`
          );
        }
        const byKey = new Set(rows.map((r) => `${r.product_slug}/${r.port_slug}`));
        const notFound = expectedOutputPorts.filter((e) => !byKey.has(`${e.product}/${e.port}`));
        if (notFound.length > 0) {
          throw new Error(
            `expected output ports missing from database: ${notFound.map((e) => `${e.product}/${e.port}`).join(', ')}`
          );
        }
      },
    },
    {
      name: 'every seeded agent has a Keycloak client',
      async run(db) {
        const { rows } = await db.query<{ slug: string; has_client: boolean }>(
          `SELECT a.agent_slug AS slug,
                  a.keycloak_client_id IS NOT NULL AS has_client
             FROM identity.agent_identities a`
        );
        const byKey = new Map(rows.map((r) => [r.slug, r.has_client]));
        for (const agent of seedAgents) {
          const present = byKey.get(agent.agentSlug);
          if (present !== true) {
            throw new Error(`agent ${agent.agentSlug}: no Keycloak client recorded`);
          }
        }
      },
    },
    {
      name: 'every product has a trust score',
      async run(db) {
        const { rows } = await db.query<{ slug: string; score: number | null }>(
          `SELECT p.slug,
                  tsh.score
             FROM products.data_products p
             LEFT JOIN LATERAL (
                   SELECT score FROM observability.trust_score_history h
                    WHERE h.product_id = p.id
                 ORDER BY h.computed_at DESC
                    LIMIT 1
             ) tsh ON true`
        );
        const missing = rows.filter((r) => r.score === null);
        if (missing.length > 0) {
          throw new Error(`products with no trust score: ${missing.map((r) => r.slug).join(', ')}`);
        }
      },
    },
  ];

  let failures = 0;
  for (const check of checks) {
    try {
      await withDb(config, (db) => check.run(db));
      logger.info(`verify ok: ${check.name}`);
    } catch (e) {
      failures += 1;
      logger.error(`verify FAIL: ${check.name}`, { error: (e as Error).message });
    }
  }
  if (failures > 0) {
    throw new Error(`verify: ${failures} check(s) failed`);
  }
  logger.info('verify: all checks passed');
}
