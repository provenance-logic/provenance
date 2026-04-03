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
import { OrganizationsService } from './organizations.service.js';
import type {
  RequestContext,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  CreateDomainRequest,
  UpdateDomainRequest,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  @Get()
  listOrganizations(
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.orgsService.listOrganizations(Number(limit), Number(offset));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrganization(@Body() dto: CreateOrganizationRequest) {
    return this.orgsService.createOrganization(dto);
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
    @ReqContext() _ctx: RequestContext,
  ) {
    return this.orgsService.listDomains(orgId, Number(limit), Number(offset));
  }

  @Post(':orgId/domains')
  @HttpCode(HttpStatus.CREATED)
  createDomain(
    @Param('orgId') orgId: string,
    @Body() dto: CreateDomainRequest,
  ) {
    return this.orgsService.createDomain(orgId, dto);
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
}
