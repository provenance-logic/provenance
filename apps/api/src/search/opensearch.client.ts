import { Client } from '@opensearch-project/opensearch';
import { getConfig } from '../config.js';

export const OPENSEARCH_CLIENT = 'OPENSEARCH_CLIENT';

export const opensearchClientProvider = {
  provide: OPENSEARCH_CLIENT,
  useFactory: (): Client => {
    const config = getConfig();
    return new Client({ node: config.OPENSEARCH_NODE });
  },
};
