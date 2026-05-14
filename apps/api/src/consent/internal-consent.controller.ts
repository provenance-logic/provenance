import {
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { ConsentService } from './consent.service.js';
import type { ConnectionReference, RequestContext } from '@provenance/types';

// Internal read surface for the Agent Query Layer's runtime scope
// enforcement guard (F12.16 / ADR-006). Distinct from the public
// `/organizations/:orgId/consent/...` controller because:
//
//   1. Identity is server-resolved from the X-Agent-Id header rather
//      than carried in the URL — the AQL never passes an arbitrary
//      orgId or agentId; the JwtAuthGuard's MCP-API-key path binds
//      the request context to the verified agent record.
//   2. The shape is optimized for a single hot-path lookup: one row
//      or 404, no pagination wrapper, no list-style metadata.
//   3. Keeping it on the `internal/` namespace makes the gateway
//      ACL story trivial — these endpoints are never reached from
//      end-user JWTs.
//
// ADR-006 specifies an in-memory cache as the primary data source
// with this endpoint serving cache-miss fallback. The cache is a
// separate slice; the MVP path is "synchronous PG lookup on every
// product-targeted call." NF12.2 (50ms p95 overhead) is met with
// headroom at MVP scale; production scale requires the cache.
@UseGuards(JwtAuthGuard)
@Controller('internal/consent/connection-references')
export class InternalConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get('active')
  async getActiveForCurrentAgent(
    @ReqContext() ctx: RequestContext,
    @Query('productId') productId: string,
  ): Promise<ConnectionReference> {
    if (!ctx.agentId) {
      throw new NotFoundException('Active connection reference lookup requires an agent identity');
    }
    if (!productId) {
      throw new NotFoundException('productId is required');
    }
    const reference = await this.consentService.findActiveByAgentProduct(
      ctx.orgId,
      ctx.agentId,
      productId,
    );
    if (!reference) {
      throw new NotFoundException('No active connection reference for this agent and product');
    }
    return reference;
  }
}
