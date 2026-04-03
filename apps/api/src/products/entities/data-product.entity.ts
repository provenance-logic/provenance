import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import type { DataProductStatus, DataClassification } from '@provenance/types';
import { PortDeclarationEntity } from './port-declaration.entity.js';

@Entity({ schema: 'products', name: 'data_products' })
export class DataProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'domain_id' })
  domainId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ length: 63 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ length: 32, default: 'draft' })
  status!: DataProductStatus;

  @Column({ length: 32, default: '0.1.0' })
  version!: string;

  @Column({ length: 32 })
  classification!: DataClassification;

  @Column({ name: 'owner_principal_id' })
  ownerPrincipalId!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => PortDeclarationEntity, (port) => port.product)
  ports!: PortDeclarationEntity[];
}
