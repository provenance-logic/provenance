// Env required by ControlPlaneClient module graph (config import chain).
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

// ESM mode does not auto-inject the `jest` global; import explicitly.
import { jest, describe, it, expect } from '@jest/globals';
import type { ConnectionReference } from '@provenance/types';
import { SCOPE_ENFORCEMENT_ERROR_CODES } from '@provenance/types';
import { ScopeEnforcer } from './scope-enforcement.js';
import type { ControlPlaneClient } from '../control-plane/control-plane.client.js';
import type { SessionIdentity } from '../mcp/tools.js';

const SESSION: SessionIdentity = {
  agentId: '550e8400-e29b-41d4-a716-446655440000',
  orgId: '660e8400-e29b-41d4-a716-446655440001',
};

const PRODUCT_ID = '770e8400-e29b-41d4-a716-446655440002';

function makeActiveReference(overrides: Partial<ConnectionReference> = {}): ConnectionReference {
  const now = Date.now();
  return {
    id: 'ref-1',
    orgId: SESSION.orgId,
    agentId: SESSION.agentId,
    productId: PRODUCT_ID,
    productVersionId: null,
    accessGrantId: 'grant-1',
    owningPrincipalId: 'owner-1',
    state: 'active',
    causedBy: 'principal_action',
    requestedAt: new Date(now - 1000).toISOString(),
    approvedAt: new Date(now - 500).toISOString(),
    activatedAt: new Date(now - 500).toISOString(),
    suspendedAt: null,
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    terminatedAt: null,
    approvedByPrincipalId: 'owner-1',
    governancePolicyVersion: null,
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration: 'x'.repeat(60),
    intendedScope: { ports: ['p1'] },
    dataCategoryConstraints: null,
    requestedDurationDays: 7,
    approvedScope: { ports: ['p1'] },
    approvedDataCategoryConstraints: null,
    approvedDurationDays: 7,
    modifiedByApprover: false,
    denialReason: null,
    deniedByPrincipalId: null,
    connectionPackage: null,
    createdAt: new Date(now - 1000).toISOString(),
    updatedAt: new Date(now - 500).toISOString(),
    ...overrides,
  };
}

type GetActiveFn = (productId: string) => Promise<ConnectionReference | null>;
type WriteAuditFn = (entry: Record<string, unknown>) => Promise<void>;

interface MockClient {
  getActiveConnectionReference: jest.Mock<GetActiveFn>;
  writeAuditEntry: jest.Mock<WriteAuditFn>;
}

function mockClient(): MockClient {
  return {
    getActiveConnectionReference: jest.fn<GetActiveFn>(),
    writeAuditEntry: jest.fn<WriteAuditFn>().mockResolvedValue(undefined),
  };
}

function asEnforcer(c: MockClient): ScopeEnforcer {
  return new ScopeEnforcer(c as unknown as ControlPlaneClient);
}

describe('ScopeEnforcer.enforce (F12.16)', () => {
  it('allows when an active in-scope reference exists', async () => {
    const client = mockClient();
    client.getActiveConnectionReference.mockResolvedValue(makeActiveReference());
    const enforcer = asEnforcer(client);

    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_product',
      action: {},
    });

    expect(decision.allow).toBe(true);
    expect(client.writeAuditEntry).not.toHaveBeenCalled();
  });

  it('denies with NOT_FOUND when the control plane returns no reference', async () => {
    const client = mockClient();
    client.getActiveConnectionReference.mockResolvedValue(null);
    const enforcer = asEnforcer(client);

    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_product',
      action: {},
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe(SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_NOT_FOUND);
    }
    expect(client.writeAuditEntry).toHaveBeenCalledTimes(1);
    // F12.24: denial audit carries the reason code and the input that
    // produced it; resource_id is null when no reference was resolved.
    const audit = client.writeAuditEntry.mock.calls[0][0] as {
      action: string;
      resource_id: string | null;
      metadata: Record<string, unknown>;
    };
    expect(audit.action).toBe('mcp_tool_call_denied');
    expect(audit.resource_id).toBeNull();
    expect(audit.metadata.reason_code).toBe('CONNECTION_REFERENCE_NOT_FOUND');
  });

  it('fails closed (NOT_FOUND) and audits when the control-plane lookup errors', async () => {
    const client = mockClient();
    client.getActiveConnectionReference.mockRejectedValue(new Error('connection refused'));
    const enforcer = asEnforcer(client);

    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_product',
      action: {},
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe(SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_NOT_FOUND);
    }
    expect(client.writeAuditEntry).toHaveBeenCalledTimes(1);
  });

  it('denies with EXPIRED when the reference is past its expires_at', async () => {
    const client = mockClient();
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    client.getActiveConnectionReference.mockResolvedValue(
      makeActiveReference({ expiresAt: expiredAt }),
    );
    const enforcer = asEnforcer(client);

    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_product',
      action: {},
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe(SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_EXPIRED);
    }
    const audit = client.writeAuditEntry.mock.calls[0][0] as {
      action: string;
      resource_id: string | null;
      metadata: Record<string, unknown>;
    };
    expect(audit.resource_id).toBe('ref-1');
    expect(audit.metadata.reference_expires_at).toBe(expiredAt);
  });

  it('denies with SCOPE_VIOLATION when the action falls outside the approved scope', async () => {
    const client = mockClient();
    client.getActiveConnectionReference.mockResolvedValue(
      makeActiveReference({ approvedScope: { ports: ['p1'] } }),
    );
    const enforcer = asEnforcer(client);

    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_lineage',
      action: { port: 'p99' },
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.code).toBe(SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_SCOPE_VIOLATION);
      expect(decision.message).toContain('p99');
    }
    const audit = client.writeAuditEntry.mock.calls[0][0] as {
      action: string;
      resource_id: string | null;
      metadata: Record<string, unknown>;
    };
    expect(audit.metadata.requested_action).toEqual({ port: 'p99' });
    expect(audit.metadata.approved_scope).toEqual({ ports: ['p1'] });
  });

  it('does not throw when the denial audit write itself fails', async () => {
    const client = mockClient();
    client.getActiveConnectionReference.mockResolvedValue(null);
    client.writeAuditEntry.mockRejectedValue(new Error('audit endpoint down'));
    const enforcer = asEnforcer(client);

    // The denial decision must still come back even if audit fails —
    // the gate cannot be defeated by knocking over the audit endpoint.
    const decision = await enforcer.enforce({
      session: SESSION,
      productId: PRODUCT_ID,
      toolName: 'get_product',
      action: {},
    });

    expect(decision.allow).toBe(false);
  });
});
