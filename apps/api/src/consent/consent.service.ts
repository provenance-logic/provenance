import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import type {
  ConnectionReference,
  ConnectionReferenceState,
  ConnectionReferenceCause,
  SubmitConnectionReferenceRequest,
} from '@provenance/types';
import { DEFAULT_PURPOSE_ELABORATION_MIN_LENGTH } from '@provenance/types';
import { ConnectionReferenceEntity } from './entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from './entities/connection-reference-outbox.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';

// Trust classifications are stored capitalized on the agent record
// (see AgentsService.formatAgentResponse). Platform defaults to 'Observed'
// when no classification row exists.
const TRUST_CLASSIFICATION_OBSERVED = 'Observed';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Submit a connection reference request (F12.9).
   *
   * The caller is `actingPrincipalId`. For Observed agents, the acting
   * principal must be a human proxy, not the agent itself (F12.9 extends
   * the no-side-effect rule from F6.3). Supervised and Autonomous agents
   * may submit requests on their own behalf; in that case
   * `actingPrincipalId` equals `agentId`.
   *
   * The method runs a single transaction that:
   *   1. Inserts the reference in `pending` state with the full use-case
   *      declaration preserved (F12.5, F12.7).
   *   2. Inserts an outbox row (ADR-007 transactional-outbox pattern) that
   *      a separate publisher will later emit to the Redpanda topic
   *      `connection_reference.state`.
   *   3. Writes an audit.audit_log entry recording the request.
   *
   * Out of scope for F12.9:
   *   - Notification to the owning principal (F12.10, depends on Domain 11).
   *   - Supervised "oversight hold" sub-state pending oversight-contact
   *     acknowledgement. The current request lands directly in `pending`;
   *     a follow-up slice will model the oversight hold when the
   *     notification channel exists.
   *   - Governance-configurable duration maximums per classification
   *     (F12.4). Duration is currently bounded only by the positive-integer
   *     CHECK in the migration; classification-based caps land with the
   *     governance integration.
   */
  async requestConnectionReference(
    orgId: string,
    actingPrincipalId: string,
    dto: SubmitConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    this.validateSubmission(dto);

    const agent = await this.agentRepo.findOne({
      where: { agentId: dto.agentId, orgId },
    });
    if (!agent) {
      throw new NotFoundException(`Agent ${dto.agentId} not found in this organization`);
    }

    const classification = agent.currentClassification ?? TRUST_CLASSIFICATION_OBSERVED;

    // F12.9: an Observed agent may not initiate its own request.
    if (classification === TRUST_CLASSIFICATION_OBSERVED && actingPrincipalId === dto.agentId) {
      throw new ForbiddenException(
        'Observed agents may not initiate connection reference requests; a human proxy must submit on their behalf',
      );
    }

    const product = await this.productRepo.findOne({
      where: { id: dto.productId, orgId },
    });
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found in this organization`);
    }

    // ADR-005 composition: the reference composes with an access grant.
    // Both must be active for an agent action to be authorized; the grant
    // must already exist at request time.
    const grant = await this.grantRepo.findOne({
      where: {
        orgId,
        productId: dto.productId,
        granteePrincipalId: dto.agentId,
        revokedAt: IsNull(),
      },
    });
    if (!grant) {
      throw new BadRequestException(
        'Cannot request connection reference: agent has no active access grant for this product',
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + dto.requestedDurationDays * 24 * 60 * 60 * 1000);
    const cause: ConnectionReferenceCause = 'principal_action';
    const state: ConnectionReferenceState = 'pending';

    const saved = await this.dataSource.transaction(async (em) => {
      const referenceRepo = em.getRepository(ConnectionReferenceEntity);
      const outboxRepo = em.getRepository(ConnectionReferenceOutboxEntity);

      const reference = referenceRepo.create({
        orgId,
        agentId: dto.agentId,
        productId: dto.productId,
        productVersionId: null,
        accessGrantId: grant.id,
        owningPrincipalId: product.ownerPrincipalId,
        state,
        causedBy: cause,
        requestedAt: now,
        expiresAt,
        useCaseCategory: dto.useCaseCategory,
        purposeElaboration: dto.purposeElaboration,
        intendedScope: dto.intendedScope,
        dataCategoryConstraints: dto.dataCategoryConstraints ?? null,
        requestedDurationDays: dto.requestedDurationDays,
        modifiedByApprover: false,
      });
      const persisted = await referenceRepo.save(reference);

      await outboxRepo.save(
        outboxRepo.create({
          orgId,
          eventType: 'connection_reference.state',
          payload: {
            connectionReferenceId: persisted.id,
            orgId,
            agentId: persisted.agentId,
            productId: persisted.productId,
            newState: state,
            previousState: null,
            scope: null,
            useCaseCategory: persisted.useCaseCategory,
            transitionedAt: now.toISOString(),
            causedBy: cause,
          },
        }),
      );

      await em.query(
        `INSERT INTO audit.audit_log
           (org_id, principal_id, principal_type, action, resource_type, resource_id,
            new_value, agent_id, agent_trust_classification_at_time)
         VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8::uuid, $9)`,
        [
          orgId,
          actingPrincipalId,
          actingPrincipalId === dto.agentId ? 'ai_agent' : 'human',
          'connection_reference_requested',
          'connection_reference',
          persisted.id,
          JSON.stringify({
            state,
            useCaseCategory: persisted.useCaseCategory,
            purposeElaboration: persisted.purposeElaboration,
            intendedScope: persisted.intendedScope,
            requestedDurationDays: persisted.requestedDurationDays,
            expiresAt: persisted.expiresAt.toISOString(),
          }),
          dto.agentId,
          classification,
        ],
      );

      return persisted;
    });

    this.logger.log(
      `Connection reference ${saved.id} requested for agent ${saved.agentId} on product ${saved.productId} (classification ${classification})`,
    );
    return this.toDto(saved);
  }

  private validateSubmission(dto: SubmitConnectionReferenceRequest): void {
    if (!dto.useCaseCategory || dto.useCaseCategory.trim().length === 0) {
      throw new BadRequestException('useCaseCategory is required');
    }
    if (!dto.purposeElaboration || dto.purposeElaboration.length < DEFAULT_PURPOSE_ELABORATION_MIN_LENGTH) {
      throw new BadRequestException(
        `purposeElaboration must be at least ${DEFAULT_PURPOSE_ELABORATION_MIN_LENGTH} characters`,
      );
    }
    if (!dto.intendedScope || typeof dto.intendedScope !== 'object') {
      throw new BadRequestException('intendedScope is required');
    }
    if (!Number.isInteger(dto.requestedDurationDays) || dto.requestedDurationDays <= 0) {
      throw new BadRequestException('requestedDurationDays must be a positive integer');
    }
  }

  private toDto(entity: ConnectionReferenceEntity): ConnectionReference {
    return {
      id: entity.id,
      orgId: entity.orgId,
      agentId: entity.agentId,
      productId: entity.productId,
      productVersionId: entity.productVersionId,
      accessGrantId: entity.accessGrantId,
      owningPrincipalId: entity.owningPrincipalId,
      state: entity.state,
      causedBy: entity.causedBy,
      requestedAt: entity.requestedAt.toISOString(),
      approvedAt: entity.approvedAt?.toISOString() ?? null,
      activatedAt: entity.activatedAt?.toISOString() ?? null,
      suspendedAt: entity.suspendedAt?.toISOString() ?? null,
      expiresAt: entity.expiresAt.toISOString(),
      terminatedAt: entity.terminatedAt?.toISOString() ?? null,
      approvedByPrincipalId: entity.approvedByPrincipalId,
      governancePolicyVersion: entity.governancePolicyVersion,
      useCaseCategory: entity.useCaseCategory,
      purposeElaboration: entity.purposeElaboration,
      intendedScope: entity.intendedScope,
      dataCategoryConstraints: entity.dataCategoryConstraints,
      requestedDurationDays: entity.requestedDurationDays,
      approvedScope: entity.approvedScope,
      approvedDataCategoryConstraints: entity.approvedDataCategoryConstraints,
      approvedDurationDays: entity.approvedDurationDays,
      modifiedByApprover: entity.modifiedByApprover,
      denialReason: entity.denialReason,
      deniedByPrincipalId: entity.deniedByPrincipalId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
