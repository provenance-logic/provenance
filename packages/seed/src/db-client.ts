import { Client } from 'pg';
import type { SeedConfig } from './config.js';

export async function withDb<T>(config: SeedConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
