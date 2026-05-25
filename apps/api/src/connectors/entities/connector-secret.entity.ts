import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EncryptedEnvelope } from '../../common/encryption.service.js';

/**
 * Persists the AES-256-GCM EncryptionService envelope for a single connector
 * credential. The `envelope` JSONB column holds {version, iv, authTag, ciphertext}
 * — never plaintext. The connector's `credential_arn` column stores a
 * `vault:<id>` reference that resolves back to this row at probe time.
 *
 * ADR-013: connector credentials — self-service secret entry, encrypted at rest.
 */
@Entity({ schema: 'connectors', name: 'connector_secrets' })
export class ConnectorSecretEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Column({ type: 'jsonb' })
  envelope!: EncryptedEnvelope;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
