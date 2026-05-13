import type { AccessGrant } from '@provenance/types';

// In-memory access-grant cache (Domain 12 PR #3).
//
// Per the implementation plan's Decision 2 (locked 2026-05-08), Domain 12
// runtime enforcement requires both an active access grant AND an active
// connection reference. Two caches at the AQL — this is the access-grant
// half. Unlike the connection-reference cache, access-grant state changes
// do NOT propagate through Redpanda (the plan considered and rejected a
// dedicated topic for MVP). Population is:
//
//   * Cache-miss fallback via the control plane.
//   * TTL eviction (default 24h) bounds staleness when a grant is
//     revoked between cache writes.
//
// The cache-miss fallback and its API-side endpoint are deferred to PR #5
// (the guard wiring) — this PR adds the data structure only. The guard
// reads from this cache once it lands; until then nothing populates or
// reads it. Same TTL safety net as the connection-reference cache.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedEntry {
  grant: AccessGrant;
  expiresAt: number;
}

export class AccessGrantCache {
  private readonly entries = new Map<string, CachedEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns the cached grant for the triple, or undefined when absent
   * or expired. Lazy expiration on read; no background sweeper at MVP
   * scale.
   */
  get(orgId: string, agentId: string, productId: string): AccessGrant | undefined {
    const key = this.keyFor(orgId, agentId, productId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.grant;
  }

  /**
   * Insert or replace the cached grant for the triple. TTL resets on
   * every set so a hot grant does not silently age out mid-conversation.
   */
  set(orgId: string, agentId: string, productId: string, grant: AccessGrant): void {
    const key = this.keyFor(orgId, agentId, productId);
    this.entries.set(key, {
      grant,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /** Remove the entry for the triple. */
  invalidate(orgId: string, agentId: string, productId: string): void {
    this.entries.delete(this.keyFor(orgId, agentId, productId));
  }

  /** Remove every entry for the org. */
  invalidateAllForOrg(orgId: string): number {
    const prefix = `${orgId}:`;
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Current entry count. For observability / tests. */
  size(): number {
    return this.entries.size;
  }

  private keyFor(orgId: string, agentId: string, productId: string): string {
    return `${orgId}:${agentId}:${productId}`;
  }
}
