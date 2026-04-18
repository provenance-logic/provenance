import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { MarketplaceService } from './marketplace.service.js';
import type {
  RequestContext,
  MarketplaceProductList,
  MarketplaceProductDetail,
  MarketplaceFilters,
  ProductSchema,
  LineageGraph,
  SloSummary,
  AccessRequestList,
  OutputPortInterfaceType,
  ComplianceStateValue,
  MarketplaceSortOption,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('marketplace')
export class MarketplaceGlobalController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('products')
  listProducts(
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

    return this.marketplaceService.listAllProducts(
      filters,
      page  ? parseInt(page,  10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('products/:productId')
  getProductDetail(
    @Param('productId') productId: string,
    @ReqContext() ctx: RequestContext,
  ): Promise<MarketplaceProductDetail> {
    return this.marketplaceService.getProductDetail(undefined, productId, ctx);
  }

  @Get('products/:productId/schema')
  getProductSchema(
    @Param('productId') productId: string,
  ): Promise<ProductSchema> {
    return this.marketplaceService.getProductSchema(undefined, productId);
  }

  @Get('products/:productId/lineage')
  getProductLineage(
    @Param('productId') productId: string,
    @Query('depth') depth?: string,
  ): Promise<LineageGraph> {
    const d = depth ? Math.min(5, Math.max(1, parseInt(depth, 10))) : 3;
    return this.marketplaceService.getProductLineage(undefined, productId, d);
  }

  @Get('products/:productId/slos')
  getProductSlos(
    @Param('productId') productId: string,
  ): Promise<SloSummary> {
    return this.marketplaceService.getProductSlos(undefined, productId);
  }

  @Get('products/:productId/access-requests')
  getMyAccessRequests(
    @ReqContext() ctx: RequestContext,
    @Param('productId') productId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AccessRequestList> {
    return this.marketplaceService.getMyAccessRequests(
      productId,
      ctx.principalId,
      limit  ? parseInt(limit,  10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }
}
