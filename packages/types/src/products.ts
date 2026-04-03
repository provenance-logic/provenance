import type { Uuid, IsoTimestamp, Slug, SemanticVersion, PaginatedList } from './common.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type DataProductStatus = 'draft' | 'published' | 'deprecated' | 'decommissioned';

export type PortType = 'input' | 'output' | 'discovery' | 'observability' | 'control';

export type OutputPortInterfaceType =
  | 'sql_jdbc'
  | 'rest_api'
  | 'graphql'
  | 'streaming_topic'
  | 'file_object_export'
  | 'semantic_query_endpoint';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface Port {
  id: Uuid;
  productId: Uuid;
  orgId: Uuid;
  portType: PortType;
  name: string;
  description: string | null;
  interfaceType: OutputPortInterfaceType | null;
  contractSchema: Record<string, unknown> | null;
  slaDescription: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface DeclarePortRequest {
  portType: PortType;
  name: string;
  description?: string;
  interfaceType?: OutputPortInterfaceType;
  contractSchema?: Record<string, unknown>;
  slaDescription?: string;
}

export interface UpdatePortRequest {
  name?: string;
  description?: string;
  interfaceType?: OutputPortInterfaceType;
  contractSchema?: Record<string, unknown>;
  slaDescription?: string;
}

export type PortList = PaginatedList<Port>;

// ---------------------------------------------------------------------------
// Data Product
// ---------------------------------------------------------------------------

export interface DataProduct {
  id: Uuid;
  orgId: Uuid;
  domainId: Uuid;
  name: string;
  slug: Slug;
  description: string | null;
  status: DataProductStatus;
  version: SemanticVersion;
  classification: DataClassification;
  ownerPrincipalId: Uuid;
  tags: string[];
  ports: Port[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface CreateDataProductRequest {
  name: string;
  slug: Slug;
  description?: string;
  classification: DataClassification;
  ownerPrincipalId: Uuid;
  tags?: string[];
}

export interface UpdateDataProductRequest {
  name?: string;
  description?: string;
  classification?: DataClassification;
  ownerPrincipalId?: Uuid;
  tags?: string[];
}

export type DataProductList = PaginatedList<DataProduct>;

export interface PublishProductRequest {
  changeDescription?: string;
}

// ---------------------------------------------------------------------------
// Product Version (immutable snapshot)
// ---------------------------------------------------------------------------

export interface ProductVersion {
  id: Uuid;
  productId: Uuid;
  orgId: Uuid;
  version: SemanticVersion;
  changeDescription: string | null;
  snapshot: DataProduct;
  createdAt: IsoTimestamp;
  createdByPrincipalId: Uuid;
}

export type ProductVersionList = PaginatedList<ProductVersion>;
