// Seed notification deep links are authored in a human-friendly, slug-based
// form (e.g. `/marketplace/revenue-daily/trust`, `/agents/acme-marketing-copilot`)
// so the data files in this package stay readable and stable across reseeds.
//
// The actual frontend routes, however, are UUID-based:
//   - product detail   -> /marketplace/:orgId/:productId
//   - agent detail      -> /agents/:agentId
//   - approver landing  -> /access-requests
//
// Posting the authored slug links verbatim is a bug: the router happily binds
// `:orgId`/`:productId` to the slug segments, and the get-product API then
// rejects the non-UUID value with `invalid input syntax for type uuid` -> HTTP
// 500 (the finance-lead "trust score" notification ISE). Single-segment and
// agent-slug links mis-route to NotFound.
//
// This resolver runs at seed time — after products and agents exist, so their
// real UUIDs are known — and rewrites each authored deep link to a concrete,
// valid route. The frontend `resolveNotificationDestination` safety net still
// exists, but stored links are now correct regardless of it.
//
// Unknown slugs degrade gracefully (warn + land on the relevant list page)
// rather than emitting a link that 500s or white-screens.

export interface DeepLinkRouteMaps {
  /** product slug -> `/marketplace/<orgId>/<productId>` */
  productRouteBySlug: Map<string, string>;
  /** agent slug -> `/agents/<agentId>` */
  agentRouteBySlug: Map<string, string>;
}

/**
 * Translate a single authored seed deep link into a concrete frontend route.
 * Pure and side-effect free apart from the optional `warn` callback.
 */
export function resolveSeedDeepLink(
  rawDeepLink: string,
  maps: DeepLinkRouteMaps,
  warn: (msg: string) => void = () => {},
): string {
  if (!rawDeepLink || !rawDeepLink.startsWith('/')) return rawDeepLink;

  const [path, query] = rawDeepLink.split('?');
  const withQuery = (route: string) => (query ? `${route}?${query}` : route);

  // Drop leading slash, split into non-empty segments.
  const segments = path.split('/').filter((s) => s.length > 0);

  const productRoute = (slug: string, fallback: string): string => {
    const route = maps.productRouteBySlug.get(slug);
    if (route) return route;
    warn(`seed deep link references unknown product slug "${slug}" (${rawDeepLink}); routing to ${fallback}`);
    return fallback;
  };
  const agentRoute = (slug: string, fallback: string): string => {
    const route = maps.agentRouteBySlug.get(slug);
    if (route) return route;
    warn(`seed deep link references unknown agent slug "${slug}" (${rawDeepLink}); routing to ${fallback}`);
    return fallback;
  };

  // /marketplace/<productSlug>  and  /marketplace/<productSlug>/<tab>
  // (the product detail page selects tabs via component state, not the URL,
  // so any trailing tab segment like `trust` is dropped — it would otherwise
  // make the route a 3-segment NotFound).
  if (segments[0] === 'marketplace' && segments.length >= 2 && segments.length <= 3) {
    return withQuery(productRoute(segments[1], '/marketplace'));
  }

  // /agents/<agentSlug>  and  /agents/<agentSlug>/<sub>
  // (no per-agent sub-routes like connection-references exist yet; land on
  // the agent detail page).
  if (segments[0] === 'agents' && segments.length >= 2 && segments.length <= 3) {
    return withQuery(agentRoute(segments[1], '/agents'));
  }

  // /publishing/<productSlug>/access-requests -> approver Pending Requests page.
  if (segments[0] === 'publishing' && segments[2] === 'access-requests') {
    return withQuery('/access-requests');
  }

  // /publishing/<productSlug>/observability -> product detail (SLO/observability
  // lives in a tab there); no standalone observability page exists.
  if (segments[0] === 'publishing' && segments[2] === 'observability') {
    return withQuery(productRoute(segments[1], '/notifications'));
  }

  // Everything else (e.g. /governance/compliance, /access-requests) is already
  // a real route — pass through unchanged.
  return rawDeepLink;
}
