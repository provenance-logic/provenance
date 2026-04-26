import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { NotificationCategory } from '@provenance/types';

@Entity({ schema: 'notifications', name: 'notifications' })
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'recipient_principal_id' })
  recipientPrincipalId!: string;

  @Column({ length: 64 })
  category!: NotificationCategory;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'deep_link', type: 'text' })
  deepLink!: string;

  @Column({ name: 'dedup_key', type: 'text' })
  dedupKey!: string;

  @Column({ name: 'dedup_count', type: 'int', default: 1 })
  dedupCount!: number;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'dismissed_at', type: 'timestamptz', nullable: true })
  dismissedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
