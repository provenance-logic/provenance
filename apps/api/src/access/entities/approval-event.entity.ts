import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { ApprovalEventAction } from '@provenance/types';

// Append-only — UPDATE and DELETE are revoked at the DB level.
@Entity({ schema: 'access', name: 'approval_events' })
export class ApprovalEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'request_id' })
  requestId!: string;

  @Column({ length: 32 })
  action!: ApprovalEventAction;

  /** NULL for system-generated events (e.g. workflow timeout or expiry). */
  @Column({ name: 'performed_by', nullable: true })
  performedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
