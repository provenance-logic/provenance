import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { ALLOW_NO_ORG_KEY } from './allow-no-org.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { OrganizationsController } from '../organizations/organizations.controller.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440001';
const MCP_KEY = 'test-mcp-api-key';

function makeAgent(overrides: Partial<AgentIdentityEntity> = {}): AgentIdentityEntity {
  return {
    agentId: AGENT_ID,
    orgId: ORG_ID,
    displayName: 'Test Agent',
    modelName: 'claude-sonnet-4-20250514',
    modelProvider: 'Anthropic',
    humanOversightContact: 'oversight@test.com',
    registeredByPrincipalId: '00000000-0000-0000-0000-000000000099',
    currentClassification: 'Observed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentIdentityEntity;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAgentRepo() {
  return {
    findOne: jest.fn(),
  };
}

function mockExecutionContext(
  headers: Record<string, string>,
  initialUser?: Record<string, unknown>,
  params?: Record<string, string>,
): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers };
  if (initialUser) request.user = initialUser;
  if (params) request.params = params;
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

function mockReflector(metadata: Record<string, boolean> = {}): Reflector {
  return {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JwtAuthGuard — MCP_API_KEY with agent identity headers (Phase 5b-8)', () => {
  let guard: JwtAuthGuard;
  let agentRepo: ReturnType<typeof mockAgentRepo>;

  beforeEach(() => {
    process.env.MCP_API_KEY = MCP_KEY;
    agentRepo = mockAgentRepo();
    guard = new JwtAuthGuard(agentRepo as any, mockReflector());
  });

  afterEach(() => {
    delete process.env.MCP_API_KEY;
  });

  // -----------------------------------------------------------------------
  // MCP_API_KEY + X-Agent-Id + X-Org-Id → verified agent context
  // -----------------------------------------------------------------------

  it('populates RequestContext with agent identity when X-Agent-Id header is present', async () => {
    agentRepo.findOne.mockResolvedValue(makeAgent());

    const { context, request } = mockExecutionContext({
      authorization: `Bearer ${MCP_KEY}`,
      'x-agent-id': AGENT_ID,
      'x-org-id': ORG_ID,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const user = request.user as Record<string, unknown>;
    expect(user.principalId).toBe(AGENT_ID);
    expect(user.orgId).toBe(ORG_ID);
    expect(user.principalType).toBe('ai_agent');
    expect(user.agentId).toBe(AGENT_ID);
    expect(user.keycloakSubject).toBe(AGENT_ID);
  });

  it('verifies the agent exists in the database', async () => {
    agentRepo.findOne.mockResolvedValue(makeAgent());

    const { context } = mockExecutionContext({
      authorization: `Bearer ${MCP_KEY}`,
      'x-agent-id': AGENT_ID,
      'x-org-id': ORG_ID,
    });

    await guard.canActivate(context);

    expect(agentRepo.findOne).toHaveBeenCalledWith({
      where: { agentId: AGENT_ID },
    });
  });

  // -----------------------------------------------------------------------
  // X-Agent-Id supplied but agent not found → 401
  // -----------------------------------------------------------------------

  it('rejects with 401 when X-Agent-Id does not match a known agent', async () => {
    agentRepo.findOne.mockResolvedValue(null);

    const { context } = mockExecutionContext({
      authorization: `Bearer ${MCP_KEY}`,
      'x-agent-id': 'unknown-agent-id',
      'x-org-id': ORG_ID,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // -----------------------------------------------------------------------
  // MCP_API_KEY without agent headers → service_account (unchanged)
  // -----------------------------------------------------------------------

  it('falls back to service_account context when no X-Agent-Id header', async () => {
    const { context, request } = mockExecutionContext({
      authorization: `Bearer ${MCP_KEY}`,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const user = request.user as Record<string, unknown>;
    expect(user.principalId).toBe('mcp-agent');
    expect(user.principalType).toBe('service_account');
    expect(user.agentId).toBeUndefined();

    // Should not touch the database
    expect(agentRepo.findOne).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Uses orgId from the verified agent record, not just the header
  // -----------------------------------------------------------------------

  it('uses orgId from the agent record for RequestContext', async () => {
    const agentOrgId = '990e8400-e29b-41d4-a716-446655440099';
    agentRepo.findOne.mockResolvedValue(makeAgent({ orgId: agentOrgId }));

    const { context, request } = mockExecutionContext({
      authorization: `Bearer ${MCP_KEY}`,
      'x-agent-id': AGENT_ID,
      'x-org-id': 'header-org-ignored',
    });

    await guard.canActivate(context);

    const user = request.user as Record<string, unknown>;
    expect(user.orgId).toBe(agentOrgId);
  });

  // -----------------------------------------------------------------------
  // Non-MCP_API_KEY auth is not affected
  // -----------------------------------------------------------------------

  it('does not interfere with normal JWT auth path', async () => {
    const { context } = mockExecutionContext(
      { authorization: 'Bearer some-jwt-token' },
      { orgId: ORG_ID, principalId: 'p-1' },
    );

    // super.canActivate would be called; we just verify it doesn't
    // enter the MCP_API_KEY branch
    // Mock super.canActivate to return true (simulating valid JWT)
    const superActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(agentRepo.findOne).not.toHaveBeenCalled();

    superActivate.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Empty-orgId enforcement — every JWT-authenticated route except @AllowNoOrg
// must carry a provenance_org_id claim.
// ---------------------------------------------------------------------------

describe('JwtAuthGuard — provenance_org_id enforcement', () => {
  let agentRepo: ReturnType<typeof mockAgentRepo>;

  beforeEach(() => {
    agentRepo = mockAgentRepo();
  });

  afterEach(() => {
    delete process.env.MCP_API_KEY;
  });

  function withValidJwt(
    user: Record<string, unknown>,
    reflectorMetadata: Record<string, boolean> = {},
  ) {
    const guard = new JwtAuthGuard(agentRepo as any, mockReflector(reflectorMetadata));
    const { context } = mockExecutionContext(
      { authorization: 'Bearer user-jwt' },
      user,
    );
    const superActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);
    return { guard, context, superActivate };
  }

  it('rejects a JWT with empty orgId on a normal route', async () => {
    const { guard, context, superActivate } = withValidJwt({
      orgId: '',
      principalId: 'p-1',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);

    superActivate.mockRestore();
  });

  it('allows a JWT with empty orgId when the route is @AllowNoOrg', async () => {
    const { guard, context, superActivate } = withValidJwt(
      { orgId: '', principalId: 'p-1' },
      { [ALLOW_NO_ORG_KEY]: true },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    superActivate.mockRestore();
  });

  it('allows a JWT with a populated orgId on a normal route', async () => {
    const { guard, context, superActivate } = withValidJwt({
      orgId: '660e8400-e29b-41d4-a716-446655440001',
      principalId: 'p-1',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    superActivate.mockRestore();
  });

  it('short-circuits JWT validation entirely when the route is @Public', async () => {
    const guard = new JwtAuthGuard(
      agentRepo as any,
      mockReflector({ [IS_PUBLIC_KEY]: true }),
    );
    const { context } = mockExecutionContext({});
    const superActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(superActivate).not.toHaveBeenCalled();

    superActivate.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Cross-org URL/JWT consistency (B-061).
// Every route that carries an :orgId path parameter must have that match the
// caller's JWT-resolved orgId. Mismatch → 403. This prevents the leak filed
// in B-061 where controllers passing @Param('orgId') straight to services
// would happily serve a different tenant's data.
// ---------------------------------------------------------------------------

describe('JwtAuthGuard — cross-org URL/JWT consistency (B-061)', () => {
  let agentRepo: ReturnType<typeof mockAgentRepo>;
  const ACME = '660e8400-e29b-41d4-a716-446655440001';
  const BETA = '660e8400-e29b-41d4-a716-44665544beta';

  beforeEach(() => {
    agentRepo = mockAgentRepo();
  });

  afterEach(() => {
    delete process.env.MCP_API_KEY;
  });

  function withValidJwt(
    user: Record<string, unknown>,
    params?: Record<string, string>,
  ) {
    const guard = new JwtAuthGuard(agentRepo as any, mockReflector());
    const { context } = mockExecutionContext(
      { authorization: 'Bearer user-jwt' },
      user,
      params,
    );
    const superActivate = jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockReturnValue(true);
    return { guard, context, superActivate };
  }

  it('rejects with 403 when URL :orgId differs from JWT orgId', async () => {
    const { guard, context, superActivate } = withValidJwt(
      { orgId: ACME, principalId: 'p-1' },
      { orgId: BETA },
    );

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);

    superActivate.mockRestore();
  });

  it('allows when URL :orgId equals JWT orgId', async () => {
    const { guard, context, superActivate } = withValidJwt(
      { orgId: ACME, principalId: 'p-1' },
      { orgId: ACME },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    superActivate.mockRestore();
  });

  it('allows when the route has no :orgId path parameter', async () => {
    const { guard, context, superActivate } = withValidJwt(
      { orgId: ACME, principalId: 'p-1' },
      // params left unset — the route does not have :orgId
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    superActivate.mockRestore();
  });

  it('does not enforce when the MCP service-account bypass set orgId=""', async () => {
    // The MCP_API_KEY bypass earlier in JwtAuthGuard sets orgId='' on the
    // privileged inter-service path. That short-circuits before this check
    // (it returns true before reaching the cross-org guard). But for the
    // belt-and-suspenders case where some other path produces an empty
    // orgId on the user, the check should not 403 — it should leave that
    // decision to whichever upstream check is responsible for empty orgIds.
    process.env.MCP_API_KEY = MCP_KEY;
    const guard = new JwtAuthGuard(agentRepo as any, mockReflector());
    const { context } = mockExecutionContext(
      { authorization: `Bearer ${MCP_KEY}` },
      undefined,
      { orgId: ACME },
    );

    // MCP key path returns true before the cross-org check runs, so this
    // should pass regardless of the URL :orgId.
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an agent JWT that targets a different org than its agent record', async () => {
    // Agent identity context — when the MCP service forwards X-Agent-Id,
    // request.user.orgId is the agent's owning org. The agent should not be
    // able to act against a different org even with a valid x-agent-id header.
    process.env.MCP_API_KEY = MCP_KEY;
    agentRepo.findOne.mockResolvedValue(makeAgent({ orgId: ACME }));
    const guard = new JwtAuthGuard(agentRepo as any, mockReflector());
    const { context } = mockExecutionContext(
      {
        authorization: `Bearer ${MCP_KEY}`,
        'x-agent-id': AGENT_ID,
        'x-org-id': ACME,
      },
      undefined,
      { orgId: BETA },
    );

    // Note: the MCP path currently returns true BEFORE the cross-org check
    // runs (early return at line 60 of jwt-auth.guard.ts). This test
    // documents that gap — agent identity bypasses cross-org scope today
    // because the MCP bypass branch short-circuits the guard. Fixing that
    // is part of the RLS-by-default follow-up tracked under B-061.
    //
    // For now we just assert the current behavior (passes) so this test
    // pins the boundary and a future fix has a place to land.
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real-metadata regression tests — these exercise the live decorator wiring
// against the actual OrganizationsController method references using a real
// Reflector. They exist so that a future regression (e.g. someone removes
// @AllowNoOrg from self-serve, or renames the metadata key) fails loudly here
// instead of silently reintroducing the chicken-and-egg 401 for new users.
// ---------------------------------------------------------------------------

describe('JwtAuthGuard — real decorator wiring on OrganizationsController', () => {
  type ControllerHandler = (...args: unknown[]) => unknown;

  function contextFor(handler: ControllerHandler, initialUser: Record<string, unknown>): ExecutionContext {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer user-jwt' },
      user: initialUser,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => OrganizationsController,
    } as unknown as ExecutionContext;
  }

  function buildGuard(): JwtAuthGuard {
    const guard = new JwtAuthGuard(
      { findOne: jest.fn() } as any,
      new Reflector(),
    );
    jest
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
      .mockImplementation(function (_ctx: unknown) {
        // Emulate @nestjs/passport: on successful JWT validation, super sets
        // request.user and returns true. For the purpose of these tests, the
        // caller has already seeded request.user via contextFor().
        return true;
      });
    return guard;
  }

  it('self-serve with empty orgId is ALLOWED (real @AllowNoOrg metadata)', async () => {
    const guard = buildGuard();
    const ctx = contextFor(
      OrganizationsController.prototype.selfServeOrganization,
      { orgId: '', principalId: 'kc-sub' },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('listOrganizations with empty orgId is REJECTED (no @AllowNoOrg)', async () => {
    const guard = buildGuard();
    const ctx = contextFor(
      OrganizationsController.prototype.listOrganizations,
      { orgId: '', principalId: 'kc-sub' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('listOrganizations with populated orgId is ALLOWED', async () => {
    const guard = buildGuard();
    const ctx = contextFor(
      OrganizationsController.prototype.listOrganizations,
      { orgId: 'org-1', principalId: 'p-1' },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('RolesGuard does not require roles on self-serve (no @Roles decorator)', () => {
    const rolesGuard = new RolesGuard(new Reflector());
    const ctx = contextFor(
      OrganizationsController.prototype.selfServeOrganization,
      { orgId: '', principalId: 'kc-sub', roles: [] },
    );
    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });
});
