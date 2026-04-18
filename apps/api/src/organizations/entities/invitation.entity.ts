import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { RoleType } from '@provenance/types';

@Entity({ schema: 'identity', name: 'invitations' })
export class InvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ length: 254 })
  email!: string;

  @Column({ length: 64 })
  role!: RoleType;

  @Column({ type: 'uuid', name: 'domain_id', nullable: true })
  domainId!: string | null;

  @Column({ name: 'invited_by_principal_id' })
  invitedByPrincipalId!: string;

  @Column({ length: 128 })
  token!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'resend_count', type: 'int', default: 0 })
  resendCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
