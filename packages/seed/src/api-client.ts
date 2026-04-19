import { request } from 'undici';
import type { SeedConfig } from './config.js';
import type { Logger } from './logger.js';

export interface ApiClient {
  post<T>(path: string, body: unknown, asPrincipal?: string): Promise<T>;
  get<T>(path: string, asPrincipal?: string): Promise<T>;
}

export function createApiClient(config: SeedConfig, logger: Logger): ApiClient {
  const base = config.API_BASE_URL.replace(/\/$/, '');

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, asPrincipal?: string): Promise<T> {
    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-seed-service-token': config.MCP_API_KEY,
    };
    if (asPrincipal) headers['x-seed-as-principal'] = asPrincipal;
    logger.debug(`${method} ${url}`, asPrincipal ? { asPrincipal } : {});
    const res = await request(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      throw new Error(`${method} ${path} -> ${res.statusCode}: ${text.slice(0, 500)}`);
    }
    return text.length === 0 ? ({} as T) : (JSON.parse(text) as T);
  }

  return {
    post: (path, body, asPrincipal) => call('POST', path, body, asPrincipal),
    get: (path, asPrincipal) => call('GET', path, undefined, asPrincipal),
  };
}
