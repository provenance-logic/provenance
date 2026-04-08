export { LineageClient } from './client.js';
export type {
  NodeType,
  EdgeType,
  LineageNode,
  LineageEvent,
  LineageClientConfig,
  EmissionError,
} from './types.js';
export {
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
} from './builders.js';
