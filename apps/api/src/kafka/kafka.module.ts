import { Module } from '@nestjs/common';
import { KafkaProducerService, KAFKA_BROKERS } from './kafka-producer.service.js';
import { getConfig } from '../config.js';

@Module({
  providers: [
    {
      provide: KAFKA_BROKERS,
      useFactory: () => getConfig().KAFKA_BROKERS.split(','),
    },
    KafkaProducerService,
  ],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
