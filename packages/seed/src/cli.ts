#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApiClient } from './api-client.js';
import { createKeycloakClient } from './keycloak-client.js';
import { runSeed } from './runner.js';
import { softReset, hardReset } from './reset.js';
import { verify } from './verify.js';

async function main(): Promise<void> {
  const [, , command, flag] = process.argv;
  const config = loadConfig();
  const logger = createLogger(config.SEED_LOG_LEVEL);

  try {
    switch (command) {
      case 'seed': {
        const api = createApiClient(config, logger);
        const keycloak = createKeycloakClient(config, logger);
        await runSeed({ config, logger, api, keycloak });
        break;
      }
      case 'reset': {
        if (flag === '--soft') {
          await softReset(config, logger);
        } else if (flag === '--hard') {
          const api = createApiClient(config, logger);
          const keycloak = createKeycloakClient(config, logger);
          await hardReset({ config, logger, api, keycloak });
        } else {
          throw new Error('reset requires --soft or --hard');
        }
        break;
      }
      case 'verify': {
        await verify(config, logger);
        break;
      }
      default:
        console.error('Usage: seed <seed|reset --soft|reset --hard|verify>');
        process.exit(2);
    }
  } catch (e) {
    logger.error((e as Error).message);
    process.exit(1);
  }
}

void main();
