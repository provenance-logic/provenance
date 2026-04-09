import type { Uuid, IsoTimestamp } from './common.js';

// ---------------------------------------------------------------------------
// SLO type and operator enums
// ---------------------------------------------------------------------------

export type SloType = 'freshness' | 'null_rate' | 'latency' | 'completeness' | 'custom';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
export type SloHealth = 'green' | 'yellow' | 'red';

// ---------------------------------------------------------------------------
// Declaration DTOs
// ---------------------------------------------------------------------------

export interface CreateSloDeclarationDto {
  name: string;
  description?: string;
  slo_type: SloType;
  metric_name: string;
  threshold_operator: ThresholdOperator;
  threshold_value: number;
  threshold_unit?: string;
  evaluation_window_hours?: number;
  external_system?: string;
}

export interface SloDeclarationDto {
  id: Uuid;
  product_id: Uuid;
  org_id: Uuid;
  name: string;
  description: string | null;
  slo_type: string;
  metric_name: string;
  threshold_operator: string;
  threshold_value: number;
  threshold_unit: string | null;
  evaluation_window_hours: number;
  external_system: string | null;
  active: boolean;
  pass_rate_7d: number | null;
  pass_rate_30d: number | null;
  last_evaluated_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Evaluation DTOs
// ---------------------------------------------------------------------------

export interface CreateSloEvaluationDto {
  measured_value: number;
  passed: boolean;
  evaluated_at: IsoTimestamp;
  evaluated_by: string;
  details?: Record<string, unknown>;
}

export interface SloEvaluationDto {
  id: Uuid;
  slo_id: Uuid;
  measured_value: number;
  passed: boolean;
  evaluated_at: IsoTimestamp;
  evaluated_by: string;
  details: Record<string, unknown> | null;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Summary DTO
// ---------------------------------------------------------------------------

export interface SloSummaryDto {
  product_id: Uuid;
  org_id: Uuid;
  total_slos: number;
  active_slos: number;
  pass_rate_7d: number;
  pass_rate_30d: number;
  slos_with_no_data: number;
  last_evaluated_at: IsoTimestamp | null;
  slo_health: SloHealth;
}
