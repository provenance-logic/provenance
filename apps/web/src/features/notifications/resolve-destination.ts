// Notification trigger services in the API emit deep links that point at
// route patterns the frontend does not (yet) implement — e.g. dedicated
// access-request detail pages, admin/connectors pages, per-product
// compliance/observability pages. Until those pages land, route those
// links to the closest existing destination so clicking a notification
// never white-screens.
//
// The mapping is intentionally pattern-based and explicit. When a real
// detail page lands, drop the entry — direct deepLinks then pass through.

const PASSTHROUGH_PREFIXES = [
  '/dashboard',
  '/onboarding',
  '/marketplace',
  '/governance',
  '/agents',
  '/notifications',
  '/access-requests',
];

interface RewriteRule {
  match: (path: string) => boolean;
  to: string;
}

const REWRITES: RewriteRule[] = [
  // Approver-side access-request landing (per-product fixture pattern from
  // older seed notifications — `/publishing/<slug>/access-requests`). Route
  // to the Pending Requests page; the user can find the specific request
  // there. Drop this rule once the seed notification format is harmonized.
  { match: (p) => /^\/publishing\/[^/]+\/access-requests$/.test(p),  to: '/access-requests' },
  // Per-request approver landing (emitted by the live trigger at
  // `access.service.ts:477` — `/access/requests/<id>`). Route to the
  // Pending Requests page; productId-level filtering is on the page itself.
  { match: (p) => p.startsWith('/access/requests/'),               to: '/access-requests' },
  // Approver-side SLA review for governance — still routes to /governance
  // until a dedicated SLA queue page exists.
  { match: (p) => p.startsWith('/governance/access-requests/'),    to: '/governance' },
  // Product detail by id-only — the actual route is
  // /marketplace/:orgId/:productId, which the trigger doesn't have orgId
  // for. Land on the marketplace list rather than 404.
  { match: (p) => p.startsWith('/marketplace/products/'),          to: '/marketplace' },
  // Per-product compliance — closest existing page is the compliance
  // monitor.
  { match: (p) => /^\/products\/[^/]+\/compliance/.test(p),         to: '/governance/compliance' },
  // Per-product observability — no dedicated page yet.
  { match: (p) => /^\/products\/[^/]+\/observability/.test(p),     to: '/notifications' },
  // Other /products/:id/* deep links have no detail page.
  { match: (p) => /^\/products\/[^/]+/.test(p),                     to: '/notifications' },
  // Admin surfaces (connectors, agents, consent) have no UI yet.
  { match: (p) => p.startsWith('/admin/'),                          to: '/notifications' },
];

export function resolveNotificationDestination(deepLink: string): string {
  if (!deepLink || !deepLink.startsWith('/')) {
    return '/notifications';
  }

  // Strip query string for matching but preserve it on passthrough.
  const [path] = deepLink.split('?');

  for (const rule of REWRITES) {
    if (rule.match(path)) return rule.to;
  }

  if (PASSTHROUGH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return deepLink;
  }

  return '/notifications';
}
