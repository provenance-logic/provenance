import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { PRODUCT_INDEX } from './product-index.service.js';
import { TrustScoreService } from './trust-score.service.js';
import { ProductEnrichmentService } from '../products/product-enrichment.service.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { ProductVersionEntity } from '../products/entities/product-version.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import type {
  MarketplaceProduct,
  MarketplaceProductList,
  MarketplaceProductDetail,
  MarketplaceSortOption,
  TrustScoreBreakdown,
  TrustScoreDimension,
  ProductSchema,
  SchemaField,
  LineageGraph,
  SloSummary,
  MarketplaceFilters,
  OutputPortInterfaceType,
  ComplianceStateValue,
  Port,
  AccessRequestList,
  RequestContext,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Existing text-search types (kept for backward compat)
// ---------------------------------------------------------------------------

export interface ProductSearchResult {
  id: string;
  orgId: string;
  domainId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  version: string;
  classification: string;
  ownerPrincipalId: string;
  tags: string[];
  trustScore: number;
}

export interface ProductSearchResponse {
  total: number;
  page: number;
  limit: number;
  results: ProductSearchResult[];
}

// ---------------------------------------------------------------------------
// Trust score algorithm constants (Phase 2)
// ---------------------------------------------------------------------------
//
// Dimension weights must sum to 1.0.
// In Phase 2 only governanceCompliance has real data; the rest are
// placeholders locked at 1.0. The composite collapses to
// governanceCompliance * 0.30 + (1.0 * 0.70) in practice, which keeps
// scores readable while the algorithm is transparent.
//
// Phase 3 will wire lineageCompleteness, sloCompliance,
// schemaConformance, and freshness with real data.
const TRUST_WEIGHTS = {
  governanceCompliance: 0.30,
  lineageCompleteness:  0.25,
  sloCompliance:        0.20,
  schemaConformance:    0.15,
  freshness:            0.10,
} as const;

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly opensearchClient: Client,
    private readonly trustScoreService: TrustScoreService,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(ProductVersionEntity)
    private readonly versionRepo: Repository<ProductVersionEntity>,
    @InjectRepository(ComplianceStateEntity)
    private readonly complianceRepo: Repository<ComplianceStateEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    @InjectRepository(AccessRequestEntity)
    private readonly requestRepo: Repository<AccessRequestEntity>,
    private readonly enrichmentService: ProductEnrichmentService,
  ) {}

  // ---------------------------------------------------------------------------
  // Marketplace listing (PostgreSQL-first)
  // ---------------------------------------------------------------------------

  async listAllProducts(
    filters: MarketplaceFilters = {},
    page = 1,
    limit = 20,
  ): Promise<MarketplaceProductList> {
    return this.queryProducts(undefined, filters, page, limit);
  }

  async listProducts(
    orgId: string,
    filters: MarketplaceFilters = {},
    page = 1,
    limit = 20,
  ): Promise<MarketplaceProductList> {
    return this.queryProducts(orgId, filters, page, limit);
  }

  private async queryProducts(
    orgId: string | undefined,
    filters: MarketplaceFilters = {},
    page = 1,
    limit = 20,
  ): Promise<MarketplaceProductList> {
    page  = Math.max(1, page);
    limit = Math.min(100, Math.max(1, limit));
    const offset = (page - 1) * limit;

    // Build base query — only published (+ optionally deprecated) products.
    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.ports', 'port')
      .where(
        filters.includeDeprecated
          ? "p.status IN ('published', 'deprecated')"
          : "p.status = 'published'",
      );

    if (orgId) {
      qb.andWhere('p.orgId = :orgId', { orgId });
    }

    // Domain filter
    if (filters.domain?.length) {
      qb.andWhere('p.domainId IN (:...domains)', { domains: filters.domain });
    }

    // Output port interface type filter — product must have ≥1 matching output port.
    if (filters.outputPortType?.length) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM products.port_declarations px
          WHERE px.product_id = p.id
            AND px.port_type = 'output'
            AND px.interface_type IN (:...portTypes)
        )`,
        { portTypes: filters.outputPortType },
      );
    }

    // Tags filter — product must have at least one of the requested tags.
    if (filters.tags?.length) {
      qb.andWhere(
        `p.tags && ARRAY[:...tags]::text[]`,
        { tags: filters.tags },
      );
    }

    // Sort
    const sort: MarketplaceSortOption = filters.sort ?? 'trust_score_desc';
    switch (sort) {
      case 'name_asc':
        qb.orderBy('p.name', 'ASC');
        break;
      case 'recently_published':
      case 'recently_updated':
        qb.orderBy('p.updatedAt', 'DESC');
        break;
      // trust_score_desc handled below after enrichment
      default:
        qb.orderBy('p.updatedAt', 'DESC');
    }

    const products = await qb.getMany();

    // Enrich: compliance state, domain names, trust scores.
    // Group by orgId for cross-org queries.
    const byOrg = new Map<string, string[]>();
    for (const p of products) {
      const list = byOrg.get(p.orgId) ?? [];
      list.push(p.id);
      byOrg.set(p.orgId, list);
    }

    const complianceMap = new Map<string, ComplianceStateValue>();
    const domainMap = new Map<string, string>();
    const trustScoreMap = new Map<string, number>();

    await Promise.all(
      [...byOrg.entries()].map(async ([org, ids]) => {
        const domainIds = products.filter((p) => p.orgId === org).map((p) => p.domainId);
        const [cm, dm, tm] = await Promise.all([
          this.fetchComplianceMap(org, ids),
          this.fetchDomainMap(org, domainIds),
          this.fetchTrustScoreMap(org, ids),
        ]);
        for (const [k, v] of cm) complianceMap.set(k, v);
        for (const [k, v] of dm) domainMap.set(k, v);
        for (const [k, v] of tm) trustScoreMap.set(k, v);
      }),
    );

    let items: MarketplaceProduct[] = products.map((p) =>
      this.toMarketplaceProduct(p, complianceMap, domainMap, trustScoreMap),
    );

    // Apply compliance filter (post-fetch because compliance lives in a separate schema).
    if (filters.compliance?.length) {
      items = items.filter(
        (p) => p.complianceState && filters.compliance!.includes(p.complianceState),
      );
    }

    // Apply trust score range filter (post-fetch).
    if (filters.trustScoreMin !== undefined) {
      items = items.filter((p) => p.trustScore >= filters.trustScoreMin!);
    }
    if (filters.trustScoreMax !== undefined) {
      items = items.filter((p) => p.trustScore <= filters.trustScoreMax!);
    }

    // Apply trust_score_desc sort after enrichment.
    if (sort === 'trust_score_desc') {
      items.sort((a, b) => b.trustScore - a.trustScore);
    }

    // Paginate the in-memory result set (necessary because compliance / trust
    // score filters run in memory above — total will reflect filtered count).
    const filteredTotal = items.length;
    const pageItems = items.slice(offset, offset + limit);

    return {
      items: pageItems,
      meta: { total: filteredTotal, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Product detail
  // ---------------------------------------------------------------------------

  async getProductDetail(orgId: string | undefined, productId: string, ctx?: RequestContext): Promise<MarketplaceProductDetail> {
    const product = await this.findProduct(productId, orgId, ['ports']);
    const resolvedOrgId = product.orgId;

    const [complianceMap, domainMap, trustScoreMap, activeConsumerCount, enrichment] = await Promise.all([
      this.fetchComplianceMap(resolvedOrgId, [productId]),
      this.fetchDomainMap(resolvedOrgId, [product.domainId]),
      this.fetchTrustScoreMap(resolvedOrgId, [productId]),
      this.countActiveConsumers(resolvedOrgId, productId),
      this.enrichmentService.enrich(
        { id: product.id, orgId: resolvedOrgId, domainId: product.domainId, ownerPrincipalId: product.ownerPrincipalId },
        ctx,
      ),
    ]);

    const base = this.toMarketplaceProduct(product, complianceMap, domainMap, trustScoreMap);
    const governanceScore = trustScoreMap.get(productId) ?? 1.0;

    // Per-port connection-details disclosure (F10.6). Same gating as the
    // draft-view get_product path: owner / active grant → full; authed no-grant
    // → redacted preview; unauthenticated → null on both.
    const discloseBase = {
      id: product.id,
      orgId: resolvedOrgId,
      ownerPrincipalId: product.ownerPrincipalId,
    };
    const ports: Port[] = [];
    for (const portEntity of product.ports ?? []) {
      const basePort = this.toPort(portEntity);
      const { connectionDetails, connectionDetailsPreview } =
        await this.enrichmentService.disclosePortConnectionDetails(portEntity, discloseBase, ctx);
      ports.push({ ...basePort, connectionDetails, connectionDetailsPreview });
    }

    return {
      ...base,
      trustScoreBreakdown: this.buildTrustScoreBreakdown(governanceScore),
      ports,
      activeConsumerCount,
      ownerPrincipalId: product.ownerPrincipalId,
      createdAt: product.createdAt.toISOString(),
      ...enrichment,
    };
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  async getProductSchema(orgId: string | undefined, productId: string): Promise<ProductSchema> {
    const product = await this.findProduct(productId, orgId);
    const resolvedOrgId = product.orgId;

    const [outputPorts, versions] = await Promise.all([
      this.portRepo.find({
        where: { orgId: resolvedOrgId, productId, portType: 'output' },
        order: { createdAt: 'ASC' },
      }),
      this.versionRepo.find({
        where: { orgId: resolvedOrgId, productId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);

    // Derive schema fields from the first output port that has a contract schema.
    const portWithSchema = outputPorts.find((p) => p.contractSchema);
    const rawSchema = portWithSchema?.contractSchema ?? null;
    const fields: SchemaField[] = rawSchema ? this.extractSchemaFields(rawSchema) : [];

    return {
      productId,
      version: product.version,
      fields,
      rawSchema,
      versionHistory: versions.map((v) => ({
        version: v.version,
        changeDescription: v.changeDescription,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Lineage (Phase 3 placeholder)
  // ---------------------------------------------------------------------------

  async getProductLineage(
    orgId: string | undefined,
    productId: string,
    depth: number,
  ): Promise<LineageGraph> {
    const product = await this.findProduct(productId, orgId);

    // Phase 3: return a minimal placeholder graph containing only this product node.
    // Real lineage traversal will query Neo4j in Phase 3.
    return {
      productId,
      depth,
      nodes: [
        {
          id: productId,
          type: 'data_product',
          label: product.name,
          metadata: { version: product.version, status: product.status },
        },
      ],
      edges: [],
      isPlaceholder: true,
    };
  }

  // ---------------------------------------------------------------------------
  // SLOs (Phase 3 placeholder)
  // ---------------------------------------------------------------------------

  async getProductSlos(orgId: string | undefined, productId: string): Promise<SloSummary> {
    const product = await this.findProduct(productId, orgId);
    const resolvedOrgId = product.orgId;

    const outputPorts = await this.portRepo.find({
      where: { orgId: resolvedOrgId, productId, portType: 'output' },
      order: { createdAt: 'ASC' },
    });

    // Phase 3: return SLO declarations from port slaDescription fields.
    // Real SLO evaluation history will come from the observability pipeline in Phase 3.
    return {
      productId,
      declarations: outputPorts.map((p) => ({
        portId: p.id,
        portName: p.name,
        description: p.slaDescription,
      })),
      overallHealth: 'unknown',
      isPlaceholder: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Access requests (for global marketplace product detail)
  // ---------------------------------------------------------------------------

  async getMyAccessRequests(
    productId: string,
    requesterPrincipalId: string,
    limit = 20,
    offset = 0,
  ): Promise<AccessRequestList> {
    const product = await this.findProduct(productId);

    const qb = this.requestRepo
      .createQueryBuilder('req')
      .where('req.orgId = :orgId', { orgId: product.orgId })
      .andWhere('req.requesterPrincipalId = :requester', { requester: requesterPrincipalId })
      .orderBy('req.requestedAt', 'DESC')
      .take(limit)
      .skip(offset);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((e) => ({
        id: e.id,
        orgId: e.orgId,
        productId: e.productId,
        requesterPrincipalId: e.requesterPrincipalId,
        justification: e.justification,
        accessScope: e.accessScope,
        status: e.status,
        temporalWorkflowId: e.temporalWorkflowId,
        requestedAt: e.requestedAt.toISOString(),
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        resolvedBy: e.resolvedBy,
        resolutionNote: e.resolutionNote,
        updatedAt: e.updatedAt.toISOString(),
      })),
      meta: { total, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // OpenSearch text search (unchanged from Phase 2)
  // ---------------------------------------------------------------------------

  async search(
    orgId: string,
    query: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<ProductSearchResponse> {
    const page  = Math.max(1, options.page  ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const from  = (page - 1) * limit;

    try {
      const mustClauses = query
        ? [
            {
              multi_match: {
                query,
                fields: ['name^3', 'description', 'tags^2'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
          ]
        : [{ match_all: {} }];

      const response = await this.opensearchClient.search({
        index: PRODUCT_INDEX,
        body: {
          from,
          size: limit,
          query: {
            bool: {
              must:   mustClauses,
              filter: [
                { term: { orgId } },
                { term: { status: 'published' } },
              ],
            },
          },
          sort: [{ _score: 'desc' }, { trustScore: 'desc' }],
        },
      });

      interface HitObject { _source: ProductSearchResult }
      interface HitsResult { hits: HitObject[]; total: number | { value: number; relation: string } }
      interface SearchBody { hits: HitsResult }
      const body = response.body as SearchBody;
      const hits = body.hits;
      const results: ProductSearchResult[] = hits.hits.map((hit) => hit._source);
      const total = typeof hits.total === 'number' ? hits.total : hits.total.value;

      return { total, page, limit, results };
    } catch (err) {
      this.logger.warn('OpenSearch unavailable — returning empty search results', (err as Error).message);
      return { total: 0, page, limit, results: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async findProduct(
    productId: string,
    orgId?: string,
    relations?: string[],
  ): Promise<DataProductEntity> {
    const where: Record<string, string> = { id: productId };
    if (orgId) where.orgId = orgId;
    const opts: { where: Record<string, string>; relations?: string[] } = { where };
    if (relations) opts.relations = relations;
    const product = await this.productRepo.findOne(opts);
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    return product;
  }

  private async fetchComplianceMap(
    orgId: string,
    productIds: string[],
  ): Promise<Map<string, ComplianceStateValue>> {
    if (!productIds.length) return new Map();
    const states = await this.complianceRepo.find({
      where: { orgId, productId: In(productIds) },
    });
    return new Map(states.map((s) => [s.productId, s.state]));
  }

  private async fetchDomainMap(
    orgId: string,
    domainIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(domainIds)];
    if (!unique.length) return new Map();
    const domains = await this.domainRepo.find({
      where: { orgId, id: In(unique) },
    });
    return new Map(domains.map((d) => [d.id, d.name]));
  }

  private async fetchTrustScoreMap(
    orgId: string,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (!productIds.length) return new Map();
    const scores = await Promise.all(
      productIds.map(async (id) => [id, await this.trustScoreService.computeTrustScore(orgId, id)] as const),
    );
    return new Map(scores);
  }

  private async countActiveConsumers(orgId: string, productId: string): Promise<number> {
    return this.grantRepo
      .createQueryBuilder('g')
      .where('g.orgId = :orgId', { orgId })
      .andWhere('g.productId = :productId', { productId })
      .andWhere('g.revokedAt IS NULL')
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now: new Date() })
      .getCount();
  }

  private toMarketplaceProduct(
    entity: DataProductEntity,
    complianceMap: Map<string, ComplianceStateValue>,
    domainMap: Map<string, string>,
    trustScoreMap: Map<string, number>,
  ): MarketplaceProduct {
    const ports = entity.ports ?? [];
    const outputPortTypes: OutputPortInterfaceType[] = [
      ...new Set(
        ports
          .filter((p) => p.portType === 'output' && p.interfaceType)
          .map((p) => p.interfaceType as OutputPortInterfaceType),
      ),
    ];

    return {
      id: entity.id,
      orgId: entity.orgId,
      domainId: entity.domainId,
      domainName: domainMap.get(entity.domainId) ?? 'Unknown Domain',
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      status: entity.status,
      version: entity.version,
      classification: entity.classification,
      tags: entity.tags,
      trustScore: trustScoreMap.get(entity.id) ?? 1.0,
      complianceState: complianceMap.get(entity.id) ?? null,
      outputPortTypes,
      sloHealthIndicator: 'unknown', // Phase 3
      publishedAt: entity.updatedAt.toISOString(), // best proxy until lifecycle events are surfaced
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private buildTrustScoreBreakdown(governanceScore: number): TrustScoreBreakdown {
    const phase3: TrustScoreDimension = {
      score: 1.0,
      weight: 0, // non-zero weights assigned in composite calculation
      available: false,
      phaseNote: 'Real data available in Phase 3',
    };

    const governanceDimension: TrustScoreDimension = {
      score: governanceScore,
      weight: TRUST_WEIGHTS.governanceCompliance,
      available: true,
    };

    // Composite: governance * 0.30 + placeholders * 0.70.
    // Placeholders are locked at 1.0 so they don't penalise products unfairly
    // before the data exists. They are clearly marked as unavailable.
    const composite =
      governanceScore * TRUST_WEIGHTS.governanceCompliance +
      1.0 * TRUST_WEIGHTS.lineageCompleteness +
      1.0 * TRUST_WEIGHTS.sloCompliance +
      1.0 * TRUST_WEIGHTS.schemaConformance +
      1.0 * TRUST_WEIGHTS.freshness;

    return {
      composite,
      dimensions: {
        governanceCompliance: governanceDimension,
        lineageCompleteness:  { ...phase3, weight: TRUST_WEIGHTS.lineageCompleteness },
        sloCompliance:        { ...phase3, weight: TRUST_WEIGHTS.sloCompliance },
        schemaConformance:    { ...phase3, weight: TRUST_WEIGHTS.schemaConformance },
        freshness:            { ...phase3, weight: TRUST_WEIGHTS.freshness },
      },
    };
  }

  private toPort(entity: PortDeclarationEntity): Port {
    return {
      id: entity.id,
      productId: entity.productId,
      orgId: entity.orgId,
      portType: entity.portType,
      name: entity.name,
      description: entity.description,
      interfaceType: entity.interfaceType,
      contractSchema: entity.contractSchema,
      slaDescription: entity.slaDescription,
      connectionDetails: null,
      connectionDetailsPreview: null,
      connectionDetailsValidated: entity.connectionDetailsValidated ?? false,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private extractSchemaFields(schema: Record<string, unknown>): SchemaField[] {
    // Best-effort extraction from JSON Schema format.
    // Handles schemas with top-level `properties` object (JSON Schema draft-07 style).
    const properties = schema['properties'] as Record<string, unknown> | undefined;
    if (!properties || typeof properties !== 'object') return [];

    return Object.entries(properties).map(([name, def]) => {
      const field = def as Record<string, unknown>;
      return {
        name,
        type: (field['type'] as string | undefined) ?? 'unknown',
        description: (field['description'] as string | undefined) ?? null,
        nullable: (field['nullable'] as boolean | undefined) ?? false,
        semanticAnnotation: (field['x-semantic-annotation'] as string | undefined) ?? null,
      };
    });
  }
}
