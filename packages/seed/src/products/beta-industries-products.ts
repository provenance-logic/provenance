import type { SeedProduct } from '../types.js';

export const betaIndustriesProducts: SeedProduct[] = [
  {
    slug: 'kyc-profiles',
    name: 'KYC Profiles',
    description: 'Current KYC profile per customer including document verification status and PEP/sanctions flags.',
    orgSlug: 'beta-industries',
    domainSlug: 'customer',
    ownerEmail: 'customer-lead@beta.example.com',
    tags: ['customer', 'kyc', 'pii', 'pci-scope'],
    lifecycleState: 'published',
    freshnessSla: '1h',
    refreshCadence: 'event-driven (streaming)',
    ports: [
      {
        slug: 'kyc-rest',
        type: 'output',
        interfaceType: 'rest_api',
        description: 'REST API for retrieving a single KYC profile by customer id.',
        contract: {
          fields: [
            { name: 'customer_id', type: 'uuid', description: 'Customer identifier', nullable: false },
            { name: 'kyc_status', type: 'text', description: 'One of: verified, pending, rejected, expired' },
            { name: 'kyc_verified_at', type: 'timestamptz', description: 'Most recent verification timestamp', nullable: true },
            { name: 'pep_flag', type: 'boolean', description: 'Politically exposed person flag' },
            { name: 'sanctions_flag', type: 'boolean', description: 'Sanctions list hit flag' },
          ],
          connectionDetails: {
            interfaceType: 'rest_api',
            endpoint: 'https://api.beta.example.com/kyc/v1/profiles/{customerId}',
            protocol: 'REST over HTTPS with mTLS',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "curl -H 'Authorization: Bearer $TOKEN' https://api.beta.example.com/kyc/v1/profiles/$CUSTOMER_ID",
          },
          howToUse:
            'PCI-scoped. Request access via the marketplace; governance approval required. Callers must present a client cert in addition to JWT.',
        },
      },
    ],
  },
  {
    slug: 'transaction-risk-signals',
    name: 'Transaction Risk Signals',
    description: 'Real-time risk score per transaction combining velocity, geo, device, and historical signals.',
    orgSlug: 'beta-industries',
    domainSlug: 'risk',
    ownerEmail: 'risk-lead@beta.example.com',
    tags: ['risk', 'streaming', 'pci-scope'],
    lifecycleState: 'published',
    freshnessSla: '5m',
    refreshCadence: 'event-driven (streaming)',
    ports: [
      {
        slug: 'risk-topic',
        type: 'output',
        interfaceType: 'streaming_topic',
        description: 'Kafka-compatible topic publishing scored transactions.',
        contract: {
          fields: [
            { name: 'transaction_id', type: 'uuid', description: 'Transaction identifier' },
            { name: 'customer_id', type: 'uuid', description: 'Customer identifier' },
            { name: 'risk_score', type: 'numeric(5,4)', description: 'Risk score between 0 and 1' },
            { name: 'decision', type: 'text', description: 'One of: allow, review, deny' },
            { name: 'signals', type: 'jsonb', description: 'Typed signal contributions' },
          ],
          connectionDetails: {
            interfaceType: 'streaming_topic',
            endpoint: 'kafka://stream.beta.example.com:9093/transactions.scored.v1',
            protocol: 'Kafka 3.x with SASL/SCRAM',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "kcat -b stream.beta.example.com:9093 -t transactions.scored.v1 -X security.protocol=SASL_SSL -X sasl.mechanisms=OAUTHBEARER",
          },
        },
      },
    ],
  },
  {
    slug: 'credit-risk-decisions',
    name: 'Credit Risk Decisions',
    description: 'Daily batch of credit decisions with explanations and model version attribution.',
    orgSlug: 'beta-industries',
    domainSlug: 'risk',
    ownerEmail: 'risk-lead@beta.example.com',
    tags: ['risk', 'credit', 'explainable'],
    lifecycleState: 'published',
    freshnessSla: '24h',
    refreshCadence: 'daily at 03:00 UTC',
    ports: [
      {
        slug: 'credit-sql',
        type: 'output',
        interfaceType: 'sql_jdbc',
        description: 'SQL view over daily credit decisions.',
        contract: {
          fields: [
            { name: 'decision_date', type: 'date', description: 'Decision date (UTC)' },
            { name: 'application_id', type: 'uuid', description: 'Application identifier' },
            { name: 'decision', type: 'text', description: 'One of: approved, denied, manual_review' },
            { name: 'model_version', type: 'text', description: 'Model version used for the decision' },
            { name: 'top_reason_codes', type: 'jsonb', description: 'Top 3 reason codes with contributions' },
          ],
          connectionDetails: {
            interfaceType: 'sql_jdbc',
            endpoint: 'jdbc:postgresql://warehouse.beta.example.com:5432/risk',
            protocol: 'PostgreSQL 16 read replica',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "psql 'postgresql://warehouse.beta.example.com:5432/risk?sslmode=require' -c 'SELECT * FROM credit_decisions LIMIT 10'",
          },
        },
      },
    ],
  },
  {
    slug: 'account-lifecycle-events',
    name: 'Account Lifecycle Events',
    description: 'Append-only log of account lifecycle transitions — opened, activated, suspended, closed.',
    orgSlug: 'beta-industries',
    domainSlug: 'customer',
    ownerEmail: 'customer-lead@beta.example.com',
    tags: ['customer', 'events'],
    lifecycleState: 'published',
    freshnessSla: '1h',
    refreshCadence: 'event-driven (streaming)',
    ports: [
      {
        slug: 'lifecycle-topic',
        type: 'output',
        interfaceType: 'streaming_topic',
        description: 'Kafka topic publishing lifecycle transitions.',
        contract: {
          fields: [
            { name: 'account_id', type: 'uuid', description: 'Account identifier' },
            { name: 'event_type', type: 'text', description: 'One of: opened, activated, suspended, closed' },
            { name: 'event_at', type: 'timestamptz', description: 'Event timestamp' },
            { name: 'reason_code', type: 'text', description: 'Reason code for the transition', nullable: true },
          ],
          connectionDetails: {
            interfaceType: 'streaming_topic',
            endpoint: 'kafka://stream.beta.example.com:9093/accounts.lifecycle.v1',
            protocol: 'Kafka 3.x with SASL/SCRAM',
            authMethod: 'keycloak_oidc',
            exampleClient:
              "kcat -b stream.beta.example.com:9093 -t accounts.lifecycle.v1 -X security.protocol=SASL_SSL",
          },
        },
      },
    ],
  },
];
