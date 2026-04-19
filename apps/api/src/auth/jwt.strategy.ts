import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { getConfig } from '../config.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import type { JwtClaims, RequestContext, RoleType } from '@provenance/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    @InjectRepository(RoleAssignmentEntity)
    private readonly roleAssignmentRepo: Repository<RoleAssignmentEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    const config = getConfig();
    // KEYCLOAK_ISSUER_URL is the FULL issuer as it appears in the JWT `iss`
    // claim (e.g. https://auth.example.com/realms/provenance). When unset,
    // fall back to deriving it from the internal AUTH_SERVER_URL + realm.
    // Appending /realms/{realm} to an already-full issuer URL double-nests
    // the path and rejects every real token at the iss check.
    const issuer = config.KEYCLOAK_ISSUER_URL
      ?? `${config.KEYCLOAK_AUTH_SERVER_URL}/realms/${config.KEYCLOAK_REALM}`;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${config.KEYCLOAK_AUTH_SERVER_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
      }),
      issuer,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtClaims): Promise<RequestContext> {
    const displayName = payload.given_name && payload.family_name
      ? `${payload.given_name} ${payload.family_name}`
      : (payload.preferred_username ?? undefined);

    const claimPrincipalId = payload.provenance_principal_id;
    const orgId = payload.provenance_org_id ?? '';
    const principalType = payload.provenance_principal_type ?? 'human_user';

    // Defense-in-depth: when the JWT has an org id but no platform principal
    // row exists, seed one JIT so the rest of the request can proceed. This
    // recovers from partial failures where Keycloak attribute binding
    // succeeded but the DB insert didn't, and absorbs users created in
    // Keycloak directly via the admin API.
    let resolvedPrincipalId = claimPrincipalId ?? payload.sub;

    const isAgentToken = principalType === 'ai_agent' || payload.agent_id !== undefined;
    if (orgId && payload.sub && !isAgentToken) {
      try {
        const existing = await this.principalRepo.findOne({
          where: { keycloakSubject: payload.sub },
        });
        if (!existing) {
          const seeded = await this.seedPrincipal({
            orgId,
            principalType,
            keycloakSubject: payload.sub,
            email: payload.email ?? null,
            displayName: displayName ?? null,
          });
          if (seeded) {
            resolvedPrincipalId = seeded;
          }
        } else if (!claimPrincipalId) {
          // JWT lacks the provenance_principal_id claim but the principal
          // exists — use the DB id so downstream services always have a stable
          // platform principal id.
          resolvedPrincipalId = existing.id;
        }
      } catch (err) {
        this.logger.warn(`JIT principal lookup/seed failed: ${(err as Error).message}`);
      }
    }

    // Fetch roles from database for this principal
    let roles: RoleType[] = [];
    if (resolvedPrincipalId && orgId) {
      try {
        const assignments = await this.roleAssignmentRepo.find({
          where: { principalId: resolvedPrincipalId, orgId },
        });
        roles = assignments.map((a) => a.role);
      } catch {
        // If role lookup fails, proceed with empty roles
      }
    }

    return {
      principalId: resolvedPrincipalId,
      orgId,
      principalType,
      roles,
      keycloakSubject: payload.sub,
      ...(payload.email !== undefined && { email: payload.email }),
      ...(displayName !== undefined && { displayName }),
      ...(payload.agent_id !== undefined && { agentId: payload.agent_id }),
    };
  }

  private async seedPrincipal(params: {
    orgId: string;
    principalType: string;
    keycloakSubject: string;
    email: string | null;
    displayName: string | null;
  }): Promise<string | null> {
    return this.dataSource.transaction(async (mgr) => {
      await mgr.query(
        `SELECT set_config('provenance.current_org_id', $1, true)`,
        [params.orgId],
      );
      const repo = mgr.getRepository(PrincipalEntity);
      const saved = await repo.save(
        repo.create({
          orgId: params.orgId,
          principalType: params.principalType as 'human_user' | 'service_account' | 'ai_agent' | 'platform_admin',
          keycloakSubject: params.keycloakSubject,
          email: params.email,
          displayName: params.displayName,
        }),
      );
      this.logger.log(`JIT-seeded principal ${saved.id} for keycloak user ${params.keycloakSubject} in org ${params.orgId}`);
      return saved.id;
    });
  }
}
