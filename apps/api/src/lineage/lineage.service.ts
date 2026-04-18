import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { EmissionLogEntity } from './entities/emission-log.entity.js';
import { TrustScoreService } from '../trust-score/trust-score.service.js';
import type {
  EmitLineageEventRequest,
  LineageGraphDto,
  LineageGraphNode,
  LineageGraphEdge,
} from '@provenance/types';

const VALID_NODE_LABELS = new Set([
  'Source', 'DataProduct', 'Port', 'Transformation', 'Agent', 'Consumer',
]);
const MAX_BATCH_SIZE = 500;

@Injectable()
export class LineageService {
  private readonly logger = new Logger(LineageService.name);
  private driver: Driver | null = null;

  constructor(
    @InjectRepository(EmissionLogEntity)
    private readonly emissionLogRepo: Repository<EmissionLogEntity>,
    @Inject(forwardRef(() => TrustScoreService))
    private readonly trustScoreService: TrustScoreService,
  ) {
    this.initNeo4j();
  }

  private initNeo4j(): void {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;
    if (!uri || !user || !password) {
      this.logger.warn('Neo4j connection not configured — graph sync disabled');
      return;
    }
    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      this.logger.log(`Neo4j driver initialized: ${uri}`);
      this.ensureConstraints().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Neo4j constraint setup failed: ${msg}`);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Neo4j driver init failed — graph sync disabled: ${msg}`);
    }
  }

  private async ensureConstraints(): Promise<void> {
    if (!this.driver) return;
    const session: Session = this.driver.session();
    try {
      for (const label of ['Source', 'DataProduct', 'Consumer']) {
        await session.run(
          `CREATE CONSTRAINT ${label.toLowerCase()}_unique IF NOT EXISTS FOR (n:${label}) REQUIRE (n.node_id, n.org_id) IS UNIQUE`,
        );
      }
      this.logger.log('Neo4j unique constraints ensured');
    } finally {
      await session.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Emit a lineage event
  // ---------------------------------------------------------------------------

  async emitEvent(orgId: string, request: EmitLineageEventRequest): Promise<EmissionLogEntity> {
    // Build target_node — if not provided, create a minimal self-referencing node
    const targetNode = request.target_node ?? {
      node_type: 'DataProduct',
      node_id: `auto-target-${Date.now()}`,
      org_id: orgId,
      display_name: 'Auto-generated target',
      metadata: {},
    };

    const entity = this.emissionLogRepo.create({
      orgId,
      sourceNode: request.source_node as unknown as Record<string, unknown>,
      targetNode: targetNode as unknown as Record<string, unknown>,
      edgeType: request.edge_type,
      confidence: request.confidence ?? 1.0,
      emittedBy: request.emitted_by ?? null,
      emittedAt: new Date(request.emitted_at ?? new Date().toISOString()),
    });

    const saved = await this.emissionLogRepo.save(entity);
    this.logger.log(`Emission logged: ${saved.id} (${request.source_node.node_id} → ${targetNode.node_id})`);

    // Fire-and-forget Neo4j sync
    this.syncToNeo4j(saved).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Neo4j sync failed for ${saved.id}: ${msg}`);
    });

    // Fire-and-forget trust score recompute for the target product
    if (targetNode.node_id) {
      this.trustScoreService.recompute(orgId, targetNode.node_id).catch(() => {});
    }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Batch emit lineage events
  // ---------------------------------------------------------------------------

  async emitBatch(orgId: string, events: EmitLineageEventRequest[]): Promise<EmissionLogEntity[]> {
    if (events.length === 0) return [];
    if (events.length > MAX_BATCH_SIZE) {
      throw new BadRequestException(`Batch size ${events.length} exceeds max ${MAX_BATCH_SIZE}`);
    }

    const results: EmissionLogEntity[] = [];
    for (const request of events) {
      const targetNode = request.target_node ?? {
        node_type: 'DataProduct' as const,
        node_id: `auto-target-${Date.now()}`,
        org_id: orgId,
        display_name: 'Auto-generated target',
        metadata: {},
      };

      const entity = this.emissionLogRepo.create({
        orgId,
        sourceNode: request.source_node as unknown as Record<string, unknown>,
        targetNode: targetNode as unknown as Record<string, unknown>,
        edgeType: request.edge_type,
        confidence: request.confidence ?? 1.0,
        emittedBy: request.emitted_by ?? null,
        emittedAt: new Date(request.emitted_at ?? new Date().toISOString()),
      });
      results.push(entity);
    }

    const saved = await this.emissionLogRepo.save(results);
    this.logger.log(`Batch emission logged: ${saved.length} events`);

    // Fire-and-forget Neo4j sync for each
    for (const entry of saved) {
      this.syncToNeo4j(entry).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Neo4j sync failed for ${entry.id}: ${msg}`);
      });
    }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Neo4j sync — write nodes and edge
  // ---------------------------------------------------------------------------

  private sanitizeLabel(nodeType: string): string {
    // Only allow known labels to prevent Cypher injection
    if (VALID_NODE_LABELS.has(nodeType)) return nodeType;
    return 'LineageNode';
  }

  private async syncToNeo4j(entry: EmissionLogEntity): Promise<void> {
    if (!this.driver) {
      this.logger.warn(`Neo4j sync skipped (no driver) for ${entry.id}`);
      return;
    }

    const session: Session = this.driver.session();
    try {
      const src = entry.sourceNode;
      const tgt = entry.targetNode;
      const srcLabel = this.sanitizeLabel(src.node_type as string);
      const tgtLabel = this.sanitizeLabel(tgt.node_type as string);

      // Labels cannot be parameterized in Cypher, so we interpolate
      // validated label names directly. sanitizeLabel() ensures only
      // allow-listed values are used, preventing injection.
      await session.run(
        `
        MERGE (s:${srcLabel} {node_id: $srcNodeId, org_id: $orgId})
        SET s.node_type = $srcType, s.display_name = $srcName, s.metadata = $srcMeta
        MERGE (t:${tgtLabel} {node_id: $tgtNodeId, org_id: $orgId})
        SET t.node_type = $tgtType, t.display_name = $tgtName, t.metadata = $tgtMeta
        MERGE (s)-[r:LINEAGE_EDGE {emission_id: $emissionId}]->(t)
        SET r.edge_type = $edgeType, r.confidence = $confidence, r.emitted_at = $emittedAt
        `,
        {
          orgId: entry.orgId,
          srcNodeId: src.node_id as string,
          srcType: src.node_type as string,
          srcName: src.display_name as string,
          srcMeta: JSON.stringify(src.metadata ?? {}),
          tgtNodeId: tgt.node_id as string,
          tgtType: tgt.node_type as string,
          tgtName: tgt.display_name as string,
          tgtMeta: JSON.stringify(tgt.metadata ?? {}),
          emissionId: entry.id,
          edgeType: entry.edgeType,
          confidence: entry.confidence,
          emittedAt: entry.emittedAt.toISOString(),
        },
      );

      // Mark as synced in Postgres
      await this.emissionLogRepo.update(entry.id, {
        neo4jWritten: true,
        neo4jWrittenAt: new Date(),
      });

      this.logger.log(`Neo4j sync complete for ${entry.id}`);
    } finally {
      await session.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Query upstream lineage from Neo4j
  // ---------------------------------------------------------------------------

  async getUpstreamLineage(
    orgId: string,
    productNodeId: string,
    depth: number,
  ): Promise<LineageGraphDto> {
    if (!this.driver) {
      return { productId: productNodeId, depth, nodes: [], edges: [] };
    }

    const session: Session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (start {node_id: $nodeId, org_id: $orgId})
        CALL apoc.path.subgraphAll(start, {
          relationshipFilter: '<LINEAGE_EDGE',
          maxLevel: $depth
        })
        YIELD nodes, relationships
        RETURN nodes, relationships
        `,
        { nodeId: productNodeId, orgId, depth: neo4j.int(depth) },
      );

      const nodes: LineageGraphNode[] = [];
      const edges: LineageGraphEdge[] = [];
      const seenNodes = new Set<string>();
      const seenEdges = new Set<string>();

      for (const record of result.records) {
        const rawNodes = record.get('nodes') as Array<{ properties: Record<string, unknown>; elementId: string }>;
        const rawRels = record.get('relationships') as Array<{
          properties: Record<string, unknown>;
          elementId: string;
          startNodeElementId: string;
          endNodeElementId: string;
        }>;

        const elementIdToNodeId = new Map<string, string>();

        for (const n of rawNodes) {
          const nodeId = n.properties.node_id as string;
          elementIdToNodeId.set(n.elementId, nodeId);
          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              type: (n.properties.node_type as string) ?? 'Unknown',
              label: (n.properties.display_name as string) ?? nodeId,
              metadata: n.properties.metadata
                ? (JSON.parse(n.properties.metadata as string) as Record<string, unknown>)
                : {},
            });
          }
        }

        for (const r of rawRels) {
          const edgeId = r.properties.emission_id as string ?? r.elementId;
          if (!seenEdges.has(edgeId)) {
            seenEdges.add(edgeId);
            edges.push({
              id: edgeId,
              source: elementIdToNodeId.get(r.startNodeElementId) ?? 'unknown',
              target: elementIdToNodeId.get(r.endNodeElementId) ?? 'unknown',
              edgeType: (r.properties.edge_type as string) ?? 'DERIVES_FROM',
              confidence: (r.properties.confidence as number) ?? 1.0,
            });
          }
        }
      }

      return { productId: productNodeId, depth, nodes, edges };
    } catch (err: unknown) {
      // If APOC is not available, fall back to a simple traversal
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`APOC query failed, trying simple traversal: ${msg}`);
      return this.getUpstreamLineageSimple(session, orgId, productNodeId, depth);
    } finally {
      await session.close();
    }
  }

  private async getUpstreamLineageSimple(
    session: Session,
    orgId: string,
    productNodeId: string,
    depth: number,
  ): Promise<LineageGraphDto> {
    const result = await session.run(
      `
      MATCH path = (start {node_id: $nodeId, org_id: $orgId})<-[r:LINEAGE_EDGE*1..${depth}]-(upstream)
      WHERE upstream.org_id = $orgId
      UNWIND nodes(path) AS n
      UNWIND relationships(path) AS rel
      RETURN DISTINCT
        n.node_id AS nodeId, n.node_type AS nodeType, n.display_name AS displayName, n.metadata AS metadata,
        startNode(rel).node_id AS srcId, endNode(rel).node_id AS tgtId,
        rel.emission_id AS emissionId, rel.edge_type AS edgeType, rel.confidence AS confidence
      `,
      { nodeId: productNodeId, orgId },
    );

    const nodes: LineageGraphNode[] = [];
    const edges: LineageGraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const record of result.records) {
      const nodeId = record.get('nodeId') as string;
      if (!seenNodes.has(nodeId)) {
        seenNodes.add(nodeId);
        nodes.push({
          id: nodeId,
          type: (record.get('nodeType') as string) ?? 'Unknown',
          label: (record.get('displayName') as string) ?? nodeId,
          metadata: record.get('metadata')
            ? (JSON.parse(record.get('metadata') as string) as Record<string, unknown>)
            : {},
        });
      }

      const emissionId = record.get('emissionId') as string;
      if (emissionId && !seenEdges.has(emissionId)) {
        seenEdges.add(emissionId);
        edges.push({
          id: emissionId,
          source: record.get('srcId') as string,
          target: record.get('tgtId') as string,
          edgeType: (record.get('edgeType') as string) ?? 'DERIVES_FROM',
          confidence: (record.get('confidence') as number) ?? 1.0,
        });
      }
    }

    return { productId: productNodeId, depth, nodes, edges };
  }

  // ---------------------------------------------------------------------------
  // Query downstream lineage from Neo4j
  // ---------------------------------------------------------------------------

  async getDownstreamLineage(
    orgId: string,
    productNodeId: string,
    depth: number,
  ): Promise<LineageGraphDto> {
    if (!this.driver) {
      return { productId: productNodeId, depth, nodes: [], edges: [] };
    }

    const session: Session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (start {node_id: $nodeId, org_id: $orgId})
        CALL apoc.path.subgraphAll(start, {
          relationshipFilter: 'LINEAGE_EDGE>',
          maxLevel: $depth
        })
        YIELD nodes, relationships
        RETURN nodes, relationships
        `,
        { nodeId: productNodeId, orgId, depth: neo4j.int(depth) },
      );

      return this.parseGraphResult(result, productNodeId, depth);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`APOC downstream query failed, trying simple traversal: ${msg}`);
      return this.getDownstreamLineageSimple(session, orgId, productNodeId, depth);
    } finally {
      await session.close();
    }
  }

  private async getDownstreamLineageSimple(
    session: Session,
    orgId: string,
    productNodeId: string,
    depth: number,
  ): Promise<LineageGraphDto> {
    const result = await session.run(
      `
      MATCH path = (start {node_id: $nodeId, org_id: $orgId})-[r:LINEAGE_EDGE*1..${depth}]->(downstream)
      WHERE downstream.org_id = $orgId
      UNWIND nodes(path) AS n
      UNWIND relationships(path) AS rel
      RETURN DISTINCT
        n.node_id AS nodeId, n.node_type AS nodeType, n.display_name AS displayName, n.metadata AS metadata,
        startNode(rel).node_id AS srcId, endNode(rel).node_id AS tgtId,
        rel.emission_id AS emissionId, rel.edge_type AS edgeType, rel.confidence AS confidence
      `,
      { nodeId: productNodeId, orgId },
    );

    return this.parseSimpleResult(result, productNodeId, depth);
  }

  // ---------------------------------------------------------------------------
  // Impact analysis — both directions
  // ---------------------------------------------------------------------------

  async getImpactAnalysis(
    orgId: string,
    productNodeId: string,
    depth: number = 3,
  ): Promise<LineageGraphDto> {
    if (!this.driver) {
      return { productId: productNodeId, depth, nodes: [], edges: [] };
    }

    const session: Session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (start {node_id: $nodeId, org_id: $orgId})
        CALL apoc.path.subgraphAll(start, {
          relationshipFilter: 'LINEAGE_EDGE',
          maxLevel: $depth
        })
        YIELD nodes, relationships
        RETURN nodes, relationships
        `,
        { nodeId: productNodeId, orgId, depth: neo4j.int(depth) },
      );

      return this.parseGraphResult(result, productNodeId, depth);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`APOC impact query failed, trying simple traversal: ${msg}`);

      // Fetch both directions and merge
      const [up, down] = await Promise.all([
        this.getUpstreamLineageSimple(session, orgId, productNodeId, depth),
        this.getDownstreamLineageSimple(session, orgId, productNodeId, depth),
      ]);

      const seenNodes = new Set<string>();
      const seenEdges = new Set<string>();
      const nodes: LineageGraphNode[] = [];
      const edges: LineageGraphEdge[] = [];

      for (const g of [up, down]) {
        for (const n of g.nodes) {
          if (!seenNodes.has(n.id)) { seenNodes.add(n.id); nodes.push(n); }
        }
        for (const e of g.edges) {
          if (!seenEdges.has(e.id)) { seenEdges.add(e.id); edges.push(e); }
        }
      }

      return { productId: productNodeId, depth, nodes, edges };
    } finally {
      await session.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Shared result parsers
  // ---------------------------------------------------------------------------

  private parseGraphResult(
    result: { records: Array<{ get(key: string): unknown }> },
    productNodeId: string,
    depth: number,
  ): LineageGraphDto {
    const nodes: LineageGraphNode[] = [];
    const edges: LineageGraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const record of result.records) {
      const rawNodes = record.get('nodes') as Array<{ properties: Record<string, unknown>; elementId: string }>;
      const rawRels = record.get('relationships') as Array<{
        properties: Record<string, unknown>;
        elementId: string;
        startNodeElementId: string;
        endNodeElementId: string;
      }>;

      const elementIdToNodeId = new Map<string, string>();

      for (const n of rawNodes) {
        const nodeId = n.properties.node_id as string;
        elementIdToNodeId.set(n.elementId, nodeId);
        if (!seenNodes.has(nodeId)) {
          seenNodes.add(nodeId);
          nodes.push({
            id: nodeId,
            type: (n.properties.node_type as string) ?? 'Unknown',
            label: (n.properties.display_name as string) ?? nodeId,
            metadata: n.properties.metadata
              ? (JSON.parse(n.properties.metadata as string) as Record<string, unknown>)
              : {},
          });
        }
      }

      for (const r of rawRels) {
        const edgeId = r.properties.emission_id as string ?? r.elementId;
        if (!seenEdges.has(edgeId)) {
          seenEdges.add(edgeId);
          edges.push({
            id: edgeId,
            source: elementIdToNodeId.get(r.startNodeElementId) ?? 'unknown',
            target: elementIdToNodeId.get(r.endNodeElementId) ?? 'unknown',
            edgeType: (r.properties.edge_type as string) ?? 'DERIVES_FROM',
            confidence: (r.properties.confidence as number) ?? 1.0,
          });
        }
      }
    }

    return { productId: productNodeId, depth, nodes, edges };
  }

  private parseSimpleResult(
    result: { records: Array<{ get(key: string): unknown }> },
    productNodeId: string,
    depth: number,
  ): LineageGraphDto {
    const nodes: LineageGraphNode[] = [];
    const edges: LineageGraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const record of result.records) {
      const nodeId = record.get('nodeId') as string;
      if (!seenNodes.has(nodeId)) {
        seenNodes.add(nodeId);
        nodes.push({
          id: nodeId,
          type: (record.get('nodeType') as string) ?? 'Unknown',
          label: (record.get('displayName') as string) ?? nodeId,
          metadata: record.get('metadata')
            ? (JSON.parse(record.get('metadata') as string) as Record<string, unknown>)
            : {},
        });
      }

      const emissionId = record.get('emissionId') as string;
      if (emissionId && !seenEdges.has(emissionId)) {
        seenEdges.add(emissionId);
        edges.push({
          id: emissionId,
          source: record.get('srcId') as string,
          target: record.get('tgtId') as string,
          edgeType: (record.get('edgeType') as string) ?? 'DERIVES_FROM',
          confidence: (record.get('confidence') as number) ?? 1.0,
        });
      }
    }

    return { productId: productNodeId, depth, nodes, edges };
  }
}
