import { type CSSProperties } from 'react';

type Band = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
type Size = 'sm' | 'md' | 'lg';

const BAND_COLORS: Record<Band, string> = {
  excellent: '#10b981',
  good:      '#0ea5e9',
  fair:      '#f59e0b',
  poor:      '#f97316',
  critical:  '#ef4444',
};

const BAND_LABELS: Record<Band, string> = {
  excellent: 'Excellent',
  good:      'Good',
  fair:      'Fair',
  poor:      'Poor',
  critical:  'Critical',
};

const SIZE_CONFIG: Record<Size, { ring: string; score: string; label: string; container: string }> = {
  sm: {
    container: 'w-12 h-12',
    ring: 'ring-2',
    score: 'text-sm font-bold',
    label: 'text-[9px]',
  },
  md: {
    container: 'w-20 h-20',
    ring: 'ring-4',
    score: 'text-2xl font-bold',
    label: 'text-[10px]',
  },
  lg: {
    container: 'w-28 h-28',
    ring: 'ring-4',
    score: 'text-4xl font-bold',
    label: 'text-xs',
  },
};

interface TrustScoreBadgeProps {
  score: number;
  band: Band;
  size?: Size;
}

export function TrustScoreBadge({ score, band, size = 'md' }: TrustScoreBadgeProps) {
  const color = BAND_COLORS[band];
  const cfg = SIZE_CONFIG[size];
  const pct = Math.round(score * 100);

  const style: CSSProperties = {
    '--tw-ring-color': color,
    color,
  } as CSSProperties;

  return (
    <div
      className={`${cfg.container} ${cfg.ring} ring-current rounded-full flex flex-col items-center justify-center`}
      style={style}
      aria-label={`Trust score ${pct} out of 100, rated ${BAND_LABELS[band]}`}
    >
      <span className={cfg.score} style={{ color }}>{pct}</span>
      <span className={`${cfg.label} font-medium uppercase tracking-wide`} style={{ color }}>
        {BAND_LABELS[band]}
      </span>
    </div>
  );
}
