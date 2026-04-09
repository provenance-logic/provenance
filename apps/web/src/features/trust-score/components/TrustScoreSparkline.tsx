import type { TrustScoreHistoryDto } from '@provenance/types';

const BAND_COLORS: Record<string, string> = {
  excellent: '#10b981',
  good:      '#0ea5e9',
  fair:      '#f59e0b',
  poor:      '#f97316',
  critical:  '#ef4444',
};

interface TrustScoreSparklineProps {
  history: TrustScoreHistoryDto[];
}

export function TrustScoreSparkline({ history }: TrustScoreSparklineProps) {
  const height = 48;
  const padding = 4;
  const dotRadius = 3;

  // Sort by computed_at ascending
  const sorted = [...history].sort(
    (a, b) => new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime(),
  );

  const latest = sorted[sorted.length - 1];
  const color = latest ? (BAND_COLORS[latest.band] ?? '#94a3b8') : '#94a3b8';

  if (sorted.length === 0) {
    return (
      <svg width="100%" height={height} className="block" aria-label="No trust score history">
        <line
          x1={padding}
          y1={height / 2}
          x2="100%"
          y2={height / 2}
          stroke="#e2e8f0"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  if (sorted.length === 1) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block" aria-label="Trust score history">
        <line
          x1={padding}
          y1={height / 2}
          x2={100 - padding}
          y2={height / 2}
          stroke={color}
          strokeWidth={1.5}
          opacity={0.4}
        />
        <circle cx={50} cy={height / 2} r={dotRadius} fill={color} />
      </svg>
    );
  }

  // Build path
  const usableHeight = height - padding * 2;
  const minScore = Math.min(...sorted.map((s) => s.score));
  const maxScore = Math.max(...sorted.map((s) => s.score));
  const scoreRange = maxScore - minScore || 0.1; // avoid division by zero

  const viewWidth = 200;
  const usableWidth = viewWidth - padding * 2;

  const points = sorted.map((entry, i) => {
    const x = padding + (i / (sorted.length - 1)) * usableWidth;
    const y = padding + (1 - (entry.score - minScore) / scoreRange) * usableHeight;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const lastPoint = points[points.length - 1];

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${viewWidth} ${height}`}
      preserveAspectRatio="none"
      className="block"
      aria-label="Trust score history sparkline"
    >
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastPoint.x} cy={lastPoint.y} r={dotRadius} fill={color} />
    </svg>
  );
}
