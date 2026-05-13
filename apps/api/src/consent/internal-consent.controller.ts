import {
  Controller,
  Get,
  NotFoundException,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { InternalServiceGuard } from '../auth/internal-service.guard.js';
import { ConsentService } from './consent.service.js';
import type { ConnectionReference } from '@provenance/types';

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
  constructor(private readonly consentService: ConsentService) {}

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
}
