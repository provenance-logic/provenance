interface Props {
  value: number;
  onChange: (depth: number) => void;
}

export function DepthControl({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium text-slate-500 mr-1">Depth</span>
      {[1, 2, 3, 4, 5].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
            d === value
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
          }`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
