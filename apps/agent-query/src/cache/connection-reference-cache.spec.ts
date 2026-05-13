import { ConnectionReferenceCache } from './connection-reference-cache.js';
import type { ConnectionReference } from '@provenance/types';

function makeReference(overrides: Partial<ConnectionReference> = {}): ConnectionReference {
  return {
    id: 'ref-1',
    orgId: 'org-1',
    agentId: 'agent-1',
    productId: 'product-1',
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

describe('ConnectionReferenceCache', () => {
  describe('basic get/set/invalidate', () => {
    it('returns undefined when no entry exists', () => {
      const cache = new ConnectionReferenceCache();
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
    });

    it('returns the stored reference after set', () => {
      const cache = new ConnectionReferenceCache();
      const ref = makeReference();
      cache.set('org-1', 'agent-1', 'product-1', ref);
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBe(ref);
    });

    it('returns undefined after invalidate', () => {
      const cache = new ConnectionReferenceCache();
      cache.set('org-1', 'agent-1', 'product-1', makeReference());
      cache.invalidate('org-1', 'agent-1', 'product-1');
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
    });

    it('invalidate on a missing entry is a no-op (does not throw)', () => {
      const cache = new ConnectionReferenceCache();
      expect(() => cache.invalidate('org-1', 'agent-1', 'product-1')).not.toThrow();
    });

    it('keys are tuple-based — same agent + product across different orgs do not collide', () => {
      const cache = new ConnectionReferenceCache();
      const refA = makeReference({ id: 'ref-org-a' });
      const refB = makeReference({ id: 'ref-org-b' });
      cache.set('org-a', 'agent-1', 'product-1', refA);
      cache.set('org-b', 'agent-1', 'product-1', refB);
      expect(cache.get('org-a', 'agent-1', 'product-1')?.id).toBe('ref-org-a');
      expect(cache.get('org-b', 'agent-1', 'product-1')?.id).toBe('ref-org-b');
    });
  });

  describe('TTL', () => {
    it('returns undefined once now() passes expiresAt and removes the entry from the map', () => {
      let nowMs = 1_000_000_000;
      const cache = new ConnectionReferenceCache({ ttlMs: 1000, now: () => nowMs });
      cache.set('org-1', 'agent-1', 'product-1', makeReference());
      expect(cache.size()).toBe(1);
      nowMs += 1001;
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it('still returns the entry when now() is exactly at expiresAt (off-by-one safety: only strict > expires)', () => {
      let nowMs = 1_000_000_000;
      const cache = new ConnectionReferenceCache({ ttlMs: 1000, now: () => nowMs });
      cache.set('org-1', 'agent-1', 'product-1', makeReference());
      nowMs += 1000;
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBeDefined();
    });

    it('a set on an existing key resets the TTL', () => {
      let nowMs = 1_000_000_000;
      const cache = new ConnectionReferenceCache({ ttlMs: 1000, now: () => nowMs });
      cache.set('org-1', 'agent-1', 'product-1', makeReference());
      nowMs += 900;
      cache.set('org-1', 'agent-1', 'product-1', makeReference());
      nowMs += 900;
      // 1800ms after original set, but only 900ms after the second set —
      // entry is still alive because TTL reset.
      expect(cache.get('org-1', 'agent-1', 'product-1')).toBeDefined();
    });
  });

  describe('loadFromArray (cold-load)', () => {
    it('loads each reference, returns the count loaded', () => {
      const cache = new ConnectionReferenceCache();
      const refs = [
        makeReference({ id: 'r1', agentId: 'a1', productId: 'p1' }),
        makeReference({ id: 'r2', agentId: 'a1', productId: 'p2' }),
        makeReference({ id: 'r3', agentId: 'a2', productId: 'p1' }),
      ];
      const loaded = cache.loadFromArray('org-1', refs);
      expect(loaded).toBe(3);
      expect(cache.size()).toBe(3);
      expect(cache.get('org-1', 'a1', 'p1')?.id).toBe('r1');
      expect(cache.get('org-1', 'a2', 'p1')?.id).toBe('r3');
    });

    it('skips references whose orgId does not match the caller-supplied orgId', () => {
      const cache = new ConnectionReferenceCache();
      const refs = [
        makeReference({ id: 'r1', orgId: 'org-1' }),
        makeReference({ id: 'r2', orgId: 'org-wrong' }),
      ];
      const loaded = cache.loadFromArray('org-1', refs);
      expect(loaded).toBe(1);
      expect(cache.size()).toBe(1);
    });

    it('returns 0 for an empty array', () => {
      const cache = new ConnectionReferenceCache();
      expect(cache.loadFromArray('org-1', [])).toBe(0);
      expect(cache.size()).toBe(0);
    });
  });

  describe('invalidateAllForOrg', () => {
    it('removes every entry for the org and returns the count', () => {
      const cache = new ConnectionReferenceCache();
      cache.set('org-1', 'a1', 'p1', makeReference());
      cache.set('org-1', 'a2', 'p2', makeReference());
      cache.set('org-2', 'a1', 'p1', makeReference());

      const removed = cache.invalidateAllForOrg('org-1');

      expect(removed).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.get('org-2', 'a1', 'p1')).toBeDefined();
    });

    it('returns 0 when the org has no entries', () => {
      const cache = new ConnectionReferenceCache();
      expect(cache.invalidateAllForOrg('org-1')).toBe(0);
    });

    // Defends against a key-prefix bug — if invalidateAllForOrg('org-1')
    // matched 'org-10:...' too, we'd silently wipe unrelated entries.
    // The colon separator guarantees this works correctly.
    it("does not match orgs whose ID is a prefix of the requested org's ID", () => {
      const cache = new ConnectionReferenceCache();
      cache.set('org-1', 'a1', 'p1', makeReference());
      cache.set('org-10', 'a1', 'p1', makeReference());
      cache.invalidateAllForOrg('org-1');
      // org-10 must survive.
      expect(cache.get('org-10', 'a1', 'p1')).toBeDefined();
    });
  });
});
