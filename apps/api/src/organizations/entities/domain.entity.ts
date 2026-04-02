import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrgEntity } from './org.entity.js';

@Entity({ schema: 'organizations', name: 'domains' })
export class DomainEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ length: 63 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'owner_principal_id' })
  ownerPrincipalId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => OrgEntity, (org) => org.domains)
  @JoinColumn({ name: 'org_id' })
  org!: OrgEntity;
}
