import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEnrichmentService } from './product-enrichment.service.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../observability/entities/slo-evaluation.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { SchemaSnapshotEntity } from '../connectors/entities/schema-snapshot.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PrincipalEntity,
      DomainEntity,
      SloDeclarationEntity,
      SloEvaluationEntity,
      AccessGrantEntity,
      AccessRequestEntity,
      SchemaSnapshotEntity,
    ]),
  ],
  providers: [ProductEnrichmentService],
  exports: [ProductEnrichmentService],
})
export class ProductEnrichmentModule {}
