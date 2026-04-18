import { SetMetadata } from '@nestjs/common';

export const ALLOW_NO_ORG_KEY = 'allowNoOrg';

/**
 * Marks a JWT-authenticated endpoint as accessible to users whose token
 * does not yet carry a `provenance_org_id` claim (i.e. newly registered
 * users who have not self-served an org). The caller must still present a
 * Keycloak-verified JWT — this only waives the org-binding requirement.
 *
 * Used for the self-serve org creation flow (F10.2), which is the bootstrap
 * endpoint that binds the user to a new org. No other endpoint should use
 * this decorator: a caller without an org has no tenant scope and must not
 * reach any tenant-scoped data path.
 */
export const AllowNoOrg = () => SetMetadata(ALLOW_NO_ORG_KEY, true);
