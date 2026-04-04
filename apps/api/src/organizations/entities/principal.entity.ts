import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PrincipalType } from '@provenance/types';

@Entity({ schema: 'identity', name: 'principals' })
export class PrincipalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'principal_type', length: 32 })
  principalType!: PrincipalType;

  @Column({ name: 'keycloak_subject', length: 255, unique: true })
  keycloakSubject!: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', name: 'display_name', length: 255, nullable: true })
  displayName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
