export type Direction = 'upstream' | 'downstream' | 'both';

interface Props {
  value: Direction;
  onChange: (direction: Direction) => void;
}

const OPTIONS: { value: Direction; label: string }[] = [
  { value: 'upstream',   label: 'Upstream'   },
  { value: 'both',       label: 'Both'       },
  { value: 'downstream', label: 'Downstream' },
];

export function DirectionToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            opt.value === value
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          } ${opt.value !== OPTIONS[0].value ? 'border-l border-slate-300' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
