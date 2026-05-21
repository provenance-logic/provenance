import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type DiscoveryCrawlStatus = 'running' | 'succeeded' | 'partial' | 'failed';

@Entity({ schema: 'connectors', name: 'discovery_crawl_events' })
export class DiscoveryCrawlEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'connector_id' })
  connectorId!: string;

  @Column({ name: 'triggered_by', type: 'uuid', nullable: true })
  triggeredBy!: string | null;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ length: 32 })
  status!: DiscoveryCrawlStatus;

  @Column({ name: 'catalogs_walked', type: 'integer', default: 0 })
  catalogsWalked!: number;

  @Column({ name: 'schemas_walked', type: 'integer', default: 0 })
  schemasWalked!: number;

  @Column({ name: 'tables_found', type: 'integer', default: 0 })
  tablesFound!: number;

  @Column({ name: 'sources_created', type: 'integer', default: 0 })
  sourcesCreated!: number;

  @Column({ name: 'sources_skipped', type: 'integer', default: 0 })
  sourcesSkipped!: number;

  @Column({ name: 'snapshots_captured', type: 'integer', default: 0 })
  snapshotsCaptured!: number;

  @Column({ name: 'snapshots_failed', type: 'integer', default: 0 })
  snapshotsFailed!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;
}
