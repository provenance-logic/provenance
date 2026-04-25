import type { GraphQlConnectionDetails } from '@provenance/types';
import type { ConnectionProbe, ProbeOutcome } from './types.js';
import { withTimeout } from './registry.js';

/**
 * GraphQL endpoint reachability probe. POSTs the smallest valid GraphQL
 * request — `{ __typename }` — to either `introspectionEndpoint` (when set)
 * or the main `endpointUrl`. Any HTTP-level response counts as reachable;
 * a `data.__typename` value in the response body is recorded as a stronger
 * signal in the success message but is not required.
 */
export class GraphQlProbe implements ConnectionProbe<GraphQlConnectionDetails> {
  readonly interfaceType = 'graphql' as const;

  probe(details: GraphQlConnectionDetails, timeoutMs: number): Promise<ProbeOutcome> {
    return withTimeout(this.run(details), timeoutMs, 'GraphQL');
  }

  private async run(d: GraphQlConnectionDetails): Promise<ProbeOutcome> {
    const start = Date.now();
    const url = d.introspectionEndpoint && d.introspectionEndpoint.length > 0
      ? d.introspectionEndpoint
      : d.endpointUrl;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (d.authMethod === 'bearer_token' && d.bearerToken) {
      headers['Authorization'] = `Bearer ${d.bearerToken}`;
    } else if (d.authMethod === 'api_key' && d.apiKey) {
      headers['X-API-Key'] = d.apiKey;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: '{ __typename }' }),
      });
      const latencyMs = Date.now() - start;
      let typeName: string | null = null;
      try {
        const body = (await res.json()) as { data?: { __typename?: string } };
        typeName = body?.data?.__typename ?? null;
      } catch {
        // Non-JSON response — still counts as reachable.
      }
      const detail = typeName ? `, root type "${typeName}"` : '';
      return {
        status: 'success',
        message: `Endpoint reachable (HTTP ${res.status}${detail})`,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        status: 'failure',
        message: `Could not reach ${url}: ${(err as Error).message}`,
        latencyMs,
      };
    }
  }
}
