import type { SeedAccessRequest, SeedAccessGrant } from '../types.js';

export const betaIndustriesAccessRequests: SeedAccessRequest[] = [
  {
    productSlug: 'credit-risk-decisions',
    requesterEmail: 'analyst@beta.example.com',
    justification:
      'Supporting the quarterly model risk review. Need decision-level rationale to spot-check 50 randomly sampled approvals and denials.',
    status: 'pending',
    submittedDaysAgo: 1,
  },
  {
    productSlug: 'kyc-profiles',
    requesterEmail: 'analyst@beta.example.com',
    justification:
      'Building a one-off cohort report for the regulator. Hashed identifier columns only — no raw PII required.',
    status: 'approved',
    submittedDaysAgo: 7,
    resolvedDaysAgo: 6,
    resolverEmail: 'customer-lead@beta.example.com',
    resolutionNote: 'Approved for the regulator engagement; expires in 60 days.',
  },
];

export const betaIndustriesAccessGrants: SeedAccessGrant[] = [
  {
    productSlug: 'kyc-profiles',
    granteeEmail: 'analyst@beta.example.com',
    grantedByEmail: 'customer-lead@beta.example.com',
    grantedDaysAgo: 6,
    expiresInDays: 54,
  },
  {
    productSlug: 'transaction-risk-signals',
    granteeEmail: 'analyst@beta.example.com',
    grantedByEmail: 'risk-lead@beta.example.com',
    grantedDaysAgo: 14,
    expiresInDays: 76,
  },
  {
    productSlug: 'kyc-profiles',
    granteeEmail: 'risk-lead@beta.example.com',
    grantedByEmail: 'customer-lead@beta.example.com',
    grantedDaysAgo: 90,
    expiresInDays: 5,
  },
];
