import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';
import { LifecycleEventEntity } from './entities/lifecycle-event.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { GovernanceModule } from '../governance/governance.module.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { SearchModule } from '../search/search.module.js';
import { TrustScoreService } from '../search/trust-score.service.js';

export { ProductsService };

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DataProductEntity,
      PortDeclarationEntity,
      ProductVersionEntity,
      LifecycleEventEntity,
      PrincipalEntity,
      ComplianceStateEntity,
    ]),
    GovernanceModule,
    KafkaModule,
    SearchModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, TrustScoreService],
  exports: [ProductsService],
})
export class ProductsModule {}
