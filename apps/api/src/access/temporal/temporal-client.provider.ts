import { Connection, Client } from '@temporalio/client';
import { Logger } from '@nestjs/common';
import { getConfig } from '../../config.js';

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

const logger = new Logger('TemporalClientProvider');

/**
 * Async NestJS provider for the Temporal client.
 * Used by AccessService to start workflows and send signals.
 * Returns null when TEMPORAL_ENABLED=false so callers can short-circuit
 * cleanly without lazy-connection errors on every workflow start.
 */
export const temporalClientProvider = {
  provide: TEMPORAL_CLIENT,
  useFactory: (): Client | null => {
    const config = getConfig();
    if (!config.TEMPORAL_ENABLED) {
      logger.log('TEMPORAL_ENABLED=false — access approval workflows skipped');
      return null;
    }
    try {
      const connection = Connection.lazy({ address: config.TEMPORAL_ADDRESS });
      return new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    } catch (err: unknown) {
      logger.warn('Could not create Temporal client — access workflows disabled', (err as Error).message);
      return null;
    }
  },
};
