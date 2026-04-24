import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ConnectionReferenceState,
  ConnectionReferenceCause,
  ConnectionReferenceScope,
  DataCategoryConstraints,
} from '@provenance/types';

@Entity({ schema: 'consent', name: 'connection_references' })
export class ConnectionReferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'agent_id' })
  agentId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ type: 'uuid', name: 'product_version_id', nullable: true })
  productVersionId!: string | null;

  @Column({ name: 'access_grant_id' })
  accessGrantId!: string;

  @Column({ name: 'owning_principal_id' })
  owningPrincipalId!: string;

  @Column({ length: 32, default: 'pending' })
  state!: ConnectionReferenceState;

  @Column({ type: 'varchar', length: 64, name: 'caused_by', nullable: true })
  causedBy!: ConnectionReferenceCause | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'terminated_at', type: 'timestamptz', nullable: true })
  terminatedAt!: Date | null;

  @Column({ type: 'uuid', name: 'approved_by_principal_id', nullable: true })
  approvedByPrincipalId!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'governance_policy_version', nullable: true })
  governancePolicyVersion!: string | null;

  @Column({ name: 'use_case_category', length: 128 })
  useCaseCategory!: string;

  @Column({ name: 'purpose_elaboration', type: 'text' })
  purposeElaboration!: string;

  @Column({ name: 'intended_scope', type: 'jsonb' })
  intendedScope!: ConnectionReferenceScope;

  @Column({ name: 'data_category_constraints', type: 'jsonb', nullable: true })
  dataCategoryConstraints!: DataCategoryConstraints | null;

  @Column({ name: 'requested_duration_days', type: 'int' })
  requestedDurationDays!: number;

  @Column({ name: 'approved_scope', type: 'jsonb', nullable: true })
  approvedScope!: ConnectionReferenceScope | null;

  @Column({ name: 'approved_data_category_constraints', type: 'jsonb', nullable: true })
  approvedDataCategoryConstraints!: DataCategoryConstraints | null;

  @Column({ name: 'approved_duration_days', type: 'int', nullable: true })
  approvedDurationDays!: number | null;

  @Column({ name: 'modified_by_approver', type: 'boolean', default: false })
  modifiedByApprover!: boolean;

  @Column({ name: 'denial_reason', type: 'text', nullable: true })
  denialReason!: string | null;

  @Column({ type: 'uuid', name: 'denied_by_principal_id', nullable: true })
  deniedByPrincipalId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
