import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { MarketplaceService } from './marketplace.service.js';
import type { ProductSearchResponse } from './marketplace.service.js';
import type {
  RequestContext,
  MarketplaceProductList,
  MarketplaceProductDetail,
  MarketplaceFilters,
  ProductSchema,
  LineageGraph,
  SloSummary,
  OutputPortInterfaceType,
  ComplianceStateValue,
  MarketplaceSortOption,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  @Get('products')
  listProducts(
    @ReqContext() ctx: RequestContext,
    @Query('domain') domain?: string,
    @Query('outputPortType') outputPortType?: string,
    @Query('compliance') compliance?: string,
    @Query('trustScoreMin') trustScoreMin?: string,
    @Query('trustScoreMax') trustScoreMax?: string,
    @Query('tags') tags?: string,
    @Query('includeDeprecated') includeDeprecated?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<MarketplaceProductList> {
    const filters: MarketplaceFilters = {};
    if (domain)       filters.domain           = domain.split(',').filter(Boolean);
    if (outputPortType) filters.outputPortType = outputPortType.split(',').filter(Boolean) as OutputPortInterfaceType[];
    if (compliance)   filters.compliance       = compliance.split(',').filter(Boolean) as ComplianceStateValue[];
    if (trustScoreMin !== undefined) filters.trustScoreMin = parseFloat(trustScoreMin);
    if (trustScoreMax !== undefined) filters.trustScoreMax = parseFloat(trustScoreMax);
    if (tags)         filters.tags             = tags.split(',').filter(Boolean);
    if (includeDeprecated === 'true') filters.includeDeprecated = true;
    if (sort)         filters.sort             = sort as MarketplaceSortOption;

    return this.marketplaceService.listProducts(
      ctx.orgId,
      filters,
      page  ? parseInt(page,  10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ---------------------------------------------------------------------------
  // Detail
  // ---------------------------------------------------------------------------

  @Get('products/:productId')
  getProductDetail(
    @ReqContext() ctx: RequestContext,
    @Param('productId') productId: string,
  ): Promise<MarketplaceProductDetail> {
    return this.marketplaceService.getProductDetail(ctx.orgId, productId);
  }

  @Get('products/:productId/schema')
  getProductSchema(
    @ReqContext() ctx: RequestContext,
    @Param('productId') productId: string,
  ): Promise<ProductSchema> {
    return this.marketplaceService.getProductSchema(ctx.orgId, productId);
  }

  @Get('products/:productId/lineage')
  getProductLineage(
    @ReqContext() ctx: RequestContext,
    @Param('productId') productId: string,
    @Query('depth') depth?: string,
  ): Promise<LineageGraph> {
    const d = depth ? Math.min(5, Math.max(1, parseInt(depth, 10))) : 3;
    return this.marketplaceService.getProductLineage(ctx.orgId, productId, d);
  }

  @Get('products/:productId/slos')
  getProductSlos(
    @ReqContext() ctx: RequestContext,
    @Param('productId') productId: string,
  ): Promise<SloSummary> {
    return this.marketplaceService.getProductSlos(ctx.orgId, productId);
  }

  // ---------------------------------------------------------------------------
  // Legacy text search (OpenSearch-backed)
  // ---------------------------------------------------------------------------

  @Get('search')
  search(
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
