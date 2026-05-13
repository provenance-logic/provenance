import { AccessGrantCache } from './access-grant-cache.js';
import type { AccessGrant } from '@provenance/types';

// The access-grant cache is a TTL data structure only — no loader, no
// consumer (per Decision 2 of the Domain 12 implementation plan). The
// guard wiring in PR #5 will populate it via cache-miss fallback when
// the corresponding API endpoint lands. This spec exercises the data
// structure itself; integration coverage waits for PR #5.

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: 'grant-1',
    orgId: 'org-1',
    productId: 'product-1',
    granteePrincipalId: 'agent-1',
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

describe('AccessGrantCache', () => {
  it('returns undefined when no entry exists', () => {
    const cache = new AccessGrantCache();
    expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
  });

  it('returns the stored grant after set', () => {
    const cache = new AccessGrantCache();
    const grant = makeGrant();
    cache.set('org-1', 'agent-1', 'product-1', grant);
    expect(cache.get('org-1', 'agent-1', 'product-1')).toBe(grant);
  });

  it('returns undefined after invalidate', () => {
    const cache = new AccessGrantCache();
    cache.set('org-1', 'agent-1', 'product-1', makeGrant());
    cache.invalidate('org-1', 'agent-1', 'product-1');
    expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
  });

  it('treats expired entries as absent and removes them lazily on read', () => {
    let nowMs = 1_000_000_000;
    const cache = new AccessGrantCache({ ttlMs: 500, now: () => nowMs });
    cache.set('org-1', 'agent-1', 'product-1', makeGrant());
    expect(cache.size()).toBe(1);
    nowMs += 501;
    expect(cache.get('org-1', 'agent-1', 'product-1')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('keys per (org, agent, product) triple — different orgs do not collide', () => {
    const cache = new AccessGrantCache();
    cache.set('org-a', 'agent-1', 'product-1', makeGrant({ id: 'grant-a' }));
    cache.set('org-b', 'agent-1', 'product-1', makeGrant({ id: 'grant-b' }));
    expect(cache.get('org-a', 'agent-1', 'product-1')?.id).toBe('grant-a');
    expect(cache.get('org-b', 'agent-1', 'product-1')?.id).toBe('grant-b');
  });

  it('invalidateAllForOrg removes only the targeted org', () => {
    const cache = new AccessGrantCache();
    cache.set('org-1', 'a1', 'p1', makeGrant());
    cache.set('org-1', 'a2', 'p2', makeGrant());
    cache.set('org-2', 'a1', 'p1', makeGrant());
    expect(cache.invalidateAllForOrg('org-1')).toBe(2);
    expect(cache.get('org-2', 'a1', 'p1')).toBeDefined();
  });
});
