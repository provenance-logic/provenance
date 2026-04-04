import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';
import type { ComplianceStateValue, ComplianceViolation } from '@provenance/types';

// One mutable row per (org_id, product_id). Updated in-place on every evaluation cycle.
@Entity({ schema: 'governance', name: 'compliance_states' })
export class ComplianceStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ length: 32, default: 'compliant' })
  state!: ComplianceStateValue;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  violations!: ComplianceViolation[];

  @Column({ type: 'uuid', name: 'policy_version_id', nullable: true })
  policyVersionId!: string | null;

  // Explicitly set each time the evaluation runs.
  @Column({ name: 'evaluated_at', type: 'timestamptz', default: () => 'NOW()' })
  evaluatedAt!: Date;

  @Column({ name: 'next_evaluation_at', type: 'timestamptz', nullable: true })
  nextEvaluationAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
