import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { getConfig } from '../config.js';
import type { JwtClaims, RequestContext, PrincipalType } from '@meshos/types';

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
      audience: config.KEYCLOAK_CLIENT_ID,
      issuer: `${config.KEYCLOAK_AUTH_SERVER_URL}/realms/${config.KEYCLOAK_REALM}`,
      algorithms: ['RS256'],
    });
  }

  validate(payload: JwtClaims): RequestContext {
    return {
      principalId: payload.meshos_principal_id ?? payload.sub,
      orgId: payload.meshos_org_id ?? '',
      principalType: (payload.meshos_principal_type ?? 'human_user') as PrincipalType,
      roles: [],
      agentId: payload.agent_id,
    };
  }
}
