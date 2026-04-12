import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'identity', name: 'agent_identities' })
export class AgentIdentityEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'agent_id' })
  agentId!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'display_name', length: 255 })
  displayName!: string;

  @Column({ name: 'model_name', length: 255 })
  modelName!: string;

  @Column({ name: 'model_provider', length: 255 })
  modelProvider!: string;

  @Column({ name: 'human_oversight_contact', length: 255 })
  humanOversightContact!: string;

  @Column({ name: 'registered_by_principal_id' })
  registeredByPrincipalId!: string;

  @Column({ name: 'current_classification', type: 'varchar', length: 50, nullable: true })
  currentClassification!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
