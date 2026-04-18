import { api } from './client.js';
import type {
  Invitation,
  InvitationList,
  CreateInvitationRequest,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
} from '@provenance/types';

export const invitationsApi = {
  list: (orgId: string, limit = 20, offset = 0) =>
    api.get<InvitationList>(`/organizations/${orgId}/invitations?limit=${limit}&offset=${offset}`),

  listForDomain: (orgId: string, domainId: string, limit = 20, offset = 0) =>
    api.get<InvitationList>(
      `/organizations/${orgId}/domains/${domainId}/invitations?limit=${limit}&offset=${offset}`,
    ),

  create: (orgId: string, dto: CreateInvitationRequest) =>
    api.post<Invitation>(`/organizations/${orgId}/invitations`, dto),

  resend: (orgId: string, invitationId: string) =>
    api.post<Invitation>(`/organizations/${orgId}/invitations/${invitationId}/resend`, {}),
};

/**
 * The accept endpoint is unauthenticated — the invitation token itself is
 * the bearer authorization. We intentionally bypass the shared api client so
 * we don't send a Keycloak token on this request.
 */
export async function acceptInvitationPublic(
  token: string,
  dto: AcceptInvitationRequest,
): Promise<AcceptInvitationResponse> {
  const base = import.meta.env.VITE_API_BASE_URL as string;
  const res = await fetch(`${base}/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const message = (body as { message?: string }).message ?? res.statusText;
    const err = new Error(message) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<AcceptInvitationResponse>;
}
