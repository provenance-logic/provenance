import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { LegacyAgentMigrationService } from '../legacy-agent-migration.service.js';
import { ConnectionReferenceEntity } from '../entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from '../entities/connection-reference-outbox.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { AgentIdentityEntity } from '../../agents/entities/agent-identity.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

// F12.25 migration spec. The service is purely a data-flow orchestrator:
// load grants, filter to active agent grants, skip ones with existing
// active refs, provision the rest inside a transaction + write outbox +
// audit + notification. We mock every repository and confirm the
// orchestration without touching real PostgreSQL.

const ORG_ID = 'org-1';
const AGENT_ID = 'agent-1';
const HUMAN_ID = 'human-1';
const PRODUCT_ID = 'product-1';
const OWNER_ID = 'owner-1';
const GRANT_ID = 'grant-1';

function makeGrant(overrides: Partial<AccessGrantEntity> = {}): AccessGrantEntity {
  return {
    id: GRANT_ID,
    orgId: ORG_ID,
    productId: PRODUCT_ID,
    granteePrincipalId: AGENT_ID,
    grantedBy: OWNER_ID,
    grantedAt: new Date(),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    accessScope: null,
    approvalRequestId: null,
    connectionPackage: null,
    expiryWarningSentAt: null,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentIdentityEntity> = {}): AgentIdentityEntity {
  return {
    agentId: AGENT_ID,
    orgId: ORG_ID,
    displayName: 'Test Agent',
    modelName: 'claude-opus-4-7',
    modelProvider: 'anthropic',
    humanOversightContact: HUMAN_ID,
    registeredByPrincipalId: HUMAN_ID,
    currentClassification: 'Autonomous',
    keycloakClientProvisioned: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProduct(overrides: Partial<DataProductEntity> = {}): DataProductEntity {
  return {
    id: PRODUCT_ID,
    orgId: ORG_ID,
    domainId: 'domain-1',
    name: 'Customer Events',
    slug: 'customer-events',
    description: null,
    status: 'published',
    version: '1.0.0',
    classification: 'internal',
    ownerPrincipalId: OWNER_ID,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ports: [],
    ...overrides,
  };
}

describe('LegacyAgentMigrationService', () => {
  let service: LegacyAgentMigrationService;
  let grantRepo: { find: jest.Mock };
  let referenceRepo: { findOne: jest.Mock };
  let agentRepo: { find: jest.Mock };
  let productRepo: { findOne: jest.Mock };
  let notificationsService: { enqueue: jest.Mock };
  let refRepoInTxn: { create: jest.Mock; save: jest.Mock };
  let outboxRepoInTxn: { create: jest.Mock; save: jest.Mock };
  let emQueryMock: jest.Mock;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    grantRepo = { find: jest.fn() };
    referenceRepo = { findOne: jest.fn() };
    agentRepo = { find: jest.fn() };
    productRepo = { findOne: jest.fn() };
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };

    refRepoInTxn = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest
        .fn()
        .mockImplementation((v) => Promise.resolve({ ...v, id: 'ref-new' })),
    };
    outboxRepoInTxn = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };
    emQueryMock = jest.fn().mockResolvedValue(undefined);

    const entityManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === ConnectionReferenceEntity) return refRepoInTxn;
        if (entity === ConnectionReferenceOutboxEntity) return outboxRepoInTxn;
        throw new Error(`Unexpected repository in test: ${String(entity)}`);
      }),
      query: emQueryMock,
    };

    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(entityManager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LegacyAgentMigrationService,
        { provide: getRepositoryToken(AccessGrantEntity), useValue: grantRepo },
        { provide: getRepositoryToken(ConnectionReferenceEntity), useValue: referenceRepo },
        { provide: getRepositoryToken(AgentIdentityEntity), useValue: agentRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = moduleRef.get(LegacyAgentMigrationService);
  });

  describe('runMigration', () => {
    it('provisions a legacy reference for each eligible grant', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());

      const result = await service.runMigration();

      expect(result).toEqual({ provisioned: 1, skipped: 0 });
      expect(refRepoInTxn.save).toHaveBeenCalledTimes(1);
      const persisted = refRepoInTxn.create.mock.calls[0][0];
      expect(persisted).toMatchObject({
        orgId: ORG_ID,
        agentId: AGENT_ID,
        productId: PRODUCT_ID,
        accessGrantId: GRANT_ID,
        owningPrincipalId: OWNER_ID,
        state: 'active',
        causedBy: 'legacy_migration',
        useCaseCategory: 'Legacy - Migration Required',
        approvedScope: { ports: ['*'] },
        approvedDurationDays: 30,
        requestedDurationDays: 30,
        approvedByPrincipalId: null,
      });
      expect(persisted.purposeElaboration).toContain('Auto-provisioned for continuity');
      // 30-day expiry — generous tolerance for the test's wall-clock window.
      const expiresAt = persisted.expiresAt as Date;
      const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expiresAt.getTime() - expectedMs)).toBeLessThan(60_000);
    });

    it('writes an outbox event with newState=active and the legacy_migration cause', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());

      await service.runMigration();

      expect(outboxRepoInTxn.save).toHaveBeenCalledTimes(1);
      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.eventType).toBe('connection_reference.state');
      expect(outboxArg.payload).toMatchObject({
        newState: 'active',
        previousState: null,
        causedBy: 'legacy_migration',
        scope: { ports: ['*'] },
        useCaseCategory: 'Legacy - Migration Required',
      });
    });

    it('writes an audit row tagged action=connection_reference_legacy_provisioned, principal_type=system', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());

      await service.runMigration();

      expect(emQueryMock).toHaveBeenCalledTimes(1);
      const auditArgs = emQueryMock.mock.calls[0][1];
      // [orgId, principalId, principalType, action, resourceType, resourceId,
      //  newValueJson, agentId]
      expect(auditArgs[2]).toBe('system');
      expect(auditArgs[3]).toBe('connection_reference_legacy_provisioned');
      expect(auditArgs[7]).toBe(AGENT_ID);
    });

    it('fans out a legacy-provisioned notification to the product owner', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());

      await service.runMigration();

      expect(notificationsService.enqueue).toHaveBeenCalledTimes(1);
      const arg = notificationsService.enqueue.mock.calls[0][0];
      expect(arg.category).toBe('connection_reference_legacy_provisioned');
      expect(arg.recipients).toEqual([OWNER_ID]);
      expect(arg.payload).toMatchObject({
        agentId: AGENT_ID,
        productId: PRODUCT_ID,
        accessGrantId: GRANT_ID,
      });
    });

    it('skips a grant when an active reference already exists for the triple (idempotent re-run)', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      // Active ref present.
      referenceRepo.findOne.mockResolvedValue({ id: 'ref-existing', state: 'active' });

      const result = await service.runMigration();

      expect(result).toEqual({ provisioned: 0, skipped: 1 });
      expect(refRepoInTxn.save).not.toHaveBeenCalled();
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('skips grants whose grantee is not an agent (humans do not get legacy refs)', async () => {
      grantRepo.find.mockResolvedValue([makeGrant({ granteePrincipalId: HUMAN_ID })]);
      // Only AGENT_ID is in the agent registry, not HUMAN_ID.
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);

      const result = await service.runMigration();

      expect(result).toEqual({ provisioned: 0, skipped: 0 });
      expect(refRepoInTxn.save).not.toHaveBeenCalled();
    });

    it('skips revoked grants by repo filter (revokedAt IS NULL is in the where clause)', async () => {
      // The repo mock is consulted with the where clause — if our service
      // passes the wrong filter the test fails. We assert the call shape
      // and that nothing got provisioned when the repo returns empty.
      grantRepo.find.mockResolvedValue([]);
      agentRepo.find.mockResolvedValue([makeAgent()]);

      const result = await service.runMigration();

      expect(result).toEqual({ provisioned: 0, skipped: 0 });
      const where = grantRepo.find.mock.calls[0][0].where;
      expect(where.revokedAt).toBeDefined();
    });

    it('filters out expired grants in JS (expiresAt in the past)', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      grantRepo.find.mockResolvedValue([makeGrant({ expiresAt: past })]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);

      const result = await service.runMigration();

      expect(result).toEqual({ provisioned: 0, skipped: 0 });
      expect(refRepoInTxn.save).not.toHaveBeenCalled();
    });

    it('continues past a per-grant failure and reports partial completion', async () => {
      const grantA = makeGrant({ id: 'grant-a', productId: 'product-a' });
      const grantB = makeGrant({ id: 'grant-b', productId: 'product-b' });
      grantRepo.find.mockResolvedValue([grantA, grantB]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);

      // First grant: product lookup succeeds. Second grant: product
      // missing — service throws inside its private helper and the catch
      // in runMigration() should log and continue.
      productRepo.findOne
        .mockResolvedValueOnce(makeProduct({ id: 'product-a' }))
        .mockResolvedValueOnce(null);

      const result = await service.runMigration();

      expect(result.provisioned).toBe(1);
      expect(refRepoInTxn.save).toHaveBeenCalledTimes(1);
    });

    it('swallows notification enqueue failures (provisioning is the durable correctness fix)', async () => {
      grantRepo.find.mockResolvedValue([makeGrant()]);
      agentRepo.find.mockResolvedValue([makeAgent()]);
      referenceRepo.findOne.mockResolvedValue(null);
      productRepo.findOne.mockResolvedValue(makeProduct());
      notificationsService.enqueue.mockRejectedValueOnce(new Error('notif boom'));

      const result = await service.runMigration();

      // Reference was still committed; notification failure does not
      // unwind the migration.
      expect(result).toEqual({ provisioned: 1, skipped: 0 });
      expect(refRepoInTxn.save).toHaveBeenCalledTimes(1);
    });
  });
});
