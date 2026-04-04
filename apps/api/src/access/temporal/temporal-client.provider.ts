import { Connection, Client } from '@temporalio/client';
import { Logger } from '@nestjs/common';
import { getConfig } from '../../config.js';

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

const logger = new Logger('TemporalClientProvider');

/**
 * Async NestJS provider for the Temporal client.
 * Used by AccessService to start workflows and send signals.
 * Uses a lazy connection so startup does not fail if Temporal is unavailable.
 */
export const temporalClientProvider = {
  provide: TEMPORAL_CLIENT,
  useFactory: (): Client => {
    const config = getConfig();
    try {
      const connection = Connection.lazy({ address: config.TEMPORAL_ADDRESS });
      return new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    } catch (err: unknown) {
      logger.warn('Could not create Temporal client — access workflows disabled', (err as Error).message);
      return null as unknown as Client;
    }
  },
};
