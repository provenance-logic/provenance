import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity({ schema: 'observability', name: 'slo_evaluations' })
export class SloEvaluationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'slo_id' })
  sloId!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'measured_value', type: 'numeric' })
  measuredValue!: number;

  @Column({ type: 'boolean' })
  passed!: boolean;

  @Column({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt!: Date;

  @Column({ name: 'evaluated_by', type: 'text' })
  evaluatedBy!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
