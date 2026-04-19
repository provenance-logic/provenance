import type { SeedLineageEdge } from '../types.js';

export const seedLineageEdges: SeedLineageEdge[] = [
  {
    fromProductSlug: 'customer-360',
    toProductSlug: 'campaign-attribution',
    edgeType: 'derives_from',
    description: 'Campaign attribution joins customer 360 profiles to touchpoint data to produce per-campaign weights.',
  },
  {
    fromProductSlug: 'inventory-daily',
    toProductSlug: 'supplier-performance',
    edgeType: 'derives_from',
    description: 'Supplier performance rolls up delivery variance observed in the daily inventory snapshot.',
  },
  {
    fromProductSlug: 'revenue-daily',
    toProductSlug: 'forecast-weekly',
    edgeType: 'derives_from',
    description: 'The weekly forecast model trains on daily revenue recognition history.',
  },
  {
    fromProductSlug: 'inventory-daily',
    toProductSlug: 'revenue-daily',
    edgeType: 'depends_on',
    description: 'Revenue recognition reconciles against inventory movement on the same trading day.',
  },
  {
    fromProductSlug: 'customer-360',
    toProductSlug: 'revenue-daily',
    edgeType: 'depends_on',
    description: 'Revenue attribution by customer segment requires customer 360 as a dimension.',
  },
  {
    fromProductSlug: 'kyc-profiles',
    toProductSlug: 'credit-risk-decisions',
    edgeType: 'depends_on',
    description: 'Credit decisions require a verified KYC profile; decisions on non-verified accounts are blocked upstream.',
  },
  {
    fromProductSlug: 'account-lifecycle-events',
    toProductSlug: 'transaction-risk-signals',
    edgeType: 'depends_on',
    description: 'Transaction risk scoring incorporates account age and recent lifecycle state transitions.',
  },
  {
    fromProductSlug: 'transaction-risk-signals',
    toProductSlug: 'credit-risk-decisions',
    edgeType: 'consumes',
    description: 'The daily credit decision batch consumes aggregated transaction risk signals from the prior 30 days.',
  },
];
