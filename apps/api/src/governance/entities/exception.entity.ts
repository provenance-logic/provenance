import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PolicyDomain } from '@provenance/types';

@Entity({ schema: 'governance', name: 'exceptions' })
export class ExceptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'policy_domain', length: 64 })
  policyDomain!: PolicyDomain;

  @Column({ type: 'uuid', name: 'policy_version_id', nullable: true })
  policyVersionId!: string | null;

  @Column({ name: 'exception_reason', type: 'text' })
  exceptionReason!: string;

  @Column({ name: 'granted_by' })
  grantedBy!: string;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', name: 'revoked_by', nullable: true })
  revokedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
