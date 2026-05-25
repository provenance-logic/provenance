import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../common/encryption.service.js';
import { ConnectorSecretEntity } from './entities/connector-secret.entity.js';

/**
 * Prefix for the built-in encrypted-at-rest credential reference scheme.
 * Stored in connectors.credential_arn as `vault:<uuid>`.
 */
export const VAULT_PREFIX = 'vault:';

/**
 * UUID v4 pattern — 8-4-4-4-12 hex groups.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true when `ref` is a platform vault reference (`vault:<uuid>`).
 * Used by the guard and resolution dispatch to distinguish the three schemes:
 *   - `vault:<uuid>`           → ConnectorCredentialVaultService.resolve()
 *   - `arn:aws:secretsmanager:…` → SecretsManagerService (AWS)
 *   - `local-env:VARNAME`      → SecretsManagerService (process.env, dev only)
 */
export function isVaultRef(ref: string): boolean {
  if (!ref.startsWith(VAULT_PREFIX)) return false;
  const id = ref.slice(VAULT_PREFIX.length);
  return UUID_PATTERN.test(id);
}

/**
 * Built-in encrypted credential store (ADR-013).
 *
 * The platform receives a raw secret from the GUI over TLS, encrypts it with
 * AES-256-GCM via EncryptionService (same key source as Domain 10 connection
 * details), persists only the envelope in connectors.connector_secrets, and
 * returns a `vault:<uuid>` reference. The plaintext lives in memory only
 * during the encryption call and is never written to any column, log, or
 * response body.
 *
 * Every method that touches the repo filters on orgId — the ESLint rule
 * `provenance/require-org-filter` enforces this at CI level.
 */
@Injectable()
export class ConnectorCredentialVaultService {
  constructor(
    private readonly encryption: EncryptionService,
    @InjectRepository(ConnectorSecretEntity)
    private readonly secretRepo: Repository<ConnectorSecretEntity>,
  ) {}

  /**
   * Encrypts `secret` and stores it in the vault.
   *
   * - If `existingRef` is a `vault:<uuid>` that exists for this org, the
   *   existing row's envelope is overwritten in place (credential rotation
   *   — same UUID, same reference, no history of past secrets).
   * - Otherwise a new row is created and its UUID is returned as the ref.
   *
   * Returns `vault:<uuid>` — the reference to store in connector.credentialArn.
   * Never logs or returns the secret.
   */
  async store(
    orgId: string,
    secret: Record<string, unknown>,
    existingRef?: string,
  ): Promise<string> {
    const envelope = await this.encryption.encrypt(secret);

    // Rotation path: try to update the existing row if a vault ref was given.
    if (existingRef && isVaultRef(existingRef)) {
      const existingId = existingRef.slice(VAULT_PREFIX.length);
      const existing = await this.secretRepo.findOne({
        where: { id: existingId, orgId },
      });
      if (existing) {
        existing.envelope = envelope;
        await this.secretRepo.save(existing);
        return `${VAULT_PREFIX}${existing.id}`;
      }
      // Row not found for this org (mismatch or deleted) — fall through to create.
    }

    // New row path.
    const entity = this.secretRepo.create({ orgId, envelope });
    const saved = await this.secretRepo.save(entity);
    return `${VAULT_PREFIX}${saved.id}`;
  }

  /**
   * Resolves a `vault:<uuid>` reference to the decrypted secret object.
   *
   * The lookup is org-scoped — a caller cannot resolve another org's secret
   * even if they know the UUID. Throws NotFoundException when the row does
   * not exist or belongs to a different org.
   *
   * Only call this inside the probe / schema / crawl path. The plaintext
   * object lives no longer than the connection attempt.
   */
  async resolve(orgId: string, ref: string): Promise<Record<string, string>> {
    if (!isVaultRef(ref)) {
      throw new Error(`resolve() called with non-vault ref; expected a ref starting with '${VAULT_PREFIX}'`);
    }
    const id = ref.slice(VAULT_PREFIX.length);
    const entity = await this.secretRepo.findOne({ where: { id, orgId } });
    if (!entity) {
      throw new NotFoundException(`Vault secret ${id} not found for this organization`);
    }
    return this.encryption.decrypt<Record<string, string>>(entity.envelope);
  }
}
