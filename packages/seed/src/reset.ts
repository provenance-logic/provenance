import type { Client } from 'pg';
import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';
import type { ApiClient } from './api-client.js';
import type { KeycloakAdminClient } from './keycloak-client.js';
import { withDb } from './db-client.js';
import { runSeed } from './runner.js';

export async function softReset(config: SeedConfig, logger: Logger): Promise<void> {
  logger.info('soft reset: clearing transactional demo state (audit log, lineage emissions, trust score history)');
  await withDb(config, async (db: Client) => {
    await db.query('BEGIN');
    try {
      await db.query(
        `DELETE FROM audit.audit_log WHERE event_at >= now() - interval '24 hours'`
      );
      await db.query(
        `DELETE FROM observability.trust_score_history WHERE computed_at >= now() - interval '24 hours'`
      );
      await db.query(
        `DELETE FROM observability.observability_snapshots WHERE snapshot_at >= now() - interval '24 hours'`
      );
      await db.query(`DELETE FROM lineage.emission_events WHERE emitted_at >= now() - interval '24 hours'`);
      await db.query(`DELETE FROM access.access_requests WHERE created_at >= now() - interval '24 hours'`);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  });
  logger.info('soft reset: done');
}

export interface HardResetContext {
  config: SeedConfig;
  logger: Logger;
  api: ApiClient;
  keycloak: KeycloakAdminClient;
}

export async function hardReset(ctx: HardResetContext): Promise<void> {
  const { config, logger } = ctx;
  logger.warn('hard reset: dropping all seeded data from platform schemas');
  await withDb(config, async (db: Client) => {
    await db.query('BEGIN');
    try {
      const schemas = [
        'audit',
        'observability',
        'access',
        'lineage',
        'governance',
        'connectors',
        'products',
        'identity',
        'organizations',
      ];
      for (const schema of schemas) {
        const { rows } = await db.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
          [schema]
        );
        for (const { tablename } of rows) {
          await db.query(`TRUNCATE TABLE "${schema}"."${tablename}" RESTART IDENTITY CASCADE`);
        }
      }
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  });
  logger.info('hard reset: platform schemas truncated — re-seeding now');
  await runSeed(ctx);
  logger.info('hard reset: re-seed complete');
}
