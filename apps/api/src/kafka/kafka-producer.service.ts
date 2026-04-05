import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Producer, KafkaJSError } from 'kafkajs';

export const KAFKA_BROKERS = 'KAFKA_BROKERS';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  constructor(@Inject(KAFKA_BROKERS) brokers: string[]) {
    const kafka = new Kafka({ clientId: 'provenance-api', brokers });
    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
    } catch (err: unknown) {
      this.logger.warn('Kafka broker unreachable — event publishing disabled', (err as Error).message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(topic: string, key: string, value: unknown): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(value) }],
      });
    } catch (err: unknown) {
      if (err instanceof KafkaJSError) {
        this.logger.warn(`Kafka publish skipped — broker unavailable (topic: ${topic})`, err.message);
        return;
      }
      throw err;
    }
  }
}
