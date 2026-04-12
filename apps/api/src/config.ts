import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // PostgreSQL
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().min(1),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),

  // OPA sidecar
  OPA_BASE_URL: z.string().url().default('http://localhost:8181'),

  // Redpanda / Kafka
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),

  // OpenSearch
  OPENSEARCH_NODE: z.string().url().default('http://localhost:9200'),

  // Temporal
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  APPROVAL_TIMEOUT_HOURS: z.coerce.number().int().positive().default(72),
  APPROVAL_ESCALATION_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24),

  // Keycloak
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_AUTH_SERVER_URL: z.string().url(),
  // Public-facing issuer URL embedded in JWTs (matches KC_HOSTNAME / browser-visible URL).
  // Defaults to KEYCLOAK_AUTH_SERVER_URL when running outside Docker.
  KEYCLOAK_ISSUER_URL: z.string().url().optional(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),

  // Embedding service
  EMBEDDING_SERVICE_URL: z.string().url().default('http://localhost:8001'),

  // MCP API key (optional — enables API key auth for the agent query layer)
  MCP_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let _config: AppConfig | undefined;

export function loadConfig(): AppConfig {
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

export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}
