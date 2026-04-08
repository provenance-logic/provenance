import type { Uuid, IsoTimestamp, Slug, SemanticVersion, PaginatedList } from './common.js';
import type { DataProductStatus, DataClassification, OutputPortInterfaceType, Port } from './products.js';
import type { ComplianceStateValue } from './governance.js';

// ---------------------------------------------------------------------------
// Trust Score
// ---------------------------------------------------------------------------

export interface TrustScoreDimension {
  /** Normalised score 0.0–1.0. */
  score: number;
  /** Fractional weight of this dimension in the composite score. */
  weight: number;
  /** False when the data for this dimension is unavailable (Phase 3 placeholder). */
  available: boolean;
  /** Present when available is false — explains when this becomes live. */
  phaseNote?: string;
}

export interface TrustScoreBreakdown {
  /** Weighted composite 0.0–1.0. */
  composite: number;
  dimensions: {
    governanceCompliance: TrustScoreDimension;
    lineageCompleteness: TrustScoreDimension;
    sloCompliance: TrustScoreDimension;
    schemaConformance: TrustScoreDimension;
    freshness: TrustScoreDimension;
  };
}

// ---------------------------------------------------------------------------
// Marketplace product (listing card)
// ---------------------------------------------------------------------------

export type SloHealthIndicator = 'healthy' | 'degraded' | 'unknown';

export interface MarketplaceProduct {
  id: Uuid;
  orgId: Uuid;
  domainId: Uuid;
  domainName: string;
  name: string;
  slug: Slug;
  description: string | null;
  status: DataProductStatus;
  version: SemanticVersion;
  classification: DataClassification;
  tags: string[];
  trustScore: number;
  complianceState: ComplianceStateValue | null;
  outputPortTypes: OutputPortInterfaceType[];
  sloHealthIndicator: SloHealthIndicator;
  publishedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
}

export type MarketplaceProductList = PaginatedList<MarketplaceProduct>;

// ---------------------------------------------------------------------------
// Product detail (consumer view)
// ---------------------------------------------------------------------------

export interface MarketplaceProductDetail extends MarketplaceProduct {
  trustScoreBreakdown: TrustScoreBreakdown;
  ports: Port[];
  activeConsumerCount: number;
  ownerPrincipalId: Uuid;
  createdAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Schema endpoint
// ---------------------------------------------------------------------------

export interface SchemaField {
  name: string;
  type: string;
  description: string | null;
  nullable: boolean;
  semanticAnnotation: string | null;
}

export interface SchemaVersionSummary {
  version: SemanticVersion;
  changeDescription: string | null;
  createdAt: IsoTimestamp;
}

export interface ProductSchema {
  productId: Uuid;
  version: SemanticVersion;
  fields: SchemaField[];
  rawSchema: Record<string, unknown> | null;
  versionHistory: SchemaVersionSummary[];
}

// ---------------------------------------------------------------------------
// Lineage endpoint (Phase 3 — marketplace view types, kept for backward compat)
// ---------------------------------------------------------------------------

export interface LineageNode {
  id: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface LineageGraph {
  productId: Uuid;
  depth: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
  /** True until Phase 3 (Neo4j lineage graph) is built. */
  isPlaceholder: boolean;
}

// ---------------------------------------------------------------------------
// SLOs endpoint (Phase 3 placeholder)
// ---------------------------------------------------------------------------

export interface SloDeclaration {
  portId: Uuid;
  portName: string;
  description: string | null;
}

export interface SloSummary {
  productId: Uuid;
  declarations: SloDeclaration[];
  overallHealth: SloHealthIndicator;
  /** True until Phase 3 (SLO evaluation pipeline) is built. */
  isPlaceholder: boolean;
}

// ---------------------------------------------------------------------------
// Filter / sort options
// ---------------------------------------------------------------------------

export type MarketplaceSortOption =
  | 'trust_score_desc'
  | 'name_asc'
  | 'recently_published'
  | 'recently_updated';

export interface MarketplaceFilters {
  domain?: string[];
  outputPortType?: OutputPortInterfaceType[];
  compliance?: ComplianceStateValue[];
  trustScoreMin?: number;
  trustScoreMax?: number;
  tags?: string[];
  includeDeprecated?: boolean;
  sort?: MarketplaceSortOption;
}
