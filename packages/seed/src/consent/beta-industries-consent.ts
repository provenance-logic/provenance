import type { SeedConnectionReference } from '../types.js';

// Risk Assistant — tight scope (discovery ONLY, not observability). Drives
// the CONNECTION_REFERENCE_SCOPE_VIOLATION demo: get_product and get_lineage
// on credit-risk-decisions succeed (discovery in scope), get_trust_score and
// get_slo_summary on the same product deny with SCOPE_VIOLATION (observability
// out of scope) — same product, different tool, different port. Shorter
// 30-day duration matches the Restricted-classification F12 default max.
export const betaIndustriesConnectionRefs: SeedConnectionReference[] = [
  {
    agentSlug: 'beta-risk-assistant',
    productSlug: 'credit-risk-decisions',
    useCaseCategory: 'Audit and Compliance',
    purposeElaboration:
      'Surface credit-decision metadata to compliance analysts reviewing model explainability artifacts. Scope is intentionally narrow: discovery only (metadata, lineage), not observability (trust score, SLOs) — those signals are governance-team-only under the beta.risk-domain-observed-only policy boundary, which holds this agent at Observed and restricts the kinds of signals it can surface outside the risk domain.',
    approverEmail: 'compliance@beta.example.com',
    approvedScope: { ports: ['discovery'] },
    requestedDurationDays: 30,
    requestedDaysAgo: 10,
  },
];
