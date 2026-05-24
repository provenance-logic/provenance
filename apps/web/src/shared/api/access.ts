import { api } from './client.js';
import type {
  AccessRequest,
  AccessRequestList,
  AccessGrant,
  AccessGrantList,
  SubmitAccessRequestRequest,
  ApproveAccessRequestRequest,
  DenyAccessRequestRequest,
  AccessRequestApprovalResult,
} from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/access`;

export const accessApi = {
  requests: {
    submit: (orgId: string, dto: SubmitAccessRequestRequest): Promise<AccessRequest> =>
      api.post<AccessRequest>(`${base(orgId)}/requests`, dto),

    get: (orgId: string, requestId: string): Promise<AccessRequest> =>
      api.get<AccessRequest>(`${base(orgId)}/requests/${requestId}`),

    mine: (orgId: string, status?: string, limit = 20, offset = 0): Promise<AccessRequestList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (status) params.set('status', status);
      return api.get<AccessRequestList>(`${base(orgId)}/requests/mine?${params.toString()}`);
    },

    /**
     * Generalized list endpoint backing the Pending Requests page.
     * Pass `forApprover: 'me'` to scope to requests for products owned by
     * the caller — the approver queue. Pass `status: 'pending'` to limit
     * to actionable rows.
     */
    list: (
      orgId: string,
      opts: {
        status?: string;
        forApprover?: 'me';
        productId?: string;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<AccessRequestList> => {
      const params = new URLSearchParams({
        limit: String(opts.limit ?? 20),
        offset: String(opts.offset ?? 0),
      });
      if (opts.status) params.set('status', opts.status);
      if (opts.forApprover) params.set('forApprover', opts.forApprover);
      if (opts.productId) params.set('productId', opts.productId);
      return api.get<AccessRequestList>(`${base(orgId)}/requests?${params.toString()}`);
    },

    approve: (
      orgId: string,
      requestId: string,
      dto: ApproveAccessRequestRequest = {},
    ): Promise<AccessRequestApprovalResult> =>
      api.post<AccessRequestApprovalResult>(
        `${base(orgId)}/requests/${requestId}/approve`,
        dto,
      ),

    deny: (
      orgId: string,
      requestId: string,
      dto: DenyAccessRequestRequest = {},
    ): Promise<AccessRequest> =>
      api.post<AccessRequest>(`${base(orgId)}/requests/${requestId}/deny`, dto),
  },

  grants: {
    mine: (orgId: string, activeOnly = true, limit = 20, offset = 0): Promise<AccessGrantList> => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        activeOnly: String(activeOnly),
      });
      return api.get<AccessGrantList>(`${base(orgId)}/grants?${params.toString()}`);
    },

    /**
     * Generalized grant list. Pass `granteePrincipalId` to filter to a
     * specific principal — for agents, the agent's `agentId` IS its
     * principalId per the JWT issuer (jwt-auth.guard.ts:52).
     */
    list: (
      orgId: string,
      opts: {
        granteePrincipalId?: string;
        productId?: string;
        activeOnly?: boolean;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<AccessGrantList> => {
      const params = new URLSearchParams({
        limit: String(opts.limit ?? 20),
        offset: String(opts.offset ?? 0),
        activeOnly: String(opts.activeOnly ?? true),
      });
      if (opts.granteePrincipalId) params.set('granteePrincipalId', opts.granteePrincipalId);
      if (opts.productId) params.set('productId', opts.productId);
      return api.get<AccessGrantList>(`${base(orgId)}/grants?${params.toString()}`);
    },

    get: (orgId: string, grantId: string): Promise<AccessGrant> =>
      api.get<AccessGrant>(`${base(orgId)}/grants/${grantId}`),

    /**
     * F10.19 / Phase 5.13 — consumer-initiated grant renewal.
     *
     * Returns `{mode, grant?, request?}`:
     *   - `auto_renewed`: all the product's output ports are
     *     situation-A-eligible (open access); the grant's `expiresAt`
     *     extended by the original TTL; warning markers reset. `grant`
     *     contains the updated row.
     *   - `approval_required`: any port requires per-product grant;
     *     a new pending access_request was created linked to this
     *     grant via `payload.renewalOfGrantId`. `request` contains
     *     the new pending request. The existing grant stays active
     *     while approval runs.
     *
     * Only the grantee may call. 409 if the grant is revoked.
     */
    renew: (
      orgId: string,
      grantId: string,
    ): Promise<{
      mode: 'auto_renewed' | 'approval_required';
      grant?: AccessGrant;
      request?: AccessRequest;
    }> =>
      api.post(
        `${base(orgId)}/grants/${grantId}/renew`,
        {},
      ),
  },
};
