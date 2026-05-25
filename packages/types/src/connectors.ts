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
 * capability manifest row, and update the registration UI dropdown.
 *
 * Snowflake (V37, F3.2a): probe (Layer 1) and schema inference (Layer 2)
 * are implemented. Discovery crawl (Layer 3) and lineage (Layer 4) ship
 * in subsequent PRs. The registration UI dropdown is deliberately NOT
 * updated yet — UI exposure waits for live-account end-to-end verification.
 */
export type ConnectorType =
  | 'postgresql'
  | 's3'
  | 'databricks'
  | 'snowflake';

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
  /**
   * Pre-staged credential reference: an AWS Secrets Manager ARN or the
   * dev-only `local-env:VARNAME` sentinel. Use `credentialSecret` for
   * self-service GUI entry instead.
   */
  credentialArn?: string;
  /**
   * Raw credential payload submitted once over TLS (ADR-013). The platform
   * encrypts it at rest (AES-256-GCM) and stores only a `vault:<uuid>`
   * reference. The plaintext is never persisted, logged, or returned.
   * When provided, takes precedence over `credentialArn`.
   */
  credentialSecret?: Record<string, unknown>;
}

export interface UpdateConnectorRequest {
  name?: string;
  description?: string;
  connectionConfig?: Record<string, unknown>;
  /**
   * Pre-staged credential reference. Use `credentialSecret` for self-service
   * credential rotation instead.
   */
  credentialArn?: string;
  /**
   * New raw credential payload for credential rotation (ADR-013). Overwrites
   * the existing vault entry in place — same `vault:<uuid>` reference, new
   * encrypted envelope. The plaintext is never persisted, logged, or returned.
   */
  credentialSecret?: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Discovery Crawl Events (append-only)
// ---------------------------------------------------------------------------

export type DiscoveryCrawlStatus = 'running' | 'succeeded' | 'partial' | 'failed';

/**
 * A single crawl invocation record returned by GET .../connectors/:id/crawl-events.
 *
 * Note: the endpoint returns DiscoveryCrawlEventRecord[] (an array, not a
 * PaginatedList) because crawl history is short and always fully fetched.
 * The `metadata` field carries connector-type-specific counters such as
 * `lineageEdgesEmitted` for Databricks and Snowflake crawls.
 */
export interface DiscoveryCrawlEventRecord {
  id: Uuid;
  orgId: Uuid;
  connectorId: Uuid;
  triggeredBy: Uuid | null;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
  status: DiscoveryCrawlStatus;
  catalogsWalked: number;
  schemasWalked: number;
  tablesFound: number;
  sourcesCreated: number;
  sourcesSkipped: number;
  snapshotsCaptured: number;
  snapshotsFailed: number;
  errorMessage: string | null;
  /** Connector-type-specific counters. Snowflake + Databricks set lineageEdgesEmitted. */
  metadata: Record<string, unknown>;
}
