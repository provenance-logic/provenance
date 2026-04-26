import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'notifications', name: 'principal_settings' })
export class PrincipalNotificationSettingsEntity {
  @Column({ name: 'org_id' })
  orgId!: string;

  @PrimaryColumn({ name: 'principal_id' })
  principalId!: string;

  @Column({ name: 'webhook_url', type: 'varchar', length: 2000, nullable: true })
  webhookUrl!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
