import type { SeedOrg } from '../types.js';

export const betaIndustries: SeedOrg = {
  slug: 'beta-industries',
  name: 'Beta Industries',
  description:
    'A fintech platform using Provenance to expose data products to regulated consumers and internal AI agents.',
  contactEmail: 'platform@beta.example.com',
  domains: [
    {
      slug: 'risk',
      name: 'Risk',
      description: 'Credit risk, transaction risk, and fraud signal data products.',
      ownerEmail: 'risk-lead@beta.example.com',
    },
    {
      slug: 'customer',
      name: 'Customer',
      description: 'KYC profiles, account metadata, and lifecycle data products.',
      ownerEmail: 'customer-lead@beta.example.com',
    },
  ],
};
