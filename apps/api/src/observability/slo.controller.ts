import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { SloService } from './slo.service.js';
import type { CreateSloDeclarationDto, UpdateSloDeclarationDto, CreateSloEvaluationDto } from './slo.service.js';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products/:productId')
export class SloController {
  constructor(private readonly sloService: SloService) {}

  // ---------------------------------------------------------------------------
  // Declarations
  // ---------------------------------------------------------------------------

  @Post('slos')
  @HttpCode(HttpStatus.CREATED)
  createDeclaration(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Body() body: CreateSloDeclarationDto,
  ) {
    return this.sloService.createDeclaration(orgId, productId, body);
  }

  @Get('slos')
  listDeclarations(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Query('status') status = 'active',
  ) {
    return this.sloService.listDeclarations(orgId, productId, status);
  }

  @Get('slos/:sloId')
  getDeclaration(
    @Param('orgId') orgId: string,
    @Param('sloId') sloId: string,
  ) {
    return this.sloService.getDeclaration(orgId, sloId);
  }

  @Patch('slos/:sloId')
  updateDeclaration(
    @Param('orgId') orgId: string,
    @Param('sloId') sloId: string,
    @Body() body: UpdateSloDeclarationDto,
  ) {
    return this.sloService.updateDeclaration(orgId, sloId, body);
  }

  @Delete('slos/:sloId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDeclaration(
    @Param('orgId') orgId: string,
    @Param('sloId') sloId: string,
  ) {
    return this.sloService.deleteDeclaration(orgId, sloId);
  }

  // ---------------------------------------------------------------------------
  // Evaluations
  // ---------------------------------------------------------------------------

  @Post('slos/:sloId/evaluations')
  @HttpCode(HttpStatus.CREATED)
  createEvaluation(
    @Param('orgId') orgId: string,
    @Param('sloId') sloId: string,
    @Body() body: CreateSloEvaluationDto,
  ) {
    return this.sloService.createEvaluation(orgId, sloId, body);
  }

  @Get('slos/:sloId/evaluations')
  listEvaluations(
    @Param('orgId') orgId: string,
    @Param('sloId') sloId: string,
    @Query('limit') limit = '50',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.sloService.listEvaluations(orgId, sloId, Number(limit), from, to);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  @Get('slo-summary')
  getSloSummary(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.sloService.getSloSummary(orgId, productId);
  }
}
