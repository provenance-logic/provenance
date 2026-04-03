import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { Client } from '@temporalio/client';
import { TEMPORAL_CLIENT } from './temporal/temporal-client.provider.js';
import { APPROVAL_TASK_QUEUE } from './temporal/temporal-worker.service.js';
import { approvalWorkflow, resolveSignal } from './temporal/approval.workflow.js';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { getConfig } from '../config.js';
import type {
  AccessGrant,
  AccessGrantList,
  DirectGrantRequest,
  AccessRequest,
  AccessRequestList,
  AccessRequestApprovalResult,
  SubmitAccessRequestRequest,
  ApproveAccessRequestRequest,
  DenyAccessRequestRequest,
  WithdrawAccessRequestRequest,
  ApprovalEvent,
  ApprovalEventList,
  ApprovalEventAction,
} from '@provenance/types';

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(AccessRequestEntity)
    private readonly requestRepo: Repository<AccessRequestEntity>,
    @InjectRepository(ApprovalEventEntity)
    private readonly eventRepo: Repository<ApprovalEventEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @Inject(TEMPORAL_CLIENT)
    private readonly temporalClient: Client,
  ) {}

  // ---------------------------------------------------------------------------
  // Access Grants
  // ---------------------------------------------------------------------------

  async listGrants(
    orgId: string,
    filters: {
      productId?: string;
      granteePrincipalId?: string;
      activeOnly?: boolean;
      limit: number;
      offset: number;
    },
  ): Promise<AccessGrantList> {
    const qb = this.grantRepo
      .createQueryBuilder('grant')
      .where('grant.orgId = :orgId', { orgId })
      .orderBy('grant.grantedAt', 'DESC')
      .take(filters.limit)
      .skip(filters.offset);

    if (filters.productId) {
      qb.andWhere('grant.productId = :productId', { productId: filters.productId });
    }
    if (filters.granteePrincipalId) {
      qb.andWhere('grant.granteePrincipalId = :grantee', {
        grantee: filters.granteePrincipalId,
      });
    }
    if (filters.activeOnly) {
      qb.andWhere('grant.revokedAt IS NULL').andWhere(
        '(grant.expiresAt IS NULL OR grant.expiresAt > :now)',
        { now: new Date() },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((g) => this.toGrant(g)),
      meta: { total, limit: filters.limit, offset: filters.offset },
    };
  }

  async createGrant(
    orgId: string,
    dto: DirectGrantRequest,
    grantedByPrincipalId: string,
  ): Promise<AccessGrant> {
    const grant = this.grantRepo.create({
      orgId,
      productId: dto.productId,
      granteePrincipalId: dto.granteePrincipalId,
      grantedBy: grantedByPrincipalId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      accessScope: dto.accessScope ?? null,
      approvalRequestId: null,
    });
    const saved = await this.grantRepo.save(grant);
    return this.toGrant(saved);
  }

  async getGrant(orgId: string, grantId: string): Promise<AccessGrant> {
    const grant = await this.grantRepo.findOne({ where: { id: grantId, orgId } });
    if (!grant) throw new NotFoundException(`Access grant ${grantId} not found`);
    return this.toGrant(grant);
  }

  async revokeGrant(
    orgId: string,
    grantId: string,
    revokedByPrincipalId: string,
  ): Promise<AccessGrant> {
    const grant = await this.grantRepo.findOne({ where: { id: grantId, orgId } });
    if (!grant) throw new NotFoundException(`Access grant ${grantId} not found`);

    // Idempotent — return already-revoked grant as-is.
    if (grant.revokedAt) return this.toGrant(grant);

    grant.revokedAt = new Date();
    grant.revokedBy = revokedByPrincipalId;
    const saved = await this.grantRepo.save(grant);
    return this.toGrant(saved);
  }

  // ---------------------------------------------------------------------------
  // Access Requests
  // ---------------------------------------------------------------------------

  async listRequests(
    orgId: string,
    filters: {
      productId?: string;
      requesterPrincipalId?: string;
      status?: string;
      limit: number;
      offset: number;
    },
  ): Promise<AccessRequestList> {
    const qb = this.requestRepo
      .createQueryBuilder('req')
      .where('req.orgId = :orgId', { orgId })
      .orderBy('req.requestedAt', 'DESC')
      .take(filters.limit)
      .skip(filters.offset);

    if (filters.productId) {
      qb.andWhere('req.productId = :productId', { productId: filters.productId });
    }
    if (filters.requesterPrincipalId) {
      qb.andWhere('req.requesterPrincipalId = :requester', {
        requester: filters.requesterPrincipalId,
      });
    }
    if (filters.status) {
      qb.andWhere('req.status = :status', { status: filters.status });
    }

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((r) => this.toRequest(r)),
      meta: { total, limit: filters.limit, offset: filters.offset },
    };
  }

  async submitRequest(
    orgId: string,
    dto: SubmitAccessRequestRequest,
    requesterPrincipalId: string,
  ): Promise<AccessRequest> {
    // 409 if an active (non-revoked, non-expired) grant already exists.
    const activeGrant = await this.grantRepo.findOne({
      where: {
        orgId,
        productId: dto.productId,
        granteePrincipalId: requesterPrincipalId,
        revokedAt: IsNull(),
      },
    });
    if (activeGrant && (!activeGrant.expiresAt || activeGrant.expiresAt > new Date())) {
      throw new ConflictException(
        'An active access grant already exists for this product',
      );
    }

    // 404 / 403 — validate the product exists, belongs to this org, and is published.
    const product = await this.productRepo.findOne({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundException(`Data product ${dto.productId} not found`);
    }
    if (product.orgId !== orgId) {
      throw new ForbiddenException(
        'Cannot request access to a product that belongs to a different organisation',
      );
    }
    if (product.status !== 'published') {
      throw new ConflictException(
        `Access requests are only accepted for published products (current status: ${product.status})`,
      );
    }

    // 409 if a pending request for this product already exists from this requester.
    const duplicate = await this.requestRepo.findOne({
      where: {
        orgId,
        productId: dto.productId,
        requesterPrincipalId,
        status: 'pending',
      },
    });
    if (duplicate) {
      throw new ConflictException(
        'A pending access request for this product already exists',
      );
    }

    const request = this.requestRepo.create({
      orgId,
      productId: dto.productId,
      requesterPrincipalId,
      justification: dto.justification ?? null,
      accessScope: dto.accessScope ?? null,
      status: 'pending',
      temporalWorkflowId: null,
    });
    const saved = await this.requestRepo.save(request);

    // Record the submitted event.
    await this.recordEvent(orgId, saved.id, 'submitted', requesterPrincipalId, null);

    // Start the Temporal approval workflow (best-effort).
    const workflowId = `approval-${saved.id}`;
    try {
      const config = getConfig();
      await this.temporalClient.workflow.start(approvalWorkflow, {
        args: [
          {
            requestId: saved.id,
            orgId,
            firstTimeoutMs: config.APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000,
            escalationTimeoutMs:
              config.APPROVAL_ESCALATION_TIMEOUT_HOURS * 60 * 60 * 1000,
          },
        ],
        taskQueue: APPROVAL_TASK_QUEUE,
        workflowId,
      });
      saved.temporalWorkflowId = workflowId;
      await this.requestRepo.save(saved);
    } catch (err) {
      this.logger.error(`Failed to start approval workflow for request ${saved.id}`, err);
      // The request is still created — Temporal is best-effort for now.
    }

    return this.toRequest(saved);
  }

  async getRequest(orgId: string, requestId: string): Promise<AccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId, orgId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    return this.toRequest(request);
  }

  async approveRequest(
    orgId: string,
    requestId: string,
    dto: ApproveAccessRequestRequest,
    approvedByPrincipalId: string,
  ): Promise<AccessRequestApprovalResult> {
    const request = await this.requestRepo.findOne({ where: { id: requestId, orgId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new ConflictException(
        `Access request is not pending (current status: ${request.status})`,
      );
    }

    const now = new Date();
    request.status = 'approved';
    request.resolvedAt = now;
    request.resolvedBy = approvedByPrincipalId;
    request.resolutionNote = dto.note ?? null;
    const savedRequest = await this.requestRepo.save(request);

    // Create the resulting access grant.
    const grant = this.grantRepo.create({
      orgId,
      productId: request.productId,
      granteePrincipalId: request.requesterPrincipalId,
      grantedBy: approvedByPrincipalId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      accessScope: request.accessScope,
      approvalRequestId: request.id,
    });
    const savedGrant = await this.grantRepo.save(grant);

    // Record the approved event.
    await this.recordEvent(orgId, requestId, 'approved', approvedByPrincipalId, dto.note ?? null);

    // Signal the workflow that a human decision was made (best-effort).
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    return {
      request: this.toRequest(savedRequest),
      grant: this.toGrant(savedGrant),
    };
  }

  async denyRequest(
    orgId: string,
    requestId: string,
    dto: DenyAccessRequestRequest,
    deniedByPrincipalId: string,
  ): Promise<AccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId, orgId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new ConflictException(
        `Access request is not pending (current status: ${request.status})`,
      );
    }

    request.status = 'denied';
    request.resolvedAt = new Date();
    request.resolvedBy = deniedByPrincipalId;
    request.resolutionNote = dto.note ?? null;
    const saved = await this.requestRepo.save(request);

    await this.recordEvent(orgId, requestId, 'denied', deniedByPrincipalId, dto.note ?? null);
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    return this.toRequest(saved);
  }

  async withdrawRequest(
    orgId: string,
    requestId: string,
    dto: WithdrawAccessRequestRequest,
    callerPrincipalId: string,
  ): Promise<AccessRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId, orgId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);

    // Only the original requester may withdraw.
    if (request.requesterPrincipalId !== callerPrincipalId) {
      throw new ForbiddenException('Only the original requester may withdraw this request');
    }
    if (request.status !== 'pending') {
      throw new ConflictException(
        `Access request is not pending (current status: ${request.status})`,
      );
    }

    request.status = 'withdrawn';
    request.resolvedAt = new Date();
    request.resolvedBy = callerPrincipalId;
    request.resolutionNote = dto.note ?? null;
    const saved = await this.requestRepo.save(request);

    await this.recordEvent(orgId, requestId, 'withdrawn', callerPrincipalId, dto.note ?? null);
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    return this.toRequest(saved);
  }

  // ---------------------------------------------------------------------------
  // Approval Events
  // ---------------------------------------------------------------------------

  async listApprovalEvents(
    orgId: string,
    requestId: string,
    options: { limit: number; offset: number },
  ): Promise<ApprovalEventList> {
    // Verify the request exists and belongs to this org.
    const request = await this.requestRepo.findOne({ where: { id: requestId, orgId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);

    const [items, total] = await this.eventRepo.findAndCount({
      where: { requestId, orgId },
      order: { occurredAt: 'DESC' },
      take: options.limit,
      skip: options.offset,
    });

    return {
      items: items.map((e) => this.toEvent(e)),
      meta: { total, limit: options.limit, offset: options.offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async recordEvent(
    orgId: string,
    requestId: string,
    action: ApprovalEventAction,
    performedBy: string | null,
    note: string | null,
  ): Promise<void> {
    const event = this.eventRepo.create({ orgId, requestId, action, performedBy, note });
    await this.eventRepo.save(event);
  }

  private async signalWorkflowResolved(workflowId: string | null): Promise<void> {
    if (!workflowId) return;
    try {
      const handle = this.temporalClient.workflow.getHandle(workflowId);
      await handle.signal(resolveSignal);
    } catch (err) {
      // Best-effort — the workflow may have already completed (timed out and expired).
      this.logger.warn(
        `Could not signal workflow ${workflowId}: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toGrant(e: AccessGrantEntity): AccessGrant {
    return {
      id: e.id,
      orgId: e.orgId,
      productId: e.productId,
      granteePrincipalId: e.granteePrincipalId,
      grantedBy: e.grantedBy,
      grantedAt: e.grantedAt.toISOString(),
      expiresAt: e.expiresAt?.toISOString() ?? null,
      revokedAt: e.revokedAt?.toISOString() ?? null,
      revokedBy: e.revokedBy,
      accessScope: e.accessScope,
      approvalRequestId: e.approvalRequestId,
    };
  }

  private toRequest(e: AccessRequestEntity): AccessRequest {
    return {
      id: e.id,
      orgId: e.orgId,
      productId: e.productId,
      requesterPrincipalId: e.requesterPrincipalId,
      justification: e.justification,
      accessScope: e.accessScope,
      status: e.status,
      temporalWorkflowId: e.temporalWorkflowId,
      requestedAt: e.requestedAt.toISOString(),
      resolvedAt: e.resolvedAt?.toISOString() ?? null,
      resolvedBy: e.resolvedBy,
      resolutionNote: e.resolutionNote,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private toEvent(e: ApprovalEventEntity): ApprovalEvent {
    return {
      id: e.id,
      orgId: e.orgId,
      requestId: e.requestId,
      action: e.action,
      performedBy: e.performedBy,
      note: e.note,
      occurredAt: e.occurredAt.toISOString(),
    };
  }
}
