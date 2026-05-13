import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { InternalServiceGuard } from '../auth/internal-service.guard.js';
import { ConsentService } from './consent.service.js';
import { LegacyAgentMigrationService } from './legacy-agent-migration.service.js';
import type { ConnectionReference } from '@provenance/types';

/**
 * Wire shape the Agent Query Layer posts when its connection-reference
 * guard denies a request with CONNECTION_REFERENCE_SCOPE_VIOLATION.
 * The API does the recipient resolution and enqueue; the AQL is
 * fire-and-forget.
 */
export interface ScopeViolationNotificationRequest {
  referenceId: string;
  agentId: string;
  productId: string;
  actionScope: { port: string; dataCategories?: string[] };
  approvedScope: { ports: string[] };
  denyReason: string;
  enforcementMode: 'shadow' | 'enforced';
}

// Domain 12 — internal endpoints the Agent Query Layer calls for
// connection-reference cache cold-load (`/active`) and cache-miss
// fallback (`/active/lookup`). See ADR-006 § "Data Source" and the
// Domain 12 implementation plan § 4.
//
// `@Public()` skips JwtAuthGuard — internal callers do not carry a
// user-bound JWT. Authentication is the service-token check in
// InternalServiceGuard. Tenant isolation is enforced by requiring
// orgId on every request and scoping the service queries to that
// org explicitly.
@UseGuards(InternalServiceGuard)
@Controller('internal/consent/connection-references')
@Public()
export class InternalConsentController {
  constructor(
    private readonly consentService: ConsentService,
    private readonly legacyMigrationService: LegacyAgentMigrationService,
  ) {}

  /**
   * Cache cold-load. Returns every currently-active connection
   * reference for the org. The AQL calls this on boot for every org
   * it serves.
   */
  @Get('active')
  async listActiveForOrg(
    @Query('orgId') orgId?: string,
  ): Promise<{ items: ConnectionReference[] }> {
    if (!orgId || orgId.trim().length === 0) {
      throw new BadRequestException('orgId query parameter is required');
    }
    const items = await this.consentService.listActiveConnectionReferencesForOrg(orgId);
    return { items };
  }

  /**
   * Cache-miss fallback. Returns the active reference for a single
   * (orgId, agentId, productId) triple, or 404 when none exists. The
   * AQL calls this when the request lands before cold-load completes
   * or after the cache entry was evicted.
   */
  @Get('active/lookup')
  async lookupActive(
    @Query('orgId') orgId?: string,
    @Query('agentId') agentId?: string,
    @Query('productId') productId?: string,
  ): Promise<ConnectionReference> {
    if (!orgId || orgId.trim().length === 0) {
      throw new BadRequestException('orgId query parameter is required');
    }
    if (!agentId || agentId.trim().length === 0) {
      throw new BadRequestException('agentId query parameter is required');
    }
    if (!productId || productId.trim().length === 0) {
      throw new BadRequestException('productId query parameter is required');
    }
    const result = await this.consentService.findActiveConnectionReference(
      orgId,
      agentId,
      productId,
    );
    if (!result) {
      throw new NotFoundException(
        `No active connection reference for agent ${agentId} on product ${productId}`,
      );
    }
    return result;
  }

  /**
   * Domain 12 PR #5c — scope-violation notification fan-out endpoint.
   * The AQL calls this after the connection-reference guard denies a
   * request with `CONNECTION_REFERENCE_SCOPE_VIOLATION`. Recipients
   * (owning principal + governance role) and channel resolution
   * happen in the api; the AQL just hands over the violation context.
   *
   * 204 No Content on success — fire-and-forget from the AQL's
   * perspective. The audit-log entry the AQL already wrote is the
   * durable record; this notification is the operator wake-up call.
   */
  @Post('scope-violations')
  @HttpCode(HttpStatus.NO_CONTENT)
  async notifyScopeViolation(
    @Query('orgId') orgId: string | undefined,
    @Body() dto: ScopeViolationNotificationRequest,
  ): Promise<void> {
    if (!orgId || orgId.trim().length === 0) {
      throw new BadRequestException('orgId query parameter is required');
    }
    if (!dto.referenceId || dto.referenceId.trim().length === 0) {
      throw new BadRequestException('referenceId is required');
    }
    if (!dto.agentId || dto.agentId.trim().length === 0) {
      throw new BadRequestException('agentId is required');
    }
    if (!dto.productId || dto.productId.trim().length === 0) {
      throw new BadRequestException('productId is required');
    }
    if (!dto.actionScope || !dto.actionScope.port) {
      throw new BadRequestException('actionScope.port is required');
    }
    if (!dto.approvedScope || !Array.isArray(dto.approvedScope.ports)) {
      throw new BadRequestException('approvedScope.ports must be an array');
    }
    if (dto.enforcementMode !== 'shadow' && dto.enforcementMode !== 'enforced') {
      throw new BadRequestException(
        "enforcementMode must be 'shadow' or 'enforced'",
      );
    }
    await this.consentService.notifyScopeViolation({
      orgId,
      referenceId: dto.referenceId,
      agentId: dto.agentId,
      productId: dto.productId,
      actionScope: dto.actionScope,
      approvedScope: dto.approvedScope,
      denyReason: dto.denyReason ?? '',
      enforcementMode: dto.enforcementMode,
    });
  }

  /**
   * F12.25 — Legacy Agent Migration on Enforcement Activation.
   *
   * Operator-invoked endpoint. Provisions a legacy-compatibility
   * connection reference for every agent-product access grant that
   * does not already have an active reference. Run as step 2 of the
   * three-step Domain 12 rollout (after shadow-mode soak, before
   * flipping CONNECTION_REFERENCE_ENFORCEMENT_ENABLED on the AQL).
   *
   * Idempotent: re-running provisions zero rows on the second pass.
   * The response carries counts so the operator can see what
   * happened. Per-grant failures are logged and the migration
   * continues — the response reflects the partial completion.
   */
  @Post('legacy-agent-migration')
  @HttpCode(HttpStatus.OK)
  async runLegacyAgentMigration(): Promise<{ provisioned: number; skipped: number }> {
    return this.legacyMigrationService.runMigration();
  }
}
