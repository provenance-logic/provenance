import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ConnectorType, ValidationStatus } from '@provenance/types';

@Entity({ schema: 'connectors', name: 'connectors' })
export class ConnectorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'domain_id' })
  domainId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'connector_type', length: 64 })
  connectorType!: ConnectorType;

  @Column({ name: 'connection_config', type: 'jsonb', default: '{}' })
  connectionConfig!: Record<string, unknown>;

  @Column({ type: 'varchar', name: 'credential_arn', length: 2048, nullable: true })
  credentialArn!: string | null;

  @Column({ name: 'validation_status', length: 32, default: 'pending' })
  validationStatus!: ValidationStatus;

  @Column({ name: 'last_validated_at', type: 'timestamptz', nullable: true })
  lastValidatedAt!: Date | null;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
