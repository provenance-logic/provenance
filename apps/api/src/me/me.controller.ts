import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { MeService } from './me.service.js';
import type { MeProfileResponse, RequestContext } from '@provenance/types';

// F7.48 — Provenance Account Surface backend.
// GET /me returns the current caller's profile for the /account page.
// Sibling routes under /me are reserved for other per-principal reads
// (preferences already lives at /me/preferences via PreferencesController).
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  getProfile(@ReqContext() ctx: RequestContext): Promise<MeProfileResponse> {
    return this.meService.getProfile(ctx);
  }
}
