import type { Client } from 'pg';
import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';
import { withDb } from './db-client.js';
import { softReset } from './reset.js';

// Fixed sentinel UUIDs so partial runs can be cleaned up across invocations
// without polluting real seed data (real rows use gen_random_uuid()).
const SENTINEL = {
  auditRecent:    '00000000-0000-0000-aaaa-000000000001',
  auditOld:       '00000000-0000-0000-aaaa-000000000002',
  trustRecent:    '00000000-0000-0000-bbbb-000000000001',
  trustOld:       '00000000-0000-0000-bbbb-000000000002',
  emissionRecent: '00000000-0000-0000-cccc-000000000001',
  emissionOld:    '00000000-0000-0000-cccc-000000000002',
  accessRecent:   '00000000-0000-0000-dddd-000000000001',
  accessOld:      '00000000-0000-0000-dddd-000000000002',
} as const;

const ALL_IDS = Object.values(SENTINEL);
const RECENT_IDS = [SENTINEL.auditRecent, SENTINEL.trustRecent, SENTINEL.emissionRecent, SENTINEL.accessRecent];
const OLD_IDS = [SENTINEL.auditOld, SENTINEL.trustOld, SENTINEL.emissionOld, SENTINEL.accessOld];

interface SeedRefs {
  orgId: string;
  productId: string;
  principalId: string;
}

async function deleteSentinels(db: Client): Promise<void> {
  await db.query(`DELETE FROM audit.audit_log WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
  await db.query(`DELETE FROM observability.trust_score_history WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
  await db.query(`DELETE FROM lineage.emission_log WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
  await db.query(`DELETE FROM access.access_requests WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
}

async function pickRefs(db: Client): Promise<SeedRefs> {
  const { rows } = await db.query<{ org_id: string; product_id: string; principal_id: string }>(
    `SELECT o.id AS org_id, p.id AS product_id, pr.id AS principal_id
       FROM organizations.orgs o
       JOIN products.data_products p ON p.org_id = o.id
       JOIN identity.principals pr ON pr.org_id = o.id
      LIMIT 1`
  );
  if (rows.length === 0) {
    throw new Error('verify-soft-reset: no seeded org+product+principal found. Run `seed` first.');
  }
  return { orgId: rows[0].org_id, productId: rows[0].product_id, principalId: rows[0].principal_id };
}

async function insertSentinels(db: Client, refs: SeedRefs): Promise<void> {
  const { orgId, productId, principalId } = refs;

  await db.query(
    `INSERT INTO audit.audit_log (id, org_id, action, resource_type, occurred_at)
     VALUES ($1, $2, 'verify_soft_reset.sentinel', 'verify_soft_reset', now()),
            ($3, $2, 'verify_soft_reset.sentinel', 'verify_soft_reset', now() - interval '48 hours')`,
    [SENTINEL.auditRecent, orgId, SENTINEL.auditOld]
  );

  await db.query(
    `INSERT INTO observability.trust_score_history (id, org_id, product_id, score, band, components, computed_at)
     VALUES ($1, $2, $3, 0.99, 'high', '{"smoke":"verify-soft-reset"}'::jsonb, now()),
            ($4, $2, $3, 0.99, 'high', '{"smoke":"verify-soft-reset"}'::jsonb, now() - interval '48 hours')`,
    [SENTINEL.trustRecent, orgId, productId, SENTINEL.trustOld]
  );

  await db.query(
    `INSERT INTO lineage.emission_log (id, org_id, source_node, target_node, emitted_at)
     VALUES ($1, $2, '{"id":"verify-soft-reset"}'::jsonb, '{"id":"verify-soft-reset"}'::jsonb, now()),
            ($3, $2, '{"id":"verify-soft-reset"}'::jsonb, '{"id":"verify-soft-reset"}'::jsonb, now() - interval '48 hours')`,
    [SENTINEL.emissionRecent, orgId, SENTINEL.emissionOld]
  );

  await db.query(
    `INSERT INTO access.access_requests (id, org_id, product_id, requester_principal_id, status, requested_at)
     VALUES ($1, $2, $3, $4, 'pending', now()),
            ($5, $2, $3, $4, 'pending', now() - interval '48 hours')`,
    [SENTINEL.accessRecent, orgId, productId, principalId, SENTINEL.accessOld]
  );
}

async function presentIds(db: Client): Promise<Set<string>> {
  const present = new Set<string>();
  const check = async (table: string, ids: string[]): Promise<void> => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    for (const r of rows) present.add(r.id);
  };
  await check('audit.audit_log', [SENTINEL.auditRecent, SENTINEL.auditOld]);
  await check('observability.trust_score_history', [SENTINEL.trustRecent, SENTINEL.trustOld]);
  await check('lineage.emission_log', [SENTINEL.emissionRecent, SENTINEL.emissionOld]);
  await check('access.access_requests', [SENTINEL.accessRecent, SENTINEL.accessOld]);
  return present;
}

export async function verifySoftReset(config: SeedConfig, logger: Logger): Promise<void> {
  logger.warn(
    'verify-soft-reset: destructive on real transactional state in the 24h window — run only against a seeded demo/CI db'
  );
  try {
    await withDb(config, deleteSentinels);
    const refs = await withDb(config, pickRefs);
    await withDb(config, (db) => insertSentinels(db, refs));

    const before = await withDb(config, presentIds);
    const missingBefore = ALL_IDS.filter((id) => !before.has(id));
    if (missingBefore.length > 0) {
      throw new Error(`sentinels not inserted: ${missingBefore.join(', ')}`);
    }
    logger.info('verify-soft-reset: 8 sentinels inserted (4 recent, 4 older-than-24h)');

    await softReset(config, logger);

    const after = await withDb(config, presentIds);
    const failures: string[] = [];
    for (const id of RECENT_IDS) {
      if (after.has(id)) failures.push(`recent sentinel ${id} should have been deleted by softReset`);
    }
    for (const id of OLD_IDS) {
      if (!after.has(id)) failures.push(`old sentinel ${id} should have survived softReset`);
    }
    if (failures.length > 0) {
      throw new Error(`verify-soft-reset FAIL:\n  - ${failures.join('\n  - ')}`);
    }
    logger.info('verify-soft-reset: PASS — softReset deleted 4 recent rows and preserved 4 older rows');
  } finally {
    await withDb(config, deleteSentinels);
  }
}
