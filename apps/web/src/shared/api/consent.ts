import { api } from './client.js';
import type {
  ConnectionReference,
  ConnectionReferenceList,
  ConnectionReferenceState,
} from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/consent`;

/**
 * Domain 12 connection-reference surface. Backs the agent detail page's
 * Connection References tab; will also back the per-principal consent
 * management view when that's built.
 */
export const consentApi = {
  connectionReferences: {
    /**
     * List connection references for the org. Filter by agent, product,
     * owning principal, or state. Used by the agent detail page with
     * `{ agentId }` to render the agent's references.
     */
    list: (
      orgId: string,
      opts: {
        agentId?: string;
        productId?: string;
        owningPrincipalId?: string;
        state?: ConnectionReferenceState;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<ConnectionReferenceList> => {
      const params = new URLSearchParams({
        limit: String(opts.limit ?? 20),
        offset: String(opts.offset ?? 0),
      });
      if (opts.agentId) params.set('agentId', opts.agentId);
      if (opts.productId) params.set('productId', opts.productId);
      if (opts.owningPrincipalId) params.set('owningPrincipalId', opts.owningPrincipalId);
      if (opts.state) params.set('state', opts.state);
      return api.get<ConnectionReferenceList>(
        `${base(orgId)}/connection-references?${params.toString()}`,
      );
    },

    get: (orgId: string, referenceId: string): Promise<ConnectionReference> =>
      api.get<ConnectionReference>(`${base(orgId)}/connection-references/${referenceId}`),
  },
};
