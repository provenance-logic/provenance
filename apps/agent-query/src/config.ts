import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  CONTROL_PLANE_URL: z.string().default('http://localhost:3001'),
  MCP_API_KEY: z.string().min(1),
  DEFAULT_ORG_ID: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Keycloak — JWT validation for agent tokens (ADR-002 Phase 5b)
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().min(1).default('provenance'),

  // ADR-002 Phase 5c: 30-day deprecation compatibility mode.
  // When true, unauthenticated MCP requests are logged but allowed through.
  // When false (default), unauthenticated requests are rejected with 401.
  DEPRECATION_WARNING_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Domain 12 runtime-enforcement plumbing (ADR-006 / ADR-007).
  //
  // KAFKA_BROKERS: comma-separated brokers for the
  // `connection_reference.state` consumer. Matches the API side default
  // (single-broker Redpanda on :19092 in dev).
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),

  // Shared secret with the API's InternalServiceGuard. The AQL passes
  // this in the x-internal-service-token header on every call to
  // /api/v1/internal/consent/*. Must match the API's AQL_INTERNAL_TOKEN
  // env var byte-for-byte. Minimum 16 characters.
  AQL_INTERNAL_TOKEN: z.string().min(16, 'AQL_INTERNAL_TOKEN must be at least 16 characters'),

  // Domain 12 PR #5b — connection-reference enforcement feature flag.
  //
  // false (default): SHADOW MODE. The guard runs on every product-bound
  //   MCP tool call, writes audit-log entries on what it would deny,
  //   and logs the decision to stdout — but does not actually block the
  //   request. Used to observe how enforcement would behave before
  //   flipping on.
  //
  // true: ENFORCEMENT MODE. The guard denies any request that fails its
  //   checks. Denied responses are MCP isError results carrying the
  //   distinct denial code. Flipping this on is gated on F12.25
  //   (legacy-agent migration) — without it, every existing agent loses
  //   access on the next request.
  CONNECTION_REFERENCE_ENFORCEMENT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AgentQueryConfig = z.infer<typeof envSchema>;

let _config: AgentQueryConfig | undefined;

export function loadConfig(): AgentQueryConfig {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  _config = result.data;
  return _config;
}

export function getConfig(): AgentQueryConfig {
  if (!_config) return loadConfig();
  return _config;
}
