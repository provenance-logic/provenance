import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { ALLOW_NO_ORG_KEY } from './allow-no-org.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { RequestContext } from '@provenance/types';

interface AuthRequest {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  user?: RequestContext;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public bypasses JWT entirely (used for token-authenticated endpoints
    // like invitation acceptance).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authHeader = request.headers?.authorization as string | undefined;

    // API key bypass: if MCP_API_KEY is configured and the bearer token matches, allow through
    const mcpApiKey = process.env.MCP_API_KEY;
    if (mcpApiKey && authHeader === `Bearer ${mcpApiKey}`) {
      const agentId = request.headers?.['x-agent-id'] as string | undefined;

      // ADR-002 Phase 5b-8: when the Agent Query Layer forwards identity
      // headers, verify the agent exists and build a proper agent context.
      if (agentId) {
        const agent = await this.agentRepo.findOne({ where: { agentId } });
        if (!agent) {
          throw new UnauthorizedException('Unknown agent');
        }

        const agentContext: RequestContext = {
          principalId: agent.agentId,
          orgId: agent.orgId,
          principalType: 'ai_agent',
          roles: [],
          agentId: agent.agentId,
          keycloakSubject: agent.agentId,
        };
        request.user = agentContext;
        return true;
      }

      // No agent headers — plain service account context (unchanged)
      const mcpContext: RequestContext = {
        principalId: 'mcp-agent',
        orgId: '',
        principalType: 'service_account',
        roles: [],
        keycloakSubject: 'mcp-agent',
      };
      request.user = mcpContext;
      return true;
    }

    // Normal Keycloak JWT validation.
    const activated = (await (super.canActivate(context) as Promise<boolean>));
    if (!activated) return false;

    // Require a non-empty provenance_org_id claim on every route except those
    // explicitly marked @AllowNoOrg — a caller without an org has no tenant
    // scope and must not reach any tenant-scoped data path. The only
    // authenticated-but-orgless endpoint is the self-serve org bootstrap.
    const allowNoOrg = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_ORG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowNoOrg && !request.user?.orgId) {
      throw new UnauthorizedException(
        'Token is missing a provenance_org_id claim — complete org signup first',
      );
    }

    // Cross-org URL/JWT consistency (B-061). When a route carries an :orgId
    // path parameter, it must equal the caller's JWT-resolved orgId. Several
    // controllers pass @Param('orgId') straight through to the service layer
    // without this check, and the RLS session variable (set with is_local=true
    // by OrgContextMiddleware on a transient pool connection) does not always
    // cover the downstream query — so without enforcement here, an Acme user
    // could substitute Beta's UUID in the URL and the service would happily
    // return Beta's data.
    //
    // Skip when request.user.orgId is empty (the MCP service-account bypass
    // earlier in this guard sets orgId='' for the privileged inter-service
    // path; @AllowNoOrg routes don't carry :orgId in their URLs).
    const urlOrgId = request.params?.orgId;
    if (urlOrgId && request.user?.orgId && urlOrgId !== request.user.orgId) {
      throw new ForbiddenException(
        'Org scope mismatch: token is scoped to a different organization than the URL targets',
      );
    }

    return true;
  }
}
