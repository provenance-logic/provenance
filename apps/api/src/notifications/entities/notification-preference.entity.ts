import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';
import type {
  NotificationCategory,
  NotificationDeliveryChannel,
} from '@provenance/types';

@Entity({ schema: 'notifications', name: 'principal_preferences' })
export class NotificationPreferenceEntity {
  @Column({ name: 'org_id' })
  orgId!: string;

  @PrimaryColumn({ name: 'principal_id' })
  principalId!: string;

  @PrimaryColumn({ length: 64 })
  category!: NotificationCategory;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  channels!: NotificationDeliveryChannel[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
