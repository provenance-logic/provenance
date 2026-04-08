import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { LineageGraphDto, LineageGraphNode } from '@provenance/types';

cytoscape.use(dagre);

const NODE_COLORS: Record<string, string> = {
  Source:         '#6366f1',
  DataProduct:    '#0ea5e9',
  Port:           '#8b5cf6',
  Transformation: '#f59e0b',
  Agent:          '#10b981',
  Consumer:       '#f43f5e',
  Unknown:        '#94a3b8',
};

interface Props {
  graph: LineageGraphDto;
  centralProductId: string;
  onNodeClick?: (node: LineageGraphNode) => void;
  isLoading?: boolean;
}

export function LineageGraph({ graph, centralProductId, onNodeClick, isLoading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Keep a lookup so we can return proper LineageGraphNode on click
  const nodeMapRef = useRef<Map<string, LineageGraphNode>>(new Map());

  useEffect(() => {
    if (!containerRef.current || isLoading) return;
    if (graph.nodes.length === 0) return;

    // Build node lookup for click handler
    const nodeMap = new Map<string, LineageGraphNode>();
    const elements: cytoscape.ElementDefinition[] = [];

    for (const node of graph.nodes) {
      nodeMap.set(node.id, node);
      const isCentral = node.id === centralProductId;
      elements.push({
        data: {
          id: node.id,
          label: node.label,
          nodeType: node.type,
          isCentral,
        },
      });
    }
    nodeMapRef.current = nodeMap;

    for (const edge of graph.edges) {
      elements.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.edgeType,
          confidence: edge.confidence,
        },
      });
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'font-size': '11px',
            'text-margin-y': 8,
            'width': 45,
            'height': 45,
            'background-color': (ele: cytoscape.NodeSingular) =>
              NODE_COLORS[ele.data('nodeType') as string] ?? NODE_COLORS.Unknown,
            'border-width': 1,
            'border-color': '#cbd5e1',
            'color': '#334155',
            'text-wrap': 'ellipsis',
            'text-max-width': '100px',
          } as cytoscape.Css.Node,
        },
        {
          selector: 'node[?isCentral]',
          style: {
            'width': 60,
            'height': 60,
            'border-width': 4,
            'border-color': '#1e40af',
            'font-size': '12px',
            'font-weight': 'bold',
          } as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#94a3b8',
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            'width': 2,
            'line-color': '#cbd5e1',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
          } as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[confidence < 1]',
          style: {
            'line-style': 'dashed',
          } as cytoscape.Css.Edge,
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 80,
        rankSep: 120,
        padding: 40,
      } as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (evt) => {
      const id = evt.target.id() as string;
      const node = nodeMapRef.current.get(id);
      if (node) onNodeClick?.(node);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, centralProductId, onNodeClick, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 bg-slate-50 rounded-xl border border-slate-200">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500">Loading lineage graph...</span>
        </div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-slate-50 rounded-xl border border-slate-200">
        <div className="text-center px-6">
          <p className="text-sm font-medium text-slate-600">No lineage data yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Emit lineage events using the SDK to populate this graph.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-96 bg-white rounded-xl border border-slate-200"
    />
  );
}
