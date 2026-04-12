import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { AgentsService } from '../agents.service.js';
import { AgentIdentityEntity } from '../entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from '../entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import type { RequestContext } from '@provenance/types';

const mockAgentRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((dto: Partial<AgentIdentityEntity>) => dto),
  save: jest.fn((entity: Partial<AgentIdentityEntity>) => ({
    agentId: 'agent-001',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...entity,
  })),
});

const mockClassificationRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((dto: Partial<AgentTrustClassificationEntity>) => dto),
  save: jest.fn((entity: Partial<AgentTrustClassificationEntity>) => ({
    classificationId: 'cls-001',
    effectiveFrom: new Date(),
    createdAt: new Date(),
    ...entity,
  })),
});

const mockPrincipalRepo = () => ({
  findOne: jest.fn(),
});

const mockDataSource = () => ({
  query: jest.fn().mockResolvedValue([]),
});

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    principalId: 'principal-001',
    orgId: 'org-001',
    principalType: 'human_user',
    roles: [],
    keycloakSubject: 'kc-sub-001',
    email: 'user@example.com',
    displayName: 'Test User',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentIdentityEntity> = {}): AgentIdentityEntity {
  return {
    agentId: 'agent-001',
    orgId: 'org-001',
    displayName: 'Test Agent',
    modelName: 'claude-sonnet-4-20250514',
    modelProvider: 'Anthropic',
    humanOversightContact: 'oversight@example.com',
    registeredByPrincipalId: 'principal-001',
    currentClassification: 'Observed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentIdentityEntity;
}

describe('AgentsService', () => {
  let service: AgentsService;
  let agentRepo: ReturnType<typeof mockAgentRepo>;
  let classificationRepo: ReturnType<typeof mockClassificationRepo>;
  let principalRepo: ReturnType<typeof mockPrincipalRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: getRepositoryToken(AgentIdentityEntity), useFactory: mockAgentRepo },
        { provide: getRepositoryToken(AgentTrustClassificationEntity), useFactory: mockClassificationRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: getDataSourceToken(), useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get(AgentsService);
    agentRepo = module.get(getRepositoryToken(AgentIdentityEntity));
    classificationRepo = module.get(getRepositoryToken(AgentTrustClassificationEntity));
    principalRepo = module.get(getRepositoryToken(PrincipalEntity));
  });

  // ---------------------------------------------------------------------------
  // Test 1: Registration always produces Observed classification
  // ---------------------------------------------------------------------------
  it('registration always produces Observed classification', async () => {
    principalRepo.findOne.mockResolvedValue({ principalId: 'principal-002', email: 'oversight@example.com' });
    const ctx = makeCtx();
    const result = await service.registerAgent(
      {
        display_name: 'My Agent',
        model_name: 'claude-sonnet-4-20250514',
        model_provider: 'Anthropic',
        human_oversight_contact: 'oversight@example.com',
        org_id: 'org-001',
      },
      ctx,
    );

    expect(result.current_classification).toBe('Observed');
    expect(classificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'Observed',
        scope: 'global',
        reason: 'Initial registration',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: Upgrade blocked without governance role
  // ---------------------------------------------------------------------------
  it('upgrade blocked without governance role', async () => {
    const agent = makeAgent({ currentClassification: 'Observed' });
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue({
      classification: 'Observed',
      effectiveFrom: new Date(),
    });

    const ctx = makeCtx({ roles: ['consumer'] });

    await expect(
      service.updateClassification(
        'agent-001',
        { classification: 'Supervised', reason: 'Promoting agent after review period' },
        ctx,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ---------------------------------------------------------------------------
  // Test 2b: Upgrade succeeds with governance role (B2 positive gate)
  // ---------------------------------------------------------------------------
  it('upgrade succeeds with governance_member role', async () => {
    const agent = makeAgent({ currentClassification: 'Observed' });
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue({
      classification: 'Observed',
      effectiveFrom: new Date(),
    });

    const ctx = makeCtx({ roles: ['governance_member'], email: 'governance-lead@example.com' });

    const result = await service.updateClassification(
      'agent-001',
      { classification: 'Supervised', reason: 'Agent completed 30-day observation period with zero policy violations' },
      ctx,
    );

    expect(result.current_classification).toBe('Supervised');
    expect(result.agent_id).toBe('agent-001');
    expect(result.classification_reason).toBe(
      'Agent completed 30-day observation period with zero policy violations',
    );
    expect(result.classification_scope).toBe('global');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Downgrade allowed by oversight contact
  // ---------------------------------------------------------------------------
  it('downgrade allowed by oversight contact', async () => {
    const agent = makeAgent({
      currentClassification: 'Supervised',
      humanOversightContact: 'oversight@example.com',
    });
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue({
      classification: 'Supervised',
      effectiveFrom: new Date(),
    });

    const ctx = makeCtx({ roles: ['consumer'], email: 'oversight@example.com' });

    const result = await service.updateClassification(
      'agent-001',
      { classification: 'Observed', reason: 'Downgrading due to anomalous behavior detected' },
      ctx,
    );

    expect(result.current_classification).toBe('Observed');
  });

  // ---------------------------------------------------------------------------
  // Test 4: Downgrade allowed by governance role
  // ---------------------------------------------------------------------------
  it('downgrade allowed by governance role', async () => {
    const agent = makeAgent({ currentClassification: 'Autonomous' });
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue({
      classification: 'Autonomous',
      effectiveFrom: new Date(),
    });

    const ctx = makeCtx({ roles: ['governance_member'], email: 'governance@example.com' });

    const result = await service.updateClassification(
      'agent-001',
      { classification: 'Observed', reason: 'Governance-mandated review of all autonomous agents' },
      ctx,
    );

    expect(result.current_classification).toBe('Observed');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Autonomous assignment blocked for non-governance role
  // ---------------------------------------------------------------------------
  it('Autonomous assignment blocked for non-governance role', async () => {
    const agent = makeAgent({ currentClassification: 'Supervised' });
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue({
      classification: 'Supervised',
      effectiveFrom: new Date(),
    });

    const ctx = makeCtx({ roles: ['org_admin'] });

    await expect(
      service.updateClassification(
        'agent-001',
        { classification: 'Autonomous', reason: 'Want to promote to autonomous operation' },
        ctx,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
