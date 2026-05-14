import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { PreferencesService } from './preferences.service.js';
import type {
  PrincipalPreferencesResponse,
  RequestContext,
  UpdatePrincipalPreferencesRequest,
} from '@provenance/types';

// F7.46 per-principal preferences (initial use: onboarding wizard state).
//
// Routes are under `/me/...` rather than `/principals/:id/...` because
// callers always operate on their own row — the request context's
// principalId is the only identity that matters here. This avoids
// inviting "let me read someone else's preferences" patterns into the
// codebase and keeps the URL semantically honest.
@UseGuards(JwtAuthGuard)
@Controller('me')
export class PreferencesController {
  constructor(private readonly prefsService: PreferencesService) {}

  @Get('preferences')
  getPreferences(@ReqContext() ctx: RequestContext): Promise<PrincipalPreferencesResponse> {
    return this.prefsService.getPreferences(ctx.orgId, ctx.principalId);
  }

  @Patch('preferences')
  updatePreferences(
    @ReqContext() ctx: RequestContext,
    @Body() dto: UpdatePrincipalPreferencesRequest,
  ): Promise<PrincipalPreferencesResponse> {
    return this.prefsService.updatePreferences(ctx.orgId, ctx.principalId, dto.preferences ?? {});
  }
}
