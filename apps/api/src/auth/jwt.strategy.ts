import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { getConfig } from '../config.js';
import type { JwtClaims, RequestContext } from '@provenance/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const config = getConfig();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${config.KEYCLOAK_AUTH_SERVER_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
      }),
      issuer: `${config.KEYCLOAK_ISSUER_URL ?? config.KEYCLOAK_AUTH_SERVER_URL}/realms/${config.KEYCLOAK_REALM}`,
      algorithms: ['RS256'],
    });
  }

  validate(payload: JwtClaims): RequestContext {
    const displayName = payload.given_name && payload.family_name
      ? `${payload.given_name} ${payload.family_name}`
      : (payload.preferred_username ?? undefined);
    return {
      principalId: payload.provenance_principal_id ?? payload.sub,
      orgId: payload.provenance_org_id ?? '',
      principalType: payload.provenance_principal_type ?? 'human_user',
      roles: [],
      keycloakSubject: payload.sub,
      ...(payload.email !== undefined && { email: payload.email }),
      ...(displayName !== undefined && { displayName }),
      ...(payload.agent_id !== undefined && { agentId: payload.agent_id }),
    };
  }
}
