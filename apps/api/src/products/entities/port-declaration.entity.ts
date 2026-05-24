import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { PortType, OutputPortInterfaceType } from '@provenance/types';
import { DataProductEntity } from './data-product.entity.js';

@Entity({ schema: 'products', name: 'port_declarations' })
export class PortDeclarationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'port_type', length: 32 })
  portType!: PortType;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', name: 'interface_type', length: 64, nullable: true })
  interfaceType!: OutputPortInterfaceType | null;

  @Column({ name: 'contract_schema', type: 'jsonb', nullable: true })
  contractSchema!: Record<string, unknown> | null;

  @Column({ name: 'sla_description', type: 'text', nullable: true })
  slaDescription!: string | null;

  @Column({ name: 'connection_details', type: 'jsonb', nullable: true })
  connectionDetails!: Record<string, unknown> | null;

  @Column({ name: 'connection_details_validated', type: 'boolean', default: false })
  connectionDetailsValidated!: boolean;

  @Column({ name: 'connection_details_encrypted', type: 'boolean', default: false })
  connectionDetailsEncrypted!: boolean;

  // F2.8a (closes B-070) — optional binding to a registered source
  // object. When set, the port's schema initializes from the bound
  // source's latest schema_snapshot and freshness consults the same.
  // When null, the port is hand-authored. See migration V33.
  @Column({ name: 'source_registration_id', type: 'uuid', nullable: true })
  sourceRegistrationId!: string | null;

  @Column({ name: 'source_object_path', type: 'text', nullable: true })
  sourceObjectPath!: string | null;

  // F10.15 layer 1 (Phase 5.9) — producer declaration. When true, this
  // port is open to all source-system principals (Situation A); no
  // per-product grant is required at the consumer connect flow. Default
  // false (Situation B — per-product grant required). Layer-2 probe
  // verification (separate follow-up) catches mis-declarations.
  @Column({ name: 'situation_a_eligibility', type: 'boolean', default: false })
  situationAEligibility!: boolean;

  // F10.14 / Phase 5.11 — producer-facing catalog name. When set, the
  // consumer-grade snippets address the data by this name instead of
  // the physical source path. For SQL sources the producer is expected
  // to back this with `CREATE VIEW <catalog_name> AS ...` at the source
  // (DDL the platform generates on request but never executes itself per
  // Constraint 3). NULL means "no catalog-name abstraction; snippets
  // fall back to source_object_path or generic placeholders." See V36.
  @Column({ name: 'catalog_name', type: 'text', nullable: true })
  catalogName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => DataProductEntity, (product) => product.ports)
  @JoinColumn({ name: 'product_id' })
  product!: DataProductEntity;
}
