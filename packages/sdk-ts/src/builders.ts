import type { LineageNode, LineageEvent } from './types.js';

// ---------------------------------------------------------------------------
// Node factories
// ---------------------------------------------------------------------------

export function sourceNode(
  id: string,
  orgId: string,
  displayName: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  return { node_type: 'Source', node_id: id, org_id: orgId, display_name: displayName, metadata };
}

export function dataProductNode(
  productId: string,
  orgId: string,
  displayName: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  return { node_type: 'DataProduct', node_id: productId, org_id: orgId, display_name: displayName, metadata };
}

export function portNode(
  portId: string,
  orgId: string,
  displayName: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  return { node_type: 'Port', node_id: portId, org_id: orgId, display_name: displayName, metadata };
}

export function transformationNode(
  id: string,
  orgId: string,
  displayName: string,
  logic?: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  const meta = logic ? { ...metadata, logic } : metadata;
  return { node_type: 'Transformation', node_id: id, org_id: orgId, display_name: displayName, metadata: meta };
}

export function agentNode(
  agentId: string,
  orgId: string,
  displayName: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  return { node_type: 'Agent', node_id: agentId, org_id: orgId, display_name: displayName, metadata };
}

export function consumerNode(
  consumerId: string,
  orgId: string,
  displayName: string,
  metadata?: Record<string, unknown>,
): LineageNode {
  return { node_type: 'Consumer', node_id: consumerId, org_id: orgId, display_name: displayName, metadata };
}

// ---------------------------------------------------------------------------
// Edge factories
// ---------------------------------------------------------------------------

export function derivesFrom(
  source: LineageNode,
  target: LineageNode,
  opts?: Partial<LineageEvent>,
): LineageEvent {
  return { source_node: source, target_node: target, edge_type: 'DERIVES_FROM', ...opts };
}

export function transforms(
  source: LineageNode,
  target: LineageNode,
  logic: string,
  opts?: Partial<LineageEvent>,
): LineageEvent {
  return {
    source_node: source,
    target_node: target,
    edge_type: 'TRANSFORMS',
    transformation_logic: logic,
    ...opts,
  };
}

export function consumes(
  consumer: LineageNode,
  product: LineageNode,
  opts?: Partial<LineageEvent>,
): LineageEvent {
  return { source_node: consumer, target_node: product, edge_type: 'CONSUMES', ...opts };
}

export function dependsOn(
  product: LineageNode,
  dependency: LineageNode,
  opts?: Partial<LineageEvent>,
): LineageEvent {
  return { source_node: product, target_node: dependency, edge_type: 'DEPENDS_ON', ...opts };
}

export function supersedes(
  newProduct: LineageNode,
  oldProduct: LineageNode,
  opts?: Partial<LineageEvent>,
): LineageEvent {
  return { source_node: newProduct, target_node: oldProduct, edge_type: 'SUPERSEDES', ...opts };
}
