import type { SeedNotification } from '../types.js';

export const betaIndustriesNotifications: SeedNotification[] = [
  // analyst@beta — has approved grants.
  {
    recipientEmail: 'analyst@beta.example.com',
    category: 'access_request_approved',
    payload: {
      productName: 'KYC Profiles',
      approvedBy: 'Camille Okonkwo',
      grantExpiresAt: '2026-06-25',
    },
    deepLink: '/marketplace/kyc-profiles',
    seedKey: 'beta:analyst:approved:kyc-profiles',
    createdDaysAgo: 6,
    readDaysAgo: 5,
  },

  // customer-lead@beta — owns KYC Profiles, Account Lifecycle Events.
  {
    recipientEmail: 'customer-lead@beta.example.com',
    category: 'access_request_submitted',
    payload: {
      productName: 'KYC Profiles',
      requesterName: 'Anya Volkov',
      justification:
        'Building a one-off cohort report for the regulator. Hashed identifier columns only — no raw PII required.',
    },
    deepLink: '/publishing/kyc-profiles/access-requests',
    seedKey: 'beta:customer:request:kyc-profiles',
    createdDaysAgo: 7,
    readDaysAgo: 6,
  },
  {
    recipientEmail: 'customer-lead@beta.example.com',
    category: 'product_published',
    payload: {
      productName: 'Account Lifecycle Events',
      publishedBy: 'Camille Okonkwo',
      version: '1.0.0',
    },
    deepLink: '/marketplace/account-lifecycle-events',
    seedKey: 'beta:customer:published:account-lifecycle-events',
    createdDaysAgo: 14,
    readDaysAgo: 14,
  },

  // risk-lead@beta — owns Transaction Risk Signals + Credit Risk Decisions.
  {
    recipientEmail: 'risk-lead@beta.example.com',
    category: 'access_grant_expiring',
    payload: {
      productName: 'KYC Profiles',
      expiresAt: '2026-05-07',
      daysUntilExpiry: 5,
    },
    deepLink: '/marketplace/kyc-profiles',
    seedKey: 'beta:risk:expiring:kyc-profiles',
    createdDaysAgo: 0,
  },
  {
    recipientEmail: 'risk-lead@beta.example.com',
    category: 'connection_reference_request',
    payload: {
      agentName: 'Risk Assistant',
      productName: 'Transaction Risk Signals',
      useCase: 'Operational Monitoring',
      requestedBy: 'Anya Volkov',
    },
    deepLink: '/agents/risk-assistant/connection-references',
    seedKey: 'beta:risk:conn-ref:risk-assistant-tx-signals',
    createdDaysAgo: 1,
  },

  // compliance@beta — governance role.
  {
    recipientEmail: 'compliance@beta.example.com',
    category: 'compliance_drift_detected',
    payload: {
      productName: 'Credit Risk Decisions',
      driftType: 'Decision rationale coverage below threshold',
      details: '91.4% rationale coverage vs 95% policy floor',
    },
    deepLink: '/governance/compliance',
    seedKey: 'beta:compliance:drift:credit-risk-decisions',
    createdDaysAgo: 4,
  },
];
