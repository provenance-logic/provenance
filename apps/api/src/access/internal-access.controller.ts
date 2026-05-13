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
import { AccessService } from './access.service.js';
import type { AccessGrant } from '@provenance/types';

// Domain 12 PR #5a — internal endpoint the Agent Query Layer calls for
// access-grant cache-miss fallback. Mirrors InternalConsentController:
// the AQL holds an in-memory AccessGrantCache (PR #3); when the cache
// has no entry for a triple, the guard (PR #5b) calls this endpoint to
// confirm whether an active grant exists.
//
// `@Public()` skips JwtAuthGuard. Authentication is the service-token
// check in InternalServiceGuard. Tenant isolation is enforced by
// requiring orgId on every request and scoping the service query
// explicitly.
@UseGuards(InternalServiceGuard)
@Controller('internal/access/grants')
@Public()
export class InternalAccessController {
  constructor(private readonly accessService: AccessService) {}

  /**
   * Cache-miss fallback. Returns the active grant for a single
   * (orgId, agentId, productId) triple, or 404 when none exists.
   * "Active" means non-revoked AND non-expired.
   */
  @Get('active/lookup')
  async lookupActive(
    @Query('orgId') orgId?: string,
    @Query('agentId') agentId?: string,
    @Query('productId') productId?: string,
  ): Promise<AccessGrant> {
    if (!orgId || orgId.trim().length === 0) {
      throw new BadRequestException('orgId query parameter is required');
    }
    if (!agentId || agentId.trim().length === 0) {
      throw new BadRequestException('agentId query parameter is required');
    }
    if (!productId || productId.trim().length === 0) {
      throw new BadRequestException('productId query parameter is required');
    }
    const result = await this.accessService.findActiveGrant(orgId, agentId, productId);
    if (!result) {
      throw new NotFoundException(
        `No active access grant for agent ${agentId} on product ${productId}`,
      );
    }
    return result;
  }
}
