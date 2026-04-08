import type { Uuid, IsoTimestamp } from './common.js';

// ---------------------------------------------------------------------------
// Lineage node descriptor — embedded in each emission event
// ---------------------------------------------------------------------------

export type LineageNodeType =
  | 'Source'
  | 'DataProduct'
  | 'Port'
  | 'Transformation'
  | 'Agent'
  | 'Consumer';

export interface LineageNodeDescriptor {
  node_type: LineageNodeType;
  node_id: string;
  org_id: Uuid;
  display_name: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Emit lineage event — POST /organizations/:orgId/lineage/events
// ---------------------------------------------------------------------------

export interface EmitLineageEventRequest {
  source_node: LineageNodeDescriptor;
  target_node?: LineageNodeDescriptor;
  edge_type: string;
  emitted_at?: IsoTimestamp;
  emitted_by?: string;
  transformation_logic?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Emission log row — returned by queries
// ---------------------------------------------------------------------------

export interface EmissionLogEntry {
  id: Uuid;
  orgId: Uuid;
  sourceNode: LineageNodeDescriptor;
  targetNode: LineageNodeDescriptor | null;
  edgeType: string;
  confidence: number;
  emittedBy: string | null;
  emittedAt: IsoTimestamp;
  neo4jWritten: boolean;
  neo4jWrittenAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Lineage graph DTO — returned by upstream/downstream traversal
// ---------------------------------------------------------------------------

export interface LineageGraphNode {
  id: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface LineageGraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  confidence: number;
}

export interface LineageGraphDto {
  productId: string;
  depth: number;
  nodes: LineageGraphNode[];
  edges: LineageGraphEdge[];
}
