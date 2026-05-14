import {
  SCOPE_ENFORCEMENT_ERROR_CODES,
  type ConnectionReference,
  type ScopeEnforcementErrorCode,
} from '@provenance/types';
import { ControlPlaneClient } from '../control-plane/control-plane.client.js';
import type { SessionIdentity } from '../mcp/tools.js';
import { matchesScope, type RequestedAction } from './scope-match.js';

// F12.16 / ADR-006 runtime scope enforcement orchestrator.
//
// Called from the MCP tool dispatcher (apps/agent-query/src/mcp/tools.ts)
// before any product-targeted tool handler runs. Resolves the
// connection reference, checks state and scope, writes a
// scope-violation audit entry on every denial (F12.24), and returns a
// structured decision the caller can turn into an MCP error.
//
// MVP data path: synchronous control-plane lookup on every call.
// ADR-006 § Decision picks an in-memory cache as the primary data
// source; that lands in a follow-on slice. The MVP path is honest to
// NF12.2 at MVP scale (single AQL replica on a t3.medium) and
// trivially correct — every decision sees the current DB state. The
// cache slice swaps the data source behind the same interface.

export type EnforcementDecision =
  | { allow: true; reference: ConnectionReference }
  | { allow: false; code: ScopeEnforcementErrorCode; message: string };

export interface EnforcementInput {
  session: SessionIdentity;
  productId: string;
  toolName: string;
  /** Action shape passed to the scope-match function. */
  action: RequestedAction;
}

export class ScopeEnforcer {
  constructor(private readonly client: ControlPlaneClient) {}

  async enforce(input: EnforcementInput): Promise<EnforcementDecision> {
    const { session, productId, toolName, action } = input;

    let reference: ConnectionReference | null;
    try {
      reference = await this.client.getActiveConnectionReference(productId);
    } catch (err) {
      // Fail closed on any non-404 error — per NF12.6, scope violation
      // detection is preventive, and allowing on enforcement-service
      // failure would defeat that guarantee. We surface this as
      // NOT_FOUND from the agent's perspective because the agent has
      // no way to distinguish "consent doesn't exist" from "we
      // couldn't check whether consent exists" in a useful way.
      // Operators see the underlying error in the AQL logs.
      console.error('[scope-enforcement] Reference lookup failed:', (err as Error).message);
      reference = null;
    }

    if (!reference) {
      const decision: EnforcementDecision = {
        allow: false,
        code: SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_NOT_FOUND,
        message: 'No active connection reference for this agent and product. A human-consented use-case declaration is required before any agent action against this product.',
      };
      await this.writeDenialAudit(session, productId, toolName, action, decision, null);
      return decision;
    }

    // Expired-state guard. The control-plane lookup filters to
    // state='active', so a row that reached expires_at but hasn't yet
    // been transitioned by the (still-deferred) F12.22 expiration
    // workflow would still be returned. Catching expiry here closes
    // that gap until the workflow lands.
    if (new Date(reference.expiresAt).getTime() <= Date.now()) {
      const decision: EnforcementDecision = {
        allow: false,
        code: SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_EXPIRED,
        message: `Connection reference expired at ${reference.expiresAt}. Submit a fresh request to continue.`,
      };
      await this.writeDenialAudit(session, productId, toolName, action, decision, reference);
      return decision;
    }

    const match = matchesScope(reference.approvedScope, action);
    if (!match.matches) {
      const decision: EnforcementDecision = {
        allow: false,
        code: SCOPE_ENFORCEMENT_ERROR_CODES.CONNECTION_REFERENCE_SCOPE_VIOLATION,
        message: `Action falls outside the approved scope of the connection reference: ${match.reason}.`,
      };
      await this.writeDenialAudit(session, productId, toolName, action, decision, reference);
      return decision;
    }

    return { allow: true, reference };
  }

  private async writeDenialAudit(
    session: SessionIdentity,
    productId: string,
    toolName: string,
    action: RequestedAction,
    decision: Exclude<EnforcementDecision, { allow: true }>,
    reference: ConnectionReference | null,
  ): Promise<void> {
    // F12.24 scope-violation logging. The audit row must capture
    // enough to reconstruct the decision from the log alone (F12.23),
    // including the inputs to the match function and the reference
    // identity when one was resolved.
    try {
      await this.client.writeAuditEntry({
        org_id: session.orgId,
        principal_id: session.agentId,
        principal_type: 'ai_agent',
        action: 'mcp_tool_call_denied',
        resource_type: 'connection_reference',
        resource_id: reference?.id ?? null,
        agent_id: session.agentId,
        tool_name: toolName,
        metadata: {
          reason_code: decision.code,
          reason: decision.message,
          product_id: productId,
          requested_action: action,
          approved_scope: reference?.approvedScope ?? null,
          reference_state: reference?.state ?? null,
          reference_expires_at: reference?.expiresAt ?? null,
        },
      });
    } catch (err) {
      // Audit write failure must not block the denial — the denial
      // itself still goes through. Surface for operators.
      console.error('[scope-enforcement] Denial audit write failed:', (err as Error).message);
    }
  }
}
