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
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { AllowNoOrg } from '../auth/allow-no-org.decorator.js';
import { OrganizationsService } from './organizations.service.js';
import type {
  RequestContext,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  CreateDomainRequest,
  UpdateDomainRequest,
  AddMemberRequest,
} from '@provenance/types';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  @Get()
  listOrganizations(
    @ReqContext() ctx: RequestContext,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.orgsService.listOrganizations(ctx, Number(limit), Number(offset));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrganization(@Body() dto: CreateOrganizationRequest) {
    return this.orgsService.createOrganization(dto);
  }

  /**
   * Self-serve tenant provisioning — F10.2. The calling Keycloak user becomes
   * the first Platform Administrator. No operator involvement required. The
   * caller's token does NOT need a provenance_org_id claim (they don't have
   * an org yet); the endpoint will bind the claim after creating the org.
   */
  @Post('self-serve')
  @AllowNoOrg()
  @HttpCode(HttpStatus.CREATED)
  selfServeOrganization(
    @Body() dto: CreateOrganizationRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.selfServeOrganization(dto, ctx);
  }

  @Get(':orgId')
  getOrganization(@Param('orgId') orgId: string) {
    return this.orgsService.getOrganization(orgId);
  }

  @Patch(':orgId')
  updateOrganization(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrganizationRequest,
  ) {
    return this.orgsService.updateOrganization(orgId, dto);
  }

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------

  @Get(':orgId/domains')
  listDomains(
    @Param('orgId') orgId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.orgsService.listDomains(orgId, Number(limit), Number(offset));
  }

  @Post(':orgId/domains')
  @HttpCode(HttpStatus.CREATED)
  createDomain(
    @Param('orgId') orgId: string,
    @Body() dto: CreateDomainRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.createDomain(orgId, dto, ctx);
  }

  @Get(':orgId/domains/:domainId')
  getDomain(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
  ) {
    return this.orgsService.getDomain(orgId, domainId);
  }

  @Patch(':orgId/domains/:domainId')
  updateDomain(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Body() dto: UpdateDomainRequest,
  ) {
    return this.orgsService.updateDomain(orgId, domainId, dto);
  }

  @Delete(':orgId/domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDomain(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
  ) {
    return this.orgsService.deleteDomain(orgId, domainId);
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  @Get(':orgId/members')
  listMembers(
    @Param('orgId') orgId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.orgsService.listMembers(orgId, Number(limit), Number(offset));
  }

  @Post(':orgId/members')
  @HttpCode(HttpStatus.CREATED)
  @Roles('org_admin')
  addMember(
    @Param('orgId') orgId: string,
    @Body() dto: AddMemberRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.addMember(orgId, dto, ctx.principalId);
  }

  @Delete(':orgId/members/:principalId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('org_admin')
  removeMember(
    @Param('orgId') orgId: string,
    @Param('principalId') principalId: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.removeMember(orgId, principalId, ctx.principalId);
  }

  // F7.7 — per-role revoke. `removeMember` above strips every role the
  // principal holds in the org; this strips one specific org-level role
  // (domainId IS NULL). Use this from the Roles page so revoking
  // governance_member doesn't accidentally remove org_admin too.
  @Delete(':orgId/members/:principalId/roles/:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('org_admin')
  removeMemberRole(
    @Param('orgId') orgId: string,
    @Param('principalId') principalId: string,
    @Param('role') role: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.removeMemberRole(
      orgId,
      principalId,
      role as AddMemberRequest['role'],
      ctx.principalId,
    );
  }

  // ---------------------------------------------------------------------------
  // Domain-scoped members (F7.22 / F10.4)
  //
  // Distinct from the org-scoped /members surface above: these endpoints
  // operate on role_assignments rows with a non-null domain_id, which is
  // what domain owners actually need to manage their team without falling
  // back to the Keycloak console. The org-scoped endpoints continue to
  // work for org_admins managing org-level role assignments.
  // ---------------------------------------------------------------------------

  @Get(':orgId/domains/:domainId/members')
  @Roles('org_admin', 'domain_owner')
  listDomainMembers(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.orgsService.listDomainMembers(orgId, domainId, Number(limit), Number(offset));
  }

  @Post(':orgId/domains/:domainId/members')
  @HttpCode(HttpStatus.CREATED)
  @Roles('org_admin', 'domain_owner')
  addDomainMember(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Body() dto: AddMemberRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.addDomainMember(orgId, domainId, dto, ctx.principalId);
  }

  @Delete(':orgId/domains/:domainId/members/:principalId/roles/:role')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('org_admin', 'domain_owner')
  removeDomainMemberRole(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Param('principalId') principalId: string,
    @Param('role') role: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.orgsService.removeDomainMemberRole(
      orgId,
      domainId,
      principalId,
      role as AddMemberRequest['role'],
      ctx.principalId,
    );
  }
}
