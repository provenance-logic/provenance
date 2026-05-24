import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { ConnectionPackageService } from './connection-package.service.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import type { RequestContext } from '@provenance/types';

/**
 * F10.14 / Phase 5.11 — source-side view DDL generation.
 *
 * Producer-facing endpoint that returns the `CREATE OR REPLACE VIEW ...`
 * statement the producer pastes into their source system to back a
 * catalog name with a view over the physical source path. The platform
 * never executes the DDL itself per Constraint 3 / ADR-011.
 *
 * **Owner-only.** Deliberately NOT marked `@AllowCrossOrgRead` because
 * this is a producer surface — only the port owner needs the DDL. The
 * `JwtAuthGuard` enforces URL `:orgId === JWT orgId`. A second
 * service-layer check (in this controller) confirms the caller is the
 * actual product owner — a domain owner in the same org but a
 * different domain shouldn't be able to fetch arbitrary product DDL.
 */
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products/:productId/ports/:portId/source-view-ddl')
export class SourceViewDdlController {
  constructor(
    private readonly service: ConnectionPackageService,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
  ) {}

  @Get()
  async getSourceViewDdl(
    @Param('orgId') productOrgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
    @ReqContext() ctx: RequestContext,
  ): Promise<{
    available: boolean;
    ddl: string | null;
    reason?: string;
  }> {
    // Service-layer ownership check before consulting the service. Same
    // pattern as B-059 — role guard at the controller is necessary but
    // not sufficient; the second check confirms authority over the
    // specific resource.
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId: productOrgId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.ownerPrincipalId !== ctx.principalId) {
      throw new ForbiddenException(
        'Only the product owner may fetch the source-view DDL for this port',
      );
    }

    const result = await this.service.resolveSourceViewDdl(productOrgId, productId, portId);
    if (!result) throw new NotFoundException('Port not found');
    return result;
  }
}
