import type { SeedNotification } from '../types.js';

export const acmeCorpNotifications: SeedNotification[] = [
  // analyst@acme — has approved grants and one expiring soon.
  {
    recipientEmail: 'analyst@acme.example.com',
    category: 'access_request_approved',
    payload: {
      productName: 'Customer 360',
      approvedBy: 'Maya Rodriguez',
      grantExpiresAt: '2026-06-01',
    },
    deepLink: '/marketplace/customer-360',
    seedKey: 'acme:analyst:approved:customer-360',
    createdDaysAgo: 30,
    readDaysAgo: 28,
  },
  {
    recipientEmail: 'analyst@acme.example.com',
    category: 'access_grant_expiring',
    payload: {
      productName: 'Supplier Performance',
      expiresAt: '2026-05-09',
      daysUntilExpiry: 7,
    },
    deepLink: '/marketplace/supplier-performance',
    seedKey: 'acme:analyst:expiring:supplier-performance',
    createdDaysAgo: 1,
  },

  // marketing-lead@acme — owns Customer 360 and Campaign Attribution.
  {
    recipientEmail: 'marketing-lead@acme.example.com',
    category: 'access_request_submitted',
    payload: {
      productName: 'Customer 360',
      requesterName: 'Aiden Chen',
      justification:
        'Building the Q3 cohort retention dashboard; only need the hashed identifier columns.',
    },
    deepLink: '/publishing/customer-360/access-requests',
    seedKey: 'acme:marketing:request:customer-360',
    createdDaysAgo: 30,
    readDaysAgo: 29,
  },
  {
    recipientEmail: 'marketing-lead@acme.example.com',
    category: 'slo_violation',
    payload: {
      productName: 'Campaign Attribution',
      sloName: 'Attribution API latency',
      threshold: '500ms',
      measured: '742ms',
      window: 'last 1 hour',
    },
    deepLink: '/publishing/campaign-attribution/observability',
    seedKey: 'acme:marketing:slo:campaign-attribution-latency',
    createdDaysAgo: 0,
  },

  // finance-lead@acme — owns Daily Revenue Recognition.
  {
    recipientEmail: 'finance-lead@acme.example.com',
    category: 'access_request_submitted',
    payload: {
      productName: 'Daily Revenue Recognition',
      requesterName: 'Samuel Okafor',
      justification:
        'Reconciling inventory write-offs against daily revenue postings — May 14 variance investigation.',
    },
    deepLink: '/publishing/revenue-daily/access-requests',
    seedKey: 'acme:finance:request:revenue-daily',
    createdDaysAgo: 5,
  },
  {
    recipientEmail: 'finance-lead@acme.example.com',
    category: 'trust_score_significant_change',
    payload: {
      productName: 'Daily Revenue Recognition',
      previousScore: 0.91,
      currentScore: 0.78,
      reason: 'Reconciliation match rate fell below the 99.5% SLO floor twice this week.',
    },
    deepLink: '/marketplace/revenue-daily/trust',
    seedKey: 'acme:finance:trust:revenue-daily',
    createdDaysAgo: 2,
  },

  // supply-lead@acme — owns Daily Inventory Snapshot and Supplier Performance.
  {
    recipientEmail: 'supply-lead@acme.example.com',
    category: 'slo_violation',
    payload: {
      productName: 'Daily Inventory Snapshot',
      sloName: 'Daily snapshot freshness',
      threshold: '8 hours',
      measured: '11.4 hours',
      window: 'today',
    },
    deepLink: '/publishing/inventory-daily/observability',
    seedKey: 'acme:supply:slo:inventory-daily-freshness',
    createdDaysAgo: 0,
  },

  // governance@acme — sees compliance signals across the org.
  {
    recipientEmail: 'governance@acme.example.com',
    category: 'compliance_drift_detected',
    payload: {
      productName: 'Customer 360',
      driftType: 'PII completeness below threshold',
      details: '93.2% non-null on hashed identifier columns vs 95% policy floor',
    },
    deepLink: '/governance/compliance',
    seedKey: 'acme:governance:drift:customer-360',
    createdDaysAgo: 3,
  },
  {
    recipientEmail: 'governance@acme.example.com',
    category: 'classification_changed',
    payload: {
      agentName: 'Marketing Copilot',
      previousClassification: 'observed',
      currentClassification: 'supervised',
      changedBy: 'Gita Schreiber',
      reason: 'Marketing requested supervised access for the Q3 segmentation experiment.',
    },
    deepLink: '/agents/marketing-copilot',
    seedKey: 'acme:governance:classification:marketing-copilot',
    createdDaysAgo: 7,
    readDaysAgo: 6,
  },
];
