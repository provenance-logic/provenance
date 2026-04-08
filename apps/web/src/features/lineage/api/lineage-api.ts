import { api } from '../../../shared/api/client.js';
import type { LineageGraphDto } from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/lineage`;

export function fetchUpstreamLineage(
  orgId: string,
  productId: string,
  depth: number,
): Promise<LineageGraphDto> {
  return api.get<LineageGraphDto>(`${base(orgId)}/products/${productId}/upstream?depth=${depth}`);
}

export function fetchDownstreamLineage(
  orgId: string,
  productId: string,
  depth: number,
): Promise<LineageGraphDto> {
  return api.get<LineageGraphDto>(`${base(orgId)}/products/${productId}/downstream?depth=${depth}`);
}

export function fetchImpactAnalysis(
  orgId: string,
  productId: string,
): Promise<LineageGraphDto> {
  return api.get<LineageGraphDto>(`${base(orgId)}/products/${productId}/impact`);
}
