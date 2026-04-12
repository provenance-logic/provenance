import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { AgentsService, CreateAgentSchema, UpdateClassificationSchema } from './agents.service.js';
import type { RequestContext } from '@provenance/types';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registerAgent(
    @Body() body: Record<string, unknown>,
    @ReqContext() ctx: RequestContext,
  ) {
    const parsed = CreateAgentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.agentsService.registerAgent(parsed.data, ctx);
  }

  @Get(':agentId')
  async getAgent(@Param('agentId') agentId: string) {
    return this.agentsService.getAgent(agentId);
  }

  @Get()
  async listAgents(@Query('orgId') orgId: string) {
    if (!orgId) {
      throw new BadRequestException('orgId query parameter is required');
    }
    return this.agentsService.listAgents(orgId);
  }

  @Patch(':agentId/classification')
  async updateClassification(
    @Param('agentId') agentId: string,
    @Body() body: Record<string, unknown>,
    @ReqContext() ctx: RequestContext,
  ) {
    const parsed = UpdateClassificationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.agentsService.updateClassification(agentId, parsed.data, ctx);
  }
}
