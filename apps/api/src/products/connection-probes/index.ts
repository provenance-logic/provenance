import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectionDetails,
  OutputPortInterfaceType,
  TestConnectionResponse,
} from '@provenance/types';
import { ConnectionProbeRegistry, detailsSubkind } from './registry.js';
import { RestApiProbe } from './rest-api.probe.js';
import { GraphQlProbe } from './graphql.probe.js';
import { KafkaProbe } from './kafka.probe.js';

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class ConnectionProbeService {
  private readonly logger = new Logger(ConnectionProbeService.name);
  private readonly registry = new ConnectionProbeRegistry();

  constructor() {
    this.registry.register(new RestApiProbe());
    this.registry.register(new GraphQlProbe());
    this.registry.register(new KafkaProbe());
    // sql_jdbc and file_object_export intentionally not registered yet —
    // the dispatcher returns `unsupported` so callers can render a distinct
    // "manual validation" UX. See F10.7 implementation notes.
  }

  async runProbe(
    interfaceType: OutputPortInterfaceType | null,
    details: ConnectionDetails | null,
  ): Promise<TestConnectionResponse> {
    const probedAt = new Date().toISOString();
    if (!interfaceType) {
      return {
        status: 'unsupported',
        interfaceType: null,
        message: 'Port has no interfaceType — connection probe is not applicable.',
        probedAt,
      };
    }
    if (!details) {
      return {
        status: 'unsupported',
        interfaceType,
        message: 'Port has no connection details to probe.',
        probedAt,
      };
    }

    const subkind = detailsSubkind(details);
    const probe = this.registry.resolve(interfaceType, subkind);
    if (!probe) {
      return {
        status: 'unsupported',
        interfaceType,
        message: `Automated probe not yet available for ${interfaceType}${subkind ? ` (${subkind})` : ''}. Mark validated manually after testing locally.`,
        probedAt,
      };
    }

    try {
      const outcome = await probe.probe(details, DEFAULT_TIMEOUT_MS);
      return {
        status: outcome.status,
        interfaceType,
        message: outcome.message,
        ...(outcome.latencyMs !== undefined ? { latencyMs: outcome.latencyMs } : {}),
        probedAt,
      };
    } catch (err) {
      this.logger.warn(
        `Probe for ${interfaceType} threw unexpectedly: ${(err as Error).message}`,
      );
      return {
        status: 'failure',
        interfaceType,
        message: `Probe error: ${(err as Error).message}`,
        probedAt,
      };
    }
  }
}

export { ConnectionProbeRegistry } from './registry.js';
export type { ConnectionProbe, ProbeOutcome } from './types.js';
