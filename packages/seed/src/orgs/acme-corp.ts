import type { SeedOrg } from '../types.js';

export const acmeCorp: SeedOrg = {
  slug: 'acme-corp',
  name: 'Acme Corporation',
  description:
    'A global consumer goods manufacturer using Provenance to coordinate data products across marketing, supply chain, and finance domains.',
  contactEmail: 'platform@acme.example.com',
  domains: [
    {
      slug: 'marketing',
      name: 'Marketing',
      description: 'Customer, campaign, and attribution data products.',
      ownerEmail: 'marketing-lead@acme.example.com',
    },
    {
      slug: 'supply-chain',
      name: 'Supply Chain',
      description: 'Inventory, supplier performance, and logistics data products.',
      ownerEmail: 'supply-lead@acme.example.com',
    },
    {
      slug: 'finance',
      name: 'Finance',
      description: 'Revenue, forecasting, and compliance data products.',
      ownerEmail: 'finance-lead@acme.example.com',
    },
  ],
};
