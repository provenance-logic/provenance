import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint as public — bypasses JwtAuthGuard. Used for token-
 * authenticated endpoints (e.g. invitation acceptance) where the bearer token
 * is not a Keycloak JWT.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
