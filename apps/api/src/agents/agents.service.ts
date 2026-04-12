import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { z } from 'zod';
import { AgentIdentityEntity } from './entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from './entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
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
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(AgentTrustClassificationEntity)
    private readonly classificationRepo: Repository<AgentTrustClassificationEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async registerAgent(dto: CreateAgentDto, ctx: RequestContext) {
    // B4: Validate human_oversight_contact belongs to a known principal
    const oversightPrincipal = await this.principalRepo.findOne({
      where: { email: dto.human_oversight_contact },
    });
    if (!oversightPrincipal) {
      throw new BadRequestException(
        'human_oversight_contact must be a registered platform user',
      );
    }

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

    // Emit downgrade to audit log
    if (!upgrade) {
      try {
        await this.writeAuditLog({
          orgId: agent.orgId,
          principalId: ctx.principalId,
          principalType: ctx.principalType,
          action: 'classification_downgraded',
          resourceType: 'agent_identity',
          resourceId: agentId,
          oldValue: { classification: currentClassification },
          newValue: { classification: dto.classification, reason: dto.reason },
          agentId,
          agentTrustClassificationAtTime: dto.classification,
          humanOversightContact: agent.humanOversightContact,
        });
      } catch (err) {
        this.logger.error('Failed to write classification downgrade audit entry', err);
      }
    }

    return this.formatAgentResponse(agent, savedClassification);
  }

  // ---------------------------------------------------------------------------
  // B2: Classification history
  // ---------------------------------------------------------------------------

  async getClassificationHistory(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);

    const history = await this.classificationRepo.find({
      where: { agentId },
      order: { effectiveFrom: 'DESC' },
    });

    return history.map((h) => ({
      classification_id: h.classificationId,
      agent_id: h.agentId,
      classification: h.classification,
      scope: h.scope,
      changed_by_principal_id: h.changedByPrincipalId,
      changed_by_principal_type: h.changedByPrincipalType,
      reason: h.reason,
      effective_from: h.effectiveFrom,
      created_at: h.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // B4: Oversight endpoint
  // ---------------------------------------------------------------------------

  async getOversight(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { agentId } });
    if (!agent) throw new NotFoundException(`Agent ${agentId} not found`);

    const currentClassification = await this.getCurrentClassification(agentId);

    // Fetch last activity and 24h count from audit log
    let lastActivityAt: string | null = null;
    let activityCount24h = 0;

    try {
      const lastActivity = await this.dataSource.query(
        `SELECT occurred_at FROM audit.audit_log
         WHERE agent_id = $1 AND action = 'mcp_tool_call'
         ORDER BY occurred_at DESC LIMIT 1`,
        [agentId],
      );
      if (lastActivity.length > 0) {
        lastActivityAt = lastActivity[0].occurred_at;
      }

      const countResult = await this.dataSource.query(
        `SELECT count(*)::int as cnt FROM audit.audit_log
         WHERE agent_id = $1 AND action = 'mcp_tool_call'
           AND occurred_at >= NOW() - INTERVAL '24 hours'`,
        [agentId],
      );
      activityCount24h = countResult[0]?.cnt ?? 0;
    } catch (err) {
      this.logger.error('Failed to query agent activity from audit log', err);
    }

    return {
      agent_id: agent.agentId,
      display_name: agent.displayName,
      human_oversight_contact: agent.humanOversightContact,
      current_classification: currentClassification?.classification ?? 'Observed',
      last_activity_at: lastActivityAt,
      activity_count_24h: activityCount24h,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async getCurrentClassification(agentId: string) {
    return this.classificationRepo.findOne({
      where: { agentId },
      order: { effectiveFrom: 'DESC' },
    });
  }

  private async writeAuditLog(entry: {
    orgId: string;
    principalId: string;
    principalType: string;
    action: string;
    resourceType: string;
    resourceId: string;
    oldValue?: unknown;
    newValue?: unknown;
    agentId?: string;
    agentTrustClassificationAtTime?: string;
    humanOversightContact?: string;
    toolName?: string;
    mcpInputSummary?: string;
  }) {
    await this.dataSource.query(
      `INSERT INTO audit.audit_log
       (org_id, principal_id, principal_type, action, resource_type, resource_id,
        old_value, new_value, agent_id, agent_trust_classification_at_time,
        human_oversight_contact, tool_name, mcp_input_summary)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9::uuid, $10, $11, $12, $13)`,
      [
        entry.orgId,
        entry.principalId,
        entry.principalType,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.oldValue ? JSON.stringify(entry.oldValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
        entry.agentId ?? null,
        entry.agentTrustClassificationAtTime ?? null,
        entry.humanOversightContact ?? null,
        entry.toolName ?? null,
        entry.mcpInputSummary ?? null,
      ],
    );
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
