import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { PolicyDomain } from '@provenance/types';

// DELETE is revoked on this table — published policy artifacts are permanent records.
// There is intentionally no updated_at column: rules are immutable after INSERT.
// The only permitted update is setting rego_bundle_ref after async OPA compilation.
@Entity({ schema: 'governance', name: 'policy_versions' })
export class PolicyVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'policy_domain', length: 64 })
  policyDomain!: PolicyDomain;

  @Column({ name: 'version_number' })
  versionNumber!: number;

  // Immutable after INSERT — the authored governance rules.
  @Column({ type: 'jsonb' })
  rules!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'published_by' })
  publishedBy!: string;

  @CreateDateColumn({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  // Set after async OPA bundle compilation; NULL until compilation completes.
  @Column({ type: 'varchar', name: 'rego_bundle_ref', length: 2048, nullable: true })
  regoBundleRef!: string | null;
}
