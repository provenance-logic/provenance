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
import { Roles } from '../auth/roles.decorator.js';
import { AllowCrossOrgRead } from '../auth/allow-cross-org-read.decorator.js';
import { AllowCrossOrgWriteForApproval } from '../auth/allow-cross-org-write-for-approval.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { AccessService } from './access.service.js';
import type {
  RequestContext,
  AccessGrant,
  AccessGrantList,
  DirectGrantRequest,
  AccessRequest,
  AccessRequestList,
  AccessRequestApprovalResult,
  SubmitAccessRequestRequest,
  ApproveAccessRequestRequest,
  DenyAccessRequestRequest,
  WithdrawAccessRequestRequest,
  ApprovalEventList,
} from '@provenance/types';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  // ---------------------------------------------------------------------------
  // Access Grants
  // ---------------------------------------------------------------------------

  @Get('grants')
  listGrants(
    @ReqContext() ctx: RequestContext,
    @Query('productId') productId?: string,
    @Query('granteePrincipalId') granteePrincipalId?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AccessGrantList> {
    return this.accessService.listGrants(ctx.orgId, {
      ...(productId !== undefined && { productId }),
      ...(granteePrincipalId !== undefined && { granteePrincipalId }),
      activeOnly: activeOnly === 'true',
      limit:  limit  ? parseInt(limit,  10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Post('grants')
  @HttpCode(HttpStatus.CREATED)
  @Roles('org_admin', 'domain_owner')
  createGrant(
    @ReqContext() ctx: RequestContext,
    @Body() dto: DirectGrantRequest,
  ): Promise<AccessGrant> {
    return this.accessService.createGrant(ctx.orgId, dto, ctx.principalId);
  }

  @Get('grants/:grantId')
  getGrant(
    @ReqContext() ctx: RequestContext,
    @Param('grantId') grantId: string,
  ): Promise<AccessGrant> {
    return this.accessService.getGrant(ctx.orgId, grantId);
  }

  @Post('grants/:grantId/revoke')
  @Roles('org_admin', 'domain_owner')
  revokeGrant(
    @ReqContext() ctx: RequestContext,
    @Param('grantId') grantId: string,
  ): Promise<AccessGrant> {
    return this.accessService.revokeGrant(ctx.orgId, grantId, ctx.principalId);
  }

  // ---------------------------------------------------------------------------
  // Access Requests
  // ---------------------------------------------------------------------------

  @Get('requests/mine')
  listMyRequests(
    @ReqContext() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AccessRequestList> {
    return this.accessService.listRequests(ctx.orgId, {
      requesterPrincipalId: ctx.principalId,
      ...(status !== undefined && { status }),
      limit:  limit  ? parseInt(limit,  10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('requests')
  listRequests(
    @ReqContext() ctx: RequestContext,
    @Query('productId') productId?: string,
    @Query('requesterPrincipalId') requesterPrincipalId?: string,
    @Query('status') status?: string,
    // forApprover=me filters to requests for products owned by the caller —
    // the approver queue used by the Pending Requests page.
    @Query('forApprover') forApprover?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AccessRequestList> {
    return this.accessService.listRequests(ctx.orgId, {
      ...(productId !== undefined && { productId }),
      ...(requesterPrincipalId !== undefined && { requesterPrincipalId }),
      ...(status !== undefined && { status }),
      ...(forApprover === 'me' && { forApproverPrincipalId: ctx.principalId }),
      limit:  limit  ? parseInt(limit,  10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  submitRequest(
    @ReqContext() ctx: RequestContext,
    @Body() dto: SubmitAccessRequestRequest,
  ): Promise<AccessRequest> {
    return this.accessService.submitRequest(ctx.orgId, dto, ctx.principalId);
  }

  // @AllowCrossOrgRead per B-071 Model A: both the requester (whose JWT
  // orgId matches request.orgId) and the product owner (whose JWT orgId
  // differs from request.orgId) need to read the request detail. The
  // service-layer principal check enforces the requester-or-owner rule.
  @Get('requests/:requestId')
  @AllowCrossOrgRead()
  getRequest(
    @ReqContext() ctx: RequestContext,
    @Param('requestId') requestId: string,
  ): Promise<AccessRequest> {
    return this.accessService.getRequest(ctx.orgId, requestId, ctx.principalId);
  }

  // @AllowCrossOrgWriteForApproval per B-071 Model A: under Model A
  // (anchor decision 3), the request row lives in the requester's org;
  // the product owner reaches across to approve. The service-layer
  // assertCallerCanResolve enforces that the caller owns the product
  // the request targets — the decorator only relaxes the URL/JWT org
  // match, not the resource-ownership check.
  @Post('requests/:requestId/approve')
  @Roles('org_admin', 'domain_owner')
  @AllowCrossOrgWriteForApproval()
  approveRequest(
    @ReqContext() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Body() dto: ApproveAccessRequestRequest = {},
  ): Promise<AccessRequestApprovalResult> {
    return this.accessService.approveRequest(
      ctx.orgId,
      requestId,
      dto,
      ctx.principalId,
      ctx.roles,
    );
  }

  @Post('requests/:requestId/deny')
  @Roles('org_admin', 'domain_owner')
  @AllowCrossOrgWriteForApproval()
  denyRequest(
    @ReqContext() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Body() dto: DenyAccessRequestRequest = {},
  ): Promise<AccessRequest> {
    return this.accessService.denyRequest(
      ctx.orgId,
      requestId,
      dto,
      ctx.principalId,
      ctx.roles,
    );
  }

  @Post('requests/:requestId/withdraw')
  withdrawRequest(
    @ReqContext() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Body() dto: WithdrawAccessRequestRequest = {},
  ): Promise<AccessRequest> {
    return this.accessService.withdrawRequest(ctx.orgId, requestId, dto, ctx.principalId);
  }

  // ---------------------------------------------------------------------------
  // Approval Events
  // ---------------------------------------------------------------------------

  // @AllowCrossOrgRead per B-071 Model A: same shape as getRequest —
  // requester or owner needs to read; service-layer check enforces it.
  @Get('requests/:requestId/events')
  @AllowCrossOrgRead()
  listApprovalEvents(
    @ReqContext() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApprovalEventList> {
    return this.accessService.listApprovalEvents(ctx.orgId, requestId, ctx.principalId, {
      limit:  limit  ? parseInt(limit,  10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }
}
