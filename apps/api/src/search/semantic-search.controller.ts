import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { NlQueryService } from './nl-query.service.js';
import { HybridSearchService } from './hybrid-search.service.js';

interface SemanticSearchDto {
  query: string;
  org_id: string;
  limit?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('internal/search')
export class SemanticSearchController {
  constructor(
    private readonly nlQueryService: NlQueryService,
    private readonly hybridSearchService: HybridSearchService,
  ) {}

  @Post('semantic')
  @HttpCode(HttpStatus.OK)
  async semanticSearch(@Body() dto: SemanticSearchDto) {
    const intent = await this.nlQueryService.parseQuery(dto.query);
    const results = await this.hybridSearchService.search(
      intent,
      dto.org_id,
      dto.limit ?? 10,
    );
    return { intent, results };
  }
}
