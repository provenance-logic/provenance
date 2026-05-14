import type { ConnectionReferenceScope } from '@provenance/types';

// F12.16 / ADR-006 scope match function.
//
// Pure structural subset check, not a policy evaluation. ADR-006
// explicitly rejected expressing this in Rego — it is platform
// behavior, not governance-authored policy. The function is shaped to
// be extensible: today's MCP tools target a product as a whole, so
// only the `ports` dimension carries meaningful constraints; richer
// dimensions (data_categories, operations) land alongside the tool
// surfaces that emit them.
//
// The match rule from ADR-006:
//   action.port ∈ declared.ports
//   AND action.data_categories ⊆ declared.data_categories
//   AND action.type compatible with declared.use_case_category
//
// At this slice we evaluate only the first clause when the action
// declares a port; otherwise the call is treated as covered by the
// reference's mere existence (the existence-and-state check still
// runs in the enforcement orchestrator). Each clause's behavior is
// documented inline so future extensions can be added without
// breaking the audit story.

/**
 * Shape of the action surface the agent is requesting authorization
 * for. All fields are optional because the current MCP tool surfaces
 * carry only a subset of them; the function treats omitted fields as
 * "no constraint to check on this dimension."
 */
export interface RequestedAction {
  /** Target port identifier on the product, if the tool addresses a port. */
  port?: string;
  /** Data category identifiers the action will read, if known. */
  dataCategories?: string[];
  /** Free-form action type — currently informational only. */
  actionType?: string;
}

export type ScopeMatchResult =
  | { matches: true }
  | { matches: false; reason: string };

/**
 * Read a string array from an opaque ConnectionReferenceScope. The
 * scope type is intentionally Record<string, unknown> until F12.6
 * locks the schema; this helper does the narrow runtime check
 * needed for the subset rule.
 */
function readStringArray(scope: ConnectionReferenceScope, key: string): string[] | null {
  const value = (scope as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}

export function matchesScope(
  approvedScope: ConnectionReferenceScope | null,
  action: RequestedAction,
): ScopeMatchResult {
  // A reference with no approved scope at all cannot grant any
  // narrower action — fail closed. This should not occur on `active`
  // references (approval sets approvedScope), but the type allows it
  // and the guard is the wrong place to trust invariants set
  // elsewhere.
  if (!approvedScope) {
    return { matches: false, reason: 'reference has no approved scope' };
  }

  if (action.port !== undefined) {
    const allowedPorts = readStringArray(approvedScope, 'ports');
    if (allowedPorts === null || allowedPorts.length === 0) {
      return {
        matches: false,
        reason: `action targets port "${action.port}" but reference declares no ports`,
      };
    }
    if (!allowedPorts.includes(action.port)) {
      return {
        matches: false,
        reason: `port "${action.port}" not in approved ports [${allowedPorts.join(', ')}]`,
      };
    }
  }

  if (action.dataCategories !== undefined && action.dataCategories.length > 0) {
    const allowedCategories = readStringArray(approvedScope, 'data_categories');
    // When the reference does not declare data_categories at all, the
    // approval implicitly covers all categories — only narrow when the
    // approver explicitly bounded the set.
    if (allowedCategories !== null) {
      const overrun = action.dataCategories.filter((c) => !allowedCategories.includes(c));
      if (overrun.length > 0) {
        return {
          matches: false,
          reason: `data categories [${overrun.join(', ')}] not in approved set [${allowedCategories.join(', ')}]`,
        };
      }
    }
  }

  // action.actionType is currently informational — the use-case
  // category compatibility table lives with the governance-configurable
  // taxonomy (F12.6) which has not yet shipped. When it does, the
  // check goes here; today, presence of an active reference for the
  // (agent, product) pair is taken to authorize the action type.

  return { matches: true };
}
