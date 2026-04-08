import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TrustScoreService } from './trust-score.service.js';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products/:productId/trust-score')
export class TrustScoreController {
  constructor(private readonly trustScoreService: TrustScoreService) {}

  @Get()
  getCurrentScore(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.trustScoreService.getCurrentScore(orgId, productId);
  }

  @Get('history')
  getHistory(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Query('limit') limit = '30',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.trustScoreService.getHistory(orgId, productId, Number(limit), from, to);
  }

  @Post('recompute')
  @HttpCode(HttpStatus.ACCEPTED)
  recompute(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.trustScoreService.recompute(orgId, productId);
  }
}
