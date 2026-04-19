import type { SeedPolicy } from '../types.js';

export const betaIndustriesPolicies: SeedPolicy[] = [
  {
    orgSlug: 'beta-industries',
    policyKey: 'beta.pci-scope-isolation',
    title: 'PCI-scoped ports require PCI-cleared principals',
    description:
      'Output ports tagged as in-PCI-scope can only be consumed by principals with a pci_cleared attribute set to true.',
    appliesTo: 'platform',
    regoModule: `package provenance.beta.pci

default allow = false

allow {
  not contains(input.resource.tags, "pci-scope")
}

allow {
  contains(input.resource.tags, "pci-scope")
  input.principal.attributes.pci_cleared == true
}

contains(arr, x) {
  arr[_] == x
}
`,
  },
  {
    orgSlug: 'beta-industries',
    policyKey: 'beta.risk-domain-observed-only',
    title: 'Risk domain readable only by Observed agents by default',
    description:
      'Risk domain products require Observed classification or higher — Supervised or Autonomous require governance grant.',
    appliesTo: 'domain',
    regoModule: `package provenance.beta.risk_domain

default allow = false

allow {
  input.resource.domain != "risk"
}

allow {
  input.resource.domain == "risk"
  input.principal.type == "ai_agent"
  input.principal.trust_classification == "observed"
}

allow {
  input.resource.domain == "risk"
  input.principal.type == "ai_agent"
  input.principal.trust_classification != "observed"
  input.request.grant.approved_by_role == "governance"
}

allow {
  input.resource.domain == "risk"
  input.principal.type != "ai_agent"
}
`,
  },
  {
    orgSlug: 'beta-industries',
    policyKey: 'beta.kyc-retention-90d',
    title: 'KYC data retention capped at 90 days in output ports',
    description:
      'KYC-tagged output ports must not expose rows older than 90 days.',
    appliesTo: 'product',
    regoModule: `package provenance.beta.kyc_retention

default allow = false

allow {
  not contains(input.resource.tags, "kyc")
}

allow {
  contains(input.resource.tags, "kyc")
  input.resource.retention_days <= 90
}

contains(arr, x) {
  arr[_] == x
}
`,
  },
];
