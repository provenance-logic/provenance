import type { LineageGraphNode } from '@provenance/types';

const NODE_BADGE_COLORS: Record<string, string> = {
  Source:         'bg-indigo-100 text-indigo-800',
  DataProduct:    'bg-sky-100 text-sky-800',
  Port:           'bg-violet-100 text-violet-800',
  Transformation: 'bg-amber-100 text-amber-800',
  Agent:          'bg-emerald-100 text-emerald-800',
  Consumer:       'bg-rose-100 text-rose-800',
  Unknown:        'bg-slate-100 text-slate-800',
};

interface Props {
  node: LineageGraphNode | null;
  onClose: () => void;
}

export function NodeDetailPanel({ node, onClose }: Props) {
  if (!node) return null;

  const badgeColor = NODE_BADGE_COLORS[node.type] ?? NODE_BADGE_COLORS.Unknown;
  const metadata = node.metadata && Object.keys(node.metadata).length > 0
    ? node.metadata
    : null;

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-white border-l border-slate-200 shadow-lg overflow-y-auto z-10">
      <div className="p-4 border-b border-slate-100 flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badgeColor}`}>
            {node.type}
          </span>
          <h3 className="text-sm font-semibold text-slate-900 truncate">{node.label}</h3>
        </div>
        <button
          onClick={onClose}
          className="ml-2 p-1 text-slate-400 hover:text-slate-600 rounded"
          aria-label="Close panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Node ID</dt>
          <dd className="mt-0.5 text-sm text-slate-700 font-mono break-all">{node.id}</dd>
        </div>

        {metadata && (
          <div>
            <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Metadata</dt>
            <dl className="space-y-1">
              {Object.entries(metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-xs text-slate-500 font-mono shrink-0">{key}:</dt>
                  <dd className="text-xs text-slate-700 break-all">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
