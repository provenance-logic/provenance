import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type DiscoveryGranularity = 'asset_level' | 'column_level';

@Entity({ schema: 'connectors', name: 'capability_manifests' })
@Index(['connectorType'])
export class CapabilityManifestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'connector_type', length: 64 })
  connectorType!: string;

  @Column({ length: 32 })
  version!: string;

  @Column({ name: 'supports_probe', type: 'boolean', default: false })
  supportsProbe!: boolean;

  @Column({ name: 'supports_schema_inference', type: 'boolean', default: false })
  supportsSchemaInference!: boolean;

  @Column({ name: 'supports_discovery_crawl', type: 'boolean', default: false })
  supportsDiscoveryCrawl!: boolean;

  @Column({ name: 'supports_lineage_emission', type: 'boolean', default: false })
  supportsLineageEmission!: boolean;

  @Column({ name: 'supports_lineage_discovery', type: 'boolean', default: false })
  supportsLineageDiscovery!: boolean;

  @Column({ name: 'discovery_granularity', length: 32, nullable: true, type: 'varchar' })
  discoveryGranularity!: DiscoveryGranularity | null;

  @Column({
    name: 're_crawl_interval_hours_default',
    type: 'integer',
    nullable: true,
  })
  reCrawlIntervalHoursDefault!: number | null;

  @Column({ name: 'capabilities_doc', type: 'jsonb', default: {} })
  capabilitiesDoc!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
