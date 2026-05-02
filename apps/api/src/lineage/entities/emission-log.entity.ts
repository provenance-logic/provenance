import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ schema: 'lineage', name: 'emission_log' })
export class EmissionLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'source_node', type: 'jsonb' })
  sourceNode!: Record<string, unknown>;

  @Column({ name: 'target_node', type: 'jsonb' })
  targetNode!: Record<string, unknown>;

  @Column({ name: 'edge_type', length: 64, default: 'DERIVES_FROM' })
  edgeType!: string;

  @Column({ type: 'numeric', precision: 3, scale: 2, default: 1.0 })
  confidence!: number;

  @Column({ name: 'emitted_by', type: 'varchar', length: 255, nullable: true })
  emittedBy!: string | null;

  @Column({ name: 'emitted_at', type: 'timestamptz' })
  emittedAt!: Date;

  @Column({ name: 'neo4j_written', type: 'boolean', default: false })
  neo4jWritten!: boolean;

  @Column({ name: 'neo4j_written_at', type: 'timestamptz', nullable: true })
  neo4jWrittenAt!: Date | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
