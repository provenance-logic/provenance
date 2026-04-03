import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaModule } from '../kafka/kafka.module.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { opensearchClientProvider } from './opensearch.client.js';
import { TrustScoreService } from './trust-score.service.js';
import { ProductIndexService } from './product-index.service.js';
import { KafkaConsumerService } from './kafka-consumer.service.js';
import { MarketplaceService } from './marketplace.service.js';
import { MarketplaceController } from './marketplace.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ComplianceStateEntity]),
    KafkaModule,
  ],
  providers: [
    opensearchClientProvider,
    TrustScoreService,
    ProductIndexService,
    KafkaConsumerService,
    MarketplaceService,
  ],
  controllers: [MarketplaceController],
})
export class SearchModule {}
