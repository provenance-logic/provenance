import type { RestApiConnectionDetails } from '@provenance/types';
import type { ConnectionProbe, ProbeOutcome } from './types.js';
import { withTimeout } from './registry.js';

/**
 * REST endpoint reachability probe. Issues a GET to `baseUrl` with the
 * declared auth header and treats *any* HTTP response — including 401, 403,
 * 404, 5xx — as success: the platform is asserting reachability of the
 * endpoint, not that the credentials are correct or the URL is precisely
 * tuned. Network-level failures (DNS, TCP, TLS, connection refused) are the
 * only `failure` cases. This matches the spec's intent of "the connector
 * can establish connectivity" — credential validity is a deeper check that
 * belongs to a future capability.
 */
export class RestApiProbe implements ConnectionProbe<RestApiConnectionDetails> {
  readonly interfaceType = 'rest_api' as const;

  probe(details: RestApiConnectionDetails, timeoutMs: number): Promise<ProbeOutcome> {
    return withTimeout(this.run(details), timeoutMs, 'REST');
  }

  private async run(d: RestApiConnectionDetails): Promise<ProbeOutcome> {
    const start = Date.now();
    const headers: Record<string, string> = {};
    switch (d.authMethod) {
      case 'bearer_token':
        if (d.bearerToken) headers['Authorization'] = `Bearer ${d.bearerToken}`;
        break;
      case 'api_key':
        if (d.apiKey) headers['X-API-Key'] = d.apiKey;
        break;
      case 'oauth2':
        // The probe does not perform an OAuth token exchange — the user-supplied
        // `oauth2TokenUrl` would itself need credentials. Reachability of the
        // resource URL is the only signal we provide here.
        break;
    }
    if (d.requiredHeaders) Object.assign(headers, d.requiredHeaders);
    if (d.apiVersion) headers['Accept-Version'] = d.apiVersion;

    try {
      const res = await fetch(d.baseUrl, { method: 'GET', headers });
      const latencyMs = Date.now() - start;
      return {
        status: 'success',
        message: `Endpoint reachable (HTTP ${res.status} ${res.statusText})`,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        status: 'failure',
        message: `Could not reach ${d.baseUrl}: ${(err as Error).message}`,
        latencyMs,
      };
    }
  }
}
