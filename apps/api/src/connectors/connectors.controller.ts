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
import { ReqContext } from '../auth/request-context.decorator.js';
import { ConnectorsService } from './connectors.service.js';
import type {
  RequestContext,
  RegisterConnectorRequest,
  UpdateConnectorRequest,
  ValidationStatus,
  SourceType,
  RegisterSourceRequest,
  UpdateSourceRequest,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/connectors')
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  // ---------------------------------------------------------------------------
  // Connectors
  // ---------------------------------------------------------------------------

  @Get()
  listConnectors(
    @Param('orgId') orgId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
    @Query('domainId') domainId?: string,
    @Query('validationStatus') validationStatus?: ValidationStatus,
  ) {
    return this.connectorsService.listConnectors(
      orgId,
      Number(limit),
      Number(offset),
      domainId,
      validationStatus,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  registerConnector(
    @Param('orgId') orgId: string,
    @Body() dto: RegisterConnectorRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.connectorsService.registerConnector(orgId, dto, ctx.principalId);
  }

  @Get(':connectorId')
  getConnector(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
  ) {
    return this.connectorsService.getConnector(orgId, connectorId);
  }

  @Patch(':connectorId')
  updateConnector(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Body() dto: UpdateConnectorRequest,
  ) {
    return this.connectorsService.updateConnector(orgId, connectorId, dto);
  }

  @Delete(':connectorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteConnector(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
  ) {
    return this.connectorsService.deleteConnector(orgId, connectorId);
  }

  @Post(':connectorId/validate')
  validateConnector(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
  ) {
    return this.connectorsService.validateConnector(orgId, connectorId);
  }

  // ---------------------------------------------------------------------------
  // Health Events
  // ---------------------------------------------------------------------------

  @Get(':connectorId/health')
  listHealthEvents(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.connectorsService.listHealthEvents(
      orgId,
      connectorId,
      Number(limit),
      Number(offset),
    );
  }

  // ---------------------------------------------------------------------------
  // Source Registrations
  // ---------------------------------------------------------------------------

  @Get(':connectorId/sources')
  listSourceRegistrations(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
    @Query('sourceType') sourceType?: SourceType,
  ) {
    return this.connectorsService.listSourceRegistrations(
      orgId,
      connectorId,
      Number(limit),
      Number(offset),
      sourceType,
    );
  }

  @Post(':connectorId/sources')
  @HttpCode(HttpStatus.CREATED)
  registerSource(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Body() dto: RegisterSourceRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.connectorsService.registerSource(
      orgId,
      connectorId,
      dto,
      ctx.principalId,
    );
  }

  @Get(':connectorId/sources/:sourceId')
  getSourceRegistration(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.connectorsService.getSourceRegistration(orgId, connectorId, sourceId);
  }

  @Patch(':connectorId/sources/:sourceId')
  updateSourceRegistration(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateSourceRequest,
  ) {
    return this.connectorsService.updateSourceRegistration(
      orgId,
      connectorId,
      sourceId,
      dto,
    );
  }

  @Delete(':connectorId/sources/:sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSourceRegistration(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Param('sourceId') sourceId: string,
  ) {
    return this.connectorsService.deleteSourceRegistration(
      orgId,
      connectorId,
      sourceId,
    );
  }

  // ---------------------------------------------------------------------------
  // Schema Snapshots
  // ---------------------------------------------------------------------------

  @Get(':connectorId/sources/:sourceId/snapshots')
  listSchemaSnapshots(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Param('sourceId') sourceId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.connectorsService.listSchemaSnapshots(
      orgId,
      connectorId,
      sourceId,
      Number(limit),
      Number(offset),
    );
  }

  @Post(':connectorId/sources/:sourceId/snapshots')
  @HttpCode(HttpStatus.CREATED)
  captureSchemaSnapshot(
    @Param('orgId') orgId: string,
    @Param('connectorId') connectorId: string,
    @Param('sourceId') sourceId: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.connectorsService.captureSchemaSnapshot(
      orgId,
      connectorId,
      sourceId,
      ctx.principalId,
    );
  }
}
