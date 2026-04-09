import { api } from '../../../shared/api/client.js';
import type {
  SloSummaryDto,
  SloDeclarationDto,
  SloEvaluationDto,
  CreateSloDeclarationDto,
  CreateSloEvaluationDto,
} from '@provenance/types';

const base = (orgId: string, productId: string) =>
  `/organizations/${orgId}/products/${productId}`;

export function fetchSloSummary(
  orgId: string,
  productId: string,
): Promise<SloSummaryDto> {
  return api.get<SloSummaryDto>(`${base(orgId, productId)}/slo-summary`);
}

export function fetchSlos(
  orgId: string,
  productId: string,
  status = 'active',
): Promise<{ items: SloDeclarationDto[] }> {
  return api.get<{ items: SloDeclarationDto[] }>(
    `${base(orgId, productId)}/slos?status=${status}`,
  );
}

export function fetchSloEvaluations(
  orgId: string,
  productId: string,
  sloId: string,
  limit = 20,
): Promise<SloEvaluationDto[]> {
  return api.get<SloEvaluationDto[]>(
    `${base(orgId, productId)}/slos/${sloId}/evaluations?limit=${limit}`,
  );
}

export function createSlo(
  orgId: string,
  productId: string,
  dto: CreateSloDeclarationDto,
): Promise<SloDeclarationDto> {
  return api.post<SloDeclarationDto>(`${base(orgId, productId)}/slos`, dto);
}

export function postEvaluation(
  orgId: string,
  productId: string,
  sloId: string,
  dto: CreateSloEvaluationDto,
): Promise<SloEvaluationDto> {
  return api.post<SloEvaluationDto>(
    `${base(orgId, productId)}/slos/${sloId}/evaluations`,
    dto,
  );
}
