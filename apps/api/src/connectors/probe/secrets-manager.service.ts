import { Injectable } from '@nestjs/common';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Thin wrapper around AWS Secrets Manager.
 * Fetches the string value of a secret and parses it as JSON.
 *
 * The client uses the default credential chain (environment variables,
 * ECS task role, EC2 instance profile, etc.). No credentials are stored
 * in application config.
 */
@Injectable()
export class SecretsManagerService {
  private readonly client = new SecretsManagerClient({});

  async getSecretValue(arn: string): Promise<Record<string, string>> {
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: arn }),
    );
    if (!response.SecretString) {
      throw new Error(`Secret ${arn} has no string value (binary secrets are not supported)`);
    }
    return JSON.parse(response.SecretString) as Record<string, string>;
  }
}
