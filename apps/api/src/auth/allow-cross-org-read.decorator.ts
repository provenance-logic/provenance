import { SetMetadata } from '@nestjs/common';

export const ALLOW_CROSS_ORG_READ_KEY = 'allowCrossOrgRead';

/**
 * Marks a JWT-authenticated endpoint as intentionally cross-tenant for read.
 * The `JwtAuthGuard` skips its `request.params.orgId === request.user.orgId`
 * check (added by B-061's fix in PR #140) when this decorator is present.
 *
 * The guard otherwise rejects any URL whose `:orgId` differs from the caller's
 * JWT `provenance_org_id` claim. That guard is correct for tenant-scoped
 * write or owner-scoped read endpoints, but it breaks the marketplace's
 * intentional cross-tenant read path — a data consumer in org A who has
 * discovered a product owned by org B must be able to GET that product's
 * trust score, SLO summary, lineage, and similar marketplace-public metadata
 * without first being moved into org B.
 *
 * Use ONLY for GET endpoints whose service-layer return shape is appropriate
 * for any authenticated principal in any org to see. Never apply to:
 *   - Mutations (POST / PATCH / DELETE).
 *   - Owner-only reads (e.g., raw credentials, audit history, internal
 *     governance state).
 *   - Endpoints that haven't been audited for cross-org leak shape.
 *
 * The caller still needs a valid Keycloak JWT (the decorator does NOT bypass
 * authentication) and still needs a non-empty `provenance_org_id` claim (the
 * decorator does NOT bypass `@AllowNoOrg` enforcement).
 *
 * Resolves: B-068 (marketplace cross-org URL break introduced by B-061's fix).
 * Pairs with: [[allow-no-org-decorator]] for the bootstrap path.
 */
export const AllowCrossOrgRead = () => SetMetadata(ALLOW_CROSS_ORG_READ_KEY, true);
