import { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { LineageGraphDto, LineageGraphNode } from '@provenance/types';

// ---------------------------------------------------------------------------
// React Flow + Dagre lineage visualization (ADR-003).
//
// Replaces the previous Cytoscape implementation with a React-native
// component that produces a deterministic LR DAG layout. Sources sit on
// the left, the focal product sits in the middle, downstream consumers
// land on the right — a contributor reading the graph can rely on spatial
// position to mean "upstream of" and "downstream of," which the previous
// non-deterministic force layout did not guarantee.
// ---------------------------------------------------------------------------

interface Props {
  graph: LineageGraphDto;
  centralProductId: string;
  onNodeClick?: (node: LineageGraphNode) => void;
  isLoading?: boolean;
}

// Layout-driven sizing. Dagre needs to know each node's bounding box to
// compute non-overlapping positions; the actual rendered card matches
// these dimensions so connectors meet edges cleanly.
const NODE_WIDTH = 200;
const NODE_HEIGHT = 76;

// Per-node-type styling. Border color is the primary differentiator;
// background stays neutral so labels remain readable on any monitor.
const NODE_STYLE: Record<string, { border: string; pill: string; pillText: string }> = {
  Source:         { border: 'border-indigo-400',  pill: 'bg-indigo-50',   pillText: 'text-indigo-700' },
  DataProduct:    { border: 'border-sky-400',     pill: 'bg-sky-50',      pillText: 'text-sky-700' },
  Port:           { border: 'border-violet-400',  pill: 'bg-violet-50',   pillText: 'text-violet-700' },
  Transformation: { border: 'border-amber-400',  pill: 'bg-amber-50',    pillText: 'text-amber-700' },
  Agent:          { border: 'border-emerald-400', pill: 'bg-emerald-50',  pillText: 'text-emerald-700' },
  Consumer:       { border: 'border-rose-400',    pill: 'bg-rose-50',     pillText: 'text-rose-700' },
  Unknown:        { border: 'border-slate-300',   pill: 'bg-slate-50',    pillText: 'text-slate-600' },
};

// Edge labels read better as natural language than the database edge_type
// constants (DERIVES_FROM, etc.). Mapping is forgiving — anything we don't
// recognize falls back to the raw string.
const EDGE_TYPE_LABEL: Record<string, string> = {
  DERIVES_FROM: 'derives from',
  derives_from: 'derives from',
  TRANSFORMS:   'transforms',
  transforms:   'transforms',
  CONSUMES:     'consumes',
  consumes:     'consumes',
  DEPENDS_ON:   'depends on',
  depends_on:   'depends on',
  SUPERSEDES:   'supersedes',
  supersedes:   'supersedes',
};

// ---------------------------------------------------------------------------
// Custom node component — one card per lineage node.
// ---------------------------------------------------------------------------

interface LineageNodeData {
  label: string;
  nodeType: string;
  isCentral: boolean;
  trustScore: number | null;
  domain: string | null;
}

function LineageCard({ data }: NodeProps<LineageNodeData>) {
  const style = NODE_STYLE[data.nodeType] ?? NODE_STYLE.Unknown;
  const central = data.isCentral
    ? 'border-2 ring-2 ring-brand-200 shadow-md'
    : 'border';
  return (
    <div
      className={`bg-white rounded-lg ${style.border} ${central} px-3 py-2 w-[200px] flex flex-col gap-1`}
      style={{ height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-300" />
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-block text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${style.pill} ${style.pillText}`}
        >
          {humanizeType(data.nodeType)}
        </span>
        {data.trustScore !== null && (
          <span
            className={`text-[10px] font-semibold ${trustScoreColor(data.trustScore)}`}
            title={`Trust score: ${data.trustScore.toFixed(2)}`}
          >
            {Math.round(data.trustScore * 100)}
          </span>
        )}
      </div>
      <div className="text-sm font-medium text-slate-800 truncate" title={data.label}>
        {data.label}
      </div>
      {data.domain && (
        <div className="text-[11px] text-slate-500 truncate">{data.domain}</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-slate-300" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  lineage: LineageCard,
};

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

interface LayoutInput {
  rfNodes: Node<LineageNodeData>[];
  rfEdges: Edge[];
}

function layoutWithDagre({ rfNodes, rfEdges }: LayoutInput): Node<LineageNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // Left-to-right per ADR-003. nodesep is the gap between rows in the same
  // rank; ranksep is the gap between ranks (i.e. between upstream and
  // downstream layers).
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 110, marginx: 20, marginy: 20 });

  for (const node of rfNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of rfEdges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return rfNodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    // Dagre returns the center of the node; React Flow expects the
    // top-left corner. Translate accordingly.
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      // Lock target/source positions so edge anchors line up with the
      // handles on the LineageCard.
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
    };
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LineageGraph({ graph, centralProductId, onNodeClick, isLoading }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const baseNodes: Node<LineageNodeData>[] = graph.nodes.map((n) => ({
      id: n.id,
      type: 'lineage',
      data: {
        label: n.label,
        nodeType: n.type,
        isCentral: n.id === centralProductId,
        trustScore: extractTrustScore(n),
        domain: extractDomain(n),
      },
      position: { x: 0, y: 0 }, // overwritten by Dagre below
    }));
    const baseEdges: Edge[] = graph.edges.map((e) => {
      const dashed = Number(e.confidence) < 1;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: EDGE_TYPE_LABEL[e.edgeType] ?? e.edgeType,
        labelStyle: { fontSize: 10, fill: '#64748b' },
        labelBgStyle: { fill: '#f8fafc' },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        type: 'smoothstep',
        animated: false,
        style: dashed
          ? { stroke: '#94a3b8', strokeDasharray: '4 4' }
          : { stroke: '#cbd5e1' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      };
    });
    return { rfNodes: layoutWithDagre({ rfNodes: baseNodes, rfEdges: baseEdges }), rfEdges: baseEdges };
  }, [graph, centralProductId]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    // Center the focal product on first paint. fitView's padding leaves
    // room for the node card borders to breathe.
    setTimeout(() => instance.fitView({ padding: 0.2, duration: 200 }), 0);
  }, []);

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node<LineageNodeData>) => {
      if (!onNodeClick) return;
      const original = graph.nodes.find((n) => n.id === node.id);
      if (original) onNodeClick(original);
    },
    [graph.nodes, onNodeClick],
  );

  const hasNodes = graph.nodes.length > 0;

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80 rounded-xl">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-500">Loading lineage graph...</span>
          </div>
        </div>
      )}

      {!isLoading && !hasNodes && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
          <div className="text-center px-6">
            <p className="text-sm font-medium text-slate-600">No lineage data yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Emit lineage events using the SDK to populate this graph.
            </p>
          </div>
        </div>
      )}

      <div
        style={{ width: '100%', height: '420px' }}
        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
      >
        {hasNodes && (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onInit={onInit}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            // Read-only graph — disable user-driven node drag and edge
            // creation. The deterministic Dagre layout is the source of
            // truth; a user dragging a node would silently desync the
            // layout from the data.
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} color="#e2e8f0" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(248,250,252,0.7)"
              nodeColor={(n) => {
                const t = (n.data as LineageNodeData | undefined)?.nodeType ?? 'Unknown';
                return MINIMAP_COLOR[t] ?? MINIMAP_COLOR.Unknown;
              }}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeType(t: string): string {
  if (t === 'DataProduct') return 'Data Product';
  return t;
}

function extractTrustScore(node: LineageGraphNode): number | null {
  const meta = node.metadata ?? {};
  const candidates = [meta['trustScore'], meta['trust_score']];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 0 && c <= 1) return c;
  }
  return null;
}

function extractDomain(node: LineageGraphNode): string | null {
  const meta = node.metadata ?? {};
  const value = meta['domain'] ?? meta['domainName'] ?? meta['domain_name'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function trustScoreColor(score: number): string {
  if (score >= 0.9) return 'text-emerald-600';
  if (score >= 0.75) return 'text-sky-600';
  if (score >= 0.6) return 'text-amber-600';
  if (score >= 0.4) return 'text-orange-600';
  return 'text-rose-600';
}

const MINIMAP_COLOR: Record<string, string> = {
  Source:         '#818cf8',
  DataProduct:    '#38bdf8',
  Port:           '#a78bfa',
  Transformation: '#fbbf24',
  Agent:          '#34d399',
  Consumer:       '#fb7185',
  Unknown:        '#cbd5e1',
};
