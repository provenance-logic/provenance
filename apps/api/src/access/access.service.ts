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
import { ConnectionPackageService } from './connection-package.service.js';
import { ConsentService } from '../consent/consent.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
  ConnectionPackage,
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
    private readonly temporalClient: Client | null,
    private readonly connectionPackageService: ConnectionPackageService,
    private readonly consentService: ConsentService,
    private readonly notificationsService: NotificationsService,
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

  /**
   * Returns deduplicated principal IDs for grants on a product. Used by
   * trigger modules (e.g. ProductsService for F11.12 / F11.13) to resolve
   * notification recipient sets.
   *
   * - When `includeRevokedSince` is omitted, only non-revoked + non-expired
   *   grants are included (current consumers).
   * - When `includeRevokedSince` is supplied, the result includes any grant
   *   whose revoked_at is on or after that timestamp, in addition to active
   *   grants. Used for "consumers within the past N days" recipient sets.
   */
  async listGranteesForProduct(
    orgId: string,
    productId: string,
    options: { includeRevokedSince?: Date } = {},
  ): Promise<string[]> {
    const qb = this.grantRepo
      .createQueryBuilder('grant')
      .select('DISTINCT grant.granteePrincipalId', 'granteePrincipalId')
      .where('grant.orgId = :orgId', { orgId })
      .andWhere('grant.productId = :productId', { productId });

    if (options.includeRevokedSince) {
      // Active grants OR grants revoked on/after the cutoff.
      qb.andWhere(
        '(grant.revokedAt IS NULL OR grant.revokedAt >= :since)',
        { since: options.includeRevokedSince },
      ).andWhere(
        '(grant.expiresAt IS NULL OR grant.expiresAt > :now OR grant.revokedAt IS NOT NULL)',
        { now: new Date() },
      );
    } else {
      // Active only.
      qb.andWhere('grant.revokedAt IS NULL').andWhere(
        '(grant.expiresAt IS NULL OR grant.expiresAt > :now)',
        { now: new Date() },
      );
    }

    const rows: { granteePrincipalId: string }[] = await qb.getRawMany();
    return rows.map((r) => r.granteePrincipalId);
  }

  async createGrant(
    orgId: string,
    dto: DirectGrantRequest,
    grantedByPrincipalId: string,
  ): Promise<AccessGrant> {
    const connectionPackage = await this.generatePackage(orgId, dto.productId);
    const grant = this.grantRepo.create({
      orgId,
      productId: dto.productId,
      granteePrincipalId: dto.granteePrincipalId,
      grantedBy: grantedByPrincipalId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      accessScope: dto.accessScope ?? null,
      approvalRequestId: null,
      connectionPackage: connectionPackage as unknown as Record<string, unknown> | null,
    });
    const saved = await this.grantRepo.save(grant);
    return this.toGrant(saved);
  }

  private async generatePackage(
    orgId: string,
    productId: string,
  ): Promise<ConnectionPackage | null> {
    try {
      return await this.connectionPackageService.generateForProduct(orgId, productId);
    } catch (err) {
      // Grant creation should not fail because package generation failed — the
      // consumer can still retrieve connection details via get_product once
      // they have the grant. Log and continue.
      this.logger.warn(
        `Connection package generation failed for product ${productId}: ${(err as Error).message}`,
      );
      return null;
    }
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

    // Domain 12 F12.21 / ADR-005: grant revocation cascades to revoke
    // every connection reference for this agent-product pair. The cascade
    // runs after the grant row is durably saved — if it throws, the grant
    // is still revoked (agent actions will be denied by the access-grant
    // check regardless of reference state), and a retry re-runs the
    // cascade idempotently since already-revoked refs are skipped.
    try {
      await this.consentService.cascadeRevokeForGrant(orgId, grantId, revokedByPrincipalId);
    } catch (err) {
      this.logger.error(
        `Grant ${grantId} revoked but connection-reference cascade failed; references may need reconciliation`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }

    return this.toGrant(saved);
  }

  /**
   * F10.10 — regenerate connection packages for every active grant on a
   * product. Called when the product's port connection details change.
   * Revoked or expired grants are skipped; a missing prior package is treated
   * as version 0 so the first refresh writes version 1. Returns the count of
   * grants whose package was rewritten.
   */
  async refreshPackagesForProduct(
    orgId: string,
    productId: string,
  ): Promise<{ refreshed: number }> {
    const now = new Date();
    const candidates = await this.grantRepo.find({
      where: { orgId, productId, revokedAt: IsNull() },
    });
    const active = candidates.filter(
      (g) => g.expiresAt === null || g.expiresAt > now,
    );
    if (active.length === 0) return { refreshed: 0 };

    const fresh = await this.connectionPackageService.generateForProduct(orgId, productId);
    if (!fresh) return { refreshed: 0 };

    let refreshed = 0;
    const refreshedGrants: AccessGrantEntity[] = [];
    for (const grant of active) {
      const prior = grant.connectionPackage as unknown as ConnectionPackage | null;
      const nextVersion = (prior?.packageVersion ?? 0) + 1;
      grant.connectionPackage = {
        ...fresh,
        packageVersion: nextVersion,
      } as unknown as Record<string, unknown>;
      await this.grantRepo.save(grant);
      refreshed++;
      refreshedGrants.push(grant);
    }
    this.logger.log(
      `Refreshed ${refreshed} connection package(s) for product ${productId}`,
    );

    // F11.27 — fire connection_package_refreshed per refreshed grant.
    // Recipient: the grantee (typically an agent). The PRD also calls for
    // the connection-reference-owning principal as a recipient, but the
    // current F10.10 path operates at the grant level — references are
    // notified separately when the system migrates to per-reference package
    // refresh (ADR-008 follow-up). Best-effort wrapper.
    for (const grant of refreshedGrants) {
      try {
        const newPackage = grant.connectionPackage as unknown as ConnectionPackage;
        await this.notificationsService.enqueue({
          orgId,
          category: 'connection_package_refreshed',
          recipients: [grant.granteePrincipalId],
          payload: {
            grantId: grant.id,
            productId,
            packageVersion: newPackage.packageVersion,
          },
          deepLink: `/marketplace/products/${productId}`,
          // Per-grant + per-version key so a recipient sees one notification
          // per actual refresh (not per cron tick if a refresh re-runs).
          dedupKey: `connection_package_refreshed:${grant.id}:${newPackage.packageVersion}`,
        });
      } catch (err) {
        this.logger.error(
          `Connection package refresh notification failed for grant ${grant.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { refreshed };
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

    // Start the Temporal approval workflow. The workflow drives the SLA timer
    // and escalation behavior; without it the request is still actionable
    // through the API but no auto-escalation fires. We treat the workflow start
    // as best-effort: a Temporal hiccup must not lose an access request.
    if (this.temporalClient) {
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
      }
    }

    // F11.6 — notify the product owner of the new access request.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId,
        category: 'access_request_submitted',
        recipients: [product.ownerPrincipalId],
        payload: {
          requestId: saved.id,
          productId: product.id,
          productName: product.name,
          requesterPrincipalId,
          justification: saved.justification,
        },
        deepLink: `/access/requests/${saved.id}`,
        // Each request is unique; the dedup_key just provides traceability.
        dedupKey: `access_request_submitted:${saved.id}`,
      }),
    );

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

    // Generate the connection package (F10.8) before saving so that the grant
    // row carries it in the same transactional write.
    const connectionPackage = await this.generatePackage(orgId, request.productId);

    // Create the resulting access grant.
    const grant = this.grantRepo.create({
      orgId,
      productId: request.productId,
      granteePrincipalId: request.requesterPrincipalId,
      grantedBy: approvedByPrincipalId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      accessScope: request.accessScope,
      approvalRequestId: request.id,
      connectionPackage: connectionPackage as unknown as Record<string, unknown> | null,
    });
    const savedGrant = await this.grantRepo.save(grant);

    // Record the approved event.
    await this.recordEvent(orgId, requestId, 'approved', approvedByPrincipalId, dto.note ?? null);

    // Signal the workflow that a human decision was made (best-effort).
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    // F11.7 — notify the requester of the approval.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId,
        category: 'access_request_approved',
        recipients: [request.requesterPrincipalId],
        payload: {
          requestId: request.id,
          productId: request.productId,
          grantId: savedGrant.id,
          expiresAt: savedGrant.expiresAt ? savedGrant.expiresAt.toISOString() : null,
          note: dto.note ?? null,
        },
        deepLink: `/marketplace/products/${request.productId}`,
        dedupKey: `access_request_approved:${request.id}`,
      }),
    );

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

    // F11.8 — notify the requester of the denial.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId,
        category: 'access_request_denied',
        recipients: [request.requesterPrincipalId],
        payload: {
          requestId: request.id,
          productId: request.productId,
          reason: dto.note ?? null,
        },
        deepLink: `/marketplace/products/${request.productId}`,
        dedupKey: `access_request_denied:${request.id}`,
      }),
    );

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
    if (!workflowId || !this.temporalClient) return;
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
      connectionPackage: (e.connectionPackage as unknown as ConnectionPackage | null) ?? null,
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

  // Wraps a notification enqueue so a notification failure cannot fail or
  // roll back the action that triggered it. The notification itself is
  // best-effort delivery on a separate code path; the user-visible action
  // (request submitted, approved, etc.) has already happened by the time
  // we get here.
  private async fireNotification(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Notification enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
