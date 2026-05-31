import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Repository } from 'typeorm';
import type { Client } from '@temporalio/client';
import { TEMPORAL_CLIENT } from './temporal/temporal-client.provider.js';
import { APPROVAL_TASK_QUEUE } from './temporal/temporal-worker.service.js';
import { approvalWorkflow, resolveSignal } from './temporal/approval.workflow.js';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
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
  RoleType,
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
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
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

  /**
   * Look up the currently-active access grant for an agent-product pair
   * within an org. Returns null when no active grant exists. Called by
   * the Agent Query Layer's connection-reference guard on cache miss
   * (Domain 12 PR #5).
   *
   * "Active" means: not revoked AND (no expiry OR expiry is in the
   * future). Callers (the AQL guard) do not need to distinguish absent
   * from revoked from expired — all three map to the same denial code,
   * `ACCESS_GRANT_NOT_FOUND`. The narrowness of the contract is
   * deliberate: the guard's decision is binary, so anything more
   * structured would be wasted in the hot path.
   */
  async findActiveGrant(
    orgId: string,
    agentId: string,
    productId: string,
  ): Promise<AccessGrant | null> {
    const grant = await this.grantRepo.findOne({
      where: {
        orgId,
        productId,
        granteePrincipalId: agentId,
        revokedAt: IsNull(),
      },
    });
    if (!grant) return null;
    if (grant.expiresAt && grant.expiresAt <= new Date()) {
      return null;
    }
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
   * F10.19 / Phase 5.13 — Renew an access grant per F10.15 situation routing.
   *
   * Auto-renew vs re-trigger approval is decided by the product's port mix:
   *   - All output ports declared `situation_a_eligibility = true` → auto-
   *     renew (extend `expiresAt` by the original TTL the grant was issued
   *     for; reset both warning markers so the 14d/7d tiers fire again on
   *     the next cycle).
   *   - Otherwise → re-trigger approval workflow (create a new pending
   *     access_request linked to the grant via `approval_request_id`). The
   *     consumer keeps the existing grant active in the meantime; the
   *     approval flow runs as if it were a fresh request.
   *
   * Only the grantee may renew their own grant (cross-org consumer keeps the
   * grant in their own namespace per B-071 Model A; no cross-org carve-out
   * needed). A revoked grant cannot be renewed — the consumer must submit a
   * fresh access request.
   *
   * Per F10.19, expired grants are renewable too — the consumer landing on
   * the expiry message should be able to one-click renew rather than start
   * the whole flow over.
   */
  async renewGrant(
    orgId: string,
    grantId: string,
    callerPrincipalId: string,
  ): Promise<{
    mode: 'auto_renewed' | 'approval_required';
    grant?: AccessGrant;
    request?: AccessRequest;
  }> {
    const grant = await this.grantRepo.findOne({ where: { id: grantId, orgId } });
    if (!grant) throw new NotFoundException(`Access grant ${grantId} not found`);
    if (grant.granteePrincipalId !== callerPrincipalId) {
      throw new ForbiddenException('Only the grantee may renew their own access grant');
    }
    if (grant.revokedAt) {
      throw new ConflictException(
        'This grant was revoked and cannot be renewed — submit a fresh access request',
      );
    }

    const ports = await this.portRepo.find({
      where: { orgId: grant.orgId, productId: grant.productId, portType: 'output' },
    });
    // @cross-tenant-by-design: under Model A the grant lives in the
    // requester's org but the product lives in the owner's org. The
    // product lookup is bare-id; the orgId on the resulting row tells the
    // notification path which org to route through.
    const product = await this.productRepo.findOne({ where: { id: grant.productId } });

    const allOpenAccess = ports.length > 0 && ports.every((p) => p.situationAEligibility === true);

    if (allOpenAccess) {
      // Auto-renew: extend by the original TTL the grant was issued for.
      // If the grant never had an expiresAt (perpetual), nothing to extend
      // — return as-is.
      if (!grant.expiresAt) return { mode: 'auto_renewed', grant: this.toGrant(grant) };
      const originalTTLMs = grant.expiresAt.getTime() - grant.grantedAt.getTime();
      const baseTime = grant.expiresAt > new Date() ? grant.expiresAt.getTime() : Date.now();
      grant.expiresAt = new Date(baseTime + originalTTLMs);
      grant.expiryWarningSentAt = null;
      grant.expiryWarning7dSentAt = null;
      const saved = await this.grantRepo.save(grant);

      await this.fireNotification(() =>
        this.notificationsService.enqueue({
          orgId: grant.orgId,
          category: 'access_grant_renewed',
          recipients: [grant.granteePrincipalId],
          payload: {
            grantId: saved.id,
            productId: saved.productId,
            productName: product ? product.name : null,
            mode: 'auto_renewed',
            newExpiresAt: saved.expiresAt!.toISOString(),
          },
          deepLink: `/marketplace/products/${saved.productId}`,
          dedupKey: `access_grant_renewed:${saved.id}:${saved.expiresAt!.toISOString()}`,
        }),
      );

      return { mode: 'auto_renewed', grant: this.toGrant(saved) };
    }

    // Re-trigger approval workflow. Skip the line-426-style duplicate
    // check by reusing submitRequest's path, but inline-create the
    // request so the existing grant ID is captured on it.
    const request = this.requestRepo.create({
      orgId: grant.orgId,
      productId: grant.productId,
      requesterPrincipalId: callerPrincipalId,
      justification: 'Renewal request — original grant approaching/past expiry',
      accessScope: grant.accessScope,
      status: 'pending',
      temporalWorkflowId: null,
    });
    const savedRequest = await this.requestRepo.save(request);
    await this.recordEvent(grant.orgId, savedRequest.id, 'submitted', callerPrincipalId, null);

    // Notify the owner per F11.6 — notification lives in the owner's org
    // (recipient's namespace) per the placeholder cross-org pattern (see
    // submitRequest above).
    if (product) {
      await this.fireNotification(() =>
        this.notificationsService.enqueue({
          orgId: product.orgId,
          category: 'access_request_submitted',
          recipients: [product.ownerPrincipalId],
          payload: {
            requestId: savedRequest.id,
            productId: product.id,
            productName: product.name,
            requesterPrincipalId: callerPrincipalId,
            requesterOrgId: grant.orgId,
            justification: savedRequest.justification,
            renewalOfGrantId: grant.id,
          },
          deepLink: `/access/requests/${savedRequest.id}`,
          dedupKey: `access_request_submitted:${savedRequest.id}`,
        }),
      );
    }

    return { mode: 'approval_required', request: this.toRequest(savedRequest) };
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
      /**
       * When set, restrict results to requests for products owned by this
       * principal. The "approver queue" filter used by the Pending Requests
       * page so a domain owner sees their own actionable workload instead
       * of every request in the org. Joins data_products on product_id.
       *
       * Per B-071 Model A (anchor decision 3), cross-org requests live
       * in the requester's org. When `forApproverPrincipalId` is set,
       * the orgId filter is dropped — the product-ownership join is the
       * authorization gate, and a domain owner needs to see incoming
       * requests against their products regardless of which org each
       * request came from.
       */
      forApproverPrincipalId?: string;
      limit: number;
      offset: number;
    },
  ): Promise<AccessRequestList> {
    const isApproverQueue = Boolean(filters.forApproverPrincipalId);
    const qb = this.requestRepo
      .createQueryBuilder('req')
      .orderBy('req.requestedAt', 'DESC')
      .take(filters.limit)
      .skip(filters.offset);

    if (isApproverQueue) {
      // @cross-tenant-by-design: the approver queue intentionally
      // crosses orgs per Model A — drop the `req.orgId` filter and
      // let the product-ownership join authorize the rows.
      qb.innerJoin(
        DataProductEntity,
        'prod',
        'prod.id = req.productId AND prod.owner_principal_id = :approver',
        { approver: filters.forApproverPrincipalId },
      );
    } else {
      qb.where('req.orgId = :orgId', { orgId });
    }

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
      items: await this.enrichRequesters(items.map((r) => this.toRequest(r))),
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

    // 404 — validate the product exists and is published.
    // @cross-tenant-by-design: the marketplace is cross-org by design; a
    // consumer in Org A submitting against a product in Org B is the
    // central use case of the data-mesh marketplace per anchor decision 3
    // (Model A). Same-org-only enforcement here was removed by the B-071
    // fix; the cross-org write is governed instead by the approver-side
    // ownership check in `assertCallerCanResolve` (which fires on
    // approve/deny). The request row's `orgId` is the requester's org
    // (Model A: request and grant live in requester's namespace).
    const product = await this.productRepo.findOne({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundException(`Data product ${dto.productId} not found`);
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
    // Notification lives in the recipient's (owner's) org rather than
    // the requester's; this keeps the notification reachable from the
    // owner's inbox query (which scopes on the owner's orgId). For the
    // same-org case product.orgId === orgId, no behavior change. For
    // the cross-org case (Model A: requester in Org A, owner in Org B),
    // this is the placeholder pending the broader notification cross-
    // org routing decision deferred by the anchor-decisions doc.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId: product.orgId,
        category: 'access_request_submitted',
        recipients: [product.ownerPrincipalId],
        payload: {
          requestId: saved.id,
          productId: product.id,
          productName: product.name,
          requesterPrincipalId,
          requesterOrgId: orgId,
          justification: saved.justification,
        },
        deepLink: `/access/requests/${saved.id}`,
        // Each request is unique; the dedup_key just provides traceability.
        dedupKey: `access_request_submitted:${saved.id}`,
      }),
    );

    return this.toRequest(saved);
  }

  async getRequest(
    orgId: string,
    requestId: string,
    callerPrincipalId: string,
  ): Promise<AccessRequest> {
    // @cross-tenant-by-design: under B-071 Model A (anchor decision 3),
    // the request row lives in the requester's org. The reader may be
    // the requester (orgId match) OR the owner of the product the
    // request targets (cross-org read). The id is a UUID so any
    // accidental cross-org leak is bounded by knowledge of the
    // specific UUID; the `assertCallerCanReadRequest` check below
    // restricts to requester-or-owner regardless.
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    await this.assertCallerCanReadRequest(orgId, request, callerPrincipalId);
    return (await this.enrichRequesters([this.toRequest(request)]))[0];
  }

  async approveRequest(
    orgId: string,
    requestId: string,
    dto: ApproveAccessRequestRequest,
    approvedByPrincipalId: string,
    approvedByRoles: RoleType[],
  ): Promise<AccessRequestApprovalResult> {
    // @cross-tenant-by-design: under B-071 Model A (anchor decision 3),
    // the request row lives in the requester's org. The approver (owner)
    // reaches across to update it; `assertCallerCanResolve` below
    // enforces that the caller owns the product the request targets
    // (the second-layer ownership check the cross-org write decorator
    // explicitly relies on).
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new ConflictException(
        `Access request is not pending (current status: ${request.status})`,
      );
    }

    await this.assertCallerCanResolve(
      orgId,
      request.productId,
      requestId,
      approvedByPrincipalId,
      approvedByRoles,
      'approve',
    );

    const now = new Date();
    request.status = 'approved';
    request.resolvedAt = now;
    request.resolvedBy = approvedByPrincipalId;
    request.resolutionNote = dto.note ?? null;
    const savedRequest = await this.requestRepo.save(request);

    // Generate the connection package (F10.8) using the product's org
    // (not the approver's), since the product owns the connection
    // metadata regardless of which org the requester is in. Same value
    // as approver's org in the same-org case.
    const connectionPackage = await this.generatePackage(request.orgId, request.productId);

    // Create the resulting access grant in the requester's org per
    // Model A — the grant belongs to the consumer.
    const grant = this.grantRepo.create({
      orgId: request.orgId,
      productId: request.productId,
      granteePrincipalId: request.requesterPrincipalId,
      grantedBy: approvedByPrincipalId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      accessScope: request.accessScope,
      approvalRequestId: request.id,
      connectionPackage: connectionPackage as unknown as Record<string, unknown> | null,
    });
    const savedGrant = await this.grantRepo.save(grant);

    // Record the approved event in the request's org (Model A).
    await this.recordEvent(
      request.orgId,
      requestId,
      'approved',
      approvedByPrincipalId,
      dto.note ?? null,
    );

    // Signal the workflow that a human decision was made (best-effort).
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    // F11.7 — notify the requester of the approval. Notification lives
    // in the requester's org (the recipient's namespace) per the
    // placeholder pattern for cross-org notifications.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId: request.orgId,
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
    deniedByRoles: RoleType[],
  ): Promise<AccessRequest> {
    // @cross-tenant-by-design: same Model A cross-org write shape as
    // `approveRequest` — request lives in requester's org; owner
    // reaches across to deny; ownership check is the second layer.
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new ConflictException(
        `Access request is not pending (current status: ${request.status})`,
      );
    }

    await this.assertCallerCanResolve(
      orgId,
      request.productId,
      requestId,
      deniedByPrincipalId,
      deniedByRoles,
      'deny',
    );

    request.status = 'denied';
    request.resolvedAt = new Date();
    request.resolvedBy = deniedByPrincipalId;
    request.resolutionNote = dto.note ?? null;
    const saved = await this.requestRepo.save(request);

    // Record the denied event in the request's org (Model A).
    await this.recordEvent(
      request.orgId,
      requestId,
      'denied',
      deniedByPrincipalId,
      dto.note ?? null,
    );
    await this.signalWorkflowResolved(request.temporalWorkflowId);

    // F11.8 — notify the requester of the denial. Notification lives
    // in the requester's org per the placeholder cross-org pattern.
    await this.fireNotification(() =>
      this.notificationsService.enqueue({
        orgId: request.orgId,
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
    callerPrincipalId: string,
    options: { limit: number; offset: number },
  ): Promise<ApprovalEventList> {
    // @cross-tenant-by-design: same Model A read shape as `getRequest`
    // — request lives in requester's org; events live alongside it;
    // reader is requester or product owner.
    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Access request ${requestId} not found`);
    await this.assertCallerCanReadRequest(orgId, request, callerPrincipalId);

    // @cross-tenant-by-design: events filter on the request's orgId
    // (Model A — events live where the request lives), not the
    // caller's orgId. The ownership check above is the auth gate.
    const [items, total] = await this.eventRepo.findAndCount({
      where: { requestId, orgId: request.orgId },
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

  /**
   * Authorizes a read of an access request row under B-071 Model A.
   * The reader may be (a) the original requester or (b) the owner of
   * the product the request targets. Org admins in EITHER the
   * requester's org or the product owner's org also pass — they keep
   * the platform-admin visibility precedent.
   *
   * Callers reach this through `getRequest` and `listApprovalEvents`,
   * both marked `@AllowCrossOrgRead` at the controller. The decorator
   * relaxes the URL/JWT org-match guard; this helper enforces the
   * requester-or-owner constraint at the service layer so cross-org
   * reads are bounded by the principal's actual relationship to the
   * request, not just by knowledge of the request UUID.
   */
  private async assertCallerCanReadRequest(
    callerOrgId: string,
    request: AccessRequestEntity,
    callerPrincipalId: string,
  ): Promise<void> {
    if (request.requesterPrincipalId === callerPrincipalId) return;

    // Product-owner read: load the product (which lives in the owner's
    // org); the caller is authorized iff the product's owner is the
    // caller AND the caller's JWT org matches the product's org (the
    // owner is acting from their own org, not impersonating).
    // @cross-tenant-by-design: the product lookup is bare-id because
    // the product may not be in the caller's org under Model A; the
    // (ownerPrincipalId, orgId) match is the authorization gate.
    const product = await this.productRepo.findOne({ where: { id: request.productId } });
    if (
      product &&
      product.ownerPrincipalId === callerPrincipalId &&
      product.orgId === callerOrgId
    ) {
      return;
    }

    throw new NotFoundException(`Access request ${request.id} not found`);
  }

  /**
   * Enforces the federated-governance ownership boundary on approve/deny.
   * `RolesGuard` confirms the caller holds `domain_owner` or `org_admin`; this
   * adds the missing "on *this* product" half. `org_admin` keeps platform-wide
   * authority. Other callers must own the underlying product. Scope-violation
   * attempts land in the audit log before the 403 is thrown so cross-domain
   * authority probes are visible to governance review. See B-059.
   */
  private async assertCallerCanResolve(
    orgId: string,
    productId: string,
    requestId: string,
    callerPrincipalId: string,
    callerRoles: RoleType[],
    attemptedAction: 'approve' | 'deny',
  ): Promise<void> {
    if (callerRoles.includes('org_admin')) return;

    const product = await this.productRepo.findOne({ where: { id: productId, orgId } });
    if (!product) {
      throw new NotFoundException(`Data product ${productId} not found`);
    }
    if (product.ownerPrincipalId === callerPrincipalId) return;

    await this.requestRepo.manager.query(
      `INSERT INTO audit.audit_log
         (org_id, principal_id, principal_type, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7)`,
      [
        orgId,
        callerPrincipalId,
        'human',
        `access_request.${attemptedAction}_blocked_scope_violation`,
        'access_request',
        requestId,
        JSON.stringify({
          productId,
          productOwnerPrincipalId: product.ownerPrincipalId,
          callerRoles,
        }),
      ],
    );

    throw new ForbiddenException(
      'Only the product owner or an org_admin may resolve this access request',
    );
  }

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
      // Resolved by enrichRequesters() on the read paths; null until then.
      requesterName: null,
      requesterEmail: null,
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

  /**
   * Fill requesterName / requesterEmail from identity.principals so approvers
   * see a human, not a raw UUID (walkthrough finding — the approval UI showed
   * the bare requesterPrincipalId). Batch lookup; unresolved principals stay
   * null. Org-scoped: principals are looked up within their own org rows, but
   * since principal ids are globally unique we resolve by id directly.
   */
  private async enrichRequesters(requests: AccessRequest[]): Promise<AccessRequest[]> {
    const ids = [...new Set(requests.map((r) => r.requesterPrincipalId).filter(Boolean))];
    if (ids.length === 0) return requests;
    // @cross-tenant-by-design: requester identity is display metadata for the
    // approver; principal ids are globally-unique UUIDs and only name/email
    // are exposed. No tenant-scoped data crosses here.
    const principals = await this.principalRepo.find({ where: { id: In(ids) } });
    const byId = new Map(principals.map((p) => [p.id, p]));
    return requests.map((r) => {
      const p = byId.get(r.requesterPrincipalId);
      return p ? { ...r, requesterName: p.displayName, requesterEmail: p.email } : r;
    });
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
