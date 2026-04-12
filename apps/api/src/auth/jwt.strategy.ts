import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { getConfig } from '../config.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import type { JwtClaims, RequestContext, RoleType } from '@provenance/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(RoleAssignmentEntity)
    private readonly roleAssignmentRepo: Repository<RoleAssignmentEntity>,
  ) {
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

  async validate(payload: JwtClaims): Promise<RequestContext> {
    const displayName = payload.given_name && payload.family_name
      ? `${payload.given_name} ${payload.family_name}`
      : (payload.preferred_username ?? undefined);

    const principalId = payload.provenance_principal_id ?? payload.sub;
    const orgId = payload.provenance_org_id ?? '';

    // Fetch roles from database for this principal
    let roles: RoleType[] = [];
    if (principalId && orgId) {
      try {
        const assignments = await this.roleAssignmentRepo.find({
          where: { principalId, orgId },
        });
        roles = assignments.map((a) => a.role as RoleType);
      } catch {
        // If role lookup fails, proceed with empty roles
      }
    }

    return {
      principalId,
      orgId,
      principalType: payload.provenance_principal_type ?? 'human_user',
      roles,
      keycloakSubject: payload.sub,
      ...(payload.email !== undefined && { email: payload.email }),
      ...(displayName !== undefined && { displayName }),
      ...(payload.agent_id !== undefined && { agentId: payload.agent_id }),
    };
  }
}
