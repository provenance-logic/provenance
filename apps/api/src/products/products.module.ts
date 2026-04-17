import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';
import { LifecycleEventEntity } from './entities/lifecycle-event.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../observability/entities/slo-evaluation.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { SchemaSnapshotEntity } from '../connectors/entities/schema-snapshot.entity.js';
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
      DomainEntity,
      ComplianceStateEntity,
      SloDeclarationEntity,
      SloEvaluationEntity,
      AccessGrantEntity,
      AccessRequestEntity,
      SchemaSnapshotEntity,
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
