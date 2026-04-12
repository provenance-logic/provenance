import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ schema: 'identity', name: 'agent_trust_classifications' })
export class AgentTrustClassificationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'classification_id' })
  classificationId!: string;

  @Column({ name: 'agent_id' })
  agentId!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ length: 50 })
  classification!: string;

  @Column({ length: 50, default: 'global' })
  scope!: string;

  @Column({ name: 'changed_by_principal_id' })
  changedByPrincipalId!: string;

  @Column({ name: 'changed_by_principal_type', length: 50 })
  changedByPrincipalType!: string;

  @Column({ length: 1000 })
  reason!: string;

  @CreateDateColumn({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
