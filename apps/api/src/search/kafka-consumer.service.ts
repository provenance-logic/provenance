import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_BROKERS } from '../kafka/kafka-producer.service.js';
import { ProductIndexService } from './product-index.service.js';
import type { ProductLifecycleEvent } from '@provenance/types';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumer: Consumer;

  constructor(
    @Inject(KAFKA_BROKERS) brokers: string[],
    private readonly productIndexService: ProductIndexService,
  ) {
    const kafka = new Kafka({ clientId: 'provenance-api-search', brokers });
    this.consumer = kafka.consumer({ groupId: 'provenance-search-indexer' });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'product.lifecycle', fromBeginning: false });
    await this.consumer.run({
      eachMessage: (payload: EachMessagePayload) => this.handleMessage(payload),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let event: ProductLifecycleEvent;
    try {
      event = JSON.parse(message.value.toString()) as ProductLifecycleEvent;
    } catch {
      this.logger.warn('Received unparseable message on product.lifecycle');
      return;
    }

    try {
      if (event.eventType === 'product.published') {
        await this.productIndexService.indexProduct(event.orgId, event.snapshot);
      } else if (event.eventType === 'product.decommissioned') {
        await this.productIndexService.removeProduct(event.productId);
      }
      // product.deprecated: product remains searchable — no index change needed
    } catch (err) {
      this.logger.error(
        `Failed to process ${event.eventType} for product ${event.productId}`,
        err,
      );
    }
  }
}
