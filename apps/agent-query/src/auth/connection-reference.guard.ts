import type { ConnectionReferenceCache } from '../cache/connection-reference-cache.js';
import type { AccessGrantCache } from '../cache/access-grant-cache.js';
import type { InternalControlPlaneClient } from '../control-plane/internal-control-plane.client.js';
import { lookupToolScope } from './tool-scope-map.js';
import { matchesApprovedScope } from './scope-match.js';

// ---------------------------------------------------------------------------
// Domain 12 connection-reference guard (PR #5b; ADR-006).
//
// Decision algorithm per the implementation plan's Decision 3:
//
//   1. Tool lookup. Exempt → allow. Unknown → deny (UNKNOWN_TOOL safety
//      belt; a newly added MCP tool that has not been mapped cannot
//      slip past enforcement by accident).
//
//   2. Access grant check. Cache → control-plane fallback. Absent →
//      ACCESS_GRANT_NOT_FOUND.
//
//   3. Connection-reference existence + state. Cache → control-plane
//      fallback. The lookup endpoint only returns rows in `active`
//      state, so anything else is a defensive branch:
//        * absent → CONNECTION_REFERENCE_NOT_FOUND
//        * state 'suspended' → CONNECTION_REFERENCE_SUSPENDED (signals
//          "wait, re-approval pending")
//        * state 'expired' or 'revoked' → CONNECTION_REFERENCE_EXPIRED
//          (umbrella per Decision 3 — both share the agent-developer
//          action path of "submit fresh")
//
//   4. Scope match. Action's required port + data categories must be a
//      subset of the approved scope. Mismatch →
//      CONNECTION_REFERENCE_SCOPE_VIOLATION.
//
// All denials write an audit-log entry. Scope-violation denials
// additionally fire a notification to the owning principal and
// governance role — that wiring lands in PR #5c; for now the guard
// returns the decision and the caller decides what side-effects fire.
//
// The guard itself does NOT consult the
// CONNECTION_REFERENCE_ENFORCEMENT_ENABLED flag — it always returns
// the truth of the check. The MCP tool wrapper in tools.ts gates the
// actual user-facing block on the flag. This separation keeps the
// guard pure and lets us audit shadow-mode would-be denials with the
// same code path as enforcement-mode real denials.
// ---------------------------------------------------------------------------

export type GuardDenyCode =
  | 'ACCESS_GRANT_NOT_FOUND'
  | 'CONNECTION_REFERENCE_NOT_FOUND'
  | 'CONNECTION_REFERENCE_SUSPENDED'
  | 'CONNECTION_REFERENCE_EXPIRED'
  | 'CONNECTION_REFERENCE_SCOPE_VIOLATION'
  | 'UNKNOWN_TOOL';

export type GuardDecision =
  | { allowed: true; exempt: boolean }
  | { allowed: false; code: GuardDenyCode; reason: string };

export class ConnectionReferenceGuard {
  constructor(
    private readonly referenceCache: ConnectionReferenceCache,
    private readonly grantCache: AccessGrantCache,
    private readonly internalClient: InternalControlPlaneClient,
  ) {}

  async check(
    orgId: string,
    agentId: string,
    toolName: string,
    args: Record<string, string>,
  ): Promise<GuardDecision> {
    const tool = lookupToolScope(toolName);

    if (tool.unknown) {
      return {
        allowed: false,
        code: 'UNKNOWN_TOOL',
        reason: `Tool '${toolName}' is not in the connection-reference scope map; treating as deny-by-default per Decision 4 safety belt`,
      };
    }
    if (tool.exempt) {
      return { allowed: true, exempt: true };
    }

    // Product-bound from here on. Every mapped product-bound tool
    // declares product_id as required input, so this is also a
    // defensive check.
    const productId = args.product_id;
    if (!productId || productId.length === 0) {
      return {
        allowed: false,
        code: 'UNKNOWN_TOOL',
        reason: `Tool '${toolName}' is product-bound but no product_id was supplied`,
      };
    }

    // 1. Access grant.
    const grant = await this.resolveGrant(orgId, agentId, productId);
    if (!grant) {
      return {
        allowed: false,
        code: 'ACCESS_GRANT_NOT_FOUND',
        reason: `No active access grant for agent ${agentId} on product ${productId}`,
      };
    }

    // 2. Connection reference existence + state.
    const reference = await this.resolveReference(orgId, agentId, productId);
    if (!reference) {
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_NOT_FOUND',
        reason: `No active connection reference for agent ${agentId} on product ${productId}`,
      };
    }
    if (reference.state === 'suspended') {
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_SUSPENDED',
        reason: 'Connection reference is suspended; wait for owner re-approval',
      };
    }
    if (reference.state === 'expired' || reference.state === 'revoked') {
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_EXPIRED',
        reason: `Connection reference is ${reference.state}; submit a new request`,
      };
    }
    if (reference.state !== 'active') {
      // Pending references should never reach the cache (the consumer
      // ignores Pending events and the lookup endpoint filters by
      // state='active'). Defensive deny.
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_NOT_FOUND',
        reason: `Connection reference state '${reference.state}' is not usable`,
      };
    }

    // 3. Scope match. An active reference must have approvedScope —
    // ConsentService writes both columns at activation time. If
    // somehow null, treat as scope violation (deny rather than allow).
    if (!reference.approvedScope) {
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_SCOPE_VIOLATION',
        reason: 'Active connection reference has no approved scope on record',
      };
    }
    const match = matchesApprovedScope(
      reference.approvedScope,
      reference.approvedDataCategoryConstraints,
      tool.actionScope,
    );
    if (!match.ok) {
      return {
        allowed: false,
        code: 'CONNECTION_REFERENCE_SCOPE_VIOLATION',
        reason: `Action requires port '${tool.actionScope.port}'; not covered by approved scope (${match.reason})`,
      };
    }

    return { allowed: true, exempt: false };
  }

  private async resolveGrant(
    orgId: string,
    agentId: string,
    productId: string,
  ): Promise<unknown | null> {
    const cached = this.grantCache.get(orgId, agentId, productId);
    if (cached) return cached;
    const loaded = await this.internalClient.lookupActiveAccessGrant(
      orgId,
      agentId,
      productId,
    );
    if (loaded) {
      this.grantCache.set(orgId, agentId, productId, loaded);
    }
    return loaded;
  }

  private async resolveReference(
    orgId: string,
    agentId: string,
    productId: string,
  ): Promise<ReturnType<ConnectionReferenceCache['get']>> {
    const cached = this.referenceCache.get(orgId, agentId, productId);
    if (cached) return cached;
    const loaded = await this.internalClient.lookupActiveReference(
      orgId,
      agentId,
      productId,
    );
    if (loaded) {
      this.referenceCache.set(orgId, agentId, productId, loaded);
      return loaded;
    }
    return undefined;
  }
}
