import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConnectionReferenceGuard } from './connection-reference.guard.js';
import type { ConnectionReferenceCache } from '../cache/connection-reference-cache.js';
import type { AccessGrantCache } from '../cache/access-grant-cache.js';
import type { InternalControlPlaneClient } from '../control-plane/internal-control-plane.client.js';
import type { AccessGrant, ConnectionReference } from '@provenance/types';

// Guard correctness contract per the Domain 12 implementation plan
// Decision 3 + 4 and ADR-006:
//
//   * Tool lookup: exempt → allowed; unknown → UNKNOWN_TOOL.
//   * Access grant check: cache hit fast-path; cache miss falls back
//     to the control-plane lookup and backfills.
//   * Connection-reference state mapping to the five denial codes.
//   * Scope-match invocation (integration with PR #4's pure function).
//
// All caches and the internal client are mocked. We are testing the
// orchestration, not the data structures or the control-plane client.

const ORG_ID = 'org-1';
const AGENT_ID = 'agent-1';
const PRODUCT_ID = 'product-1';

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: 'grant-1',
    orgId: ORG_ID,
    productId: PRODUCT_ID,
    granteePrincipalId: AGENT_ID,
    grantedBy: 'owner-1',
    grantedAt: '2026-05-13T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    accessScope: null,
    approvalRequestId: null,
    connectionPackage: null,
    ...overrides,
  };
}

function makeReference(overrides: Partial<ConnectionReference> = {}): ConnectionReference {
  return {
    id: 'ref-1',
    orgId: ORG_ID,
    agentId: AGENT_ID,
    productId: PRODUCT_ID,
    productVersionId: null,
    accessGrantId: 'grant-1',
    owningPrincipalId: 'owner-1',
    state: 'active',
    causedBy: 'principal_action',
    requestedAt: '2026-05-13T00:00:00.000Z',
    approvedAt: '2026-05-13T00:00:00.000Z',
    activatedAt: '2026-05-13T00:00:00.000Z',
    suspendedAt: null,
    expiresAt: '2026-06-13T00:00:00.000Z',
    terminatedAt: null,
    approvedByPrincipalId: 'owner-1',
    governancePolicyVersion: null,
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration: 'x'.repeat(60),
    intendedScope: { ports: ['discovery'] },
    dataCategoryConstraints: null,
    requestedDurationDays: 30,
    approvedScope: { ports: ['discovery'] },
    approvedDataCategoryConstraints: null,
    approvedDurationDays: 30,
    modifiedByApprover: false,
    denialReason: null,
    deniedByPrincipalId: null,
    connectionPackage: null,
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('ConnectionReferenceGuard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let refCache: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let grantCache: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let internalClient: any;
  let guard: ConnectionReferenceGuard;

  beforeEach(() => {
    refCache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    grantCache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    internalClient = {
      lookupActiveAccessGrant: jest.fn(),
      lookupActiveReference: jest.fn(),
    };
    guard = new ConnectionReferenceGuard(
      refCache as unknown as ConnectionReferenceCache,
      grantCache as unknown as AccessGrantCache,
      internalClient as unknown as InternalControlPlaneClient,
    );
  });

  describe('tool dispatch', () => {
    it.each(['list_products', 'search_products', 'semantic_search', 'register_agent', 'get_agent_status'])(
      'returns allowed/exempt for %s without consulting caches or the control plane',
      async (toolName) => {
        const result = await guard.check(ORG_ID, AGENT_ID, toolName, {});
        expect(result).toEqual({ allowed: true, exempt: true });
        expect(grantCache.get).not.toHaveBeenCalled();
        expect(refCache.get).not.toHaveBeenCalled();
        expect(internalClient.lookupActiveAccessGrant).not.toHaveBeenCalled();
      },
    );

    it('returns UNKNOWN_TOOL for a tool name not in the scope map', async () => {
      const result = await guard.check(ORG_ID, AGENT_ID, 'mystery_tool', {
        product_id: PRODUCT_ID,
      });
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('UNKNOWN_TOOL');
    });

    it('returns UNKNOWN_TOOL for a product-bound tool called without product_id', async () => {
      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {});
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('UNKNOWN_TOOL');
    });
  });

  describe('access-grant check', () => {
    it('takes the cache fast path when the grant is in cache (no control-plane call)', async () => {
      grantCache.get.mockReturnValue(makeGrant());
      refCache.get.mockReturnValue(makeReference());

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(true);
      expect(internalClient.lookupActiveAccessGrant).not.toHaveBeenCalled();
    });

    it('falls back to the control plane on cache miss and backfills the cache', async () => {
      grantCache.get.mockReturnValue(undefined);
      internalClient.lookupActiveAccessGrant.mockResolvedValue(makeGrant());
      refCache.get.mockReturnValue(makeReference());

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(true);
      expect(internalClient.lookupActiveAccessGrant).toHaveBeenCalledWith(
        ORG_ID,
        AGENT_ID,
        PRODUCT_ID,
      );
      expect(grantCache.set).toHaveBeenCalledWith(
        ORG_ID,
        AGENT_ID,
        PRODUCT_ID,
        expect.objectContaining({ id: 'grant-1' }),
      );
    });

    it('denies ACCESS_GRANT_NOT_FOUND when neither cache nor control plane has a grant', async () => {
      grantCache.get.mockReturnValue(undefined);
      internalClient.lookupActiveAccessGrant.mockResolvedValue(null);

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('ACCESS_GRANT_NOT_FOUND');
      // Reference check must not run when grant check fails — order
      // matters because the denial code distinguishes the two cases.
      expect(internalClient.lookupActiveReference).not.toHaveBeenCalled();
    });
  });

  describe('connection-reference state mapping', () => {
    beforeEach(() => {
      grantCache.get.mockReturnValue(makeGrant());
    });

    it('denies CONNECTION_REFERENCE_NOT_FOUND when neither cache nor control plane has a reference', async () => {
      refCache.get.mockReturnValue(undefined);
      internalClient.lookupActiveReference.mockResolvedValue(null);

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('CONNECTION_REFERENCE_NOT_FOUND');
    });

    it('falls back to the control plane on reference cache miss and backfills', async () => {
      refCache.get.mockReturnValue(undefined);
      internalClient.lookupActiveReference.mockResolvedValue(makeReference());

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(true);
      expect(refCache.set).toHaveBeenCalledWith(
        ORG_ID,
        AGENT_ID,
        PRODUCT_ID,
        expect.objectContaining({ id: 'ref-1' }),
      );
    });

    it('denies CONNECTION_REFERENCE_SUSPENDED when reference state is suspended', async () => {
      refCache.get.mockReturnValue(makeReference({ state: 'suspended' }));

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('CONNECTION_REFERENCE_SUSPENDED');
    });

    it.each(['expired', 'revoked'] as const)(
      'denies CONNECTION_REFERENCE_EXPIRED when reference state is %s (umbrella per Decision 3)',
      async (state) => {
        refCache.get.mockReturnValue(makeReference({ state }));

        const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
          product_id: PRODUCT_ID,
        });

        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('unreachable');
        expect(result.code).toBe('CONNECTION_REFERENCE_EXPIRED');
      },
    );

    it('denies CONNECTION_REFERENCE_NOT_FOUND when reference state is pending (defensive — pending should never reach the cache)', async () => {
      refCache.get.mockReturnValue(makeReference({ state: 'pending' }));

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('CONNECTION_REFERENCE_NOT_FOUND');
    });
  });

  describe('scope match integration', () => {
    beforeEach(() => {
      grantCache.get.mockReturnValue(makeGrant());
    });

    it('allows when get_product (discovery port) matches a reference with discovery scope', async () => {
      refCache.get.mockReturnValue(makeReference({ approvedScope: { ports: ['discovery'] } }));

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });
      expect(result).toEqual({ allowed: true, exempt: false });
    });

    it('denies CONNECTION_REFERENCE_SCOPE_VIOLATION when get_trust_score (observability port) is not in approved scope', async () => {
      refCache.get.mockReturnValue(makeReference({ approvedScope: { ports: ['discovery'] } }));

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_trust_score', {
        product_id: PRODUCT_ID,
      });

      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('CONNECTION_REFERENCE_SCOPE_VIOLATION');
    });

    it("allows when the approved scope is the wildcard '*'", async () => {
      refCache.get.mockReturnValue(makeReference({ approvedScope: { ports: ['*'] } }));

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_lineage', {
        product_id: PRODUCT_ID,
      });
      expect(result.allowed).toBe(true);
    });

    it('denies SCOPE_VIOLATION when an active reference somehow has a null approvedScope (defensive)', async () => {
      refCache.get.mockReturnValue(
        makeReference({ approvedScope: null as unknown as { ports: string[] } }),
      );

      const result = await guard.check(ORG_ID, AGENT_ID, 'get_product', {
        product_id: PRODUCT_ID,
      });
      expect(result.allowed).toBe(false);
      if (result.allowed) throw new Error('unreachable');
      expect(result.code).toBe('CONNECTION_REFERENCE_SCOPE_VIOLATION');
    });
  });
});
