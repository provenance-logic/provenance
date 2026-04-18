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
import { Public } from '../auth/public.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { InvitationsService } from './invitations.service.js';
import type {
  RequestContext,
  CreateInvitationRequest,
  AcceptInvitationRequest,
} from '@provenance/types';

@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // ---------------------------------------------------------------------------
  // Org-scoped invitation management (authenticated, org_admin only)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('organizations/:orgId/invitations')
  @Roles('org_admin', 'domain_owner')
  listInvitations(
    @Param('orgId') orgId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.invitationsService.listInvitations(orgId, Number(limit), Number(offset));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('organizations/:orgId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @Roles('org_admin', 'domain_owner')
  createInvitation(
    @Param('orgId') orgId: string,
    @Body() dto: CreateInvitationRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.invitationsService.createInvitation(orgId, dto, ctx.principalId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('organizations/:orgId/invitations/:invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @Roles('org_admin', 'domain_owner')
  resendInvitation(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitationsService.resendInvitation(orgId, invitationId);
  }

  // ---------------------------------------------------------------------------
  // Domain-scoped invitation list (authenticated, domain_owner or above)
  // F7.22 — team management UI reads from this endpoint.
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('organizations/:orgId/domains/:domainId/invitations')
  @Roles('org_admin', 'domain_owner')
  listDomainInvitations(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.invitationsService.listDomainInvitations(
      orgId,
      domainId,
      Number(limit),
      Number(offset),
    );
  }

  // ---------------------------------------------------------------------------
  // Public acceptance endpoint — token-authenticated, no JWT required.
  // ---------------------------------------------------------------------------

  @Public()
  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationRequest,
  ) {
    return this.invitationsService.acceptInvitation(token, dto);
  }
}
