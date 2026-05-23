import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AllowCrossOrgRead } from '../auth/allow-cross-org-read.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { ConnectionPackageService } from './connection-package.service.js';
import type { PortSituationResponse, RequestContext } from '@provenance/types';

/**
 * F10.15 layer 1 (Phase 5.9) — consumer-flow situation detection for a
 * port. Returns A or B with a recommendedNext UX hint:
 *
 *   - A: producer-declared open access (no per-product grant required);
 *     recommendedNext = 'view_snippet'.
 *   - B: per-product grant required; recommendedNext = 'view_snippet'
 *     when the caller already has an active grant, 'request_access'
 *     otherwise.
 *
 * Situation C (caller has no source-system account at all) is not yet
 * reported — its detection needs the layer-2 probe or directory
 * integration (post-OSR per OS10.4). Until then this endpoint reports
 * A or B only.
 *
 * Marked `@AllowCrossOrgRead` because the data-mesh marketplace's
 * consumer flow is cross-org by design (same precedent as the snippet
 * endpoint at `ConnectionPackageController`).
 */
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products/:productId/ports/:portId/situation')
export class PortSituationController {
  constructor(private readonly service: ConnectionPackageService) {}

  @Get()
  @AllowCrossOrgRead()
  async getSituation(
    @Param('orgId') productOrgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
    @ReqContext() ctx: RequestContext,
  ): Promise<PortSituationResponse> {
    const result = await this.service.resolveSituationForPort(
      productOrgId,
      productId,
      portId,
      ctx.principalId,
    );
    if (!result) {
      throw new NotFoundException('Product or port not found');
    }
    return result;
  }
}
