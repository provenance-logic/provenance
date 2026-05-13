import type {
  ConnectionReferenceScope,
  DataCategoryConstraints,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Domain 12 runtime scope-match (Phase 1 step 2 of ADR-006, PR #4 of the
// implementation plan).
//
// Pure structural subset check. Given the approved scope of a connection
// reference and the scope claim of an incoming agent action, decide whether
// the action fits. No I/O. No logging. The guard layer that wraps this
// owns audit-log writes and notification fan-out — see ADR-006 §
// "Enforcement Location" and the Domain 12 implementation plan § 4.
//
// MVP shape per Decision 1 (locked 2026-05-08): ConnectionReferenceScope is
// { ports: string[] } with '*' meaning "all". DataCategoryConstraints is
// { allowed_categories?: string[] }. Absent allowed_categories means no
// category-level narrowing beyond the port list.
// ---------------------------------------------------------------------------

/**
 * Scope claim of an incoming agent action.
 *
 * `port` is matched against the approved scope's `ports` list. For MVP it
 * carries a port-type token (`'discovery'` or `'observability'`) produced
 * by `tool-scope-map.ts`. Named output ports will start appearing here
 * when write tools land in Phase 6+.
 *
 * `dataCategories` is optional. The four read-only MCP tools currently
 * mapped do not declare data categories, so this field is undefined on
 * every MVP request. It is kept on the type because category-level
 * narrowing is the documented next axis of growth.
 */
export interface ActionScope {
  port: string;
  dataCategories?: string[];
}

/** Reason a scope-match failed. Used by the guard to pick the denial code
 *  and to populate the audit-log row. Order matters: port mismatch is
 *  checked first and short-circuits, so a request that fails both port
 *  and category checks reports `port_not_in_approved_scope`. */
export type ScopeMismatchReason =
  | 'port_not_in_approved_scope'
  | 'data_categories_not_in_approved_scope';

export type ScopeMatchResult =
  | { ok: true }
  | { ok: false; reason: ScopeMismatchReason };

/**
 * True iff the action's port and data categories are a subset of the
 * approved scope. The wildcard `'*'` in `approvedScope.ports` matches any
 * action port. Absent or empty `allowed_categories` means the approved
 * scope imposes no category-level narrowing.
 */
export function matchesApprovedScope(
  approvedScope: ConnectionReferenceScope,
  approvedDataCategoryConstraints: DataCategoryConstraints | null,
  action: ActionScope,
): ScopeMatchResult {
  const allowedPorts = approvedScope.ports;
  const portMatches =
    allowedPorts.includes('*') || allowedPorts.includes(action.port);
  if (!portMatches) {
    return { ok: false, reason: 'port_not_in_approved_scope' };
  }

  const allowedCategories = approvedDataCategoryConstraints?.allowed_categories;
  const hasCategoryNarrowing =
    allowedCategories !== undefined && allowedCategories.length > 0;
  const actionDeclaresCategories =
    action.dataCategories !== undefined && action.dataCategories.length > 0;

  if (hasCategoryNarrowing && actionDeclaresCategories) {
    const allowedSet = new Set(allowedCategories);
    const allCovered = action.dataCategories!.every((c) => allowedSet.has(c));
    if (!allCovered) {
      return { ok: false, reason: 'data_categories_not_in_approved_scope' };
    }
  }

  return { ok: true };
}
