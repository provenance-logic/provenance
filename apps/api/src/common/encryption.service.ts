import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Encrypts and decrypts JSON payloads (initially port connection details,
 * F10.6) using AES-256-GCM. Keys are sourced in this order:
 *   1. CONNECTION_DETAILS_SECRET_ARN — AWS Secrets Manager (production path)
 *   2. CONNECTION_DETAILS_DEV_KEY    — 64-char hex fallback (dev/test only)
 *
 * The service never logs the key, the plaintext, or the ciphertext. Errors
 * are logged with only the operation name.
 */

export interface EncryptedEnvelope {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

const ENVELOPE_VERSION = 1 as const;
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly secretArn: string | undefined;
  private readonly devKey: Buffer | undefined;
  private cachedKey: Buffer | undefined;

  constructor() {
    this.secretArn = process.env.CONNECTION_DETAILS_SECRET_ARN;
    const devKeyHex = process.env.CONNECTION_DETAILS_DEV_KEY;

    if (!this.secretArn && !devKeyHex) {
      throw new Error(
        'EncryptionService: one of CONNECTION_DETAILS_SECRET_ARN or CONNECTION_DETAILS_DEV_KEY must be set',
      );
    }

    if (!this.secretArn && devKeyHex) {
      if (!/^[0-9a-fA-F]{64}$/.test(devKeyHex)) {
        throw new Error('CONNECTION_DETAILS_DEV_KEY must be a 64-character hex string');
      }
      this.devKey = Buffer.from(devKeyHex, 'hex');
      if (this.devKey.length !== KEY_LENGTH_BYTES) {
        throw new Error(`CONNECTION_DETAILS_DEV_KEY must decode to ${KEY_LENGTH_BYTES} bytes`);
      }
    }
  }

  async encrypt(plaintext: Record<string, unknown>): Promise<EncryptedEnvelope> {
    const key = await this.resolveKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const jsonBuf = Buffer.from(JSON.stringify(plaintext), 'utf8');
    const encrypted = Buffer.concat([cipher.update(jsonBuf), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      version: ENVELOPE_VERSION,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  async decrypt<T = Record<string, unknown>>(envelope: EncryptedEnvelope): Promise<T> {
    if (envelope.version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported envelope version: ${String(envelope.version)}`);
    }
    const key = await this.resolveKey();
    const iv = Buffer.from(envelope.iv, 'base64');
    const authTag = Buffer.from(envelope.authTag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    try {
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8')) as T;
    } catch {
      // Intentionally opaque — leaking GCM auth failure details is not useful.
      throw new Error('Failed to decrypt envelope');
    }
  }

  static isEnvelope(value: unknown): value is EncryptedEnvelope {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.version === 'number' &&
      typeof v.iv === 'string' &&
      typeof v.authTag === 'string' &&
      typeof v.ciphertext === 'string'
    );
  }

  private async resolveKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;
    if (this.devKey) {
      this.cachedKey = this.devKey;
      return this.cachedKey;
    }
    if (!this.secretArn) {
      throw new Error('No encryption key source available');
    }
    const client = new SecretsManagerClient({});
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    if (region) {
      // Rebuild client with explicit region when one is set.
      (client as unknown as { config: { region: () => Promise<string> } }).config = {
        region: async () => region,
      };
    }
    try {
      const response = await client.send(
        new GetSecretValueCommand({ SecretId: this.secretArn }),
      );
      const raw = response.SecretString;
      if (!raw) {
        throw new Error('Secrets Manager returned no SecretString');
      }
      const keyHex = this.extractHexFromSecret(raw);
      const key = Buffer.from(keyHex, 'hex');
      if (key.length !== KEY_LENGTH_BYTES) {
        throw new Error(`Secret must decode to ${KEY_LENGTH_BYTES} bytes`);
      }
      this.cachedKey = key;
      return key;
    } catch (err) {
      this.logger.error(`Failed to resolve encryption key from ${this.secretArn}`);
      throw err instanceof Error ? err : new Error('Key resolution failed');
    }
  }

  /** Accept either a raw hex string or JSON like {"key": "<hex>"}. */
  private extractHexFromSecret(raw: string): string {
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate =
        (parsed.key as string | undefined) ??
        (parsed.masterKey as string | undefined) ??
        (parsed.value as string | undefined);
      if (candidate && /^[0-9a-fA-F]{64}$/.test(candidate)) return candidate;
    } catch {
      // fall through
    }
    throw new Error('Secrets Manager value is not a 32-byte hex key');
  }
}
