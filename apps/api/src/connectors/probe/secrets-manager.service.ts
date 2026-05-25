import { Injectable, Optional } from '@nestjs/common';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { ConnectorCredentialVaultService, isVaultRef } from '../credential-vault.service.js';

const LOCAL_ENV_PREFIX = 'local-env:';

/**
 * Thin wrapper around credential resolution — handles three reference schemes:
 *
 *   vault:<uuid>                  → ConnectorCredentialVaultService (ADR-013)
 *   arn:aws:secretsmanager:…      → AWS Secrets Manager
 *   local-env:VARNAME             → process.env (dev/test only)
 *
 * The `vault:` scheme requires the orgId of the owning connector so the lookup
 * is org-scoped. Pass it via the second parameter; it is ignored for ARN and
 * local-env refs. The vault service is `@Optional()` so unit tests that only
 * exercise the ARN or local-env path can skip providing it.
 *
 * The client uses the default credential chain (environment variables,
 * ECS task role, EC2 instance profile, etc.). No credentials are stored
 * in application config.
 */
@Injectable()
export class SecretsManagerService {
  private readonly client = new SecretsManagerClient({});

  constructor(
    @Optional()
    private readonly vaultService?: ConnectorCredentialVaultService,
  ) {}

  /**
   * Resolves a credential reference to its JSON payload.
   *
   * @param ref   - One of `vault:<uuid>`, an AWS ARN, or `local-env:VARNAME`.
   * @param orgId - Required when `ref` starts with `vault:`. Ignored otherwise.
   */
  async getSecretValue(ref: string, orgId?: string): Promise<Record<string, string>> {
    if (isVaultRef(ref)) {
      if (!this.vaultService) {
        throw new Error(
          `vault: credential ref received but ConnectorCredentialVaultService is not injected`,
        );
      }
      if (!orgId) {
        throw new Error(
          `vault: credential ref requires orgId for org-scoped lookup`,
        );
      }
      return this.vaultService.resolve(orgId, ref);
    }
    if (ref.startsWith(LOCAL_ENV_PREFIX)) {
      return this.getFromEnv(ref.slice(LOCAL_ENV_PREFIX.length));
    }
    const response = await this.client.send(
      new GetSecretValueCommand({ SecretId: ref }),
    );
    if (!response.SecretString) {
      throw new Error(`Secret ${ref} has no string value (binary secrets are not supported)`);
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
