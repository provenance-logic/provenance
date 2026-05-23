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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => DataProductEntity, (product) => product.ports)
  @JoinColumn({ name: 'product_id' })
  product!: DataProductEntity;
}
