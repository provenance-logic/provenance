import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { DataProductStatus } from '@provenance/types';

@Entity({ schema: 'products', name: 'lifecycle_events' })
export class LifecycleEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'from_status', length: 32, nullable: true })
  fromStatus!: DataProductStatus | null;

  @Column({ name: 'to_status', length: 32 })
  toStatus!: DataProductStatus;

  @Column({ name: 'triggered_by', nullable: true })
  triggeredBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
