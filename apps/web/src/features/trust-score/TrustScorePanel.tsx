import { useState, useEffect, useCallback } from 'react';
import type { TrustScoreDto, TrustScoreHistoryDto } from '@provenance/types';
import { fetchTrustScore, fetchTrustScoreHistory, recomputeTrustScore } from './api/trust-score-api.js';
import { TrustScoreBadge } from './components/TrustScoreBadge.js';
import { TrustScoreBreakdownPanel } from './components/TrustScoreBreakdownPanel.js';
import { TrustScoreSparkline } from './components/TrustScoreSparkline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TrustScorePanelProps {
  productId: string;
  orgId: string;
}

export function TrustScorePanel({ productId, orgId }: TrustScorePanelProps) {
  const [score, setScore] = useState<TrustScoreDto | null>(null);
  const [history, setHistory] = useState<TrustScoreHistoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [scoreKey, setScoreKey] = useState(0); // for CSS transition

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [scoreRes, historyRes] = await Promise.all([
        fetchTrustScore(orgId, productId),
        fetchTrustScoreHistory(orgId, productId),
      ]);
      setScore(scoreRes);
      setHistory(historyRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trust score');
    } finally {
      setLoading(false);
    }
  }, [orgId, productId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      await recomputeTrustScore(orgId, productId);
      const [scoreRes, historyRes] = await Promise.all([
        fetchTrustScore(orgId, productId),
        fetchTrustScoreHistory(orgId, productId),
      ]);
      setScore(scoreRes);
      setHistory(historyRes);
      setScoreKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recompute trust score');
    } finally {
      setRecomputing(false);
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse" aria-busy="true" aria-label="Loading trust score">
        <div className="h-5 bg-slate-200 rounded w-32 mb-4" />
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 bg-slate-200 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-100 rounded w-full" />
            <div className="h-3 bg-slate-100 rounded w-3/4" />
            <div className="h-3 bg-slate-100 rounded w-1/2" />
          </div>
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
            onClick={() => { setLoading(true); loadData(); }}
            className="ml-3 text-red-800 underline hover:no-underline font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!score) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700">Trust Score</h2>
        <button
          type="button"
          onClick={handleRecompute}
          disabled={recomputing}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-60"
        >
          {recomputing && (
            <div className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden />
          )}
          Recompute
        </button>
      </div>

      {/* Badge */}
      <div className="flex flex-col items-center mb-1">
        <div key={scoreKey} className="transition-transform duration-300 ease-out" style={{ animation: scoreKey > 0 ? 'trustScorePop 0.3s ease-out' : undefined }}>
          <TrustScoreBadge score={score.score} band={score.band} size="lg" />
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Computed {formatRelativeTime(score.computed_at)}
        </p>
      </div>

      {/* Sparkline */}
      {history.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Score Trend</h3>
          <TrustScoreSparkline history={history} />
        </div>
      )}

      {/* Breakdown */}
      <div className="mt-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Score Breakdown</h3>
        <TrustScoreBreakdownPanel components={score.components} />
      </div>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes trustScorePop {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
