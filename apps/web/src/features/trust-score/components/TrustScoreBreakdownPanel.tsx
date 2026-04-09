import type { TrustScoreComponentsDto } from '@provenance/types';

const COMPONENT_LABELS: Record<keyof TrustScoreComponentsDto, string> = {
  governance_compliance: 'Governance Compliance',
  slo_pass_rate:         'SLO Pass Rate',
  lineage_completeness:  'Lineage Completeness',
  usage_activity:        'Usage Activity',
  exception_history:     'Exception History',
};

const COMPONENT_ORDER: (keyof TrustScoreComponentsDto)[] = [
  'governance_compliance',
  'slo_pass_rate',
  'lineage_completeness',
  'usage_activity',
  'exception_history',
];

function barColor(score: number): string {
  if (score >= 0.8) return 'bg-emerald-500';
  if (score >= 0.6) return 'bg-amber-500';
  return 'bg-red-500';
}

interface TrustScoreBreakdownPanelProps {
  components: TrustScoreComponentsDto;
}

export function TrustScoreBreakdownPanel({ components }: TrustScoreBreakdownPanelProps) {
  return (
    <div className="space-y-2">
      {COMPONENT_ORDER.map((key) => {
        const comp = components[key];
        const pct = Math.round(comp.component_score * 100);
        const weightPct = Math.round(comp.weight * 100);

        return (
          <div key={key} className="flex items-center gap-3">
            <span className="text-xs text-slate-700 w-44 truncate font-medium">
              {COMPONENT_LABELS[key]}
            </span>
            <span className="text-xs text-slate-400 w-8 text-right">{weightPct}%</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(comp.component_score)}`}
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={COMPONENT_LABELS[key]}
              />
            </div>
            <span className="text-xs font-medium text-slate-600 w-10 text-right">
              {comp.weighted_score.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
