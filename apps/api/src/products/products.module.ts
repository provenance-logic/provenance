import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';
import { LifecycleEventEntity } from './entities/lifecycle-event.entity.js';
import { GovernanceModule } from '../governance/governance.module.js';
import { KafkaModule } from '../kafka/kafka.module.js';

export { ProductsService };

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DataProductEntity,
      PortDeclarationEntity,
      ProductVersionEntity,
      LifecycleEventEntity,
    ]),
    GovernanceModule,
    KafkaModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
