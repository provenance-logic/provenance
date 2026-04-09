import type { Uuid, IsoTimestamp } from './common.js';

export interface TrustScoreComponentDto {
  raw_value: string | number;
  component_score: number;
  weight: number;
  weighted_score: number;
}

export interface TrustScoreComponentsDto {
  governance_compliance: TrustScoreComponentDto;
  slo_pass_rate: TrustScoreComponentDto;
  lineage_completeness: TrustScoreComponentDto;
  usage_activity: TrustScoreComponentDto;
  exception_history: TrustScoreComponentDto;
}

export interface TrustScoreDto {
  product_id: Uuid;
  org_id: Uuid;
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  components: TrustScoreComponentsDto;
  computed_at: IsoTimestamp;
}

export interface TrustScoreHistoryDto {
  id: Uuid;
  product_id: Uuid;
  score: number;
  band: string;
  components: TrustScoreComponentsDto;
  computed_at: IsoTimestamp;
}
