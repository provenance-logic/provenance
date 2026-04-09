import { api } from '../../../shared/api/client.js';
import type { TrustScoreDto, TrustScoreHistoryDto } from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/products`;

export function fetchTrustScore(
  orgId: string,
  productId: string,
): Promise<TrustScoreDto> {
  return api.get<TrustScoreDto>(`${base(orgId)}/${productId}/trust-score`);
}

export function fetchTrustScoreHistory(
  orgId: string,
  productId: string,
  limit = 30,
): Promise<TrustScoreHistoryDto[]> {
  return api.get<TrustScoreHistoryDto[]>(`${base(orgId)}/${productId}/trust-score/history?limit=${limit}`);
}

export function recomputeTrustScore(
  orgId: string,
  productId: string,
): Promise<TrustScoreDto> {
  return api.post<TrustScoreDto>(`${base(orgId)}/${productId}/trust-score/recompute`, {});
}
