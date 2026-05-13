import axios, { AxiosInstance, AxiosError } from 'axios';
import { getConfig } from '../config.js';
import type { AccessGrant, ConnectionReference } from '@provenance/types';

// Internal control-plane client (Domain 12 PR #3).
//
// Hits the /api/v1/internal/consent/* endpoints added in PR #2. Auth is the
// x-internal-service-token header — a shared secret between the API's
// InternalServiceGuard and this client. The existing ControlPlaneClient
// uses MCP_API_KEY as a user-bearer token; that auth scheme would be
// rejected by InternalServiceGuard. Two clients, two auth schemes,
// kept structurally separate so neither one's auth assumptions can leak
// into the other.
//
// Used by:
//   * The connection-reference cache cold-load at AQL boot — fetches
//     every currently-active reference for the org served by this AQL.
//   * The connection-reference guard cache-miss fallback (PR #5) — looks
//     up a single (org, agent, product) triple when the cache is cold
//     or the entry has been evicted.

export class InternalControlPlaneClient {
  private readonly http: AxiosInstance;

  /**
   * Construct with the default axios instance (production). An axios
   * instance can be injected to drive the client in tests without
   * touching the real network — ESM jest cannot reliably mock the
   * axios module via jest.mock, so dependency injection is the
   * test-friendly path.
   */
  constructor(http?: AxiosInstance) {
    if (http) {
      this.http = http;
      return;
    }
    const config = getConfig();
    this.http = axios.create({
      baseURL: `${config.CONTROL_PLANE_URL}/api/v1/internal`,
      headers: {
        'x-internal-service-token': config.AQL_INTERNAL_TOKEN,
      },
      timeout: 10_000,
      // Treat 404 as a normal response on lookup endpoints — caller
      // decides whether absent → cache-miss or absent → 404 to client.
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
  }

  /**
   * Cache cold-load. Returns every currently-active connection reference
   * for the org. Called once per cold-loaded org at AQL boot.
   */
  async listActiveReferencesForOrg(orgId: string): Promise<ConnectionReference[]> {
    const res = await this.http.get<{ items: ConnectionReference[] }>(
      '/consent/connection-references/active',
      { params: { orgId } },
    );
    return res.data.items;
  }

  /**
   * Cache-miss fallback. Returns the active reference for a single
   * (orgId, agentId, productId) triple, or null when no active
   * reference exists. A 404 from the API maps to null — both mean
   * "no entry to cache."
   */
  async lookupActiveReference(
    orgId: string,
    agentId: string,
    productId: string,
  ): Promise<ConnectionReference | null> {
    try {
      const res = await this.http.get<ConnectionReference>(
        '/consent/connection-references/active/lookup',
        { params: { orgId, agentId, productId } },
      );
      if (res.status === 404) return null;
      return res.data;
    } catch (err) {
      // Anything other than the validateStatus-permitted 404 — network
      // error, 401 (bad token), 500 — bubbles up. The cache layer logs
      // and re-throws so the request path can deny correctly rather
      // than silently letting it through.
      if (err instanceof AxiosError && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Cache-miss fallback for the access-grant cache. Returns the active
   * grant for the triple, or null when no active grant exists.
   * "Active" means non-revoked AND non-expired (the API filters; the
   * client just propagates the 200/404 contract).
   */
  async lookupActiveAccessGrant(
    orgId: string,
    agentId: string,
    productId: string,
  ): Promise<AccessGrant | null> {
    try {
      const res = await this.http.get<AccessGrant>(
        '/access/grants/active/lookup',
        { params: { orgId, agentId, productId } },
      );
      if (res.status === 404) return null;
      return res.data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }
}
