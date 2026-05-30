import type { SeedConnectionReference } from '../types.js';

// Marketing Copilot — broad scope (discovery + observability) so the full
// product-bound MCP tool surface works against both products: get_product,
// get_lineage, get_trust_score, get_slo_summary all in scope. Pairs with the
// agent grants in access/acme-corp-access.ts (both required per Domain 12).
export const acmeCorpConnectionRefs: SeedConnectionReference[] = [
  {
    agentSlug: 'acme-marketing-copilot',
    productSlug: 'customer-360',
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration:
      'Answer marketing-team questions about customer segments, lifetime value, and churn signals against the Customer 360 product. Read-only access scoped to discovery + observability ports — needed for metadata, lineage context, and trust-signal disclosure when the copilot summarises product health back to the analyst.',
    approverEmail: 'marketing-lead@acme.example.com',
    approvedScope: { ports: ['discovery', 'observability'] },
    requestedDurationDays: 180,
    requestedDaysAgo: 25,
  },
  {
    agentSlug: 'acme-marketing-copilot',
    productSlug: 'revenue-daily',
    useCaseCategory: 'Reporting and Analytics',
    purposeElaboration:
      'Cross-reference daily revenue trends with campaign attribution when answering marketing-attribution questions. Scope is discovery + observability — needed so the copilot can surface trust-score and SLO context when revenue-daily appears as an upstream in a Customer 360 lineage answer.',
    approverEmail: 'finance-lead@acme.example.com',
    approvedScope: { ports: ['discovery', 'observability'] },
    requestedDurationDays: 90,
    requestedDaysAgo: 18,
  },
];
