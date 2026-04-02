import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { DataProduct } from '@meshos/types';

@Entity({ schema: 'products', name: 'product_versions' })
export class ProductVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ length: 32 })
  version!: string;

  @Column({ name: 'change_description', type: 'text', nullable: true })
  changeDescription!: string | null;

  @Column({ type: 'jsonb' })
  snapshot!: DataProduct;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by_principal_id', nullable: true })
  createdByPrincipalId!: string | null;
}
