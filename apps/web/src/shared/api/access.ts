import { api } from './client.js';
import type {
  AccessRequest,
  AccessRequestList,
  AccessGrant,
  AccessGrantList,
  SubmitAccessRequestRequest,
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

    get: (orgId: string, grantId: string): Promise<AccessGrant> =>
      api.get<AccessGrant>(`${base(orgId)}/grants/${grantId}`),
  },
};
