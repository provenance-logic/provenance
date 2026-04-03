import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AccessRequestStatus } from '@provenance/types';

@Entity({ schema: 'access', name: 'access_requests' })
export class AccessRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'requester_principal_id' })
  requesterPrincipalId!: string;

  @Column({ type: 'text', nullable: true })
  justification!: string | null;

  @Column({ name: 'access_scope', type: 'jsonb', nullable: true })
  accessScope!: Record<string, unknown> | null;

  @Column({ length: 32, default: 'pending' })
  status!: AccessRequestStatus;

  @Column({ name: 'temporal_workflow_id', length: 255, nullable: true })
  temporalWorkflowId!: string | null;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
