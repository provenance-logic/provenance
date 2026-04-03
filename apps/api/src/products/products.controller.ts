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
import { ProductsService } from './products.service.js';
import type {
  RequestContext,
  CreateDataProductRequest,
  UpdateDataProductRequest,
  DataProductStatus,
  DeclarePortRequest,
  UpdatePortRequest,
  PublishProductRequest,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/domains/:domainId/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ---------------------------------------------------------------------------
  // Data Products
  // ---------------------------------------------------------------------------

  @Get()
  listProducts(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
    @Query('status') status?: DataProductStatus,
  ) {
    return this.productsService.listProducts(orgId, domainId, Number(limit), Number(offset), status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Body() dto: CreateDataProductRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.productsService.createProduct(orgId, domainId, dto, ctx.principalId);
  }

  @Get(':productId')
  getProduct(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Param('productId') productId: string,
  ) {
    return this.productsService.getProduct(orgId, domainId, productId);
  }

  @Patch(':productId')
  updateProduct(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateDataProductRequest,
  ) {
    return this.productsService.updateProduct(orgId, domainId, productId, dto);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Param('productId') productId: string,
  ) {
    return this.productsService.deleteProduct(orgId, domainId, productId);
  }

  @Post(':productId/publish')
  publishProduct(
    @Param('orgId') orgId: string,
    @Param('domainId') domainId: string,
    @Param('productId') productId: string,
    @Body() dto: PublishProductRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.productsService.publishProduct(orgId, domainId, productId, dto, ctx.principalId);
  }

  // ---------------------------------------------------------------------------
  // Ports
  // ---------------------------------------------------------------------------

  @Get(':productId/ports')
  listPorts(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.productsService.listPorts(orgId, productId, Number(limit), Number(offset));
  }

  @Post(':productId/ports')
  @HttpCode(HttpStatus.CREATED)
  declarePort(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Body() dto: DeclarePortRequest,
  ) {
    return this.productsService.declarePort(orgId, productId, dto);
  }

  @Get(':productId/ports/:portId')
  getPort(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
  ) {
    return this.productsService.getPort(orgId, productId, portId);
  }

  @Patch(':productId/ports/:portId')
  updatePort(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
    @Body() dto: UpdatePortRequest,
  ) {
    return this.productsService.updatePort(orgId, productId, portId, dto);
  }

  @Delete(':productId/ports/:portId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePort(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Param('portId') portId: string,
  ) {
    return this.productsService.deletePort(orgId, productId, portId);
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  @Get(':productId/versions')
  listVersions(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.productsService.listVersions(orgId, productId, Number(limit), Number(offset));
  }
}
