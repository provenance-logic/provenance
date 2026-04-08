import {
  sourceNode,
  dataProductNode,
  portNode,
  transformationNode,
  agentNode,
  consumerNode,
  derivesFrom,
  transforms,
  consumes,
  dependsOn,
  supersedes,
} from '../builders';

const ORG = 'test-org';

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

describe('node builders', () => {
  test('sourceNode returns correct node_type', () => {
    const node = sourceNode('pg-orders', ORG, 'Orders DB');
    expect(node.node_type).toBe('Source');
    expect(node.node_id).toBe('pg-orders');
    expect(node.org_id).toBe(ORG);
    expect(node.display_name).toBe('Orders DB');
  });

  test('dataProductNode returns correct node_type', () => {
    const node = dataProductNode('uuid-1', ORG, 'Analytics');
    expect(node.node_type).toBe('DataProduct');
  });

  test('portNode returns correct node_type', () => {
    const node = portNode('port-1', ORG, 'Output Port');
    expect(node.node_type).toBe('Port');
  });

  test('transformationNode returns correct node_type', () => {
    const node = transformationNode('tx-1', ORG, 'ETL Step');
    expect(node.node_type).toBe('Transformation');
  });

  test('transformationNode with logic sets metadata.logic', () => {
    const node = transformationNode('tx-1', ORG, 'ETL', 'SELECT * FROM orders');
    expect(node.metadata).toEqual({ logic: 'SELECT * FROM orders' });
  });

  test('transformationNode with logic merges with existing metadata', () => {
    const node = transformationNode('tx-1', ORG, 'ETL', 'SELECT 1', { env: 'prod' });
    expect(node.metadata).toEqual({ env: 'prod', logic: 'SELECT 1' });
  });

  test('agentNode returns correct node_type', () => {
    const node = agentNode('agent-1', ORG, 'Summarizer');
    expect(node.node_type).toBe('Agent');
  });

  test('consumerNode returns correct node_type', () => {
    const node = consumerNode('consumer-1', ORG, 'Dashboard');
    expect(node.node_type).toBe('Consumer');
  });

  test('metadata is optional and passed through', () => {
    const node = sourceNode('s', ORG, 'S', { region: 'us-east-1' });
    expect(node.metadata).toEqual({ region: 'us-east-1' });
  });
});

// ---------------------------------------------------------------------------
// Edge builders
// ---------------------------------------------------------------------------

describe('edge builders', () => {
  const src = sourceNode('s', ORG, 'Source');
  const prod = dataProductNode('p', ORG, 'Product');

  test('derivesFrom returns correct edge_type', () => {
    const event = derivesFrom(src, prod);
    expect(event.edge_type).toBe('DERIVES_FROM');
    expect(event.source_node).toBe(src);
    expect(event.target_node).toBe(prod);
  });

  test('transforms returns correct edge_type and sets transformation_logic', () => {
    const event = transforms(src, prod, 'SELECT * FROM t');
    expect(event.edge_type).toBe('TRANSFORMS');
    expect(event.transformation_logic).toBe('SELECT * FROM t');
  });

  test('consumes returns correct edge_type', () => {
    const event = consumes(src, prod);
    expect(event.edge_type).toBe('CONSUMES');
  });

  test('dependsOn returns correct edge_type', () => {
    const event = dependsOn(prod, src);
    expect(event.edge_type).toBe('DEPENDS_ON');
  });

  test('supersedes returns correct edge_type', () => {
    const newP = dataProductNode('new', ORG, 'New');
    const oldP = dataProductNode('old', ORG, 'Old');
    const event = supersedes(newP, oldP);
    expect(event.edge_type).toBe('SUPERSEDES');
  });

  test('opts override merges correctly', () => {
    const event = derivesFrom(src, prod, { confidence: 0.8, emitted_by: 'test' });
    expect(event.confidence).toBe(0.8);
    expect(event.emitted_by).toBe('test');
    expect(event.edge_type).toBe('DERIVES_FROM');
  });
});
