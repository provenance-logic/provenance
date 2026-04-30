import { z } from 'zod';

const schema = z.object({
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  // Service token presented in the `x-seed-service-token` header on every
  // request to the API's /api/v1/seed/* surface. Must match the API
  // container's SEED_API_KEY exactly.
  SEED_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  KEYCLOAK_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('provenance'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('provenance-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1),
  SEED_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type SeedConfig = z.infer<typeof schema>;

export function loadConfig(): SeedConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid seed environment:\n${issues}`);
  }
  return parsed.data;
}
