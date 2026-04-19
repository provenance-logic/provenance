import type { SeedPolicy } from '../types.js';

export const acmeCorpPolicies: SeedPolicy[] = [
  {
    orgSlug: 'acme-corp',
    policyKey: 'acme.pii-requires-governance-approval',
    title: 'PII access requires governance approval',
    description:
      'Any output port tagged as containing PII requires an explicit access grant approved by a governance role.',
    appliesTo: 'platform',
    regoModule: `package provenance.acme.pii

default allow = false

allow {
  input.resource.type == "port"
  not contains(input.resource.tags, "pii")
}

allow {
  input.resource.type == "port"
  contains(input.resource.tags, "pii")
  input.request.grant.approved_by_role == "governance"
}

contains(arr, x) {
  arr[_] == x
}
`,
  },
  {
    orgSlug: 'acme-corp',
    policyKey: 'acme.supply-chain-autonomous-blocked',
    title: 'Supply chain products blocked from Autonomous agents',
    description:
      'Products in the supply-chain domain cannot be consumed by agents at the Autonomous trust classification.',
    appliesTo: 'domain',
    regoModule: `package provenance.acme.supply_chain

default allow = false

allow {
  input.resource.domain != "supply-chain"
}

allow {
  input.resource.domain == "supply-chain"
  input.principal.type != "ai_agent"
}

allow {
  input.resource.domain == "supply-chain"
  input.principal.type == "ai_agent"
  input.principal.trust_classification != "autonomous"
}
`,
  },
  {
    orgSlug: 'acme-corp',
    policyKey: 'acme.freshness-sla-on-publish',
    title: 'Published products must declare a freshness SLA',
    description: 'Products cannot transition to Published lifecycle state without a declared freshness SLA.',
    appliesTo: 'product',
    regoModule: `package provenance.acme.freshness

default allow = false

allow {
  input.resource.type == "product"
  input.request.action != "publish"
}

allow {
  input.resource.type == "product"
  input.request.action == "publish"
  input.resource.freshness_sla != null
  input.resource.freshness_sla != ""
}
`,
  },
];
