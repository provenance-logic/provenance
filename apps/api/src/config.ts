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

  // Keycloak
  KEYCLOAK_REALM: z.string().min(1),
  KEYCLOAK_AUTH_SERVER_URL: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
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
