import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';
import type { PolicyDomain, PolicyScopeType } from '@provenance/types';

@Entity({ schema: 'governance', name: 'effective_policies' })
export class EffectivePolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'policy_domain', length: 64 })
  policyDomain!: PolicyDomain;

  // 'global_floor': one row per (org, domain); scopeId is null.
  // 'domain_extension': one row per (org, domain, domain_id).
  @Column({ name: 'scope_type', length: 32 })
  scopeType!: PolicyScopeType;

  @Column({ type: 'uuid', name: 'scope_id', nullable: true })
  scopeId!: string | null;

  @Column({ name: 'policy_version_id' })
  policyVersionId!: string;

  // Union of floor + applicable extensions, evaluated by OPA at enforcement time.
  @Column({ name: 'computed_rules', type: 'jsonb' })
  computedRules!: Record<string, unknown>;

  // Manually managed — set explicitly when effective policy is recomputed.
  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'NOW()' })
  computedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
