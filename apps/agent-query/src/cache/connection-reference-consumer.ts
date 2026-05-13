import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import type { ConnectionReferenceCache } from './connection-reference-cache.js';
import type { InternalControlPlaneClient } from '../control-plane/internal-control-plane.client.js';

// Redpanda consumer for connection_reference.state events (Domain 12
// PR #3; ADR-007 § "Event Propagation"). Subscribes to the topic the
// api-side outbox publisher writes to and keeps the in-memory cache
// aligned with state transitions.
//
// Dispatch policy (per ADR-007 § "Consumer behavior"):
//
//   * new_state === 'active' — fetch the full ConnectionReference from
//     the control-plane lookup endpoint and cache.set it. We do the
//     extra fetch (rather than reconstructing from the event payload)
//     because the event payload carries `scope` but not
//     `approvedDataCategoryConstraints` — the guard needs both to
//     decide scope-match correctly, and the control-plane row is the
//     authoritative shape. The extra HTTP call is governance-scale,
//     not query-scale (< 100 events/day/org), so latency cost is
//     irrelevant.
//
//   * new_state in ['suspended', 'expired', 'revoked'] — cache.invalidate.
//     No fetch needed; these states are non-enforceable, so removing
//     the entry is sufficient.
//
//   * new_state === 'pending' — no-op. Pending references are not
//     enforceable and should never appear in the cache.
//
// Errors handling each message are logged but do not stop the
// consumer. kafkajs will continue delivering subsequent messages.
// Idempotency: ADR-007's at-least-once delivery means the consumer
// may see the same event twice on a restart. Setting the same active
// reference twice is a no-op; invalidating an already-absent entry is
// a no-op. The consumer is therefore idempotent by construction.

export type ConnectionReferenceState =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'expired'
  | 'revoked';

interface ConnectionReferenceStateEvent {
  connectionReferenceId: string;
  orgId: string;
  agentId: string;
  productId: string;
  newState: ConnectionReferenceState;
  previousState: ConnectionReferenceState | null;
  // Other fields (scope, useCaseCategory, transitionedAt, causedBy)
  // are present on the wire but not consumed here — the consumer
  // reads only what it routes on plus the cache key.
}

const TOPIC = 'connection_reference.state';
const GROUP_ID = 'agent-query-connection-reference-cache';

export class ConnectionReferenceConsumer {
  private readonly consumer: Consumer;
  private running = false;

  constructor(
    brokers: string[],
    private readonly cache: ConnectionReferenceCache,
    private readonly controlPlane: InternalControlPlaneClient,
  ) {
    const kafka = new Kafka({ clientId: 'agent-query-cref-cache', brokers });
    this.consumer = kafka.consumer({ groupId: GROUP_ID });
  }

  async start(): Promise<void> {
    if (this.running) return;
    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: TOPIC, fromBeginning: false });
      await this.consumer.run({
        eachMessage: (payload: EachMessagePayload) => this.handleMessage(payload),
      });
      this.running = true;
      console.log(
        `[AQL] ConnectionReferenceConsumer started — topic=${TOPIC} group=${GROUP_ID}`,
      );
    } catch (err) {
      // Broker unreachable. Log and proceed; the cache will rely on
      // cold-load + cache-miss-fallback until the broker comes up and
      // the consumer reconnects on the next start() attempt.
      // We do not narrow on KafkaJSError because kafkajs's named
      // exports are not reliably accessible under ESM jest; all
      // startup failures get the same "log and continue" treatment.
      console.warn(
        `[AQL] ConnectionReferenceConsumer failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await this.consumer.disconnect();
    this.running = false;
  }

  /**
   * Exposed for tests so they can drive the dispatch path without
   * spinning up a real consumer.
   */
  async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;
    let event: ConnectionReferenceStateEvent;
    try {
      event = JSON.parse(message.value.toString()) as ConnectionReferenceStateEvent;
    } catch {
      console.warn('[AQL] Received unparseable message on connection_reference.state');
      return;
    }

    const { orgId, agentId, productId, newState, connectionReferenceId } = event;

    try {
      switch (newState) {
        case 'active': {
          const ref = await this.controlPlane.lookupActiveReference(
            orgId,
            agentId,
            productId,
          );
          if (ref) {
            this.cache.set(orgId, agentId, productId, ref);
            console.log(
              `[AQL] cache.set on Active event — ref=${connectionReferenceId} org=${orgId} agent=${agentId} product=${productId}`,
            );
          } else {
            // The event said Active but lookup found nothing — could
            // mean the row terminated between event publish and
            // consumer dispatch. Defensive: ensure no stale entry.
            this.cache.invalidate(orgId, agentId, productId);
            console.warn(
              `[AQL] Active event for ${connectionReferenceId} but lookup returned no row — invalidated cache entry`,
            );
          }
          break;
        }
        case 'suspended':
        case 'expired':
        case 'revoked': {
          this.cache.invalidate(orgId, agentId, productId);
          console.log(
            `[AQL] cache.invalidate on ${newState} event — ref=${connectionReferenceId} org=${orgId} agent=${agentId} product=${productId}`,
          );
          break;
        }
        case 'pending': {
          // Pending references are not enforceable; nothing to cache.
          break;
        }
        default: {
          console.warn(
            `[AQL] Unknown newState on connection_reference.state: ${String(newState)}`,
          );
        }
      }
    } catch (err) {
      // Per ADR-007 the consumer must remain alive; a failed message
      // is logged and the next event still gets delivered. The cache
      // will heal on the next event or on the next cache-miss
      // fallback. We do not commit-skip here — kafkajs auto-commits
      // on successful message handling, and a thrown error inside
      // eachMessage causes a retry (which is the right behavior for
      // transient broker / network blips).
      console.error(
        `[AQL] connection_reference.state handler error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
