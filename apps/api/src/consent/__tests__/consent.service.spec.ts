import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  SubmitConnectionReferenceRequest,
  ApproveConnectionReferenceOptions,
} from '@provenance/types';
import { ConsentService } from '../consent.service.js';
import { ConnectionReferenceEntity } from '../entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from '../entities/connection-reference-outbox.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { AgentIdentityEntity } from '../../agents/entities/agent-identity.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { ConnectionPackageService } from '../../access/connection-package.service.js';

const ORG_ID = 'org-1';
const AGENT_ID = 'agent-1';
const PRODUCT_ID = 'product-1';
const OWNER_ID = 'owner-1';
const HUMAN_PROXY_ID = 'human-1';
const GRANT_ID = 'grant-1';

function makeDto(overrides: Partial<SubmitConnectionReferenceRequest> = {}): SubmitConnectionReferenceRequest {
  return {
    agentId: AGENT_ID,
    productId: PRODUCT_ID,
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration:
      'Weekly customer engagement analytics for the executive dashboard, aggregated across product lines',
    intendedScope: { ports: ['output-1'] },
    requestedDurationDays: 30,
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
    humanOversightContact: HUMAN_PROXY_ID,
    registeredByPrincipalId: HUMAN_PROXY_ID,
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
    ...overrides,
  };
}

describe('ConsentService', () => {
  let service: ConsentService;
  let productRepo: { findOne: jest.Mock };
  let agentRepo: { findOne: jest.Mock };
  let grantRepo: { findOne: jest.Mock };
  let referenceRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let connectionPackageService: { generateForProduct: jest.Mock };
  let referenceRepoInTxn: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let outboxRepoInTxn: { create: jest.Mock; save: jest.Mock };
  let emQueryMock: jest.Mock;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    productRepo = { findOne: jest.fn() };
    agentRepo = { findOne: jest.fn() };
    grantRepo = { findOne: jest.fn() };
    referenceRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      }),
    };
    connectionPackageService = {
      generateForProduct: jest.fn().mockResolvedValue({
        packageVersion: 1,
        generatedAt: '2026-04-24T00:00:00.000Z',
        ports: [{ portId: 'port-1', portName: 'events', interfaceType: 'rest_api', artifacts: {} }],
      }),
    };

    referenceRepoInTxn = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          id: v.id ?? 'ref-1',
          createdAt: v.createdAt ?? new Date('2026-04-24T00:00:00Z'),
          updatedAt: new Date('2026-04-24T00:00:00Z'),
        }),
      ),
      findOne: jest.fn(),
    };
    outboxRepoInTxn = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };
    emQueryMock = jest.fn().mockResolvedValue(undefined);

    const entityManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === ConnectionReferenceEntity) return referenceRepoInTxn;
        if (entity === ConnectionReferenceOutboxEntity) return outboxRepoInTxn;
        throw new Error(`Unexpected repository for ${String(entity)}`);
      }),
      query: emQueryMock,
    };

    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(entityManager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsentService,
        { provide: getRepositoryToken(ConnectionReferenceEntity), useValue: referenceRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(AgentIdentityEntity), useValue: agentRepo },
        { provide: getRepositoryToken(AccessGrantEntity), useValue: grantRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: ConnectionPackageService, useValue: connectionPackageService },
      ],
    }).compile();

    service = moduleRef.get(ConsentService);
  });

  describe('requestConnectionReference', () => {
    it('creates a pending reference and writes outbox + audit for an Autonomous agent self-submitting', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: 'Autonomous' }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      const result = await service.requestConnectionReference(ORG_ID, AGENT_ID, makeDto());

      expect(result.id).toBe('ref-1');
      expect(result.state).toBe('pending');
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.productId).toBe(PRODUCT_ID);
      expect(result.owningPrincipalId).toBe(OWNER_ID);
      expect(result.accessGrantId).toBe(GRANT_ID);
      expect(result.approvedAt).toBeNull();
      expect(result.activatedAt).toBeNull();

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(referenceRepoInTxn.save).toHaveBeenCalledTimes(1);
      expect(outboxRepoInTxn.save).toHaveBeenCalledTimes(1);
      expect(emQueryMock).toHaveBeenCalledTimes(1);

      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.eventType).toBe('connection_reference.state');
      expect(outboxArg.payload).toMatchObject({
        connectionReferenceId: 'ref-1',
        newState: 'pending',
        previousState: null,
        causedBy: 'principal_action',
      });

      const auditArgs = emQueryMock.mock.calls[0][1];
      expect(auditArgs[3]).toBe('connection_reference_requested');
      expect(auditArgs[4]).toBe('connection_reference');
      expect(auditArgs[5]).toBe('ref-1');
      expect(auditArgs[2]).toBe('ai_agent');
    });

    it('accepts a human proxy submitting on behalf of an Observed agent and records the proxy as the acting principal', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: 'Observed' }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      const result = await service.requestConnectionReference(ORG_ID, HUMAN_PROXY_ID, makeDto());

      expect(result.state).toBe('pending');
      const auditArgs = emQueryMock.mock.calls[0][1];
      expect(auditArgs[1]).toBe(HUMAN_PROXY_ID);
      expect(auditArgs[2]).toBe('human');
      expect(auditArgs[8]).toBe('Observed');
    });

    it('rejects an Observed agent attempting to self-submit (F12.9)', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: 'Observed' }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      await expect(
        service.requestConnectionReference(ORG_ID, AGENT_ID, makeDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('defaults a null classification to Observed and enforces the no-self-submit rule', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: null }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      await expect(
        service.requestConnectionReference(ORG_ID, AGENT_ID, makeDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a Supervised agent to self-submit', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: 'Supervised' }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      const result = await service.requestConnectionReference(ORG_ID, AGENT_ID, makeDto());
      expect(result.state).toBe('pending');
    });

    it('throws NotFoundException when the agent does not exist', async () => {
      agentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.requestConnectionReference(ORG_ID, HUMAN_PROXY_ID, makeDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the product does not exist', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent());
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.requestConnectionReference(ORG_ID, HUMAN_PROXY_ID, makeDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when no active access grant exists (ADR-005 composition)', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent());
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(null);

      await expect(
        service.requestConnectionReference(ORG_ID, HUMAN_PROXY_ID, makeDto()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects purpose elaboration shorter than the 50-character default minimum (F12.6)', async () => {
      await expect(
        service.requestConnectionReference(
          ORG_ID,
          HUMAN_PROXY_ID,
          makeDto({ purposeElaboration: 'too short' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a missing use-case category', async () => {
      await expect(
        service.requestConnectionReference(
          ORG_ID,
          HUMAN_PROXY_ID,
          makeDto({ useCaseCategory: '' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-positive requested duration (F12.4)', async () => {
      await expect(
        service.requestConnectionReference(
          ORG_ID,
          HUMAN_PROXY_ID,
          makeDto({ requestedDurationDays: 0 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.requestConnectionReference(
          ORG_ID,
          HUMAN_PROXY_ID,
          makeDto({ requestedDurationDays: -5 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets expires_at relative to the requested duration', async () => {
      agentRepo.findOne.mockResolvedValue(makeAgent({ currentClassification: 'Autonomous' }));
      productRepo.findOne.mockResolvedValue(makeProduct());
      grantRepo.findOne.mockResolvedValue(makeGrant());

      const before = Date.now();
      const result = await service.requestConnectionReference(
        ORG_ID,
        AGENT_ID,
        makeDto({ requestedDurationDays: 7 }),
      );
      const after = Date.now();

      const expiresAtMs = new Date(result.expiresAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(expiresAtMs).toBeLessThanOrEqual(after + sevenDaysMs);
    });
  });

  // -------------------------------------------------------------------------
  // F12.13 — approval
  // -------------------------------------------------------------------------

  function makePendingReference(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'ref-1',
      orgId: ORG_ID,
      agentId: AGENT_ID,
      productId: PRODUCT_ID,
      productVersionId: null,
      accessGrantId: GRANT_ID,
      owningPrincipalId: OWNER_ID,
      state: 'pending',
      causedBy: 'principal_action',
      requestedAt: new Date('2026-04-24T00:00:00Z'),
      approvedAt: null,
      activatedAt: null,
      suspendedAt: null,
      expiresAt: new Date('2026-05-24T00:00:00Z'),
      terminatedAt: null,
      approvedByPrincipalId: null,
      governancePolicyVersion: null,
      useCaseCategory: 'Reporting and Analytics',
      purposeElaboration: 'a'.repeat(60),
      intendedScope: { ports: ['output-1'] },
      dataCategoryConstraints: null,
      requestedDurationDays: 30,
      approvedScope: null,
      approvedDataCategoryConstraints: null,
      approvedDurationDays: null,
      modifiedByApprover: false,
      denialReason: null,
      deniedByPrincipalId: null,
      connectionPackage: null,
      createdAt: new Date('2026-04-24T00:00:00Z'),
      updatedAt: new Date('2026-04-24T00:00:00Z'),
      ...overrides,
    };
  }

  describe('approveConnectionReference', () => {
    it('transitions pending → active and inherits approved fields from the request when no options are passed', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      const result = await service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID);

      expect(result.state).toBe('active');
      expect(result.approvedByPrincipalId).toBe(OWNER_ID);
      expect(result.approvedAt).not.toBeNull();
      expect(result.activatedAt).not.toBeNull();
      expect(result.approvedScope).toEqual({ ports: ['output-1'] });
      expect(result.approvedDurationDays).toBe(30);
      expect(result.modifiedByApprover).toBe(false);

      expect(outboxRepoInTxn.save).toHaveBeenCalledTimes(1);
      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.payload).toMatchObject({
        newState: 'active',
        previousState: 'pending',
        causedBy: 'principal_action',
      });
      expect(outboxArg.payload.scope).toEqual({ ports: ['output-1'] });

      const auditArgs = emQueryMock.mock.calls[0][1];
      expect(auditArgs[3]).toBe('connection_reference_approved');
      expect(auditArgs[1]).toBe(OWNER_ID);
      expect(auditArgs[2]).toBe('human');
    });

    it('generates and persists a connection package on activation (ADR-008, F12.13)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      const result = await service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID);

      expect(connectionPackageService.generateForProduct).toHaveBeenCalledTimes(1);
      expect(connectionPackageService.generateForProduct).toHaveBeenCalledWith(
        ORG_ID,
        PRODUCT_ID,
      );
      expect(result.connectionPackage).not.toBeNull();
      expect(result.connectionPackage?.ports).toHaveLength(1);
    });

    it('stores a null package if generation returns null (no output ports yet)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());
      connectionPackageService.generateForProduct.mockResolvedValueOnce(null);

      const result = await service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID);
      expect(result.state).toBe('active');
      expect(result.connectionPackage).toBeNull();
    });

    it('marks modifiedByApprover true when the approver narrows scope', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      const options: ApproveConnectionReferenceOptions = {
        approvedScope: { ports: ['output-1'], fields: ['customer_id'] },
        approvedDurationDays: 14,
      };
      const result = await service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID, options);

      expect(result.modifiedByApprover).toBe(true);
      expect(result.approvedScope).toEqual({ ports: ['output-1'], fields: ['customer_id'] });
      expect(result.approvedDurationDays).toBe(14);
    });

    it('rejects approval by a non-owner', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      await expect(
        service.approveConnectionReference(ORG_ID, 'ref-1', HUMAN_PROXY_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects approval of a non-pending reference', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'active' }));

      await expect(
        service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the reference does not exist', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(null);

      await expect(
        service.approveConnectionReference(ORG_ID, 'does-not-exist', OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects approvedDurationDays that exceeds the requested duration (no broadening)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ requestedDurationDays: 30 }));

      await expect(
        service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { approvedDurationDays: 60 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-positive approvedDurationDays', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      await expect(
        service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { approvedDurationDays: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recomputes expires_at from the approved duration', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ requestedDurationDays: 30 }));

      const before = Date.now();
      const result = await service.approveConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
        approvedDurationDays: 7,
      });
      const after = Date.now();

      const expiresMs = new Date(result.expiresAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs);
    });
  });

  // -------------------------------------------------------------------------
  // F12.12 — denial
  // -------------------------------------------------------------------------

  describe('denyConnectionReference', () => {
    it('transitions pending → revoked with denial reason and denying principal', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      const result = await service.denyConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
        reason: 'Scope too broad for this use case; please narrow to aggregate data only.',
      });

      expect(result.state).toBe('revoked');
      expect(result.denialReason).toContain('Scope too broad');
      expect(result.deniedByPrincipalId).toBe(OWNER_ID);
      expect(result.terminatedAt).not.toBeNull();
      expect(result.approvedAt).toBeNull();

      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.payload).toMatchObject({
        newState: 'revoked',
        previousState: 'pending',
        scope: null,
        causedBy: 'principal_action',
      });

      const auditArgs = emQueryMock.mock.calls[0][1];
      expect(auditArgs[3]).toBe('connection_reference_denied');
    });

    it('rejects an empty reason (F12.12 — reason cannot be null)', async () => {
      await expect(
        service.denyConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { reason: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.denyConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { reason: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects denial by a non-owner', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference());

      await expect(
        service.denyConnectionReference(ORG_ID, 'ref-1', HUMAN_PROXY_ID, {
          reason: 'not authorized but attempted',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects denial of a non-pending reference', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'active' }));

      await expect(
        service.denyConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
          reason: 'already active — must revoke instead',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the reference does not exist', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(null);

      await expect(
        service.denyConnectionReference(ORG_ID, 'does-not-exist', OWNER_ID, {
          reason: 'none because missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // F12.19 — principal-initiated revocation
  // -------------------------------------------------------------------------

  describe('revokeConnectionReference', () => {
    it('transitions active → revoked and records reason in audit log (not on row)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'active' }));

      const reason = 'Use case shifted to a different data source; no longer needed.';
      const result = await service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { reason });

      expect(result.state).toBe('revoked');
      expect(result.terminatedAt).not.toBeNull();
      expect(result.causedBy).toBe('principal_action');
      // F12.19: reason lives in the audit log, not on the row — denial fields stay null.
      expect(result.denialReason).toBeNull();
      expect(result.deniedByPrincipalId).toBeNull();

      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.payload).toMatchObject({
        newState: 'revoked',
        previousState: 'active',
        causedBy: 'principal_action',
      });

      const auditArgs = emQueryMock.mock.calls[0][1];
      expect(auditArgs[3]).toBe('connection_reference_revoked');
      const newValue = JSON.parse(auditArgs[6]);
      expect(newValue.reason).toBe(reason);
      expect(newValue.previousState).toBe('active');
    });

    it('allows revoking a suspended reference', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'suspended' }));

      const result = await service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
        reason: 'Suspended condition not resolvable; terminating.',
      });
      expect(result.state).toBe('revoked');
      const outboxArg = outboxRepoInTxn.create.mock.calls[0][0];
      expect(outboxArg.payload.previousState).toBe('suspended');
    });

    it('rejects revoking a pending reference (deny must be used instead)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'pending' }));

      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
          reason: 'mistaken attempt',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects revoking an already-revoked reference (terminal state immutable)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'revoked' }));

      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
          reason: 'already revoked',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects revoking an expired reference (terminal state immutable)', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'expired' }));

      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, {
          reason: 'already expired',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects revocation by a non-owner', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(makePendingReference({ state: 'active' }));

      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', HUMAN_PROXY_ID, {
          reason: 'unauthorized attempt',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an empty reason', async () => {
      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { reason: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.revokeConnectionReference(ORG_ID, 'ref-1', OWNER_ID, { reason: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the reference does not exist', async () => {
      referenceRepoInTxn.findOne.mockResolvedValue(null);

      await expect(
        service.revokeConnectionReference(ORG_ID, 'does-not-exist', OWNER_ID, {
          reason: 'not found',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // F12.21 — automatic cascade on access grant revoke
  // -------------------------------------------------------------------------

  describe('cascadeRevokeForGrant', () => {
    let referenceRepoFind: jest.Mock;

    beforeEach(() => {
      referenceRepoFind = jest.fn();
      (referenceRepoInTxn as unknown as { find: jest.Mock }).find = referenceRepoFind;
    });

    it('revokes all pending/active/suspended refs tied to the grant and writes outbox + audit per ref', async () => {
      const refs = [
        makePendingReference({ id: 'ref-a', state: 'pending', accessGrantId: GRANT_ID }),
        makePendingReference({ id: 'ref-b', state: 'active', accessGrantId: GRANT_ID }),
        makePendingReference({ id: 'ref-c', state: 'suspended', accessGrantId: GRANT_ID }),
      ];
      referenceRepoFind.mockResolvedValue(refs);

      const count = await service.cascadeRevokeForGrant(ORG_ID, GRANT_ID, OWNER_ID);

      expect(count).toBe(3);
      expect(referenceRepoInTxn.save).toHaveBeenCalledTimes(3);
      expect(outboxRepoInTxn.save).toHaveBeenCalledTimes(3);
      expect(emQueryMock).toHaveBeenCalledTimes(3);

      for (const call of outboxRepoInTxn.create.mock.calls) {
        expect(call[0].payload).toMatchObject({
          newState: 'revoked',
          causedBy: 'grant_revocation_cascade',
        });
      }

      for (const call of emQueryMock.mock.calls) {
        const auditArgs = call[1];
        expect(auditArgs[3]).toBe('connection_reference_revoked');
        const newValue = JSON.parse(auditArgs[6]);
        expect(newValue.causedBy).toBe('grant_revocation_cascade');
        expect(newValue.reason).toContain(GRANT_ID);
      }
    });

    it('carries through previousState on the outbox event for each ref', async () => {
      referenceRepoFind.mockResolvedValue([
        makePendingReference({ id: 'ref-a', state: 'pending' }),
        makePendingReference({ id: 'ref-b', state: 'active' }),
      ]);

      await service.cascadeRevokeForGrant(ORG_ID, GRANT_ID, OWNER_ID);

      const previousStates = outboxRepoInTxn.create.mock.calls.map(
        (c) => (c[0] as { payload: { previousState: string } }).payload.previousState,
      );
      expect(previousStates).toEqual(['pending', 'active']);
    });

    it('returns 0 and skips all side effects when no non-terminal refs exist', async () => {
      referenceRepoFind.mockResolvedValue([]);

      const count = await service.cascadeRevokeForGrant(ORG_ID, GRANT_ID, OWNER_ID);

      expect(count).toBe(0);
      expect(referenceRepoInTxn.save).not.toHaveBeenCalled();
      expect(outboxRepoInTxn.save).not.toHaveBeenCalled();
      expect(emQueryMock).not.toHaveBeenCalled();
    });

    it('restricts the find query to non-terminal states (pending, active, suspended)', async () => {
      referenceRepoFind.mockResolvedValue([]);

      await service.cascadeRevokeForGrant(ORG_ID, GRANT_ID, OWNER_ID);

      expect(referenceRepoFind).toHaveBeenCalledTimes(1);
      const whereClause = referenceRepoFind.mock.calls[0][0].where;
      expect(whereClause.orgId).toBe(ORG_ID);
      expect(whereClause.accessGrantId).toBe(GRANT_ID);
      // Terminal states must not be in the filter — they're immutable.
      expect(whereClause.state).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Read-side: get + list
  // -------------------------------------------------------------------------

  describe('getConnectionReference', () => {
    it('returns the reference DTO when found', async () => {
      referenceRepo.findOne.mockResolvedValue(makePendingReference());
      const result = await service.getConnectionReference(ORG_ID, 'ref-1');
      expect(result.id).toBe('ref-1');
      expect(result.state).toBe('pending');
    });

    it('throws NotFoundException when the reference is absent or belongs to another org', async () => {
      referenceRepo.findOne.mockResolvedValue(null);
      await expect(service.getConnectionReference(ORG_ID, 'ref-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listConnectionReferences', () => {
    it('returns a paginated list with meta', async () => {
      const refs = [
        makePendingReference({ id: 'ref-a' }),
        makePendingReference({ id: 'ref-b', state: 'active' }),
      ];
      const getManyAndCount = jest.fn().mockResolvedValue([refs, 2]);
      referenceRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount,
      });

      const result = await service.listConnectionReferences(ORG_ID, { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('ref-a');
      expect(result.meta).toEqual({ total: 2, limit: 20, offset: 0 });
    });

    it('applies each filter as an andWhere clause on the query builder', async () => {
      const getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      const andWhere = jest.fn().mockReturnThis();
      referenceRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount,
      });

      await service.listConnectionReferences(ORG_ID, {
        agentId: AGENT_ID,
        productId: PRODUCT_ID,
        owningPrincipalId: OWNER_ID,
        state: 'active',
        limit: 20,
        offset: 0,
      });

      // One andWhere call per filter.
      expect(andWhere).toHaveBeenCalledTimes(4);
    });
  });
});
