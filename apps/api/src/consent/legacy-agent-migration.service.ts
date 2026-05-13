import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ConnectionReferenceEntity } from './entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from './entities/connection-reference-outbox.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// ---------------------------------------------------------------------------
// F12.25 — Legacy Agent Migration on Enforcement Activation.
//
// One-time migration that auto-provisions a legacy-compatibility connection
// reference for every existing active agent-product access grant pair that
// does not already have an active reference. Without this migration, flipping
// CONNECTION_REFERENCE_ENFORCEMENT_ENABLED to true would deny every existing
// agent on the next request — F12.25 closes that gap.
//
// Operator-invoked via the POST /api/v1/internal/consent/legacy-agent-migration
// endpoint. Not auto-triggered on startup or on the flag flip — operators run
// it deliberately as the second step of a three-step rollout:
//   1. Verify shadow-mode behavior over a soak period.
//   2. Run this migration; confirm legacy refs appear in the DB / UI.
//   3. Flip CONNECTION_REFERENCE_ENFORCEMENT_ENABLED=true on the AQL.
//
// Idempotent by construction: the per-grant check skips grants that already
// have an active reference. Running twice provisions zero rows on the second
// pass.
//
// Per F12.25, each provisioned reference:
//   * useCaseCategory: 'Legacy - Migration Required'
//   * purposeElaboration: verbatim from the requirement
//   * approvedScope: { ports: ['*'] } — full product access; the
//     underlying grant has no port-level narrowing today
//   * causedBy: 'legacy_migration' (V28 extends the CHECK constraint)
//   * expiresAt: now + 30 days (non-renewable as a legacy reference)
//   * state: 'active' immediately (auto-approved at provisioning)
//   * No connection package generated. Legacy refs are continuity-only;
//     proper package generation runs through the standard approval path
//     when the agent submits a real request later.
// ---------------------------------------------------------------------------

const LEGACY_USE_CASE_CATEGORY = 'Legacy - Migration Required';
const LEGACY_PURPOSE_ELABORATION =
  'Auto-provisioned for continuity at Domain 12 enforcement activation. The owning principal should review and replace with a proper use-case declaration.';
const LEGACY_DURATION_DAYS = 30;

@Injectable()
export class LegacyAgentMigrationService {
  private readonly logger = new Logger(LegacyAgentMigrationService.name);

  constructor(
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(ConnectionReferenceEntity)
    private readonly referenceRepo: Repository<ConnectionReferenceEntity>,
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Provisions a legacy reference for every agent-product grant that
   * doesn't already have an active reference. Returns counts so the
   * operator endpoint can report what happened.
   *
   * Filters:
   *   - Non-revoked grants (revokedAt IS NULL)
   *   - Non-expired grants (expiresAt IS NULL OR expiresAt > now)
   *   - Grants whose grantee is an AGENT (agent_identities row exists)
   *   - No active connection reference for the (org, agent, product) triple
   */
  async runMigration(): Promise<{ provisioned: number; skipped: number }> {
    const candidateGrants = await this.grantRepo.find({
      where: { revokedAt: IsNull() },
    });
    const now = new Date();
    const activeGrants = candidateGrants.filter(
      (g) => g.expiresAt === null || g.expiresAt > now,
    );

    // Restrict to agent grants. Loading every agent id up front is cheaper
    // than per-grant lookups when the org has more than a handful of agents.
    const agentIds = new Set(
      (await this.agentRepo.find()).map((a) => a.agentId),
    );

    let provisioned = 0;
    let skipped = 0;

    for (const grant of activeGrants) {
      if (!agentIds.has(grant.granteePrincipalId)) {
        // Not an agent grant — F12.25 only covers agent-product pairs.
        // Human-consumer grants do not need a connection reference because
        // the connection-reference guard only runs on the agent MCP path.
        continue;
      }

      const existingActive = await this.referenceRepo.findOne({
        where: {
          orgId: grant.orgId,
          agentId: grant.granteePrincipalId,
          productId: grant.productId,
          state: 'active',
        },
      });
      if (existingActive) {
        skipped++;
        continue;
      }

      try {
        await this.provisionLegacyReference(grant);
        provisioned++;
      } catch (err) {
        // Per-grant failures should not block the migration of other
        // agents. Log and continue; the operator can re-run to retry.
        this.logger.error(
          `Legacy migration failed for grant ${grant.id} (agent ${grant.granteePrincipalId}, product ${grant.productId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Legacy agent migration complete — provisioned ${provisioned}, skipped ${skipped}`,
    );
    return { provisioned, skipped };
  }

  private async provisionLegacyReference(grant: AccessGrantEntity): Promise<void> {
    const product = await this.productRepo.findOne({
      where: { id: grant.productId, orgId: grant.orgId },
    });
    if (!product) {
      throw new Error(
        `Product ${grant.productId} not found in org ${grant.orgId}; cannot derive owning principal`,
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEGACY_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const saved = await this.dataSource.transaction(async (em) => {
      const refRepo = em.getRepository(ConnectionReferenceEntity);
      const ref = refRepo.create({
        orgId: grant.orgId,
        agentId: grant.granteePrincipalId,
        productId: grant.productId,
        productVersionId: null,
        accessGrantId: grant.id,
        owningPrincipalId: product.ownerPrincipalId,
        state: 'active',
        causedBy: 'legacy_migration',
        requestedAt: now,
        approvedAt: now,
        activatedAt: now,
        suspendedAt: null,
        expiresAt,
        terminatedAt: null,
        approvedByPrincipalId: null,
        governancePolicyVersion: null,
        useCaseCategory: LEGACY_USE_CASE_CATEGORY,
        purposeElaboration: LEGACY_PURPOSE_ELABORATION,
        intendedScope: { ports: ['*'] },
        dataCategoryConstraints: null,
        requestedDurationDays: LEGACY_DURATION_DAYS,
        approvedScope: { ports: ['*'] },
        approvedDataCategoryConstraints: null,
        approvedDurationDays: LEGACY_DURATION_DAYS,
        modifiedByApprover: false,
        denialReason: null,
        deniedByPrincipalId: null,
        connectionPackage: null,
      });
      const persisted = await refRepo.save(ref);

      // Outbox event so the AQL cache picks the reference up via Redpanda
      // even if the cold-load already ran. The consumer is idempotent — a
      // second Active dispatch is a cache.set no-op.
      const outboxRepo = em.getRepository(ConnectionReferenceOutboxEntity);
      await outboxRepo.save(
        outboxRepo.create({
          orgId: persisted.orgId,
          eventType: 'connection_reference.state',
          payload: {
            connectionReferenceId: persisted.id,
            orgId: persisted.orgId,
            agentId: persisted.agentId,
            productId: persisted.productId,
            newState: 'active',
            previousState: null,
            scope: persisted.approvedScope,
            useCaseCategory: persisted.useCaseCategory,
            transitionedAt: now.toISOString(),
            causedBy: 'legacy_migration',
          },
        }),
      );

      // Audit row records the synthetic provisioning. principal_id is
      // null-system marker — the migration is operator-invoked but the
      // platform performs the write. We use the product owner as the
      // principal_id so audit queries scoped to "what did this person's
      // products gain in scope?" surface the event correctly.
      await this.writeAudit(em, {
        orgId: persisted.orgId,
        principalId: product.ownerPrincipalId,
        action: 'connection_reference_legacy_provisioned',
        referenceId: persisted.id,
        agentId: persisted.agentId,
        newValue: {
          state: 'active',
          accessGrantId: grant.id,
          useCaseCategory: LEGACY_USE_CASE_CATEGORY,
          expiresAt: expiresAt.toISOString(),
          causedBy: 'legacy_migration',
        },
      });

      return persisted;
    });

    // Notification fan-out is outside the consent transaction — the
    // notifications.notifications table is a separate concern and a
    // failed enqueue must not roll back the legacy provisioning (the ref
    // is the durable correctness fix; the notification is the courtesy
    // to the owner). Logged on failure.
    try {
      await this.notificationsService.enqueue({
        orgId: saved.orgId,
        category: 'connection_reference_legacy_provisioned',
        recipients: [product.ownerPrincipalId],
        payload: {
          referenceId: saved.id,
          agentId: saved.agentId,
          productId: saved.productId,
          productName: product.name,
          expiresAt: expiresAt.toISOString(),
          durationDays: LEGACY_DURATION_DAYS,
          accessGrantId: grant.id,
        },
        deepLink: `/governance/connection-references/${saved.id}`,
        dedupKey: `connection_reference_legacy_provisioned:${saved.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `Legacy-provisioned notification enqueue failed for reference ${saved.id} (provisioning still committed): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async writeAudit(
    em: EntityManager,
    entry: {
      orgId: string;
      principalId: string;
      action: string;
      referenceId: string;
      agentId: string;
      newValue: Record<string, unknown>;
    },
  ): Promise<void> {
    await em.query(
      `INSERT INTO audit.audit_log
         (org_id, principal_id, principal_type, action, resource_type, resource_id,
          new_value, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8::uuid)`,
      [
        entry.orgId,
        entry.principalId,
        'system',
        entry.action,
        'connection_reference',
        entry.referenceId,
        JSON.stringify(entry.newValue),
        entry.agentId,
      ],
    );
  }
}
