import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PolicyDomain } from '@provenance/types';

@Entity({ schema: 'governance', name: 'policy_schemas' })
export class PolicySchemaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'policy_domain', length: 64 })
  policyDomain!: PolicyDomain;

  @Column({ name: 'schema_version', length: 32, default: '1.0.0' })
  schemaVersion!: string;

  @Column({ name: 'schema_definition', type: 'jsonb' })
  schemaDefinition!: Record<string, unknown>;

  @Column({ name: 'is_platform_default', default: false })
  isPlatformDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
