import { AgentsService, CreateAgentDto } from './agents.service.js';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentIdentityEntity } from './entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from './entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import type { RequestContext } from '@provenance/types';
import { BadRequestException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440001';
const PRINCIPAL_ID = '770e8400-e29b-41d4-a716-446655440002';

const oversightPrincipal: Partial<PrincipalEntity> = {
  id: PRINCIPAL_ID,
  email: 'oversight@example.com',
  orgId: ORG_ID,
  principalType: 'human_user',
  keycloakSubject: 'kc-sub-1',
};

const dto: CreateAgentDto = {
  display_name: 'Test Agent',
  model_name: 'claude-sonnet-4-20250514',
  model_provider: 'Anthropic',
  human_oversight_contact: 'oversight@example.com',
  org_id: ORG_ID,
};

const ctx: RequestContext = {
  principalId: PRINCIPAL_ID,
  orgId: ORG_ID,
  principalType: 'human_user',
  roles: ['org_admin'],
  keycloakSubject: 'kc-sub-1',
  email: 'admin@example.com',
};

function makeSavedAgent(overrides: Partial<AgentIdentityEntity> = {}): AgentIdentityEntity {
  return {
    agentId: AGENT_ID,
    orgId: ORG_ID,
    displayName: dto.display_name,
    modelName: dto.model_name,
    modelProvider: dto.model_provider,
    humanOversightContact: dto.human_oversight_contact,
    registeredByPrincipalId: PRINCIPAL_ID,
    currentClassification: 'Observed',
    keycloakClientProvisioned: false,
    createdAt: new Date('2026-04-15T00:00:00Z'),
    updatedAt: new Date('2026-04-15T00:00:00Z'),
    ...overrides,
  } as AgentIdentityEntity;
}

function makeSavedClassification(): AgentTrustClassificationEntity {
  return {
    classificationId: 'cccc0000-0000-0000-0000-000000000001',
    agentId: AGENT_ID,
    orgId: ORG_ID,
    classification: 'Observed',
    scope: 'global',
    changedByPrincipalId: PRINCIPAL_ID,
    changedByPrincipalType: 'human_user',
    reason: 'Initial registration',
    effectiveFrom: new Date('2026-04-15T00:00:00Z'),
    createdAt: new Date('2026-04-15T00:00:00Z'),
  } as AgentTrustClassificationEntity;
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockRepo() {
  return {
    create: jest.fn((data: unknown) => data),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };
}

/** Build a mock DataSource whose transaction() runs the callback with a fake manager. */
function mockDataSource() {
  const managerAgentRepo = { create: jest.fn((d: unknown) => d), save: jest.fn() };
  const managerClassRepo = { create: jest.fn((d: unknown) => d), save: jest.fn() };

  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === AgentIdentityEntity) return managerAgentRepo;
      if (entity === AgentTrustClassificationEntity) return managerClassRepo;
      throw new Error(`Unexpected entity: ${String(entity)}`);
    }),
  };

  const ds = {
    transaction: jest.fn(async (cb: (mgr: typeof manager) => Promise<unknown>) => cb(manager)),
    query: jest.fn(),
  };

  return { ds, manager, managerAgentRepo, managerClassRepo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentsService — registerAgent (Phase 5a-3)', () => {
  let service: AgentsService;
  let principalRepo: ReturnType<typeof mockRepo>;
  let agentRepo: ReturnType<typeof mockRepo>;
  let classificationRepo: ReturnType<typeof mockRepo>;
  let keycloakAdmin: { createAgentClient: jest.Mock; deleteAgentClient: jest.Mock; rotateClientSecret: jest.Mock };
  let dsCtx: ReturnType<typeof mockDataSource>;

  beforeEach(() => {
    principalRepo = mockRepo();
    agentRepo = mockRepo();
    classificationRepo = mockRepo();
    dsCtx = mockDataSource();

    keycloakAdmin = {
      createAgentClient: jest.fn(),
      deleteAgentClient: jest.fn(),
      rotateClientSecret: jest.fn(),
    };

    service = new AgentsService(
      agentRepo as any,
      classificationRepo as any,
      principalRepo as any,
      dsCtx.ds as any,
      keycloakAdmin as unknown as KeycloakAdminService,
    );
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('provisions a Keycloak client and returns credentials in the response', async () => {
    principalRepo.findOne.mockResolvedValue(oversightPrincipal);

    const savedAgent = makeSavedAgent();
    dsCtx.managerAgentRepo.save.mockResolvedValue(savedAgent);
    dsCtx.managerClassRepo.save.mockResolvedValue(makeSavedClassification());

    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'super-secret',
    });

    const result = await service.registerAgent(dto, ctx);

    // Keycloak called with the agent's ID and org
    expect(keycloakAdmin.createAgentClient).toHaveBeenCalledWith(AGENT_ID, ORG_ID);

    // Response includes credentials
    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBe('super-secret');
  });

  // -------------------------------------------------------------------------
  // Transaction semantics
  // -------------------------------------------------------------------------

  it('wraps agent save, classification save, and Keycloak provisioning in a transaction', async () => {
    principalRepo.findOne.mockResolvedValue(oversightPrincipal);
    dsCtx.managerAgentRepo.save.mockResolvedValue(makeSavedAgent());
    dsCtx.managerClassRepo.save.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'secret',
    });

    await service.registerAgent(dto, ctx);

    // dataSource.transaction was called
    expect(dsCtx.ds.transaction).toHaveBeenCalledTimes(1);

    // Both saves went through the transaction manager, not the injected repos
    expect(dsCtx.manager.getRepository).toHaveBeenCalledWith(AgentIdentityEntity);
    expect(dsCtx.manager.getRepository).toHaveBeenCalledWith(AgentTrustClassificationEntity);
    expect(dsCtx.managerAgentRepo.save).toHaveBeenCalledTimes(1);
    expect(dsCtx.managerClassRepo.save).toHaveBeenCalledTimes(1);

    // Injected repos were NOT used for saves
    expect(agentRepo.save).not.toHaveBeenCalled();
    expect(classificationRepo.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Keycloak failure → rollback
  // -------------------------------------------------------------------------

  it('rolls back DB records when Keycloak provisioning fails', async () => {
    principalRepo.findOne.mockResolvedValue(oversightPrincipal);
    dsCtx.managerAgentRepo.save.mockResolvedValue(makeSavedAgent());
    dsCtx.managerClassRepo.save.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockRejectedValue(
      new Error('Keycloak unavailable'),
    );

    // The transaction mock runs the callback directly, so when it throws
    // the mock transaction rejects — simulating a rollback.
    await expect(service.registerAgent(dto, ctx)).rejects.toThrow(
      /keycloak/i,
    );

    // Keycloak was called inside the transaction
    expect(keycloakAdmin.createAgentClient).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Oversight validation still works
  // -------------------------------------------------------------------------

  it('still rejects when human_oversight_contact is not a registered user', async () => {
    principalRepo.findOne.mockResolvedValue(null);

    await expect(service.registerAgent(dto, ctx)).rejects.toThrow(
      BadRequestException,
    );

    // Should fail before reaching the transaction or Keycloak
    expect(dsCtx.ds.transaction).not.toHaveBeenCalled();
    expect(keycloakAdmin.createAgentClient).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // MCP service account fallback
  // -------------------------------------------------------------------------

  it('falls back to oversight principal ID when called via MCP API key', async () => {
    const mcpCtx: RequestContext = {
      principalId: 'mcp-agent', // not a UUID
      orgId: ORG_ID,
      principalType: 'service_account',
      roles: [],
      keycloakSubject: 'mcp-agent',
    };

    principalRepo.findOne.mockResolvedValue(oversightPrincipal);
    dsCtx.managerAgentRepo.save.mockResolvedValue(makeSavedAgent());
    dsCtx.managerClassRepo.save.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'mcp-secret',
    });

    const result = await service.registerAgent(dto, mcpCtx);

    // The agent was saved with the oversight principal's ID, not 'mcp-agent'
    const savedData = dsCtx.managerAgentRepo.save.mock.calls[0][0];
    expect(savedData.registeredByPrincipalId).toBe(PRINCIPAL_ID);

    expect(result.keycloak_client_secret).toBe('mcp-secret');
  });

  // -------------------------------------------------------------------------
  // getAgent returns null secret
  // -------------------------------------------------------------------------

  it('getAgent returns keycloak_client_id but keycloak_client_secret as null', async () => {
    const agent = makeSavedAgent();
    agentRepo.findOne.mockResolvedValue(agent);
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());

    const result = await service.getAgent(AGENT_ID);

    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Keycloak called with correct agent ID (not a stale/wrong one)
  // -------------------------------------------------------------------------

  it('passes the DB-generated agent_id to Keycloak, not a client-provided one', async () => {
    const generatedId = '880e8400-e29b-41d4-a716-446655440099';
    principalRepo.findOne.mockResolvedValue(oversightPrincipal);
    dsCtx.managerAgentRepo.save.mockResolvedValue(makeSavedAgent({ agentId: generatedId }));
    dsCtx.managerClassRepo.save.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: generatedId,
      keycloak_client_secret: 'gen-secret',
    });

    const result = await service.registerAgent(dto, ctx);

    expect(keycloakAdmin.createAgentClient).toHaveBeenCalledWith(generatedId, ORG_ID);
    expect(result.keycloak_client_id).toBe(generatedId);
  });
});

// ---------------------------------------------------------------------------
// rotateSecret (Phase 5a-4)
// ---------------------------------------------------------------------------

describe('AgentsService — rotateSecret (Phase 5a-4)', () => {
  let service: AgentsService;
  let agentRepo: ReturnType<typeof mockRepo>;
  let classificationRepo: ReturnType<typeof mockRepo>;
  let principalRepo: ReturnType<typeof mockRepo>;
  let keycloakAdmin: { createAgentClient: jest.Mock; deleteAgentClient: jest.Mock; rotateClientSecret: jest.Mock };
  let dsCtx: ReturnType<typeof mockDataSource>;

  beforeEach(() => {
    agentRepo = mockRepo();
    classificationRepo = mockRepo();
    principalRepo = mockRepo();
    dsCtx = mockDataSource();

    keycloakAdmin = {
      createAgentClient: jest.fn(),
      deleteAgentClient: jest.fn(),
      rotateClientSecret: jest.fn(),
    };

    service = new AgentsService(
      agentRepo as any,
      classificationRepo as any,
      principalRepo as any,
      dsCtx.ds as any,
      keycloakAdmin as unknown as KeycloakAdminService,
    );
  });

  const governanceCtx: RequestContext = {
    principalId: PRINCIPAL_ID,
    orgId: ORG_ID,
    principalType: 'human_user',
    roles: ['governance_member'],
    keycloakSubject: 'kc-sub-gov',
    email: 'gov@example.com',
  };

  const oversightCtx: RequestContext = {
    principalId: PRINCIPAL_ID,
    orgId: ORG_ID,
    principalType: 'human_user',
    roles: ['consumer'],
    keycloakSubject: 'kc-sub-oversight',
    email: 'oversight@example.com', // matches agent's humanOversightContact
  };

  const unauthorizedCtx: RequestContext = {
    principalId: PRINCIPAL_ID,
    orgId: ORG_ID,
    principalType: 'human_user',
    roles: ['consumer'],
    keycloakSubject: 'kc-sub-rando',
    email: 'rando@example.com',
  };

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  it('allows governance_member to rotate and returns the new secret', async () => {
    agentRepo.findOne.mockResolvedValue(makeSavedAgent());
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.rotateClientSecret.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'new-rotated-secret',
    });

    const result = await service.rotateSecret(AGENT_ID, governanceCtx);

    expect(keycloakAdmin.rotateClientSecret).toHaveBeenCalledWith(AGENT_ID);
    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBe('new-rotated-secret');
  });

  it('allows the human_oversight_contact to rotate', async () => {
    agentRepo.findOne.mockResolvedValue(makeSavedAgent());
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.rotateClientSecret.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'oversight-rotated',
    });

    const result = await service.rotateSecret(AGENT_ID, oversightCtx);

    expect(result.keycloak_client_secret).toBe('oversight-rotated');
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  it('rejects callers who are neither governance_member nor oversight contact', async () => {
    agentRepo.findOne.mockResolvedValue(makeSavedAgent());

    await expect(service.rotateSecret(AGENT_ID, unauthorizedCtx)).rejects.toThrow(
      ForbiddenException,
    );

    expect(keycloakAdmin.rotateClientSecret).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Not found
  // -------------------------------------------------------------------------

  it('throws NotFoundException when agent does not exist', async () => {
    agentRepo.findOne.mockResolvedValue(null);

    await expect(service.rotateSecret(AGENT_ID, governanceCtx)).rejects.toThrow(
      NotFoundException,
    );

    expect(keycloakAdmin.rotateClientSecret).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it('includes all standard agent fields plus the rotated secret', async () => {
    agentRepo.findOne.mockResolvedValue(makeSavedAgent());
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.rotateClientSecret.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'shape-check-secret',
    });

    const result = await service.rotateSecret(AGENT_ID, governanceCtx);

    // Standard fields present
    expect(result.agent_id).toBe(AGENT_ID);
    expect(result.org_id).toBe(ORG_ID);
    expect(result.display_name).toBe('Test Agent');
    expect(result.current_classification).toBe('Observed');

    // Keycloak fields present
    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBe('shape-check-secret');
  });
});

// ---------------------------------------------------------------------------
// provisionCredentials (Phase 5c-10)
// ---------------------------------------------------------------------------

describe('AgentsService — provisionCredentials (Phase 5c-10)', () => {
  let service: AgentsService;
  let agentRepo: ReturnType<typeof mockRepo>;
  let classificationRepo: ReturnType<typeof mockRepo>;
  let principalRepo: ReturnType<typeof mockRepo>;
  let keycloakAdmin: { createAgentClient: jest.Mock; deleteAgentClient: jest.Mock; rotateClientSecret: jest.Mock };
  let dsCtx: ReturnType<typeof mockDataSource>;

  const governanceCtx: RequestContext = {
    principalId: PRINCIPAL_ID,
    orgId: ORG_ID,
    principalType: 'human_user',
    roles: ['governance_member'],
    keycloakSubject: 'kc-sub-gov',
    email: 'gov@example.com',
  };

  const nonGovCtx: RequestContext = {
    principalId: PRINCIPAL_ID,
    orgId: ORG_ID,
    principalType: 'human_user',
    roles: ['consumer'],
    keycloakSubject: 'kc-sub-rando',
    email: 'rando@example.com',
  };

  beforeEach(() => {
    agentRepo = mockRepo();
    classificationRepo = mockRepo();
    principalRepo = mockRepo();
    dsCtx = mockDataSource();

    keycloakAdmin = {
      createAgentClient: jest.fn(),
      deleteAgentClient: jest.fn(),
      rotateClientSecret: jest.fn(),
    };

    service = new AgentsService(
      agentRepo as any,
      classificationRepo as any,
      principalRepo as any,
      dsCtx.ds as any,
      keycloakAdmin as unknown as KeycloakAdminService,
    );
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('provisions Keycloak credentials for an unprovisioned agent', async () => {
    const agent = makeSavedAgent({ keycloakClientProvisioned: false });
    agentRepo.findOne.mockResolvedValue(agent);
    agentRepo.save.mockResolvedValue({ ...agent, keycloakClientProvisioned: true });
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'provisioned-secret',
    });

    const result = await service.provisionCredentials(AGENT_ID, governanceCtx);

    expect(keycloakAdmin.createAgentClient).toHaveBeenCalledWith(AGENT_ID, ORG_ID);
    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBe('provisioned-secret');
  });

  it('sets keycloakClientProvisioned to true after provisioning', async () => {
    const agent = makeSavedAgent({ keycloakClientProvisioned: false });
    agentRepo.findOne.mockResolvedValue(agent);
    agentRepo.save.mockResolvedValue({ ...agent, keycloakClientProvisioned: true });
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'secret',
    });

    await service.provisionCredentials(AGENT_ID, governanceCtx);

    expect(agentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ keycloakClientProvisioned: true }),
    );
  });

  // -----------------------------------------------------------------------
  // Already provisioned → 409
  // -----------------------------------------------------------------------

  it('throws ConflictException when agent is already provisioned', async () => {
    agentRepo.findOne.mockResolvedValue(
      makeSavedAgent({ keycloakClientProvisioned: true }),
    );

    await expect(
      service.provisionCredentials(AGENT_ID, governanceCtx),
    ).rejects.toThrow(ConflictException);

    expect(keycloakAdmin.createAgentClient).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Authorization: governance_member required
  // -----------------------------------------------------------------------

  it('rejects non-governance callers with ForbiddenException', async () => {
    agentRepo.findOne.mockResolvedValue(
      makeSavedAgent({ keycloakClientProvisioned: false }),
    );

    await expect(
      service.provisionCredentials(AGENT_ID, nonGovCtx),
    ).rejects.toThrow(ForbiddenException);

    expect(keycloakAdmin.createAgentClient).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Not found
  // -----------------------------------------------------------------------

  it('throws NotFoundException when agent does not exist', async () => {
    agentRepo.findOne.mockResolvedValue(null);

    await expect(
      service.provisionCredentials(AGENT_ID, governanceCtx),
    ).rejects.toThrow(NotFoundException);
  });

  // -----------------------------------------------------------------------
  // Response shape
  // -----------------------------------------------------------------------

  it('returns the full agent response with the secret', async () => {
    const agent = makeSavedAgent({ keycloakClientProvisioned: false });
    agentRepo.findOne.mockResolvedValue(agent);
    agentRepo.save.mockResolvedValue({ ...agent, keycloakClientProvisioned: true });
    classificationRepo.findOne.mockResolvedValue(makeSavedClassification());
    keycloakAdmin.createAgentClient.mockResolvedValue({
      keycloak_client_id: AGENT_ID,
      keycloak_client_secret: 'one-time-secret',
    });

    const result = await service.provisionCredentials(AGENT_ID, governanceCtx);

    expect(result.agent_id).toBe(AGENT_ID);
    expect(result.org_id).toBe(ORG_ID);
    expect(result.display_name).toBe('Test Agent');
    expect(result.keycloak_client_id).toBe(AGENT_ID);
    expect(result.keycloak_client_secret).toBe('one-time-secret');
  });
});
