import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PrincipalPreferences } from '@provenance/types';

@Entity({ schema: 'identity', name: 'principal_preferences' })
export class PrincipalPreferencesEntity {
  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  preferences!: PrincipalPreferences;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
