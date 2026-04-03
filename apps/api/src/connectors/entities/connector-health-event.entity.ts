import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import type { HealthStatus } from '@provenance/types';

@Entity({ schema: 'connectors', name: 'connector_health_events' })
export class ConnectorHealthEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'org_id' })
  orgId!: string;

  @Column({ name: 'connector_id' })
  connectorId!: string;

  @Column({ length: 32 })
  status!: HealthStatus;

  @Column({ name: 'response_time_ms', type: 'int', nullable: true })
  responseTimeMs!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'checked_at', type: 'timestamptz' })
  checkedAt!: Date;
}
