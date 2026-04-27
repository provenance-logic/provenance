import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ConnectionPackageService } from '../access/connection-package.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type {
  ConnectionReference,
  ConnectionReferenceList,
  ConnectionReferenceState,
  ConnectionReferenceCause,
  ConnectionReferenceScope,
  DataCategoryConstraints,
  SubmitConnectionReferenceRequest,
  ApproveConnectionReferenceOptions,
  DenyConnectionReferenceRequest,
  RevokeConnectionReferenceRequest,
} from '@provenance/types';
import { DEFAULT_PURPOSE_ELABORATION_MIN_LENGTH } from '@provenance/types';
import type { EntityManager } from 'typeorm';
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
    @InjectRepository(ConnectionReferenceEntity)
    private readonly referenceRepo: Repository<ConnectionReferenceEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(AgentIdentityEntity)
    private readonly agentRepo: Repository<AgentIdentityEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => ConnectionPackageService))
    private readonly connectionPackageService: ConnectionPackageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getConnectionReference(
    orgId: string,
    referenceId: string,
  ): Promise<ConnectionReference> {
    const reference = await this.referenceRepo.findOne({
      where: { id: referenceId, orgId },
    });
    if (!reference) {
      throw new NotFoundException(`Connection reference ${referenceId} not found`);
    }
    return this.toDto(reference);
  }

  async listConnectionReferences(
    orgId: string,
    filters: {
      agentId?: string;
      productId?: string;
      owningPrincipalId?: string;
      state?: ConnectionReferenceState;
      limit: number;
      offset: number;
    },
  ): Promise<ConnectionReferenceList> {
    const qb = this.referenceRepo
      .createQueryBuilder('ref')
      .where('ref.orgId = :orgId', { orgId })
      .orderBy('ref.createdAt', 'DESC')
      .take(filters.limit)
      .skip(filters.offset);

    if (filters.agentId) {
      qb.andWhere('ref.agentId = :agentId', { agentId: filters.agentId });
    }
    if (filters.productId) {
      qb.andWhere('ref.productId = :productId', { productId: filters.productId });
    }
    if (filters.owningPrincipalId) {
      qb.andWhere('ref.owningPrincipalId = :owningPrincipalId', {
        owningPrincipalId: filters.owningPrincipalId,
      });
    }
    if (filters.state) {
      qb.andWhere('ref.state = :state', { state: filters.state });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((e) => this.toDto(e)),
      meta: {
        total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

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

      await this.writeOutbox(em, persisted, null, state, cause, null);

      await this.writeAudit(em, {
        orgId,
        actingPrincipalId,
        principalType: actingPrincipalId === dto.agentId ? 'ai_agent' : 'human',
        action: 'connection_reference_requested',
        referenceId: persisted.id,
        agentId: persisted.agentId,
        newValue: {
          state,
          useCaseCategory: persisted.useCaseCategory,
          purposeElaboration: persisted.purposeElaboration,
          intendedScope: persisted.intendedScope,
          requestedDurationDays: persisted.requestedDurationDays,
          expiresAt: persisted.expiresAt.toISOString(),
        },
        agentTrustClassificationAtTime: classification,
      });

      return persisted;
    });

    this.logger.log(
      `Connection reference ${saved.id} requested for agent ${saved.agentId} on product ${saved.productId} (classification ${classification})`,
    );

    // F12.10 — fan out to the owning principal (product owner) so they can
    // approve or deny. Best-effort: notification failure cannot roll back
    // the request itself; it has already been transactionally persisted
    // along with its outbox row and audit entry.
    try {
      await this.notificationsService.enqueue({
        orgId,
        category: 'connection_reference_request',
        recipients: [product.ownerPrincipalId],
        payload: {
          referenceId: saved.id,
          agentId: saved.agentId,
          agentDisplayName: agent.displayName,
          agentClassification: classification,
          productId: saved.productId,
          productName: product.name,
          useCaseCategory: saved.useCaseCategory,
          purposeElaboration: saved.purposeElaboration,
          intendedScope: saved.intendedScope,
          dataCategoryConstraints: saved.dataCategoryConstraints,
          requestedDurationDays: saved.requestedDurationDays,
          expiresAt: saved.expiresAt.toISOString(),
        },
        deepLink: `/admin/consent/connection-references/${saved.id}`,
        // Per-reference dedup key — each request is unique; the key just
        // provides traceability and collapses any rare double-submit.
        dedupKey: `connection_reference_request:${saved.id}`,
      });
    } catch (err) {
      this.logger.error(
        `Connection reference request notification failed for ${saved.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.toDto(saved);
  }

  /**
   * Approve a pending connection reference (F12.13).
   *
   * Only the owning principal recorded on the reference may approve.
   * Transitions the reference from `pending` to `active`, setting the
   * approved_* fields. If the approver left the options empty, the
   * approved fields inherit the originally requested values; if any
   * option is supplied and differs from the request, `modifiedByApprover`
   * is set true and both the original and approved shapes remain on the
   * row (F12.7).
   *
   * Out of scope for this slice:
   *   - Governance override on activation (F12.14) — governance-role
   *     principals cannot yet approve on behalf of the owner.
   *   - Connection package emission (F10.8 / ADR-008). Activation does
   *     not yet produce the per-reference connection package; that lands
   *     with the schema change adding the package column to
   *     connection_references.
   *   - Governance-hold sub-state when the owner-approval policy
   *     requires governance sign-off (F12.14).
   */
  async approveConnectionReference(
    orgId: string,
    referenceId: string,
    actingPrincipalId: string,
    options: ApproveConnectionReferenceOptions = {},
  ): Promise<ConnectionReference> {
    const saved = await this.dataSource.transaction(async (em) => {
      const reference = await this.loadForOwner(
        em,
        orgId,
        referenceId,
        actingPrincipalId,
        ['pending'],
      );

      this.validateApprovalOptions(reference, options);

      const now = new Date();
      const cause: ConnectionReferenceCause = 'principal_action';
      const newState: ConnectionReferenceState = 'active';

      const approvedScope: ConnectionReferenceScope =
        options.approvedScope ?? reference.intendedScope;
      const approvedDataCategoryConstraints: DataCategoryConstraints | null =
        options.approvedDataCategoryConstraints !== undefined
          ? options.approvedDataCategoryConstraints
          : reference.dataCategoryConstraints;
      const approvedDurationDays =
        options.approvedDurationDays ?? reference.requestedDurationDays;

      const modified = this.diffApprovalFromIntended(reference, {
        approvedScope,
        approvedDataCategoryConstraints,
        approvedDurationDays,
      });

      const expiresAt = new Date(now.getTime() + approvedDurationDays * 24 * 60 * 60 * 1000);

      const previousState = reference.state;

      reference.state = newState;
      reference.causedBy = cause;
      reference.approvedAt = now;
      reference.activatedAt = now;
      reference.expiresAt = expiresAt;
      reference.approvedByPrincipalId = actingPrincipalId;
      reference.governancePolicyVersion = options.governancePolicyVersion ?? null;
      reference.approvedScope = approvedScope;
      reference.approvedDataCategoryConstraints = approvedDataCategoryConstraints;
      reference.approvedDurationDays = approvedDurationDays;
      reference.modifiedByApprover = modified;

      // ADR-008: each connection reference produces its own connection
      // package at activation. The package is stored on the row and
      // retained as an immutable audit artifact across later state
      // transitions — consumers interpret `state` to decide usability.
      //
      // Per-reference scope filtering (ADR-008 "Scope Inheritance") is
      // deferred to a follow-up slice; we currently persist the full
      // product package. Narrowing requires threading approved_scope
      // into generateForProduct, which changes the Domain 10 contract.
      reference.connectionPackage = await this.connectionPackageService.generateForProduct(
        reference.orgId,
        reference.productId,
      );

      const persisted = await em
        .getRepository(ConnectionReferenceEntity)
        .save(reference);

      await this.writeOutbox(em, persisted, previousState, newState, cause, approvedScope);

      await this.writeAudit(em, {
        orgId,
        actingPrincipalId,
        principalType: 'human',
        action: 'connection_reference_approved',
        referenceId: persisted.id,
        agentId: persisted.agentId,
        newValue: {
          state: newState,
          approvedScope,
          approvedDataCategoryConstraints,
          approvedDurationDays,
          modifiedByApprover: modified,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return persisted;
    });

    this.logger.log(
      `Connection reference ${saved.id} approved by principal ${actingPrincipalId}`,
    );
    return this.toDto(saved);
  }

  /**
   * Deny a pending connection reference (F12.12).
   *
   * Only the owning principal recorded on the reference may deny.
   * Transitions the reference from `pending` to `revoked`, records the
   * denial reason and the denying principal, and emits the corresponding
   * outbox + audit entries. The reason is immutable and required.
   *
   * Revoked is terminal — no path re-opens the reference. A denied
   * request means the agent must submit a fresh request if the use case
   * is to be reconsidered.
   */
  async denyConnectionReference(
    orgId: string,
    referenceId: string,
    actingPrincipalId: string,
    dto: DenyConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('reason is required when denying a connection reference');
    }

    const saved = await this.dataSource.transaction(async (em) => {
      const reference = await this.loadForOwner(
        em,
        orgId,
        referenceId,
        actingPrincipalId,
        ['pending'],
      );

      const now = new Date();
      const cause: ConnectionReferenceCause = 'principal_action';
      const newState: ConnectionReferenceState = 'revoked';
      const previousState = reference.state;

      reference.state = newState;
      reference.causedBy = cause;
      reference.terminatedAt = now;
      reference.denialReason = dto.reason;
      reference.deniedByPrincipalId = actingPrincipalId;

      const persisted = await em
        .getRepository(ConnectionReferenceEntity)
        .save(reference);

      await this.writeOutbox(em, persisted, previousState, newState, cause, null);

      await this.writeAudit(em, {
        orgId,
        actingPrincipalId,
        principalType: 'human',
        action: 'connection_reference_denied',
        referenceId: persisted.id,
        agentId: persisted.agentId,
        newValue: {
          state: newState,
          denialReason: dto.reason,
          terminatedAt: now.toISOString(),
        },
      });

      return persisted;
    });

    this.logger.log(
      `Connection reference ${saved.id} denied by principal ${actingPrincipalId}`,
    );
    return this.toDto(saved);
  }

  /**
   * Principal-initiated revocation (F12.19).
   *
   * The owning principal may revoke an `active` or `suspended` reference
   * at any time. Revocation is immediate and terminal — the reference
   * cannot be reactivated. The reason is required and recorded in the
   * audit log (not on the row; F12.19 specifies the audit log as the
   * authoritative location for the reason, consistent with F12.23's
   * complete-audit-trail requirement).
   *
   * Pending references cannot be revoked through this path — they must
   * go through `denyConnectionReference` (F12.12), which has its own
   * row-level reason capture.
   *
   * Out of scope for this slice:
   *   - Freezing of in-flight operations authorized by the revoked
   *     reference (F12.19 / F8.1). The Agent Query Layer currently has
   *     no in-flight operations registry; when it does, a follow-up
   *     slice will query for operations carrying this reference ID and
   *     route them through the existing frozen-state path.
   *   - Governance-initiated revocation (F12.20).
   *   - Automatic cascade revocation on grant revoke, product
   *     deprecation, etc. (F12.21).
   *   - Notification fan-out (depends on Domain 11).
   */
  async revokeConnectionReference(
    orgId: string,
    referenceId: string,
    actingPrincipalId: string,
    dto: RevokeConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('reason is required when revoking a connection reference');
    }

    const saved = await this.dataSource.transaction(async (em) => {
      const reference = await this.loadForOwner(
        em,
        orgId,
        referenceId,
        actingPrincipalId,
        ['active', 'suspended'],
      );

      const now = new Date();
      const cause: ConnectionReferenceCause = 'principal_action';
      const newState: ConnectionReferenceState = 'revoked';
      const previousState = reference.state;

      reference.state = newState;
      reference.causedBy = cause;
      reference.terminatedAt = now;

      const persisted = await em
        .getRepository(ConnectionReferenceEntity)
        .save(reference);

      await this.writeOutbox(em, persisted, previousState, newState, cause, null);

      await this.writeAudit(em, {
        orgId,
        actingPrincipalId,
        principalType: 'human',
        action: 'connection_reference_revoked',
        referenceId: persisted.id,
        agentId: persisted.agentId,
        newValue: {
          state: newState,
          previousState,
          reason: dto.reason,
          terminatedAt: now.toISOString(),
        },
      });

      return persisted;
    });

    this.logger.log(
      `Connection reference ${saved.id} revoked by principal ${actingPrincipalId}`,
    );
    return this.toDto(saved);
  }

  /**
   * Automatic cascade revocation on access grant revoke (F12.21).
   *
   * ADR-005 specifies a one-way cascade: revoking the underlying access
   * grant revokes every connection reference for that agent-product
   * pair. The reverse does not hold — revoking a reference leaves the
   * grant intact.
   *
   * This method is invoked by AccessService immediately after the grant
   * row is marked revoked. It finds every non-terminal connection
   * reference tied to the grant and transitions it to `revoked` with
   * caused_by = 'grant_revocation_cascade'. Pending, active, and
   * suspended references are all affected. Expired and revoked refs are
   * skipped (terminal states are immutable).
   *
   * The triggering principal is the one who revoked the grant. The
   * cascade is recorded on each affected reference's audit log entry
   * with a stock reason ("Cascade from access grant {id} revocation"),
   * which keeps the audit trail explanatory even though F12.21 does
   * not require a per-trigger reason string.
   *
   * Returns the number of references actually transitioned. Callers
   * can log this for observability; a count of zero is normal (grant
   * had no references yet) and not an error.
   *
   * Idempotent: a second call after all non-terminal refs are already
   * revoked finds nothing to do and returns 0.
   */
  async cascadeRevokeForGrant(
    orgId: string,
    grantId: string,
    triggeringPrincipalId: string,
  ): Promise<number> {
    const transitioned = await this.dataSource.transaction(async (em) => {
      const refRepo = em.getRepository(ConnectionReferenceEntity);
      const refs = await refRepo.find({
        where: {
          orgId,
          accessGrantId: grantId,
          state: In(['pending', 'active', 'suspended']),
        },
      });

      if (refs.length === 0) {
        return 0;
      }

      const now = new Date();
      const cause: ConnectionReferenceCause = 'grant_revocation_cascade';
      const newState: ConnectionReferenceState = 'revoked';
      const reason = `Cascade from access grant ${grantId} revocation`;

      for (const ref of refs) {
        const previousState = ref.state;
        ref.state = newState;
        ref.causedBy = cause;
        ref.terminatedAt = now;
        const persisted = await refRepo.save(ref);

        await this.writeOutbox(em, persisted, previousState, newState, cause, null);
        await this.writeAudit(em, {
          orgId,
          actingPrincipalId: triggeringPrincipalId,
          principalType: 'human',
          action: 'connection_reference_revoked',
          referenceId: persisted.id,
          agentId: persisted.agentId,
          newValue: {
            state: newState,
            previousState,
            reason,
            terminatedAt: now.toISOString(),
            causedBy: cause,
          },
        });
      }

      return refs.length;
    });

    if (transitioned > 0) {
      this.logger.log(
        `Cascade revoked ${transitioned} connection reference(s) for access grant ${grantId}`,
      );
    }
    return transitioned;
  }

  private async loadForOwner(
    em: EntityManager,
    orgId: string,
    referenceId: string,
    actingPrincipalId: string,
    allowedStates: ConnectionReferenceState[],
  ): Promise<ConnectionReferenceEntity> {
    const reference = await em.getRepository(ConnectionReferenceEntity).findOne({
      where: { id: referenceId, orgId },
    });
    if (!reference) {
      throw new NotFoundException(`Connection reference ${referenceId} not found`);
    }
    if (reference.owningPrincipalId !== actingPrincipalId) {
      throw new ForbiddenException(
        'Only the owning principal may act on this connection reference',
      );
    }
    if (!allowedStates.includes(reference.state)) {
      throw new BadRequestException(
        `Connection reference is in state '${reference.state}'; allowed for this operation: ${allowedStates.join(', ')}`,
      );
    }
    return reference;
  }

  private validateApprovalOptions(
    reference: ConnectionReferenceEntity,
    options: ApproveConnectionReferenceOptions,
  ): void {
    if (
      options.approvedDurationDays !== undefined &&
      (!Number.isInteger(options.approvedDurationDays) || options.approvedDurationDays <= 0)
    ) {
      throw new BadRequestException('approvedDurationDays must be a positive integer');
    }
    // F12.7: the approver may narrow scope but may not broaden it beyond the
    // original request. A full generalised subset check is deferred to the
    // runtime scope enforcement slice (ADR-006); for now we reject an
    // approval that extends the duration beyond what was requested, which is
    // the one broadening case representable with scalar data.
    if (
      options.approvedDurationDays !== undefined &&
      options.approvedDurationDays > reference.requestedDurationDays
    ) {
      throw new BadRequestException(
        'approvedDurationDays may not exceed the originally requested duration',
      );
    }
  }

  private diffApprovalFromIntended(
    reference: ConnectionReferenceEntity,
    approved: {
      approvedScope: ConnectionReferenceScope;
      approvedDataCategoryConstraints: DataCategoryConstraints | null;
      approvedDurationDays: number;
    },
  ): boolean {
    if (JSON.stringify(approved.approvedScope) !== JSON.stringify(reference.intendedScope)) {
      return true;
    }
    if (
      JSON.stringify(approved.approvedDataCategoryConstraints ?? null) !==
      JSON.stringify(reference.dataCategoryConstraints ?? null)
    ) {
      return true;
    }
    if (approved.approvedDurationDays !== reference.requestedDurationDays) {
      return true;
    }
    return false;
  }

  private async writeOutbox(
    em: EntityManager,
    reference: ConnectionReferenceEntity,
    previousState: ConnectionReferenceState | null,
    newState: ConnectionReferenceState,
    cause: ConnectionReferenceCause,
    scope: ConnectionReferenceScope | null,
  ): Promise<void> {
    const outboxRepo = em.getRepository(ConnectionReferenceOutboxEntity);
    await outboxRepo.save(
      outboxRepo.create({
        orgId: reference.orgId,
        eventType: 'connection_reference.state',
        payload: {
          connectionReferenceId: reference.id,
          orgId: reference.orgId,
          agentId: reference.agentId,
          productId: reference.productId,
          newState,
          previousState,
          scope,
          useCaseCategory: reference.useCaseCategory,
          transitionedAt: new Date().toISOString(),
          causedBy: cause,
        },
      }),
    );
  }

  private async writeAudit(
    em: EntityManager,
    entry: {
      orgId: string;
      actingPrincipalId: string;
      principalType: 'ai_agent' | 'human';
      action: string;
      referenceId: string;
      agentId: string;
      newValue: Record<string, unknown>;
      agentTrustClassificationAtTime?: string | null;
    },
  ): Promise<void> {
    await em.query(
      `INSERT INTO audit.audit_log
         (org_id, principal_id, principal_type, action, resource_type, resource_id,
          new_value, agent_id, agent_trust_classification_at_time)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8::uuid, $9)`,
      [
        entry.orgId,
        entry.actingPrincipalId,
        entry.principalType,
        entry.action,
        'connection_reference',
        entry.referenceId,
        JSON.stringify(entry.newValue),
        entry.agentId,
        entry.agentTrustClassificationAtTime ?? null,
      ],
    );
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
      connectionPackage: entity.connectionPackage,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
