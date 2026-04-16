import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import type { RequestContext } from '@provenance/types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    // API key bypass: if MCP_API_KEY is configured and the bearer token matches, allow through
    const mcpApiKey = process.env.MCP_API_KEY;
    if (mcpApiKey && authHeader === `Bearer ${mcpApiKey}`) {
      const agentId: string | undefined = request.headers?.['x-agent-id'];

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

    // Fall through to normal Keycloak JWT validation
    return super.canActivate(context) as Promise<boolean>;
  }
}
