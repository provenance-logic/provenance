import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { RoleType } from '@provenance/types';

@Entity({ schema: 'identity', name: 'role_assignments' })
export class RoleAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'principal_id' })
  principalId!: string;

  @Column({ length: 64 })
  role!: RoleType;

  @Column({ type: 'uuid', name: 'domain_id', nullable: true })
  domainId!: string | null;

  @Column({ type: 'uuid', name: 'granted_by', nullable: true })
  grantedBy!: string | null;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;
}
