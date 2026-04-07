import { useState, useEffect, useMemo } from 'react';
import { governanceApi } from '../../shared/api/governance.js';
import { api } from '../../shared/api/client.js';
import { ApiError } from '../../shared/api/client.js';
import { useOrgId } from '../../shared/hooks/useOrgId.js';
import type {
  ComplianceState,
  ComplianceStateValue,
  MarketplaceProduct,
  MarketplaceProductList,
  EvaluationResult,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_COLORS: Record<ComplianceStateValue, string> = {
  compliant: 'bg-green-100 text-green-800',
  drift_detected: 'bg-yellow-100 text-yellow-800',
  grace_period: 'bg-orange-100 text-orange-800',
  non_compliant: 'bg-red-100 text-red-800',
};

const STATE_LABELS: Record<ComplianceStateValue, string> = {
  compliant: 'Compliant',
  drift_detected: 'Drift Detected',
  grace_period: 'Grace Period',
  non_compliant: 'Non-Compliant',
};

const STATE_ORDER: Record<ComplianceStateValue, number> = {
  non_compliant: 0,
  grace_period: 1,
  drift_detected: 2,
  compliant: 3,
};

const FILTER_OPTIONS: { label: string; value: ComplianceStateValue | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Compliant', value: 'compliant' },
  { label: 'Drift Detected', value: 'drift_detected' },
  { label: 'Grace Period', value: 'grace_period' },
  { label: 'Non-Compliant', value: 'non_compliant' },
];

type SortField = 'name' | 'state' | 'trustScore';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Joined row type
// ---------------------------------------------------------------------------

interface ComplianceRow {
  productId: string;
  productName: string;
  domainName: string;
  state: ComplianceStateValue;
  trustScore: number;
  evaluatedAt: string;
  violations: ComplianceState['violations'];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildCsv(rows: ComplianceRow[]): string {
  const header = 'Product Name,Domain,Compliance State,Trust Score,Last Evaluated,Violations';
  const lines = rows.map((r) => {
    const name = `"${r.productName.replace(/"/g, '""')}"`;
    const domain = `"${r.domainName.replace(/"/g, '""')}"`;
    const state = STATE_LABELS[r.state];
    return `${name},${domain},${state},${r.trustScore},${r.evaluatedAt},${r.violations.length}`;
  });
  return [header, ...lines].join('\n');
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sort indicator
// ---------------------------------------------------------------------------

function SortIndicator({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) {
    return <span className="ml-1 text-slate-300">&uarr;&darr;</span>;
  }
  return <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ComplianceMonitorPage() {
  const orgId = useOrgId();

  // Data
  const [complianceStates, setComplianceStates] = useState<ComplianceState[]>([]);
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [stateFilter, setStateFilter] = useState<ComplianceStateValue | ''>('');
  const [search, setSearch] = useState('');

  // Sort
  const [sortField, setSortField] = useState<SortField>('state');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Expand
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Re-evaluate
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!orgId) return;

    setLoading(true);
    setError(null);

    const complianceFilter = stateFilter || undefined;

    Promise.all([
      governanceApi.compliance.list(orgId, complianceFilter, undefined, 200, 0),
      api.get<MarketplaceProductList>('/api/v1/marketplace/products?limit=200'),
    ])
      .then(([complianceList, productList]) => {
        setComplianceStates(complianceList.items);
        setProducts(productList.items);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load compliance data');
        setLoading(false);
      });
  }, [orgId, stateFilter]);

  // ---------------------------------------------------------------------------
  // Join and filter/sort rows
  // ---------------------------------------------------------------------------

  const rows = useMemo<ComplianceRow[]>(() => {
    const productMap = new Map<string, MarketplaceProduct>();
    for (const p of products) {
      productMap.set(p.id, p);
    }

    let joined: ComplianceRow[] = complianceStates.map((cs) => {
      const product = productMap.get(cs.productId);
      return {
        productId: cs.productId,
        productName: product?.name ?? cs.productId,
        domainName: product?.domainName ?? 'Unknown',
        state: cs.state,
        trustScore: product?.trustScore ?? 0,
        evaluatedAt: cs.evaluatedAt,
        violations: cs.violations,
      };
    });

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      joined = joined.filter((r) => r.productName.toLowerCase().includes(q));
    }

    // Sort
    joined.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.productName.localeCompare(b.productName);
          break;
        case 'state':
          cmp = STATE_ORDER[a.state] - STATE_ORDER[b.state];
          break;
        case 'trustScore':
          cmp = a.trustScore - b.trustScore;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return joined;
  }, [complianceStates, products, search, sortField, sortDir]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function handleExportCsv() {
    const csv = buildCsv(rows);
    const ts = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `compliance-monitor-${ts}.csv`);
  }

  function handleReEvaluateAll() {
    if (!orgId || evaluating) return;
    setEvaluating(true);
    setEvalResult(null);

    governanceApi.compliance
      .evaluate(orgId, {})
      .then((result) => {
        setEvalResult(result);
        setEvaluating(false);
        // Reload compliance states after evaluation
        return governanceApi.compliance.list(orgId, stateFilter || undefined, undefined, 200, 0);
      })
      .then((complianceList) => {
        if (complianceList) {
          setComplianceStates(complianceList.items);
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Re-evaluation failed');
        setEvaluating(false);
      });
  }

  // ---------------------------------------------------------------------------
  // Render: loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Compliance Monitor</h1>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: error
  // ---------------------------------------------------------------------------

  if (error && complianceStates.length === 0) {
    return (
      <div className="p-6 max-w-screen-xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Compliance Monitor</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: main
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Compliance Monitor</h1>
          <p className="mt-1 text-sm text-slate-500">
            All published data products and their compliance state.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleReEvaluateAll}
            disabled={evaluating}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {evaluating ? 'Evaluating...' : 'Re-evaluate All'}
          </button>
        </div>
      </div>

      {/* Evaluation result banner */}
      {evalResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex items-center justify-between">
          <span>
            Evaluation complete: {evalResult.evaluated} evaluated, {evalResult.compliant} compliant,{' '}
            {evalResult.nonCompliant} non-compliant, {evalResult.driftDetected} drift detected,{' '}
            {evalResult.gracePeriod} in grace period.
          </span>
          <button
            type="button"
            onClick={() => setEvalResult(null)}
            className="ml-4 text-blue-600 hover:text-blue-800 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="state-filter" className="text-sm font-medium text-slate-700">
            State:
          </label>
          <select
            id="state-filter"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as ComplianceStateValue | '')}
            className="rounded-lg border border-slate-300 text-sm py-1.5 px-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-1">
          <label htmlFor="search" className="text-sm font-medium text-slate-700">
            Search:
          </label>
          <input
            id="search"
            type="text"
            placeholder="Filter by product name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm py-1.5 px-3 text-slate-700 flex-1 max-w-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <span className="text-xs text-slate-400 ml-auto">
          {rows.length} product{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th
                className="px-4 py-3 font-semibold text-slate-700 cursor-pointer select-none hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('name')}
              >
                Product Name
                <SortIndicator field="name" sortField={sortField} sortDir={sortDir} />
              </th>
              <th className="px-4 py-3 font-semibold text-slate-700">Domain</th>
              <th
                className="px-4 py-3 font-semibold text-slate-700 cursor-pointer select-none hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('state')}
              >
                Compliance
                <SortIndicator field="state" sortField={sortField} sortDir={sortDir} />
              </th>
              <th
                className="px-4 py-3 font-semibold text-slate-700 cursor-pointer select-none hover:bg-slate-100 transition-colors text-right"
                onClick={() => handleSort('trustScore')}
              >
                Trust Score
                <SortIndicator field="trustScore" sortField={sortField} sortDir={sortDir} />
              </th>
              <th className="px-4 py-3 font-semibold text-slate-700">Last Evaluated</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-right">Violations</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  No products match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isExpanded = expandedId === row.productId;
                return (
                  <RowGroup
                    key={row.productId}
                    row={row}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : row.productId)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row + inline detail panel
// ---------------------------------------------------------------------------

function RowGroup({
  row,
  isExpanded,
  onToggle,
}: {
  row: ComplianceRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <span className="font-medium text-slate-800 truncate block max-w-xs" title={row.productName}>
            {row.productName}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-600">{row.domainName}</td>
        <td className="px-4 py-3">
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[row.state]}`}>
            {STATE_LABELS[row.state]}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-medium text-slate-800">{row.trustScore}</td>
        <td className="px-4 py-3 text-slate-500 text-xs">{formatTimestamp(row.evaluatedAt)}</td>
        <td className="px-4 py-3 text-right">
          {row.violations.length > 0 ? (
            <span className="inline-block min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
              {row.violations.length}
            </span>
          ) : (
            <span className="text-slate-400 text-xs">0</span>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-slate-200">
          <td colSpan={6} className="px-4 py-4 bg-slate-50">
            <div className="space-y-3">
              {row.violations.length === 0 ? (
                <p className="text-xs text-slate-400">No violations recorded.</p>
              ) : (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Violations
                  </h4>
                  {row.violations.map((v, idx) => (
                    <div
                      key={`${v.policyDomain}-${v.ruleId}-${idx}`}
                      className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-3"
                    >
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 flex-shrink-0">
                        {v.policyDomain}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-700">
                          Rule: <code className="bg-slate-100 px-1 py-0.5 rounded">{v.ruleId}</code>
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{v.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-1">
                <a
                  href={`/marketplace/products/${row.productId}`}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  View product detail &rarr;
                </a>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
