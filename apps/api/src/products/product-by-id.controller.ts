import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import type { RequestContext, DataProduct } from '@provenance/types';
import { ProductsService } from './products.service.js';

/**
 * Product detail resolvable by product id alone — no domain id required.
 *
 * The domain-scoped `ProductsController`
 * (`/organizations/:orgId/domains/:domainId/products/:productId`) forces every
 * caller to supply a domainId. Product-bound MCP tools know only the
 * product id (it is globally unique), so requiring domainId was API-surface
 * inconsistency unique to `get_product` — and omitting it pushed the literal
 * string `"undefined"` into a `uuid` column, surfacing as HTTP 500 (B-082).
 *
 * This route resolves by `(orgId, productId)`, staying inside the same tenant
 * boundary as the domain-scoped route (JwtAuthGuard enforces
 * URL `:orgId` === JWT `org_id`). `ParseUUIDPipe` rejects a non-UUID
 * `productId` with 400 rather than letting it reach the database.
 */
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/products')
export class ProductByIdController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(':productId')
  getProductById(
    @Param('orgId') orgId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @ReqContext() ctx: RequestContext,
  ): Promise<DataProduct> {
    return this.productsService.getProductById(orgId, productId, ctx);
  }
}
