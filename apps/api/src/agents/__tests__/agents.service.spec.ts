import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { AgentsService } from '../agents.service.js';
import { AgentIdentityEntity } from '../entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from '../entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../../organizations/entities/role-assignment.entity.js';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
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
  transaction: jest.fn(async (cb: (mgr: any) => Promise<any>) => {
    const mgr = {
      getRepository: jest.fn(() => ({
        create: jest.fn((dto: any) => dto),
        save: jest.fn((entity: any) => ({
          agentId: 'agent-001',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        })),
      })),
    };
    return cb(mgr);
  }),
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
    keycloakClientProvisioned: false,
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
  let roleRepo: { find: jest.Mock };
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    roleRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };
    const module = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: getRepositoryToken(AgentIdentityEntity), useFactory: mockAgentRepo },
        { provide: getRepositoryToken(AgentTrustClassificationEntity), useFactory: mockClassificationRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useValue: roleRepo },
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: KeycloakAdminService, useValue: { createAgentClient: jest.fn().mockResolvedValue({ keycloak_client_id: 'agent-001', keycloak_client_secret: 'mock-secret' }), deleteAgentClient: jest.fn(), rotateClientSecret: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
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

  // ---------------------------------------------------------------------------
  // F11.23 — agent classification changed notification
  // ---------------------------------------------------------------------------

  describe('F11.23 agent classification changed notification', () => {
    function setupClassificationChange(overrides: { humanOversightContact?: string } = {}): void {
      const agent = makeAgent({
        agentId: 'agent-001',
        orgId: 'org-001',
        currentClassification: 'Observed',
        humanOversightContact: overrides.humanOversightContact ?? 'oversight@example.com',
      });
      agentRepo.findOne.mockResolvedValue(agent);
      classificationRepo.findOne.mockResolvedValue({
        classification: 'Observed',
        effectiveFrom: new Date(),
      });
      // Default mock factories already return suitable shapes; no overrides needed.
    }

    it('enqueues to oversight contact + governance team on classification change', async () => {
      setupClassificationChange();
      principalRepo.findOne.mockResolvedValue({
        id: 'oversight-principal-1',
        orgId: 'org-001',
        email: 'oversight@example.com',
      });
      roleRepo.find.mockResolvedValue([{ principalId: 'gov-1' }, { principalId: 'gov-2' }]);

      const ctx = makeCtx({ roles: ['governance_member'], email: 'governance@example.com' });
      await service.updateClassification(
        'agent-001',
        { classification: 'Supervised', reason: 'Promotion after observation period completed' },
        ctx,
      );

      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-001',
          category: 'agent_classification_changed',
          dedupKey: 'agent_classification_changed:agent-001:Supervised',
        }),
      );
      const call = notificationsService.enqueue.mock.calls[0][0] as { recipients: string[]; payload: Record<string, unknown> };
      expect(call.recipients.sort()).toEqual(['gov-1', 'gov-2', 'oversight-principal-1'].sort());
      expect(call.payload.previousClassification).toBe('Observed');
      expect(call.payload.newClassification).toBe('Supervised');
      expect(call.payload.transition).toBe('upgrade');
    });

    it('still enqueues to governance team when oversight contact email does not resolve to a principal', async () => {
      setupClassificationChange();
      // No matching principal for the oversight email.
      principalRepo.findOne.mockResolvedValue(null);
      roleRepo.find.mockResolvedValue([{ principalId: 'gov-1' }]);

      const ctx = makeCtx({ roles: ['governance_member'] });
      await service.updateClassification(
        'agent-001',
        { classification: 'Supervised', reason: 'Promotion after observation period completed' },
        ctx,
      );

      const call = notificationsService.enqueue.mock.calls[0][0] as { recipients: string[] };
      expect(call.recipients).toEqual(['gov-1']);
    });

    it('does not enqueue when neither oversight nor governance principals exist (no recipients)', async () => {
      setupClassificationChange();
      principalRepo.findOne.mockResolvedValue(null);
      roleRepo.find.mockResolvedValue([]);

      const ctx = makeCtx({ roles: ['governance_member'] });
      await service.updateClassification(
        'agent-001',
        { classification: 'Supervised', reason: 'Promotion after observation period completed' },
        ctx,
      );

      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('completes the classification change even if notification enqueue throws', async () => {
      setupClassificationChange();
      principalRepo.findOne.mockResolvedValue({
        id: 'oversight-1',
        orgId: 'org-001',
        email: 'oversight@example.com',
      });
      roleRepo.find.mockResolvedValue([]);
      notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

      const ctx = makeCtx({ roles: ['governance_member'] });
      const result = await service.updateClassification(
        'agent-001',
        { classification: 'Supervised', reason: 'Promotion after observation period completed' },
        ctx,
      );

      expect(result.current_classification).toBe('Supervised');
    });
  });
});
