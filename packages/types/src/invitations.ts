import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';
import type { RoleType } from './organizations.js';

// ---------------------------------------------------------------------------
// Invitation — F10.3 (Domain 10 self-serve)
// ---------------------------------------------------------------------------

export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export interface Invitation {
  id: Uuid;
  orgId: Uuid;
  email: string;
  role: RoleType;
  domainId: Uuid | null;
  invitedByPrincipalId: Uuid;
  expiresAt: IsoTimestamp;
  consumedAt: IsoTimestamp | null;
  resendCount: number;
  createdAt: IsoTimestamp;
  status: InvitationStatus;
}

export interface CreateInvitationRequest {
  email: string;
  role: RoleType;
  domainId?: Uuid;
}

export interface AcceptInvitationRequest {
  firstName?: string;
  lastName?: string;
  password?: string;
}

export interface AcceptInvitationResponse {
  orgId: Uuid;
  principalId: Uuid;
  role: RoleType;
  domainId: Uuid | null;
  loginUrl: string;
}

export type InvitationList = PaginatedList<Invitation>;
