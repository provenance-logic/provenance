import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SourceType } from '@provenance/types';

@Entity({ schema: 'connectors', name: 'source_registrations' })
export class SourceRegistrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'connector_id' })
  connectorId!: string;

  @Column({ name: 'source_ref', length: 500 })
  sourceRef!: string;

  @Column({ name: 'source_type', length: 64 })
  sourceType!: SourceType;

  @Column({ name: 'display_name', length: 120 })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'registered_by' })
  registeredBy!: string;

  @CreateDateColumn({ name: 'registered_at', type: 'timestamptz' })
  registeredAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
