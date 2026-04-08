import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'observability', name: 'slo_declarations' })
export class SloDeclarationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'slo_type', type: 'text' })
  sloType!: string;

  @Column({ name: 'metric_name', type: 'text' })
  metricName!: string;

  @Column({ name: 'threshold_operator', type: 'text' })
  thresholdOperator!: string;

  @Column({ name: 'threshold_value', type: 'numeric' })
  thresholdValue!: number;

  @Column({ name: 'threshold_unit', type: 'text', nullable: true })
  thresholdUnit!: string | null;

  @Column({ name: 'evaluation_window_hours', type: 'int', default: 24 })
  evaluationWindowHours!: number;

  @Column({ name: 'external_system', type: 'text', nullable: true })
  externalSystem!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
