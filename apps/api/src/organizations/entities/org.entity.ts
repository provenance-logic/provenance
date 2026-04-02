import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import type { OrganizationStatus } from '@meshos/types';
import { DomainEntity } from './domain.entity.js';

@Entity({ schema: 'organizations', name: 'orgs' })
export class OrgEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ length: 63, unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'active',
  })
  status!: OrganizationStatus;

  @Column({ name: 'contact_email', length: 254, nullable: true })
  contactEmail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => DomainEntity, (domain) => domain.org)
  domains!: DomainEntity[];
}
