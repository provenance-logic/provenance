import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type {
  NotificationCategory,
  NotificationDeliveryChannel,
} from '@provenance/types';

@Entity({ schema: 'notifications', name: 'delivery_outbox' })
export class NotificationDeliveryOutboxEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'notification_id' })
  notificationId!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ length: 32 })
  channel!: NotificationDeliveryChannel;

  @Column({ type: 'text' })
  target!: string;

  @Column({ length: 64 })
  category!: NotificationCategory;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'deep_link', type: 'text' })
  deepLink!: string;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
