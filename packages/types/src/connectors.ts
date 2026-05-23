import type { Uuid, IsoTimestamp, PaginatedList } from './common.js';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * Connector types the platform ships first-class.
 *
 * Per PRD F3.2 + F3.2a (2026-05-23 PRD v1.6 reshape closing anchor
 * decision 5 on B-063), the connector library exposes only types that
 * work end-to-end at the consumer-grade bar. Earlier versions of this
 * enum advertised 12 types; only PostgreSQL, S3, and Databricks had
 * real probes / schema inference, so the other 9 were retired by
 * migration V32. Snowflake is the next-scheduled addition under the
 * F3.2a tranche cadence and will be added back here when it ships.
 *
 * Adding a new value: implement the probe + inferSchema branches in
 * ConnectorProbeService (TypeScript exhaustiveness check will fail the
 * build otherwise), add a CHECK constraint update migration, ship a
 * capability manifest row, update the registration UI dropdown.
 */
export type ConnectorType =
  | 'postgresql'
  | 's3'
  | 'databricks';

export type SourceType =
  | 'table'
  | 'view'
  | 'materialized_view'
  | 'topic'
  | 's3_prefix'
  | 'api_endpoint'
  | 'custom';

export type ValidationStatus = 'pending' | 'valid' | 'invalid' | 'stale';

export type HealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'credential_error' | 'timeout';

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export interface Connector {
  id: Uuid;
  orgId: Uuid;
  domainId: Uuid;
  name: string;
  description: string | null;
  connectorType: ConnectorType;
  /** Non-sensitive connection parameters only. Never contains raw credentials. */
  connectionConfig: Record<string, unknown>;
  /** AWS Secrets Manager ARN. NULL for public sources. */
  credentialArn: string | null;
  validationStatus: ValidationStatus;
  lastValidatedAt: IsoTimestamp | null;
  createdBy: Uuid;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface RegisterConnectorRequest {
  domainId: Uuid;
  name: string;
  description?: string;
  connectorType: ConnectorType;
  connectionConfig?: Record<string, unknown>;
  /** AWS Secrets Manager ARN. Never include raw credentials. */
  credentialArn?: string;
}

export interface UpdateConnectorRequest {
  name?: string;
  description?: string;
  connectionConfig?: Record<string, unknown>;
  credentialArn?: string;
}

export type ConnectorList = PaginatedList<Connector>;

// ---------------------------------------------------------------------------
// Connector Health Events (append-only)
// ---------------------------------------------------------------------------

export interface ConnectorHealthEvent {
  id: Uuid;
  orgId: Uuid;
  connectorId: Uuid;
  status: HealthStatus;
  /** NULL if the connection did not complete. */
  responseTimeMs: number | null;
  /** NULL on healthy checks. */
  errorMessage: string | null;
  checkedAt: IsoTimestamp;
}

export type ConnectorHealthEventList = PaginatedList<ConnectorHealthEvent>;

// ---------------------------------------------------------------------------
// Source Registrations
// ---------------------------------------------------------------------------

export interface SourceRegistration {
  id: Uuid;
  orgId: Uuid;
  connectorId: Uuid;
  /** Opaque reference: e.g. "public.users", "s3://bucket/prefix/", "orders.v1" */
  sourceRef: string;
  sourceType: SourceType;
  displayName: string;
  description: string | null;
  registeredBy: Uuid;
  registeredAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface RegisterSourceRequest {
  sourceRef: string;
  sourceType: SourceType;
  displayName: string;
  description?: string;
}

export interface UpdateSourceRequest {
  displayName?: string;
  description?: string;
}

export type SourceRegistrationList = PaginatedList<SourceRegistration>;

// ---------------------------------------------------------------------------
// Schema Snapshots (append-only, immutable)
// ---------------------------------------------------------------------------

export interface SchemaSnapshot {
  id: Uuid;
  orgId: Uuid;
  sourceRegistrationId: Uuid;
  connectorId: Uuid;
  /** Inferred column/field names, types, and nullability. */
  schemaDefinition: Record<string, unknown>;
  columnCount: number | null;
  /** NULL for non-tabular sources. */
  rowEstimate: number | null;
  /** NULL for automated captures. */
  capturedBy: Uuid | null;
  capturedAt: IsoTimestamp;
}

export type SchemaSnapshotList = PaginatedList<SchemaSnapshot>;
