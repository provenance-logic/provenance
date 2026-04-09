import { useState, useEffect, useCallback, Component } from 'react';
import type { ReactNode } from 'react';
import type { LineageGraphDto, LineageGraphNode } from '@provenance/types';
import { LineageGraph } from './components/LineageGraph.js';
import { NodeDetailPanel } from './components/NodeDetailPanel.js';
import { DepthControl } from './components/DepthControl.js';
import { DirectionToggle } from './components/DirectionToggle.js';
import type { Direction } from './components/DirectionToggle.js';
import {
  fetchUpstreamLineage,
  fetchDownstreamLineage,
} from './api/lineage-api.js';

// ---------------------------------------------------------------------------
// Error boundary for debugging NodeDetailPanel crash
// ---------------------------------------------------------------------------

interface EBProps { fallback: ReactNode; children: ReactNode }
interface EBState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<EBProps, EBState> {
  constructor(props: EBProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute top-0 right-0 w-80 bg-red-50 border-l border-red-200 p-4 z-10">
          <p className="text-sm font-medium text-red-700">Panel render error</p>
          <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap">{this.state.error?.message}</pre>
          <pre className="mt-1 text-xs text-red-400 whitespace-pre-wrap">{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  productId: string;
  orgId: string;
}

function mergeGraphs(a: LineageGraphDto, b: LineageGraphDto): LineageGraphDto {
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const nodes: LineageGraphDto['nodes'] = [];
  const edges: LineageGraphDto['edges'] = [];

  for (const g of [a, b]) {
    for (const n of g.nodes) {
      if (!seenNodes.has(n.id)) { seenNodes.add(n.id); nodes.push(n); }
    }
    for (const e of g.edges) {
      if (!seenEdges.has(e.id)) { seenEdges.add(e.id); edges.push(e); }
    }
  }

  return { productId: a.productId, depth: Math.max(a.depth, b.depth), nodes, edges };
}

export function LineageExplorer({ productId, orgId }: Props) {
  const [depth, setDepth] = useState(3);
  const [direction, setDirection] = useState<Direction>('both');
  const [graph, setGraph] = useState<LineageGraphDto | null>(null);
  const [selectedNode, setSelectedNode] = useState<LineageGraphNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchLineage() {
      setIsLoading(true);
      setError(null);
      try {
        let result: LineageGraphDto;

        if (direction === 'upstream') {
          result = await fetchUpstreamLineage(orgId, productId, depth);
        } else if (direction === 'downstream') {
          result = await fetchDownstreamLineage(orgId, productId, depth);
        } else {
          const [up, down] = await Promise.all([
            fetchUpstreamLineage(orgId, productId, depth),
            fetchDownstreamLineage(orgId, productId, depth),
          ]);
          result = mergeGraphs(up, down);
        }

        if (!cancelled) setGraph(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load lineage');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchLineage();
    return () => { cancelled = true; };
  }, [orgId, productId, depth, direction, retryKey]);

  const handleNodeClick = useCallback((node: LineageGraphNode) => {
    console.log('Node clicked, data:', JSON.stringify(node, null, 2));
    setSelectedNode(node);
  }, []);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <DirectionToggle value={direction} onChange={setDirection} />
          <DepthControl value={depth} onChange={setDepth} />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setRetryKey((k) => k + 1)}
            className="mt-2 text-xs text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Graph */}
      {!error && (
        <div className="relative">
          <LineageGraph
            graph={graph ?? { productId, depth, nodes: [], edges: [] }}
            centralProductId={productId}
            onNodeClick={handleNodeClick}
            isLoading={isLoading}
          />
          {selectedNode && (
            <ErrorBoundary fallback={<div className="absolute top-0 right-0 w-80 bg-red-50 p-4 z-10">Panel error - check console</div>}>
              <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* Graph metadata */}
      {graph && !isLoading && graph.nodes.length > 0 && (
        <div className="flex gap-4 text-xs text-slate-400">
          <span>{graph.nodes.length} node{graph.nodes.length !== 1 ? 's' : ''}</span>
          <span>{graph.edges.length} edge{graph.edges.length !== 1 ? 's' : ''}</span>
          <span>Depth: {graph.depth}</span>
        </div>
      )}
    </div>
  );
}
