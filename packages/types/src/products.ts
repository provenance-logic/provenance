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
// Connection details (F10.5) — one shape per output port interface type.
// Full details (including credential fields) are only ever returned to a
// principal with an active access grant (F10.6). Callers without a grant get
// a redacted preview; unauthenticated callers get nothing.
// ---------------------------------------------------------------------------

export type SqlJdbcAuthMethod = 'username_password' | 'iam' | 'certificate';

export interface SqlJdbcConnectionDetails {
  kind: 'sql_jdbc';
  host: string;
  port: number;
  database: string;
  schema: string;
  authMethod: SqlJdbcAuthMethod;
  sslMode: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  jdbcUrlTemplate?: string;
  username?: string;
  password?: string;
}

export type RestApiAuthMethod = 'api_key' | 'oauth2' | 'bearer_token' | 'none';

export interface RestApiConnectionDetails {
  kind: 'rest_api';
  baseUrl: string;
  authMethod: RestApiAuthMethod;
  apiVersion?: string;
  requiredHeaders?: Record<string, string>;
  rateLimit?: { requests: number; perSeconds: number };
  apiKey?: string;
  bearerToken?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2TokenUrl?: string;
}

export interface GraphQlConnectionDetails {
  kind: 'graphql';
  endpointUrl: string;
  authMethod: RestApiAuthMethod;
  introspectionEndpoint?: string;
  apiKey?: string;
  bearerToken?: string;
}

export type KafkaAuthMethod = 'sasl_plain' | 'sasl_scram' | 'mtls' | 'none';

export interface KafkaConnectionDetails {
  kind: 'streaming_topic';
  bootstrapServers: string;
  topic: string;
  authMethod: KafkaAuthMethod;
  consumerGroupPrefix?: string;
  schemaRegistryUrl?: string;
  saslUsername?: string;
  saslPassword?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
}

export type FileExportStorage = 's3' | 'gcs' | 'adls';
export type FileExportAuthMethod = 'iam' | 'service_account' | 'access_key';

export interface FileExportConnectionDetails {
  kind: 'file_object_export';
  storage: FileExportStorage;
  bucket: string;
  pathPrefix: string;
  authMethod: FileExportAuthMethod;
  fileFormat: 'parquet' | 'avro' | 'json' | 'csv' | 'orc';
  compression?: 'none' | 'gzip' | 'snappy' | 'zstd';
  storageEndpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  serviceAccountJson?: string;
}

export type ConnectionDetails =
  | SqlJdbcConnectionDetails
  | RestApiConnectionDetails
  | GraphQlConnectionDetails
  | KafkaConnectionDetails
  | FileExportConnectionDetails;

/** Redacted preview — host/endpoint level only, no credentials (F10.6). */
export interface ConnectionDetailsPreview {
  kind: OutputPortInterfaceType;
  host?: string;
  endpoint?: string;
  bucket?: string;
  topic?: string;
  redacted: true;
}

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
  /** Full details only surfaced to principals with an active grant (F10.6). */
  connectionDetails: ConnectionDetails | null;
  /** Redacted view surfaced to authenticated principals without a grant. */
  connectionDetailsPreview: ConnectionDetailsPreview | null;
  connectionDetailsValidated: boolean;
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
  connectionDetails?: ConnectionDetails;
}

export interface UpdatePortRequest {
  name?: string;
  description?: string;
  interfaceType?: OutputPortInterfaceType;
  contractSchema?: Record<string, unknown>;
  slaDescription?: string;
  connectionDetails?: ConnectionDetails;
}

/** Response for POST /ports/:portId/test-connection (Phase B4 stub, 501). */
export interface TestConnectionResponse {
  status: 'not_implemented';
  message: string;
}

export type PortList = PaginatedList<Port>;

// ---------------------------------------------------------------------------
// Data Product — enrichment types (workstream 5.4 P1)
// ---------------------------------------------------------------------------

export interface ProductOwner {
  id: Uuid;
  displayName: string | null;
  email: string | null;
}

export interface ProductDomainTeam {
  id: Uuid;
  name: string;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
}

export interface ProductFreshness {
  lastRefreshedAt: IsoTimestamp | null;
  sloType: string;
  passed: boolean;
  measuredValue: number | null;
  evaluatedAt: IsoTimestamp;
}

export type ProductAccessStatusValue = 'granted' | 'pending' | 'not_requested' | 'denied';

export interface ProductAccessStatus {
  status: ProductAccessStatusValue;
  grantedAt: IsoTimestamp | null;
  expiresAt: IsoTimestamp | null;
}

export interface ProductColumnSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ProductColumnSchema {
  columns: ProductColumnSchemaColumn[];
  columnCount: number;
  rowEstimate: number | null;
  capturedAt: IsoTimestamp;
}

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
  owner?: ProductOwner | null;
  domainTeam?: ProductDomainTeam | null;
  freshness?: ProductFreshness | null;
  accessStatus?: ProductAccessStatus | null;
  columnSchema?: ProductColumnSchema | null;
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
