import type { SeedAccessRequest, SeedAccessGrant } from '../types.js';

export const acmeCorpAccessRequests: SeedAccessRequest[] = [
  {
    productSlug: 'forecast-weekly',
    requesterEmail: 'analyst@acme.example.com',
    justification:
      'Comparing weekly forecast accuracy against actuals for the Q3 planning review. Read-only access to the published forecast suffices.',
    status: 'pending',
    submittedDaysAgo: 2,
  },
  {
    productSlug: 'revenue-daily',
    requesterEmail: 'supply-lead@acme.example.com',
    justification:
      'Supply chain needs to reconcile inventory write-offs against daily revenue postings to investigate the May 14 variance.',
    status: 'pending',
    submittedDaysAgo: 5,
  },
  {
    productSlug: 'inventory-daily',
    requesterEmail: 'analyst@acme.example.com',
    justification:
      'Looking for a per-SKU drilldown for an exploratory dashboard.',
    status: 'denied',
    submittedDaysAgo: 12,
    resolvedDaysAgo: 10,
    resolverEmail: 'supply-lead@acme.example.com',
    resolutionNote:
      'Inventory daily contains commercially sensitive supplier-level fields. Use the public Supplier Performance product instead.',
  },
];

export const acmeCorpAccessGrants: SeedAccessGrant[] = [
  {
    productSlug: 'revenue-daily',
    granteeEmail: 'analyst@acme.example.com',
    grantedByEmail: 'finance-lead@acme.example.com',
    grantedDaysAgo: 14,
    expiresInDays: 76,
  },
  {
    productSlug: 'customer-360',
    granteeEmail: 'analyst@acme.example.com',
    grantedByEmail: 'marketing-lead@acme.example.com',
    grantedDaysAgo: 30,
    expiresInDays: 30,
  },
  {
    productSlug: 'revenue-daily',
    granteeEmail: 'marketing-lead@acme.example.com',
    grantedByEmail: 'finance-lead@acme.example.com',
    grantedDaysAgo: 60,
    expiresInDays: 120,
  },
  {
    productSlug: 'supplier-performance',
    granteeEmail: 'analyst@acme.example.com',
    grantedByEmail: 'supply-lead@acme.example.com',
    grantedDaysAgo: 5,
    expiresInDays: 7,
  },
];
