import type { ActionScope } from './scope-match.js';

// ---------------------------------------------------------------------------
// Domain 12 action-to-scope mapping for MCP tools (PR #4 of the runtime-
// enforcement implementation plan; Decision 4 locked 2026-05-08).
//
// Five of the nine MCP tools are exempt from connection-reference checks —
// they are either global discovery (list_products, search_products,
// semantic_search) or agent-self operations (register_agent,
// get_agent_status). The remaining four are product-bound and each requires
// access to either the `discovery` port or the `observability` port:
//
//   Discovery     = "what does this product look like" (metadata, lineage)
//   Observability = "how is this product doing" (trust, SLOs)
//
// Reconciliation note (flagged 2026-05-13 in the PR opening this map).
// Decision 1 of the implementation plan says `ConnectionReferenceScope.ports`
// carries *port names* with the wildcard `'*'` meaning "all output ports".
// Decision 4 maps tools to the port *types* `'discovery'` and
// `'observability'`. The locked MVP reconciliation is that the `ports`
// array accepts EITHER a named port OR a port-type token. For the nine
// read-only MCP tools shipped today this map only emits type tokens, so
// every MVP request matches a type-token entry in the approver's consent.
// Named output ports start appearing when write tools land in Phase 6+;
// those will be added to this map at that time and the action-port
// produced will be the named port. The approval UI built later in this
// arc must render both type-token consent ("Discovery access") and
// named-port consent ("Output port: events_v1") to match this shape.
// ---------------------------------------------------------------------------

/**
 * Tools that do not require a connection-reference check. The set is
 * listed explicitly so reviewers can audit the exempt list by name
 * rather than by negation against a larger registry.
 */
export const EXEMPT_TOOLS: ReadonlySet<string> = new Set<string>([
  'list_products',
  'search_products',
  'semantic_search',
  'register_agent',
  'get_agent_status',
]);

/**
 * Product-bound tools and the port-type token each one needs. See the
 * reconciliation note above for why type tokens (not named ports) are
 * what land here in MVP.
 */
const PRODUCT_BOUND_TOOLS: Readonly<Record<string, ActionScope>> = Object.freeze({
  get_product: { port: 'discovery' },
  get_lineage: { port: 'discovery' },
  get_trust_score: { port: 'observability' },
  get_slo_summary: { port: 'observability' },
});

/**
 * Result of looking up a tool by name.
 *
 * - `exempt: true` — the tool runs without a connection-reference check.
 * - `exempt: false, actionScope: {...}` — the tool is product-bound and
 *   the guard must verify the action scope fits the approved scope.
 * - `exempt: false, unknown: true` — the tool is not in the map. The
 *   guard treats unknown tools as require-check with no resolvable
 *   port, which means the request will deny by default. This is a
 *   safety belt against a newly added MCP tool silently bypassing
 *   enforcement because somebody forgot to update this map.
 */
export type ToolScopeLookup =
  | { exempt: true; unknown: false }
  | { exempt: false; actionScope: ActionScope; unknown: false }
  | { exempt: false; unknown: true };

/**
 * Look up the connection-reference-check status of an MCP tool by name.
 */
export function lookupToolScope(toolName: string): ToolScopeLookup {
  if (EXEMPT_TOOLS.has(toolName)) {
    return { exempt: true, unknown: false };
  }
  const bound = PRODUCT_BOUND_TOOLS[toolName];
  if (bound !== undefined) {
    return { exempt: false, actionScope: bound, unknown: false };
  }
  return { exempt: false, unknown: true };
}
