import type { ConnectionReference } from '@provenance/types';

// In-memory connection-reference cache (Domain 12 PR #3; ADR-006
// § "Data Source"). The hot-path read is a Map lookup; the cache is
// kept warm by:
//
//   1. Cold load at AQL boot via the internal control-plane endpoint.
//   2. Redpanda consumer updates on every connection_reference.state
//      event (Active → set, Suspended/Expired/Revoked → invalidate).
//   3. Cache-miss fallback (in PR #5) reads from the control plane and
//      backfills here.
//
// TTL is the consistency safety net — if Redpanda is silent for longer
// than the TTL, the entry expires and the next request re-fetches from
// the control plane. ADR-006 specifies 24h.
//
// MVP is single-replica AQL, so no concurrency primitives are needed.
// Multi-replica scaling is a Phase-6 concern (ADR-006 § "Scale
// Considerations") that may introduce Redis as the shared cache.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedEntry {
  reference: ConnectionReference;
  expiresAt: number; // epoch ms; entry treated as absent once now() > expiresAt
}

export class ConnectionReferenceCache {
  private readonly entries = new Map<string, CachedEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Returns the cached reference for the triple, or undefined when
   * absent or expired. Expired entries are removed lazily on read —
   * there is no background sweeper at MVP scale.
   */
  get(orgId: string, agentId: string, productId: string): ConnectionReference | undefined {
    const key = this.keyFor(orgId, agentId, productId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.reference;
  }

  /**
   * Insert or replace the cached reference for the triple. The TTL
   * resets on every set, so a hot reference does not silently age out
   * mid-conversation.
   */
  set(orgId: string, agentId: string, productId: string, reference: ConnectionReference): void {
    const key = this.keyFor(orgId, agentId, productId);
    this.entries.set(key, {
      reference,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /**
   * Remove the entry for the triple. Called on Suspended, Expired, and
   * Revoked events; also called when a cache-miss fallback returns null.
   */
  invalidate(orgId: string, agentId: string, productId: string): void {
    this.entries.delete(this.keyFor(orgId, agentId, productId));
  }

  /**
   * Remove every entry for the org. Reserved for operator-triggered
   * cache flushes (e.g. when the AQL needs to repopulate without a
   * full restart). Not used by normal state-transition handling.
   */
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

  /**
   * Bulk-load a batch of active references for an org. Called once per
   * org at cold-load time. Each entry gets the full TTL from now,
   * so cold-load and event-driven updates produce indistinguishable
   * cache state.
   */
  loadFromArray(orgId: string, references: readonly ConnectionReference[]): number {
    let loaded = 0;
    for (const reference of references) {
      // The internal endpoint guarantees orgId match, but the cache
      // key is constructed from the passed orgId rather than the
      // reference's orgId — if a stale row from a different org ever
      // sneaks in, we want to log and skip, not key the cache wrong.
      if (reference.orgId !== orgId) {
        continue;
      }
      this.set(orgId, reference.agentId, reference.productId, reference);
      loaded++;
    }
    return loaded;
  }

  /** Current entry count across all orgs. For observability / tests. */
  size(): number {
    return this.entries.size;
  }

  private keyFor(orgId: string, agentId: string, productId: string): string {
    return `${orgId}:${agentId}:${productId}`;
  }
}
