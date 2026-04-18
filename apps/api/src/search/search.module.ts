import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaModule } from '../kafka/kafka.module.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { ProductVersionEntity } from '../products/entities/product-version.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { ProductEnrichmentModule } from '../products/product-enrichment.module.js';
import { opensearchClientProvider } from './opensearch.client.js';
import { TrustScoreService } from './trust-score.service.js';
import { ProductIndexService } from './product-index.service.js';
import { SearchIndexingService } from './search-indexing.service.js';
import { KafkaConsumerService } from './kafka-consumer.service.js';
import { MarketplaceService } from './marketplace.service.js';
import { MarketplaceController } from './marketplace.controller.js';
import { MarketplaceGlobalController } from './marketplace-global.controller.js';
import { NlQueryService } from './nl-query.service.js';
import { HybridSearchService } from './hybrid-search.service.js';
import { SemanticSearchController } from './semantic-search.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceStateEntity,
      DataProductEntity,
      PortDeclarationEntity,
      ProductVersionEntity,
      DomainEntity,
      AccessGrantEntity,
      AccessRequestEntity,
    ]),
    KafkaModule,
    ProductEnrichmentModule,
  ],
  providers: [
    opensearchClientProvider,
    TrustScoreService,
    ProductIndexService,
    SearchIndexingService,
    KafkaConsumerService,
    MarketplaceService,
    NlQueryService,
    HybridSearchService,
  ],
  controllers: [MarketplaceController, MarketplaceGlobalController, SemanticSearchController],
  exports: [SearchIndexingService, NlQueryService, HybridSearchService],
})
export class SearchModule {}
