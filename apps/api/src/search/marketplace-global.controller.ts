import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MarketplaceService } from './marketplace.service.js';
import type {
  MarketplaceProductList,
  MarketplaceFilters,
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
}
