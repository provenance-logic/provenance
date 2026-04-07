import { api } from './client.js';
import type {
  MarketplaceProductList,
  MarketplaceProductDetail,
  MarketplaceFilters,
  ProductSchema,
  LineageGraph,
  SloSummary,
} from '@provenance/types';

const base = (orgId: string) => `/organizations/${orgId}/marketplace`;

function buildFilterParams(
  filters: MarketplaceFilters,
  page: number,
  limit: number,
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (filters.domain?.length)          params.set('domain',           filters.domain.join(','));
  if (filters.outputPortType?.length)  params.set('outputPortType',   filters.outputPortType.join(','));
  if (filters.compliance?.length)      params.set('compliance',       filters.compliance.join(','));
  if (filters.trustScoreMin !== undefined) params.set('trustScoreMin', String(filters.trustScoreMin));
  if (filters.trustScoreMax !== undefined) params.set('trustScoreMax', String(filters.trustScoreMax));
  if (filters.tags?.length)            params.set('tags',             filters.tags.join(','));
  if (filters.includeDeprecated)       params.set('includeDeprecated','true');
  if (filters.sort)                    params.set('sort',             filters.sort);
  return params;
}

export const marketplaceApi = {
  products: {
    listAll: (
      filters: MarketplaceFilters = {},
      page = 1,
      limit = 20,
    ): Promise<MarketplaceProductList> => {
      const params = buildFilterParams(filters, page, limit);
      return api.get<MarketplaceProductList>(`/marketplace/products?${params.toString()}`);
    },

    list: (
      orgId: string,
      filters: MarketplaceFilters = {},
      page = 1,
      limit = 20,
    ): Promise<MarketplaceProductList> => {
      const params = buildFilterParams(filters, page, limit);
      return api.get<MarketplaceProductList>(`${base(orgId)}/products?${params.toString()}`);
    },

    get: (orgId: string, productId: string): Promise<MarketplaceProductDetail> =>
      api.get<MarketplaceProductDetail>(`${base(orgId)}/products/${productId}`),

    getGlobal: (productId: string): Promise<MarketplaceProductDetail> =>
      api.get<MarketplaceProductDetail>(`/marketplace/products/${productId}`),

    schema: (orgId: string, productId: string): Promise<ProductSchema> =>
      api.get<ProductSchema>(`${base(orgId)}/products/${productId}/schema`),

    schemaGlobal: (productId: string): Promise<ProductSchema> =>
      api.get<ProductSchema>(`/marketplace/products/${productId}/schema`),

    lineage: (orgId: string, productId: string, depth = 3): Promise<LineageGraph> =>
      api.get<LineageGraph>(`${base(orgId)}/products/${productId}/lineage?depth=${depth}`),

    lineageGlobal: (productId: string, depth = 3): Promise<LineageGraph> =>
      api.get<LineageGraph>(`/marketplace/products/${productId}/lineage?depth=${depth}`),

    slos: (orgId: string, productId: string): Promise<SloSummary> =>
      api.get<SloSummary>(`${base(orgId)}/products/${productId}/slos`),

    slosGlobal: (productId: string): Promise<SloSummary> =>
      api.get<SloSummary>(`/marketplace/products/${productId}/slos`),
  },
};
