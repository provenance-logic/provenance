import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { ConsentService } from './consent.service.js';
import type {
  RequestContext,
  ConnectionReference,
  ConnectionReferenceList,
  ConnectionReferenceState,
  SubmitConnectionReferenceRequest,
  ApproveConnectionReferenceOptions,
  DenyConnectionReferenceRequest,
  RevokeConnectionReferenceRequest,
} from '@provenance/types';

// Domain 12 HTTP surface. All mutations go through ConsentService which holds
// the state-machine invariants; the controller's only job is request
// validation, auth context extraction, and shape mapping.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post('connection-references')
  @HttpCode(HttpStatus.CREATED)
  requestConnectionReference(
    @ReqContext() ctx: RequestContext,
    @Body() dto: SubmitConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    return this.consentService.requestConnectionReference(ctx.orgId, ctx.principalId, dto);
  }

  @Get('connection-references')
  listConnectionReferences(
    @ReqContext() ctx: RequestContext,
    @Query('agentId') agentId?: string,
    @Query('productId') productId?: string,
    @Query('owningPrincipalId') owningPrincipalId?: string,
    @Query('state') state?: ConnectionReferenceState,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ConnectionReferenceList> {
    return this.consentService.listConnectionReferences(ctx.orgId, {
      ...(agentId !== undefined && { agentId }),
      ...(productId !== undefined && { productId }),
      ...(owningPrincipalId !== undefined && { owningPrincipalId }),
      ...(state !== undefined && { state }),
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('connection-references/:referenceId')
  getConnectionReference(
    @ReqContext() ctx: RequestContext,
    @Param('referenceId') referenceId: string,
  ): Promise<ConnectionReference> {
    return this.consentService.getConnectionReference(ctx.orgId, referenceId);
  }

  @Post('connection-references/:referenceId/approve')
  approveConnectionReference(
    @ReqContext() ctx: RequestContext,
    @Param('referenceId') referenceId: string,
    @Body() dto: ApproveConnectionReferenceOptions = {},
  ): Promise<ConnectionReference> {
    return this.consentService.approveConnectionReference(
      ctx.orgId,
      referenceId,
      ctx.principalId,
      dto,
    );
  }

  @Post('connection-references/:referenceId/deny')
  denyConnectionReference(
    @ReqContext() ctx: RequestContext,
    @Param('referenceId') referenceId: string,
    @Body() dto: DenyConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    return this.consentService.denyConnectionReference(
      ctx.orgId,
      referenceId,
      ctx.principalId,
      dto,
    );
  }

  @Post('connection-references/:referenceId/revoke')
  revokeConnectionReference(
    @ReqContext() ctx: RequestContext,
    @Param('referenceId') referenceId: string,
    @Body() dto: RevokeConnectionReferenceRequest,
  ): Promise<ConnectionReference> {
    return this.consentService.revokeConnectionReference(
      ctx.orgId,
      referenceId,
      ctx.principalId,
      dto,
    );
  }
}
