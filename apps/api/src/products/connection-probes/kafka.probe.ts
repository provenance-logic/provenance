import { Kafka, type SASLOptions } from 'kafkajs';
import type { KafkaConnectionDetails } from '@provenance/types';
import type { ConnectionProbe, ProbeOutcome } from './types.js';
import { withTimeout } from './registry.js';

/**
 * Kafka / Redpanda broker reachability probe. Connects an admin client to
 * the broker list, lists topics, and verifies the declared topic appears.
 * Uses kafkajs' connectionTimeout so a black-hole broker fails quickly
 * instead of blocking the outer probe timeout.
 */
export class KafkaProbe implements ConnectionProbe<KafkaConnectionDetails> {
  readonly interfaceType = 'streaming_topic' as const;

  probe(details: KafkaConnectionDetails, timeoutMs: number): Promise<ProbeOutcome> {
    return withTimeout(this.run(details, timeoutMs), timeoutMs, 'Kafka');
  }

  private async run(d: KafkaConnectionDetails, timeoutMs: number): Promise<ProbeOutcome> {
    const start = Date.now();
    const brokers = d.bootstrapServers
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    if (brokers.length === 0) {
      return { status: 'failure', message: 'bootstrapServers is empty' };
    }

    const sasl = this.sasl(d);
    const ssl = d.authMethod === 'sasl_plain' || d.authMethod === 'sasl_scram' || d.authMethod === 'mtls';
    // kajkajs treats the connection/request timeout fields as soft caps; the
    // outer withTimeout still applies for the absolute ceiling.
    const innerTimeout = Math.max(1000, Math.min(timeoutMs - 500, timeoutMs));
    const kafka = new Kafka({
      clientId: 'provenance-probe',
      brokers,
      ...(sasl ? { sasl } : {}),
      ssl,
      connectionTimeout: innerTimeout,
      requestTimeout: innerTimeout,
    });
    const admin = kafka.admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      const topicPresent = topics.includes(d.topic);
      const latencyMs = Date.now() - start;
      return {
        status: 'success',
        message: topicPresent
          ? `Brokers reachable, topic "${d.topic}" exists (${topics.length} topic(s) total)`
          : `Brokers reachable, but topic "${d.topic}" not found among ${topics.length} topic(s)`,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        status: 'failure',
        message: `Could not connect to brokers ${brokers.join(',')}: ${(err as Error).message}`,
        latencyMs,
      };
    } finally {
      try { await admin.disconnect(); } catch { /* ignore */ }
    }
  }

  private sasl(d: KafkaConnectionDetails): SASLOptions | undefined {
    if (d.authMethod === 'sasl_plain') {
      return {
        mechanism: 'plain',
        username: d.saslUsername ?? '',
        password: d.saslPassword ?? '',
      };
    }
    if (d.authMethod === 'sasl_scram') {
      return {
        mechanism: 'scram-sha-256',
        username: d.saslUsername ?? '',
        password: d.saslPassword ?? '',
      };
    }
    return undefined;
  }
}
