import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ schema: 'connectors', name: 'schema_snapshots' })
export class SchemaSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'source_registration_id' })
  sourceRegistrationId!: string;

  @Column({ name: 'connector_id' })
  connectorId!: string;

  @Column({ name: 'schema_definition', type: 'jsonb' })
  schemaDefinition!: Record<string, unknown>;

  @Column({ name: 'column_count', type: 'int', nullable: true })
  columnCount!: number | null;

  @Column({ name: 'row_estimate', type: 'bigint', nullable: true })
  rowEstimate!: number | null;

  @Column({ type: 'uuid', name: 'captured_by', nullable: true })
  capturedBy!: string | null;

  @CreateDateColumn({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;
}
