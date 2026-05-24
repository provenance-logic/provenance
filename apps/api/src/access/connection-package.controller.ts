import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AllowCrossOrgRead } from '../auth/allow-cross-org-read.decorator.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import {
  ConnectionPackageService,
  SUPPORTED_SNIPPET_DESTINATIONS,
  type SnippetDestination,
  type PortSnippetResponse,
} from './connection-package.service.js';
import type { RequestContext } from '@provenance/types';

/**
 * Per-port snippet generation for the consumer-grade outbound flow.
 *
 * Marked `@AllowCrossOrgRead` because the data-mesh marketplace's central
 * use case is a consumer in Org A discovering and connecting to a product
 * owned by Org B. The service-layer access-grant check is what gates the
 * snippet content — without an active grant on the product (or owner
 * relationship), the response is `{ available: false, reason: 'request_access_required' }`.
 *
 * See: documents/architecture/consumer-grade-outbound-reframe-2026-05-22.md.
 */
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products/:productId/ports/:portId/snippet')
export class ConnectionPackageController {
  constructor(private readonly service: ConnectionPackageService) {}

  @Get()
  @AllowCrossOrgRead()
  async getSnippet(
    @Param('orgId') productOrgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
    @Query('destination') destinationParam: string,
    @Query('consumerAccountLocator') consumerAccountLocatorParam: string | undefined,
    @ReqContext() ctx: RequestContext,
  ): Promise<PortSnippetResponse> {
    if (!destinationParam) {
      throw new BadRequestException('destination query parameter is required');
    }
    if (!isSnippetDestination(destinationParam)) {
      throw new BadRequestException(
        `Unsupported destination "${destinationParam}". Supported: ${SUPPORTED_SNIPPET_DESTINATIONS.join(', ')}`,
      );
    }

    const result = await this.service.generateSnippetForPort(
      productOrgId,
      productId,
      portId,
      destinationParam,
      ctx.principalId,
      consumerAccountLocatorParam || undefined,
    );
    if (!result) {
      throw new NotFoundException('Product or port not found');
    }
    return result;
  }
}

function isSnippetDestination(value: string): value is SnippetDestination {
  return (SUPPORTED_SNIPPET_DESTINATIONS as string[]).includes(value);
}
