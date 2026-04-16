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
