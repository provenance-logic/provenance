import { Injectable } from '@nestjs/common';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const LOCAL_ENV_PREFIX = 'local-env:';

/**
 * Thin wrapper around AWS Secrets Manager.
 * Fetches the string value of a secret and parses it as JSON.
 *
 * The client uses the default credential chain (environment variables,
 * ECS task role, EC2 instance profile, etc.). No credentials are stored
 * in application config.
 *
 * Local-dev sentinel: if the "ARN" starts with `local-env:`, the value
 * after the prefix is treated as an environment variable name and the
 * secret is read from `process.env`. This exists so the connector
 * framework is testable end-to-end on a laptop without an AWS account.
 * Production deployments never trip this branch — the env var won't be
 * set, and resolution fails closed. The ARN-format check in
 * `raw-credential-guard.ts` accepts both real AWS ARNs and the sentinel.
 */
@Injectable()
export class SecretsManagerService {
  private readonly client = new SecretsManagerClient({});

  async getSecretValue(arn: string): Promise<Record<string, string>> {
    if (arn.startsWith(LOCAL_ENV_PREFIX)) {
      return this.getFromEnv(arn.slice(LOCAL_ENV_PREFIX.length));
    }
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: arn }),
    );
    if (!response.SecretString) {
      throw new Error(`Secret ${arn} has no string value (binary secrets are not supported)`);
    }
    return JSON.parse(response.SecretString) as Record<string, string>;
  }

  private getFromEnv(varName: string): Record<string, string> {
    const raw = process.env[varName];
    if (!raw) {
      throw new Error(`Local-dev secret '${varName}' is not set in the environment`);
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('value is not a JSON object');
      }
      return parsed as Record<string, string>;
    } catch (err) {
      throw new Error(
        `Local-dev secret '${varName}' is not valid JSON object (expected shape e.g. {"token":"..."}): ${(err as Error).message}`,
      );
    }
  }
}
