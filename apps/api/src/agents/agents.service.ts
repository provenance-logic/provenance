import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { AgentIdentityEntity } from './entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from './entities/agent-trust-classification.entity.js';
import type { RequestContext, RoleType } from '@provenance/types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const CreateAgentSchema = z.object({
  display_name: z.string().min(1),
  model_name: z.string().min(1),
  model_provider: z.string().min(1),
  human_oversight_contact: z.string().email('human_oversight_contact must be a valid email address'),
  org_id: z.string().uuid(),
});

export const UpdateClassificationSchema = z.object({
  classification: z.enum(['Observed', 'Supervised', 'Autonomous']),
  reason: z.string().min(10, 'reason must be at least 10 characters')
    .refine((val) => val.trim().includes(' '), {
      message: 'reason must be more than a single word',
    }),
});

export type CreateAgentDto = z.infer<typeof CreateAgentSchema>;
export type UpdateClassificationDto = z.infer<typeof UpdateClassificationSchema>;

// ---------------------------------------------------------------------------
// Classification hierarchy for transition rules
// ---------------------------------------------------------------------------

const CLASSIFICATION_RANK: Record<string, number> = {
  Observed: 0,
  Supervised: 1,
  Autonomous: 2,
};

function isUpgrade(from: string, to: string): boolean {
  return CLASSIFICATION_RANK[to] > CLASSIFICATION_RANK[from];
}

function hasGovernanceRole(roles: RoleType[]): boolean {
  return roles.includes('governance_member');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(AgentTrustClassificationEntity)
    private readonly classificationRepo: Repository<AgentTrustClassificationEntity>,
  ) {}

  async registerAgent(dto: CreateAgentDto, ctx: RequestContext) {
    const agent = this.agentRepo.create({
      orgId: dto.org_id,
      displayName: dto.display_name,
      modelName: dto.model_name,
      modelProvider: dto.model_provider,
      humanOversightContact: dto.human_oversight_contact,
      registeredByPrincipalId: ctx.principalId,
      currentClassification: 'Observed',
    });
    const savedAgent = await this.agentRepo.save(agent);

    const classification = this.classificationRepo.create({
      agentId: savedAgent.agentId,
      orgId: dto.org_id,
      classification: 'Observed',
      scope: 'global',
      changedByPrincipalId: ctx.principalId,
      changedByPrincipalType: 'human_user',
      reason: 'Initial registration',
    });
    const savedClassification = await this.classificationRepo.save(classification);

    return this.formatAgentResponse(savedAgent, savedClassification);
  }

  async getAgent(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);

    const currentClassification = await this.getCurrentClassification(agentId);
    return this.formatAgentResponse(agent, currentClassification);
  }

  async listAgents(orgId: string) {
    const agents = await this.agentRepo.find({
      where: { orgId },
      order: { createdAt: 'DESC' },
    });

    const results = await Promise.all(
      agents.map(async (agent) => {
        const classification = await this.getCurrentClassification(agent.agentId);
        return this.formatAgentResponse(agent, classification);
      }),
    );

    return results;
  }

  /**
   * Update an agent's trust classification.
   *
   * Transition rules:
   * - Upgrades (Observed → Supervised, Supervised → Autonomous) require governance_member role.
   * - Downgrades can be performed by the agent's human_oversight_contact OR governance_member.
   * - Autonomous can never be set via any automated process — this endpoint is the only path.
   *
   * On success: inserts a new row into agent_trust_classifications.
   * The table is an immutable history — existing rows are never updated.
   */
  async updateClassification(
    agentId: string,
    dto: UpdateClassificationDto,
    ctx: RequestContext,
  ) {
    const agent = await this.agentRepo.findOne({ where: { agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);

    const current = await this.getCurrentClassification(agentId);
    const currentClassification = current?.classification ?? 'Observed';

    if (dto.classification === currentClassification) {
      throw new BadRequestException(`Agent is already classified as ${currentClassification}`);
    }

    const upgrade = isUpgrade(currentClassification, dto.classification);

    if (upgrade) {
      if (!hasGovernanceRole(ctx.roles)) {
        throw new ForbiddenException(
          'Upgrades to trust classification require a governance role',
        );
      }
    } else {
      // Downgrade: allowed by oversight contact OR governance role
      const isOversightContact = ctx.email === agent.humanOversightContact;
      if (!isOversightContact && !hasGovernanceRole(ctx.roles)) {
        throw new ForbiddenException(
          'Downgrades to trust classification require the human oversight contact or a governance role',
        );
      }
    }

    const changedByPrincipalType = hasGovernanceRole(ctx.roles)
      ? 'governance_role'
      : 'human_user';

    const classification = this.classificationRepo.create({
      agentId,
      orgId: agent.orgId,
      classification: dto.classification,
      scope: 'global',
      changedByPrincipalId: ctx.principalId,
      changedByPrincipalType,
      reason: dto.reason,
    });
    const savedClassification = await this.classificationRepo.save(classification);

    // Update denormalized cache on agent_identities
    agent.currentClassification = dto.classification;
    await this.agentRepo.save(agent);

    return this.formatAgentResponse(agent, savedClassification);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async getCurrentClassification(agentId: string) {
    return this.classificationRepo.findOne({
      where: { agentId },
      order: { effectiveFrom: 'DESC' },
    });
  }

  private formatAgentResponse(
    agent: AgentIdentityEntity,
    classification: AgentTrustClassificationEntity | null,
  ) {
    return {
      agent_id: agent.agentId,
      org_id: agent.orgId,
      display_name: agent.displayName,
      model_name: agent.modelName,
      model_provider: agent.modelProvider,
      human_oversight_contact: agent.humanOversightContact,
      registered_by_principal_id: agent.registeredByPrincipalId,
      current_classification: classification?.classification ?? 'Observed',
      classification_scope: classification?.scope ?? 'global',
      classification_changed_at: classification?.effectiveFrom ?? null,
      classification_reason: classification?.reason ?? null,
      created_at: agent.createdAt,
      updated_at: agent.updatedAt,
    };
  }
}
