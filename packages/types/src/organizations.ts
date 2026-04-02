import type { Uuid, IsoTimestamp, Slug, PaginatedList } from './common.js';

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export type OrganizationStatus = 'active' | 'suspended' | 'decommissioned';

export interface Organization {
  id: Uuid;
  name: string;
  slug: Slug;
  description: string | null;
  status: OrganizationStatus;
  contactEmail: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface CreateOrganizationRequest {
  name: string;
  slug: Slug;
  description?: string;
  contactEmail?: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
  contactEmail?: string;
}

export type OrganizationList = PaginatedList<Organization>;

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export interface Domain {
  id: Uuid;
  orgId: Uuid;
  name: string;
  slug: Slug;
  description: string | null;
  ownerPrincipalId: Uuid;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface CreateDomainRequest {
  name: string;
  slug: Slug;
  description?: string;
  ownerPrincipalId: Uuid;
}

export interface UpdateDomainRequest {
  name?: string;
  description?: string;
  ownerPrincipalId?: Uuid;
}

export type DomainList = PaginatedList<Domain>;

// ---------------------------------------------------------------------------
// Principal / Member
// ---------------------------------------------------------------------------

export type PrincipalType = 'human_user' | 'service_account' | 'ai_agent' | 'platform_admin';

export type RoleType =
  | 'org_admin'
  | 'domain_owner'
  | 'data_product_owner'
  | 'consumer'
  | 'governance_member';

export interface Member {
  principalId: Uuid;
  principalType: PrincipalType;
  role: RoleType;
  email: string | null;
  displayName: string | null;
  joinedAt: IsoTimestamp;
}

export interface AddMemberRequest {
  principalId: Uuid;
  principalType: PrincipalType;
  role: RoleType;
}

export type MemberList = PaginatedList<Member>;
