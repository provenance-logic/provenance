import { useState, useEffect, useCallback } from 'react';
import type { SloSummaryDto, SloDeclarationDto } from '@provenance/types';
import { fetchSloSummary, fetchSlos } from './api/slo-api.js';
import { SloSummaryHeader } from './components/SloSummaryHeader.js';
import { SloCard } from './components/SloCard.js';
import { AddSloForm } from './components/AddSloForm.js';

interface Props {
  productId: string;
  orgId: string;
}

export function ObservabilityDashboard({ productId, orgId }: Props) {
  const [summary, setSummary] = useState<SloSummaryDto | null>(null);
  const [slos, setSlos] = useState<SloDeclarationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [summaryRes, slosRes] = await Promise.all([
        fetchSloSummary(orgId, productId),
        fetchSlos(orgId, productId),
      ]);
      setSummary(summaryRes);
      setSlos(slosRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SLO data');
    } finally {
      setLoading(false);
    }
  }, [orgId, productId]);

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  const handleSloCreated = () => {
    setShowAddForm(false);
    setLoading(true);
    void loadData();
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading SLOs">
        <div className="h-8 bg-slate-200 rounded w-2/3" />
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="h-2 bg-slate-100 rounded w-full" />
          <div className="h-4 bg-slate-100 rounded w-1/3" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="h-4 bg-slate-100 rounded w-1/2" />
          <div className="h-2 bg-slate-100 rounded w-full" />
          <div className="h-4 bg-slate-100 rounded w-1/3" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => { setLoading(true); void loadData(); }}
            className="ml-3 text-red-800 underline hover:no-underline font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + Add button */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          {summary && <SloSummaryHeader summary={summary} />}
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {showAddForm ? '− Cancel' : '+ Add SLO'}
        </button>
      </div>

      {/* Add SLO form */}
      {showAddForm && (
        <AddSloForm
          orgId={orgId}
          productId={productId}
          onCreated={handleSloCreated}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* SLO cards */}
      {slos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm font-medium text-slate-600">No SLOs defined yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Add your first SLO to start tracking this product's health.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {slos.map((slo) => (
            <SloCard
              key={slo.id}
              slo={slo}
              orgId={orgId}
              productId={productId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
