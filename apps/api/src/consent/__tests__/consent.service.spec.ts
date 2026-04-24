import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { SubmitConnectionReferenceRequest } from '@provenance/types';
import { ConsentService } from '../consent.service.js';
import { ConnectionReferenceEntity } from '../entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from '../entities/connection-reference-outbox.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { AgentIdentityEntity } from '../../agents/entities/agent-identity.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';

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
  let referenceRepoInTxn: { create: jest.Mock; save: jest.Mock };
  let outboxRepoInTxn: { create: jest.Mock; save: jest.Mock };
  let emQueryMock: jest.Mock;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    productRepo = { findOne: jest.fn() };
    agentRepo = { findOne: jest.fn() };
    grantRepo = { findOne: jest.fn() };

    referenceRepoInTxn = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          id: 'ref-1',
          createdAt: new Date('2026-04-24T00:00:00Z'),
          updatedAt: new Date('2026-04-24T00:00:00Z'),
        }),
      ),
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
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(AgentIdentityEntity), useValue: agentRepo },
        { provide: getRepositoryToken(AccessGrantEntity), useValue: grantRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
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
});
