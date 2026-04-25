import type { ConnectionDetails, OutputPortInterfaceType } from '@provenance/types';
import type { ConnectionProbe, ProbeOutcome } from './types.js';

/**
 * Registry of connection-detail probes keyed by `(interfaceType, subkind?)`.
 * The composite key supports interface types that fan out to multiple
 * implementations — e.g. `sql_jdbc` will eventually register `postgresql`,
 * `mysql`, and `snowflake` probes when SQL support lands. The lookup falls
 * back to the bare `interfaceType` entry (no subkind) for interface types
 * that have a single implementation.
 */
export class ConnectionProbeRegistry {
  private readonly byKey = new Map<string, ConnectionProbe>();

  register(probe: ConnectionProbe): void {
    this.byKey.set(this.key(probe.interfaceType, probe.subkind), probe);
  }

  resolve(
    interfaceType: OutputPortInterfaceType,
    subkind?: string,
  ): ConnectionProbe | null {
    if (subkind) {
      const specific = this.byKey.get(this.key(interfaceType, subkind));
      if (specific) return specific;
    }
    return this.byKey.get(this.key(interfaceType)) ?? null;
  }

  private key(interfaceType: OutputPortInterfaceType, subkind?: string): string {
    return subkind ? `${interfaceType}:${subkind}` : interfaceType;
  }
}

/** Run a probe under a hard timeout — returns a `failure` if it doesn't resolve. */
export async function withTimeout(
  promise: Promise<ProbeOutcome>,
  timeoutMs: number,
  interfaceLabel: string,
): Promise<ProbeOutcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<ProbeOutcome>([
      promise,
      new Promise<ProbeOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: 'failure',
              message: `${interfaceLabel} probe timed out after ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Discriminator for connection-details union — keeps interfaceType keying type-safe. */
export function detailsSubkind(details: ConnectionDetails): string | undefined {
  switch (details.kind) {
    case 'file_object_export':
      return details.storage;
    case 'sql_jdbc':
      // Crude driver inference; replaced by an explicit field when SQL probes land.
      if (details.host.includes('snowflakecomputing.com')) return 'snowflake';
      if (details.port === 3306) return 'mysql';
      return 'postgresql';
    default:
      return undefined;
  }
}
