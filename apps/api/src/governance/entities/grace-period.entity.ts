import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PolicyDomain, GracePeriodOutcome } from '@provenance/types';

@Entity({ schema: 'governance', name: 'grace_periods' })
export class GracePeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'policy_domain', length: 64 })
  policyDomain!: PolicyDomain;

  @Column({ name: 'policy_version_id' })
  policyVersionId!: string;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  // Temporal workflow ID tracking this timer. NULL until workflow is started.
  @Column({ type: 'varchar', name: 'temporal_workflow_id', length: 255, nullable: true })
  temporalWorkflowId!: string | null;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ length: 32, default: 'pending' })
  outcome!: GracePeriodOutcome;

  /**
   * Idempotency marker for the F11.21 grace-period-expiring trigger.
   * Set the first time GovernanceNotificationsTriggerWorker emits the
   * warning so subsequent cron passes skip the row.
   */
  @Column({ name: 'expiry_warning_sent_at', type: 'timestamptz', nullable: true })
  expiryWarningSentAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
