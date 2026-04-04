import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ schema: 'access', name: 'access_grants' })
export class AccessGrantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ name: 'grantee_principal_id' })
  granteePrincipalId!: string;

  @Column({ type: 'uuid', name: 'granted_by', nullable: true })
  grantedBy!: string | null;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', name: 'revoked_by', nullable: true })
  revokedBy!: string | null;

  @Column({ name: 'access_scope', type: 'jsonb', nullable: true })
  accessScope!: Record<string, unknown> | null;

  /** Set when this grant was created via an approved access request. */
  @Column({ type: 'uuid', name: 'approval_request_id', nullable: true })
  approvalRequestId!: string | null;
}
