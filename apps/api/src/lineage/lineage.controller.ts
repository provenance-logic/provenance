import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AllowCrossOrgRead } from '../auth/allow-cross-org-read.decorator.js';
import { LineageService } from './lineage.service.js';
import type { EmitLineageEventRequest, LineageGraphDto } from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/lineage')
export class LineageController {
  constructor(private readonly lineageService: LineageService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async emitEvent(
    @Param('orgId') orgId: string,
    @Body() body: EmitLineageEventRequest,
  ) {
    const entry = await this.lineageService.emitEvent(orgId, body);
    return {
      id: entry.id,
      status: 'accepted',
      neo4j_written: entry.neo4jWritten,
    };
  }

  @Post('events/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  async emitBatch(
    @Param('orgId') orgId: string,
    @Body() body: { events: EmitLineageEventRequest[] },
  ) {
    const entries = await this.lineageService.emitBatch(orgId, body.events);
    return {
      count: entries.length,
      status: 'accepted',
      ids: entries.map((e) => e.id),
    };
  }

  @Get('products/:productNodeId/upstream')
  @AllowCrossOrgRead()
  async getUpstream(
    @Param('orgId') orgId: string,
    @Param('productNodeId') productNodeId: string,
    @Query('depth') depth = '3',
  ): Promise<LineageGraphDto> {
    const d = Math.min(Math.max(Number(depth) || 3, 1), 5);
    return this.lineageService.getUpstreamLineage(orgId, productNodeId, d);
  }

  @Get('products/:productNodeId/downstream')
  @AllowCrossOrgRead()
  async getDownstream(
    @Param('orgId') orgId: string,
    @Param('productNodeId') productNodeId: string,
    @Query('depth') depth = '3',
  ): Promise<LineageGraphDto> {
    const d = Math.min(Math.max(Number(depth) || 3, 1), 5);
    return this.lineageService.getDownstreamLineage(orgId, productNodeId, d);
  }

  @Get('products/:productNodeId/impact')
  @AllowCrossOrgRead()
  async getImpact(
    @Param('orgId') orgId: string,
    @Param('productNodeId') productNodeId: string,
    @Query('depth') depth = '3',
  ): Promise<LineageGraphDto> {
    const d = Math.min(Math.max(Number(depth) || 3, 1), 5);
    return this.lineageService.getImpactAnalysis(orgId, productNodeId, d);
  }
}
