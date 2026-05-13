import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KafkaProducerService } from '../kafka/kafka-producer.service.js';

// ---------------------------------------------------------------------------
// Domain 12 — Connection Reference Outbox Publisher (PR #1 of the runtime-
// enforcement implementation plan; ADR-007 Phase 3, step 9).
//
// Drains `consent.connection_reference_outbox` to the Redpanda topic
// `connection_reference.state`. The state-machine service (ConsentService)
// writes every state transition's outbox row inside the same PostgreSQL
// transaction as the state change and the audit-log entry; this worker is
// the asynchronous half that gets those rows onto the broker.
//
// Topic configuration target (per ADR-007). Redpanda auto-creates topics
// on first publish, so the topic comes into existence the moment the
// first outbox row is drained. The configuration target the auto-created
// topic should converge toward in production:
//   * Partition key: org_id (set by the publish call; the publisher
//     passes orgId as the Kafka message key so per-tenant ordering holds)
//   * Retention: 7 days (events only need to cover the AQL boot
//     cold-load gap; cache is authoritative after cold-load)
//   * Replication factor: 1 at MVP (single-broker Redpanda)
//   * Consumer group: `agent-query-connection-reference-cache` (lands
//     when the AQL consumer goes in, PR #3 of this arc)
// At MVP we rely on the auto-created defaults. Production parity work
// will add explicit topic configuration as part of the MSK migration.
//
// Polling design (per ADR-007 latency analysis).
//   * @Interval(1000) — 1 second between ticks. The ADR's NF12.3 budget
//     allows up to ~9s of publisher lag; 1s leaves comfortable headroom
//     for operational noise without burning CPU on an empty table.
//   * Each tick reads up to BATCH_SIZE unpublished rows with
//     FOR UPDATE SKIP LOCKED, publishes each, and marks them published.
//   * Single transaction per tick. If any publish throws, the
//     transaction rolls back — rows stay unpublished for next-tick retry
//     (at-least-once semantics; consumers must be idempotent per
//     ADR-007's "consumers idempotent" guarantee).
//   * SKIP LOCKED makes the design safe for future multi-instance API
//     deployments. MVP runs a single API process; the cost of including
//     SKIP LOCKED now is one keyword.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;
const TOPIC = 'connection_reference.state';

interface OutboxRow {
  id: string;
  org_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class ConnectionReferenceOutboxPublisher {
  private readonly logger = new Logger(ConnectionReferenceOutboxPublisher.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      await this.drain();
    } catch (err) {
      // drain() already wraps every publish in a transaction that rolls
      // back on failure, so rows stay unpublished for next tick. Logging
      // here is the operator signal that the broker is unreachable.
      this.logger.error(
        `Outbox drain tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Drain at most BATCH_SIZE unpublished outbox rows. Returns the number
   * of rows published. Exposed as a public method (rather than only
   * called from the cron) so integration tests can trigger drains
   * deterministically without waiting for ticks.
   */
  async drain(): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const rows = (await em.query(
        `SELECT id::text, org_id, event_type, payload
           FROM consent.connection_reference_outbox
          WHERE published_at IS NULL
          ORDER BY id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE],
      )) as OutboxRow[];

      if (rows.length === 0) {
        return 0;
      }

      // Publish in id-ascending order so the broker sees per-tenant
      // events in the order their transactions committed. The Kafka
      // message key is org_id, which the broker uses to route each
      // tenant's events to the same partition for ordering.
      for (const row of rows) {
        await this.kafkaProducer.publishStrict(TOPIC, row.org_id, row.payload);
      }

      const ids = rows.map((r) => r.id);
      await em.query(
        `UPDATE consent.connection_reference_outbox
            SET published_at = NOW()
          WHERE id = ANY($1::bigint[])`,
        [ids],
      );

      return rows.length;
    });
  }
}
