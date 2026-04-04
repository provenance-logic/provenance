import { api } from './client.js';
import type { AccessRequest, SubmitAccessRequestRequest } from '@provenance/types';

export const accessApi = {
  requests: {
    submit: (orgId: string, dto: SubmitAccessRequestRequest) =>
      api.post<AccessRequest>(`/organizations/${orgId}/access/requests`, dto),
  },
};
