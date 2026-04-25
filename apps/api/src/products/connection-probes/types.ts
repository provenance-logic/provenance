import type { ConnectionDetails, OutputPortInterfaceType } from '@provenance/types';

export interface ProbeOutcome {
  status: 'success' | 'failure' | 'unsupported';
  message: string;
  latencyMs?: number;
}

export interface ConnectionProbe<D extends ConnectionDetails = ConnectionDetails> {
  readonly interfaceType: OutputPortInterfaceType;
  /** Optional sub-discriminator (e.g. driver for sql_jdbc, storage for file_object_export). */
  readonly subkind?: string;
  /** Run the probe with a hard total timeout (ms). */
  probe(details: D, timeoutMs: number): Promise<ProbeOutcome>;
}
