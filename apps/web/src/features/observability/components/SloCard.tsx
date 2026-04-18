import { useState } from 'react';
import type { SloDeclarationDto, SloEvaluationDto } from '@provenance/types';
import { fetchSloEvaluations } from '../api/slo-api.js';
import { formatRelativeTime } from '../../../shared/utils/format-time.js';

const TYPE_STYLES: Record<string, string> = {
  freshness:    'bg-blue-100 text-blue-700',
  null_rate:    'bg-purple-100 text-purple-700',
  latency:      'bg-orange-100 text-orange-700',
  completeness: 'bg-emerald-100 text-emerald-700',
  custom:       'bg-slate-100 text-slate-700',
};

const OP_LABELS: Record<string, string> = {
  lt:  '<',
  lte: '≤',
  gt:  '>',
  gte: '≥',
  eq:  '=',
};

function healthDot(passRate7d: number | null): string {
  if (passRate7d == null) return 'bg-red-500';
  if (passRate7d >= 0.95) return 'bg-emerald-500';
  if (passRate7d >= 0.80) return 'bg-amber-500';
  return 'bg-red-500';
}

interface Props {
  slo: SloDeclarationDto;
  orgId: string;
  productId: string;
}

export function SloCard({ slo, orgId, productId }: Props) {
  const [evals, setEvals] = useState<SloEvaluationDto[] | null>(null);
  const [evalsOpen, setEvalsOpen] = useState(false);
  const [evalsLoading, setEvalsLoading] = useState(false);

  const toggleEvals = async () => {
    if (evalsOpen) {
      setEvalsOpen(false);
      return;
    }
    if (evals == null) {
      setEvalsLoading(true);
      try {
        const data = await fetchSloEvaluations(orgId, productId, slo.id);
        setEvals(data);
      } catch {
        setEvals([]);
      } finally {
        setEvalsLoading(false);
      }
    }
    setEvalsOpen(true);
  };

  const pr7 = slo.pass_rate_7d != null ? Math.round(slo.pass_rate_7d * 100) : null;
  const threshold = `${OP_LABELS[slo.threshold_operator] ?? slo.threshold_operator} ${slo.threshold_value}${slo.threshold_unit ? ` ${slo.threshold_unit}` : ''}`;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[slo.slo_type] ?? TYPE_STYLES.custom}`}>
          {slo.slo_type}
        </span>
        <span className="text-sm font-medium text-slate-800 truncate flex-1">{slo.name}</span>
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${healthDot(slo.pass_rate_7d)}`}
          title={pr7 != null ? `7d pass rate: ${pr7}%` : 'No data'}
          aria-label={pr7 != null ? `7d pass rate: ${pr7}%` : 'No data'}
        />
      </div>

      {/* Metric */}
      <p className="text-xs text-slate-500 mb-3">
        <span className="font-mono text-slate-600">{slo.metric_name}</span>{' '}
        <span className="text-slate-400">{threshold}</span>
      </p>

      {/* 7d pass rate bar */}
      {pr7 != null && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-400 w-20">7d pass rate</span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pr7 >= 95 ? 'bg-emerald-500' : pr7 >= 80 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${pr7}%` }}
              role="progressbar"
              aria-valuenow={pr7}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <span className="text-xs font-medium text-slate-600 w-10 text-right">{pr7}%</span>
        </div>
      )}

      {/* Last evaluated */}
      {slo.last_evaluated_at && (
        <p className="text-xs text-slate-400 mb-3">
          Last evaluated: {formatRelativeTime(slo.last_evaluated_at)}
        </p>
      )}
      {!slo.last_evaluated_at && (
        <p className="text-xs text-slate-400 italic mb-3">Never evaluated</p>
      )}

      {/* Evaluation history toggle */}
      <button
        type="button"
        onClick={() => { void toggleEvals(); }}
        className="text-xs text-brand-600 hover:text-brand-800 font-medium focus:outline-none"
      >
        Evaluation History {evalsOpen ? '▲' : '▼'}
      </button>

      {evalsLoading && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin" aria-hidden />
          Loading...
        </div>
      )}

      {evalsOpen && evals != null && (
        <div className="mt-2">
          {evals.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No evaluations recorded.</p>
          ) : (
            <div className="border border-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-slate-500 font-medium">Time</th>
                    <th className="text-right px-3 py-1.5 text-slate-500 font-medium">Value</th>
                    <th className="text-center px-3 py-1.5 text-slate-500 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {evals.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-600">
                        {new Date(ev.evaluated_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                        {ev.measured_value}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {ev.passed ? (
                          <span className="text-emerald-600" title="Passed">✓</span>
                        ) : (
                          <span className="text-red-600" title="Failed">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
