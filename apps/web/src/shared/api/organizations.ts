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
  Member,
  MemberList,
  AddMemberRequest,
} from '@provenance/types';

export interface SelfServeOrganizationResponse {
  organization: Organization;
  principalId: string;
  requiresTokenRefresh: true;
}

export const organizationsApi = {
  list: (limit = 20, offset = 0) =>
    api.get<OrganizationList>(`/organizations?limit=${limit}&offset=${offset}`),

  create: (dto: CreateOrganizationRequest) =>
    api.post<Organization>('/organizations', dto),

  selfServe: (dto: CreateOrganizationRequest) =>
    api.post<SelfServeOrganizationResponse>('/organizations/self-serve', dto),

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

  members: {
    list: (orgId: string, limit = 20, offset = 0) =>
      api.get<MemberList>(`/organizations/${orgId}/members?limit=${limit}&offset=${offset}`),

    add: (orgId: string, dto: AddMemberRequest) =>
      api.post<Member>(`/organizations/${orgId}/members`, dto),

    remove: (orgId: string, principalId: string) =>
      api.delete(`/organizations/${orgId}/members/${principalId}`),
  },
};
