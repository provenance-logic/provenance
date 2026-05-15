import {
  Controller,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { SampleDataService } from './sample-data.service.js';
import type { RequestContext } from '@provenance/types';

// B-027 — Sample-data button.
//
// One endpoint, role-gated (org_admin only) and env-flag-gated
// (DEMO_DATA_ENABLED=true). Different gate than the SeedController next
// door: that one is constant-time-token-gated and dev-only, and is not
// safely callable from a user's browser session because the token is
// the bearer credential. This one is role-gated, so an org_admin can
// trigger it from the wizard's welcome step in a real session.
//
// Production deploys keep DEMO_DATA_ENABLED=false and the service
// throws NotFoundException so the surface looks like it doesn't exist.

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/sample-data')
export class SampleDataController {
  constructor(private readonly sampleDataService: SampleDataService) {}

  @Post()
  @Roles('org_admin')
  @HttpCode(HttpStatus.CREATED)
  async populate(
    @Param('orgId') orgId: string,
    @ReqContext() ctx: RequestContext,
  ) {
    if (ctx.orgId !== orgId) {
      throw new ForbiddenException('orgId in path does not match the caller\'s org context');
    }
    return this.sampleDataService.populate(orgId, ctx.principalId);
  }
}
