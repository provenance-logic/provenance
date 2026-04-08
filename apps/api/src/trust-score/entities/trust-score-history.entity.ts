import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

@Entity({ schema: 'observability', name: 'trust_score_history' })
export class TrustScoreHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'product_id' })
  productId!: string;

  @Column({ type: 'numeric', precision: 6, scale: 4 })
  score!: number;

  @Column({ type: 'text' })
  band!: string;

  @Column({ type: 'jsonb' })
  components!: Record<string, unknown>;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt!: Date;
}
