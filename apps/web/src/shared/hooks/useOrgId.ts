import { useAuth } from '../../auth/AuthProvider.js';

/**
 * Resolves the current org ID from the JWT provenance_org_id claim.
 *
 * RequireOrg gates all tenant-scoped routes, so any component reaching this
 * hook already has a non-empty claim — there is no need to fall back to an
 * API lookup (and doing so would 401 anyway: the API now rejects empty-org
 * JWTs on every route except @AllowNoOrg).
 */
export function useOrgId(): string | undefined {
  const { keycloak } = useAuth();
  return keycloak.tokenParsed?.provenance_org_id as string | undefined;
}
