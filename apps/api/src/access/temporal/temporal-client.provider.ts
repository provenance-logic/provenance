import { Connection, Client } from '@temporalio/client';
import { getConfig } from '../../config.js';

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

/**
 * Async NestJS provider for the Temporal client.
 * Used by AccessService to start workflows and send signals.
 */
export const temporalClientProvider = {
  provide: TEMPORAL_CLIENT,
  useFactory: async (): Promise<Client> => {
    const config = getConfig();
    const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
    return new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  },
};
