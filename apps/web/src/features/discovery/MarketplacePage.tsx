import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { marketplaceApi } from '../../shared/api/marketplace.js';
import { ApiError } from '../../shared/api/client.js';
import type {
  MarketplaceProduct,
  MarketplaceFilters,
  MarketplaceSortOption,
  DataClassification,
  OutputPortInterfaceType,
  ComplianceStateValue,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SORT_OPTIONS: { value: MarketplaceSortOption; label: string }[] = [
  { value: 'trust_score_desc',   label: 'Trust Score' },
  { value: 'name_asc',           label: 'Name (A–Z)' },
  { value: 'recently_updated',   label: 'Recently Updated' },
  { value: 'recently_published', label: 'Recently Published' },
];

const COMPLIANCE_OPTIONS: { value: ComplianceStateValue; label: string; color: string }[] = [
  { value: 'compliant',      label: 'Compliant',      color: 'text-green-700'  },
  { value: 'drift_detected', label: 'Drift Detected', color: 'text-yellow-700' },
  { value: 'grace_period',   label: 'Grace Period',   color: 'text-orange-700' },
  { value: 'non_compliant',  label: 'Non-Compliant',  color: 'text-red-700'    },
];

const PORT_TYPE_OPTIONS: { value: OutputPortInterfaceType; label: string }[] = [
  { value: 'sql_jdbc',                label: 'SQL / JDBC'              },
  { value: 'rest_api',                label: 'REST API'                },
  { value: 'graphql',                 label: 'GraphQL'                 },
  { value: 'streaming_topic',         label: 'Streaming'               },
  { value: 'file_object_export',      label: 'File / Object'           },
  { value: 'semantic_query_endpoint', label: 'Semantic (Agents)'       },
];

const CLASSIFICATION_STYLES: Record<DataClassification, string> = {
  public:       'bg-blue-100 text-blue-800',
  internal:     'bg-slate-100 text-slate-700',
  confidential: 'bg-amber-100 text-amber-800',
  restricted:   'bg-red-100 text-red-800',
};

const COMPLIANCE_BADGE: Record<ComplianceStateValue, string> = {
  compliant:      'bg-green-100 text-green-800',
  drift_detected: 'bg-yellow-100 text-yellow-800',
  grace_period:   'bg-orange-100 text-orange-800',
  non_compliant:  'bg-red-100 text-red-800',
};

const COMPLIANCE_LABEL: Record<ComplianceStateValue, string> = {
  compliant:      'Compliant',
  drift_detected: 'Drift',
  grace_period:   'Grace Period',
  non_compliant:  'Non-Compliant',
};

const PORT_ICON: Record<OutputPortInterfaceType, string> = {
  sql_jdbc:                '🗄',
  rest_api:                '🔗',
  graphql:                 '⬡',
  streaming_topic:         '⚡',
  file_object_export:      '📦',
  semantic_query_endpoint: '🤖',
};

const ITEMS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// URL ↔ filter state serialisation
// ---------------------------------------------------------------------------

function filtersToParams(
  filters: MarketplaceFilters,
  sort: MarketplaceSortOption,
  page: number,
): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.domain?.length)         p.set('domain',           filters.domain.join(','));
  if (filters.outputPortType?.length) p.set('outputPortType',   filters.outputPortType.join(','));
  if (filters.compliance?.length)     p.set('compliance',       filters.compliance.join(','));
  if (filters.trustScoreMin !== undefined) p.set('trustScoreMin', String(filters.trustScoreMin));
  if (filters.trustScoreMax !== undefined) p.set('trustScoreMax', String(filters.trustScoreMax));
  if (filters.tags?.length)           p.set('tags',             filters.tags.join(','));
  if (filters.includeDeprecated)      p.set('includeDeprecated','true');
  if (sort !== 'trust_score_desc')    p.set('sort',             sort);
  if (page > 1)                       p.set('page',             String(page));
  return p;
}

function paramsToFilters(params: URLSearchParams): {
  filters: MarketplaceFilters;
  sort: MarketplaceSortOption;
  page: number;
} {
  const filters: MarketplaceFilters = {};
  const domain         = params.get('domain');
  const portType       = params.get('outputPortType');
  const compliance     = params.get('compliance');
  const trustScoreMin  = params.get('trustScoreMin');
  const trustScoreMax  = params.get('trustScoreMax');
  const tags           = params.get('tags');
  if (domain)        filters.domain           = domain.split(',');
  if (portType)      filters.outputPortType   = portType.split(',') as OutputPortInterfaceType[];
  if (compliance)    filters.compliance       = compliance.split(',') as ComplianceStateValue[];
  if (trustScoreMin) filters.trustScoreMin    = parseFloat(trustScoreMin);
  if (trustScoreMax) filters.trustScoreMax    = parseFloat(trustScoreMax);
  if (tags)          filters.tags             = tags.split(',');
  if (params.get('includeDeprecated') === 'true') filters.includeDeprecated = true;
  return {
    filters,
    sort: (params.get('sort') as MarketplaceSortOption | null) ?? 'trust_score_desc',
    page: params.get('page') ? parseInt(params.get('page')!, 10) : 1,
  };
}

// ---------------------------------------------------------------------------
// Trust score badge
// ---------------------------------------------------------------------------

function TrustBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? 'bg-green-100 text-green-800 border-green-200'
    : pct >= 60 ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
    : pct >= 40 ? 'bg-orange-100 text-orange-800 border-orange-200'
    : 'bg-red-100 text-red-800 border-red-200';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${color}`}
      title={`Trust score: ${pct}/100`}
    >
      ★ {pct}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

function ProductCard({ product, view }: { product: MarketplaceProduct; view: 'grid' | 'list' }) {
  const navigate = useNavigate();
  const desc = product.description
    ? product.description.length > 140
      ? product.description.slice(0, 140) + '…'
      : product.description
    : null;
  const isDeprecated = product.status === 'deprecated';

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{product.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{product.domainName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isDeprecated && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
              Deprecated
            </span>
          )}
          <TrustBadge score={product.trustScore} />
          {product.complianceState && (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${COMPLIANCE_BADGE[product.complianceState]}`}>
              {COMPLIANCE_LABEL[product.complianceState]}
            </span>
          )}
        </div>
      </div>

      {desc && (
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">{desc}</p>
      )}

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${CLASSIFICATION_STYLES[product.classification]}`}>
          {product.classification}
        </span>
        <span className="text-xs text-slate-400">v{product.version}</span>
        {product.outputPortTypes.length > 0 && (
          <div className="flex items-center gap-1" title={product.outputPortTypes.join(', ')}>
            {product.outputPortTypes.slice(0, 4).map((t) => (
              <span key={t} className="text-sm" title={t}>{PORT_ICON[t]}</span>
            ))}
            {product.outputPortTypes.length > 4 && (
              <span className="text-xs text-slate-400">+{product.outputPortTypes.length - 4}</span>
            )}
          </div>
        )}
        {product.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
            {tag}
          </span>
        ))}
      </div>
    </>
  );

  // Deprecated products are still navigable but visually muted so a viewer
  // doesn't mistake them for first-class supported products at a glance.
  const deprecatedClass = isDeprecated ? 'bg-slate-50 opacity-75 hover:opacity-100' : 'bg-white';

  if (view === 'list') {
    return (
      <button
        type="button"
        onClick={() => navigate(`/marketplace/${product.orgId}/${product.id}`)}
        className={`w-full text-left ${deprecatedClass} border border-slate-200 rounded-lg p-4 hover:border-brand-400 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand-500`}
        aria-label={`View details for ${product.name}${isDeprecated ? ' (deprecated)' : ''}`}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate(`/marketplace/${product.orgId}/${product.id}`)}
      className={`w-full text-left ${deprecatedClass} border border-slate-200 rounded-xl p-5 hover:border-brand-400 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 flex flex-col`}
      aria-label={`View details for ${product.name}${isDeprecated ? ' (deprecated)' : ''}`}
    >
      {cardContent}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CardSkeleton({ view }: { view: 'grid' | 'list' }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 animate-pulse ${view === 'list' ? 'rounded-lg' : ''}`}>
      <div className="flex justify-between gap-4">
        <div className="h-4 bg-slate-200 rounded w-2/5" />
        <div className="h-4 bg-slate-200 rounded w-12" />
      </div>
      <div className="mt-1 h-3 bg-slate-100 rounded w-1/4" />
      <div className="mt-3 h-3 bg-slate-100 rounded w-full" />
      <div className="mt-1 h-3 bg-slate-100 rounded w-4/5" />
      <div className="mt-3 flex gap-2">
        <div className="h-5 bg-slate-100 rounded w-16" />
        <div className="h-5 bg-slate-100 rounded w-10" />
        <div className="h-5 bg-slate-100 rounded w-14" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter panel
// ---------------------------------------------------------------------------

interface FilterPanelProps {
  filters: MarketplaceFilters;
  onChange: (f: MarketplaceFilters) => void;
}

function FilterPanel({ filters, onChange }: FilterPanelProps) {
  // Returns a new filter object with the array field toggled.
  // Removes the key entirely when the resulting array is empty (exactOptionalPropertyTypes safe).
  function toggleCompliance(value: ComplianceStateValue) {
    const arr = filters.compliance ?? [];
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    const updated: MarketplaceFilters = { ...filters };
    if (next.length) { updated.compliance = next; } else { delete updated.compliance; }
    onChange(updated);
  }

  function togglePortType(value: OutputPortInterfaceType) {
    const arr = filters.outputPortType ?? [];
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    const updated: MarketplaceFilters = { ...filters };
    if (next.length) { updated.outputPortType = next; } else { delete updated.outputPortType; }
    onChange(updated);
  }

  function setTrustScoreMin(pct: number) {
    const updated: MarketplaceFilters = { ...filters };
    if (pct > 0) { updated.trustScoreMin = pct / 100; } else { delete updated.trustScoreMin; }
    onChange(updated);
  }

  function setIncludeDeprecated(checked: boolean) {
    const updated: MarketplaceFilters = { ...filters };
    if (checked) { updated.includeDeprecated = true; } else { delete updated.includeDeprecated; }
    onChange(updated);
  }

  return (
    <aside className="w-56 flex-shrink-0 space-y-6" aria-label="Filters">

      {/* Compliance state */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
          Compliance
        </legend>
        <div className="space-y-1">
          {COMPLIANCE_OPTIONS.map(({ value, label, color }) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={(filters.compliance ?? []).includes(value)}
                onChange={() => toggleCompliance(value)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className={`text-sm ${color} group-hover:font-medium transition-all`}>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Output port type */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
          Access Method
        </legend>
        <div className="space-y-1">
          {PORT_TYPE_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={(filters.outputPortType ?? []).includes(value)}
                onChange={() => togglePortType(value)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-slate-600">
                {PORT_ICON[value]} {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Trust score range */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
          Min Trust Score
        </legend>
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={Math.round((filters.trustScoreMin ?? 0) * 100)}
            onChange={(e) => setTrustScoreMin(parseInt(e.target.value, 10))}
            className="w-full accent-brand-600"
            aria-label="Minimum trust score"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>0</span>
            <span className="font-medium text-slate-700">
              {Math.round((filters.trustScoreMin ?? 0) * 100)}+
            </span>
            <span>100</span>
          </div>
        </div>
      </fieldset>

      {/* Include deprecated */}
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
          Status
        </legend>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.includeDeprecated ?? false}
            onChange={(e) => setIncludeDeprecated(e.target.checked)}
            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-600">Include deprecated</span>
        </label>
      </fieldset>

      {/* Clear all */}
      <button
        type="button"
        onClick={() => onChange({})}
        className="text-xs text-brand-600 hover:text-brand-800 underline"
      >
        Clear all filters
      </button>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function MarketplacePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { filters, sort, page } = paramsToFilters(searchParams);

  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [searchInput, setSearchInput] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (
    f: MarketplaceFilters,
    _s: MarketplaceSortOption,
    p: number,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await marketplaceApi.products.listAll(f, p, ITEMS_PER_PAGE);
      setProducts(res.items);
      setTotal(res.meta.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load marketplace');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters, sort, page);
  }, [searchParams]); // load is stable; filters/sort/page are derived from searchParams

  function applyFilters(newFilters: MarketplaceFilters) {
    setSearchParams(filtersToParams(newFilters, sort, 1));
  }

  function applySort(newSort: MarketplaceSortOption) {
    setSearchParams(filtersToParams(filters, newSort, 1));
  }

  function goToPage(p: number) {
    setSearchParams(filtersToParams(filters, sort, p));
    window.scrollTo({ top: 0 });
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const updated: MarketplaceFilters = { ...filters };
      if (value.trim()) {
        updated.tags = [value.trim()];
      } else {
        delete updated.tags;
      }
      setSearchParams(filtersToParams(updated, sort, 1));
    }, 400);
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Data Product Marketplace</h1>
        <p className="mt-1 text-sm text-slate-500">
          Discover published data products across the platform.
        </p>
      </div>

      {/* Search + sort + view toggle */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex-1 min-w-64 relative">
          <input
            type="search"
            placeholder="Search by tag…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            aria-label="Search marketplace"
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
        </div>

        <select
          value={sort}
          onChange={(e) => applySort(e.target.value as MarketplaceSortOption)}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          aria-label="Sort by"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="View mode">
          <button
            type="button"
            onClick={() => setView('grid')}
            className={`px-3 py-2 text-sm transition-colors ${view === 'grid' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            aria-pressed={view === 'grid'}
          >
            ⊞ Grid
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className={`px-3 py-2 text-sm transition-colors ${view === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            aria-pressed={view === 'list'}
          >
            ☰ List
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Filter panel */}
        <FilterPanel filters={filters} onChange={applyFilters} />

        {/* Results */}
        <div className="flex-1 min-w-0">
          {/* Result count */}
          {!loading && !error && (
            <p className="text-sm text-slate-500 mb-4">
              {total === 0 ? 'No products found' : `${total} product${total === 1 ? '' : 's'}`}
            </p>
          )}

          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div
              className={view === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'
                : 'flex flex-col gap-3'}
              aria-busy="true"
              aria-label="Loading products"
            >
              {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} view={view} />)}
            </div>
          ) : products.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <svg className="h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
              </svg>
              <p className="text-sm font-medium">No published products found</p>
              <p className="text-xs mt-1">Try adjusting your filters or check back later.</p>
              <button
                type="button"
                onClick={() => applyFilters({})}
                className="mt-4 text-xs text-brand-600 hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div
              className={view === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'
                : 'flex flex-col gap-3'}
            >
              {products.map((p) => (
                <ProductCard key={p.id} product={p} view={view} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav
              className="mt-8 flex items-center justify-center gap-1"
              aria-label="Pagination"
            >
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                ‹ Prev
              </button>

              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => goToPage(pageNum)}
                    className={`w-9 py-1.5 text-sm rounded-md border transition-colors ${
                      pageNum === page
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                    aria-label={`Page ${pageNum}`}
                    aria-current={pageNum === page ? 'page' : undefined}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                Next ›
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
