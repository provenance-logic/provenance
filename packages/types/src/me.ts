import type { PrincipalType, RoleType } from './organizations.js';
import type { Uuid } from './common.js';

/**
 * F7.48 — Provenance Account Surface profile response.
 *
 * The data the `/account` page needs to render: who the caller is signed
 * in as, the org they're scoped to, and the roles they hold. All fields
 * are derived from either the JWT claims (principalId, displayName,
 * email, principalType, keycloakSubject) or the request context (roles,
 * resolved server-side from `identity.role_assignments`), plus a single
 * org row read for the org name/slug.
 *
 * Returned by `GET /api/v1/me`.
 */
export interface MeProfileResponse {
  principalId: Uuid;
  keycloakSubject: string;
  principalType: PrincipalType;
  displayName: string | null;
  email: string | null;
  org: {
    id: Uuid;
    name: string;
    slug: string;
  };
  roles: RoleType[];
}
