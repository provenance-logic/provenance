// ---------------------------------------------------------------------------
// Node and edge type enums
// ---------------------------------------------------------------------------

export type NodeType =
  | 'Source'
  | 'DataProduct'
  | 'Port'
  | 'Transformation'
  | 'Agent'
  | 'Consumer';

export type EdgeType =
  | 'DERIVES_FROM'
  | 'TRANSFORMS'
  | 'CONSUMES'
  | 'DEPENDS_ON'
  | 'SUPERSEDES';

// ---------------------------------------------------------------------------
// Lineage node descriptor
// ---------------------------------------------------------------------------

export interface LineageNode {
  node_type: NodeType;
  node_id: string;
  org_id: string;
  display_name: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lineage event — one directional edge in the lineage graph
// ---------------------------------------------------------------------------

export interface LineageEvent {
  source_node: LineageNode;
  target_node: LineageNode;
  edge_type: EdgeType;
  emitted_at?: string;
  emitted_by?: string;
  transformation_logic?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface LineageClientConfig {
  baseUrl: string;
  orgId: string;
  token: string;
  defaultEmittedBy?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  onError?: (error: EmissionError) => void;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface EmissionError {
  message: string;
  events: LineageEvent[];
  statusCode?: number;
  attempt: number;
}
