import { api } from './client.js';
import type {
  MarketplaceProductList,
  MarketplaceProductDetail,
  MarketplaceFilters,
  ProductSchema,
  LineageGraph,
  SloSummary,
  AccessRequestList,
  PortSituationResponse,
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
  if (filters.q)                       params.set('q',                filters.q);
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

    accessRequestsGlobal: (productId: string, limit = 20, offset = 0): Promise<AccessRequestList> => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      return api.get<AccessRequestList>(`/marketplace/products/${productId}/access-requests?${params.toString()}`);
    },

    /**
     * Per-port snippet generation for the consumer-grade outbound flow.
     * Returns `{ available: false, reason: 'request_access_required' }` when
     * the caller has neither product ownership nor an active access grant.
     *
     * For the `snowflake_share` destination, supply `consumerAccountLocator`
     * (the consumer's Snowflake account locator, e.g. `EO76245.US-EAST-2.AWS`).
     * If omitted, a placeholder is emitted in the snippet.
     */
    snippet: (
      productOrgId: string,
      productId: string,
      portId: string,
      destination: SnippetDestination,
      consumerAccountLocator?: string,
    ): Promise<PortSnippetResponse> => {
      const params = new URLSearchParams({ destination });
      if (consumerAccountLocator) params.set('consumerAccountLocator', consumerAccountLocator);
      return api.get<PortSnippetResponse>(
        `/organizations/${productOrgId}/products/${productId}/ports/${portId}/snippet?${params.toString()}`,
      );
    },

    /**
     * F10.15 (Phase 5.9) — consumer-flow situation detection per port.
     * Returns Situation A (producer-declared open access) or B (per-product
     * grant required) plus a recommendedNext UX hint. Used by the
     * SnippetPicker to decide whether to render an "Open access" banner
     * vs gate the snippet behind the request-access flow.
     */
    situation: (
      productOrgId: string,
      productId: string,
      portId: string,
    ): Promise<PortSituationResponse> =>
      api.get<PortSituationResponse>(
        `/organizations/${productOrgId}/products/${productId}/ports/${portId}/situation`,
      ),

    /**
     * F10.14 / Phase 5.11 — source-side view DDL for a port.
     *
     * Producer-facing: the endpoint is owner-only (NOT marked
     * @AllowCrossOrgRead at the controller; the JwtAuthGuard same-org
     * check fires and the controller adds an additional ownership
     * check). Lives on the marketplace-style port path because the URL
     * shape `/organizations/:orgId/products/:productId/ports/:portId/...`
     * is the established sibling shape for snippet + situation, even
     * though this is a producer surface.
     *
     * Returns `{available, ddl, reason?}` — `ddl` is null when the
     * port doesn't qualify (non-sql_jdbc, missing catalog_name, or
     * missing source_object_path); `reason` is the typed enum
     * `unsupported_interface_type | missing_catalog_name | missing_source_object_path`.
     */
    sourceViewDdl: (
      productOrgId: string,
      productId: string,
      portId: string,
    ): Promise<{
      available: boolean;
      ddl: string | null;
      reason?: string;
    }> =>
      api.get<{ available: boolean; ddl: string | null; reason?: string }>(
        `/organizations/${productOrgId}/products/${productId}/ports/${portId}/source-view-ddl`,
      ),
  },
};

// ---------------------------------------------------------------------------
// Per-port snippet types
// ---------------------------------------------------------------------------

export type SnippetDestination =
  | 'python'
  | 'dbt'
  | 'sql_client'
  | 'jdbc'
  | 'power_bi'
  | 'tableau'
  | 'snowflake_share';

export const SNIPPET_DESTINATIONS: { value: SnippetDestination; label: string }[] = [
  { value: 'python',          label: 'Python' },
  { value: 'sql_client',      label: 'SQL client' },
  { value: 'jdbc',            label: 'JDBC URL' },
  { value: 'dbt',             label: 'dbt' },
  { value: 'power_bi',        label: 'Power BI' },
  { value: 'tableau',         label: 'Tableau' },
  { value: 'snowflake_share', label: 'Snowflake share (cross-org)' },
];

// Which destinations actually apply to a port's interface type. Only sql_jdbc
// supports the full toolset; every other interface type (semantic_query_endpoint,
// rest_api, graphql, streaming_topic, file_object_export) is python-only — the
// backend returns `destination_not_yet_supported` for the rest, which surfaced
// in the UI as a wall of "not yet generated" errors. Filter the picker instead.
export function snippetDestinationsFor(
  interfaceType: string | null | undefined,
  isSnowflake = false,
): { value: SnippetDestination; label: string }[] {
  if (interfaceType === 'sql_jdbc') {
    return SNIPPET_DESTINATIONS.filter((d) => d.value !== 'snowflake_share' || isSnowflake);
  }
  return SNIPPET_DESTINATIONS.filter((d) => d.value === 'python');
}

export interface PortSnippetResponse {
  destination: SnippetDestination;
  language: 'python' | 'yaml' | 'text' | 'json' | 'xml';
  code: string | null;
  available: boolean;
  reason?:
    | 'request_access_required'
    | 'destination_not_yet_supported'
    | 'port_has_no_connection_details'
    | 'unsupported_interface_type'
    | 'snowflake_port_required';
}
