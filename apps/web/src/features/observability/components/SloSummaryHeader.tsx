import type { SloSummaryDto } from '@provenance/types';
import { formatRelativeTime } from '../../../shared/utils/format-time.js';

const HEALTH_DOT: Record<string, string> = {
  green:  'bg-emerald-500',
  yellow: 'bg-amber-500',
  red:    'bg-red-500',
};

const HEALTH_LABEL: Record<string, string> = {
  green:  'Healthy',
  yellow: 'Degraded',
  red:    'Failing',
};

interface Props {
  summary: SloSummaryDto;
}

export function SloSummaryHeader({ summary }: Props) {
  const pr7 = summary.pass_rate_7d != null ? `${(summary.pass_rate_7d * 100).toFixed(1)}%` : '—';
  const pr30 = summary.pass_rate_30d != null ? `${(summary.pass_rate_30d * 100).toFixed(1)}%` : '—';

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      {/* Health */}
      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
        <span className={`w-2.5 h-2.5 rounded-full ${HEALTH_DOT[summary.slo_health] ?? 'bg-slate-400'}`} aria-hidden />
        {HEALTH_LABEL[summary.slo_health] ?? summary.slo_health}
      </span>

      <Stat label="Total" value={summary.total_slos} />
      <Stat label="Active" value={summary.active_slos} />
      <Stat label="7d Pass" value={pr7} />
      <Stat label="30d Pass" value={pr30} />
      <Stat label="No Data" value={summary.slos_with_no_data} />

      {summary.last_evaluated_at && (
        <span className="text-slate-400">
          Last eval: {formatRelativeTime(summary.last_evaluated_at)}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-full text-slate-500">
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium text-slate-700">{value}</span>
    </span>
  );
}
