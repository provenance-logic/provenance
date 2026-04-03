import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { MarketplaceService } from './marketplace.service.js';
import type { ProductSearchResponse } from './marketplace.service.js';
import type { RequestContext } from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('search')
  async search(
    @ReqContext() ctx: RequestContext,
    @Query('q') q = '',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ProductSearchResponse> {
    return this.marketplaceService.search(ctx.orgId, q, {
      ...(page  !== undefined && { page:  parseInt(page,  10) }),
      ...(limit !== undefined && { limit: parseInt(limit, 10) }),
    });
  }
}
