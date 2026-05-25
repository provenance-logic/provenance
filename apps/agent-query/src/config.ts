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
  // Full public issuer URL exactly as it appears in the JWT `iss` claim.
  // In deployed environments, KEYCLOAK_URL is the internal Docker network URL
  // (e.g. http://keycloak:8080) needed for JWKS fetching, but tokens carry the
  // public URL (e.g. https://auth-demo.provenancelogic.com/realms/provenance)
  // as their issuer. Setting KEYCLOAK_ISSUER_URL bridges this split: JWKS is
  // fetched via KEYCLOAK_URL while jwt.verify() checks against KEYCLOAK_ISSUER_URL.
  // When unset, falls back to ${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM} which is
  // correct for local-dev where the internal and public URLs are the same.
  // Mirrors the same split in apps/api/src/config.ts (KEYCLOAK_AUTH_SERVER_URL /
  // KEYCLOAK_ISSUER_URL). See B-076.
  KEYCLOAK_ISSUER_URL: z.string().url().optional(),

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

  // Domain 12 connection-reference enforcement feature flag.
  //
  // true (default, PR #6 — Domain 12 arc closeout): ENFORCEMENT MODE.
  //   The guard denies any product-bound MCP tool call that fails its
  //   checks (no grant, no reference, suspended/expired/revoked, scope
  //   violation). Denied responses are MCP isError results carrying the
  //   distinct denial code.
  //
  // false: SHADOW MODE. The guard still runs and writes audit-log
  //   entries for what it would deny, but does not block. Useful for
  //   observing how enforcement would behave on a long-running
  //   installation before committing to the flip.
  //
  // Upgrade runbook (for existing installations that ran prior versions
  // in shadow mode): run F12.25's legacy-agent migration endpoint
  // (POST /api/v1/internal/consent/legacy-agent-migration on the api)
  // before deploying this version. Without it, existing agents lose
  // access on the next request after deploy. The migration is
  // idempotent and safe to re-run.
  CONNECTION_REFERENCE_ENFORCEMENT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
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
