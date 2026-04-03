import { api } from './client.js';
import type {
  Organization,
  OrganizationList,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  Domain,
  DomainList,
  CreateDomainRequest,
  UpdateDomainRequest,
} from '@provenance/types';

export const organizationsApi = {
  list: (limit = 20, offset = 0) =>
    api.get<OrganizationList>(`/organizations?limit=${limit}&offset=${offset}`),

  create: (dto: CreateOrganizationRequest) =>
    api.post<Organization>('/organizations', dto),

  get: (orgId: string) =>
    api.get<Organization>(`/organizations/${orgId}`),

  update: (orgId: string, dto: UpdateOrganizationRequest) =>
    api.patch<Organization>(`/organizations/${orgId}`, dto),

  domains: {
    list: (orgId: string, limit = 20, offset = 0) =>
      api.get<DomainList>(`/organizations/${orgId}/domains?limit=${limit}&offset=${offset}`),

    create: (orgId: string, dto: CreateDomainRequest) =>
      api.post<Domain>(`/organizations/${orgId}/domains`, dto),

    get: (orgId: string, domainId: string) =>
      api.get<Domain>(`/organizations/${orgId}/domains/${domainId}`),

    update: (orgId: string, domainId: string, dto: UpdateDomainRequest) =>
      api.patch<Domain>(`/organizations/${orgId}/domains/${domainId}`, dto),

    delete: (orgId: string, domainId: string) =>
      api.delete(`/organizations/${orgId}/domains/${domainId}`),
  },
};
