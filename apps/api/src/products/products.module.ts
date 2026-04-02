import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';

export { ProductsService };

@Module({
  imports: [TypeOrmModule.forFeature([DataProductEntity, PortDeclarationEntity, ProductVersionEntity])],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
