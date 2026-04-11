import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  CONTROL_PLANE_URL: z.string().default('http://localhost:3001'),
  MCP_API_KEY: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
