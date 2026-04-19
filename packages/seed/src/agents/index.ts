import type { SeedAgent } from '../types.js';

export const seedAgents: SeedAgent[] = [
  {
    agentSlug: 'acme-marketing-copilot',
    displayName: 'Marketing Copilot',
    orgSlug: 'acme-corp',
    description:
      'An agent that answers marketing analyst questions about customer behaviour and campaign performance via MCP.',
    trustClassification: 'observed',
    oversightContactEmail: 'marketing-lead@acme.example.com',
  },
  {
    agentSlug: 'beta-risk-assistant',
    displayName: 'Risk Assistant',
    orgSlug: 'beta-industries',
    description:
      'An agent that surfaces risk-domain signals to compliance analysts. Held at Observed by default per beta.risk-domain-observed-only policy.',
    trustClassification: 'observed',
    oversightContactEmail: 'compliance@beta.example.com',
  },
];
