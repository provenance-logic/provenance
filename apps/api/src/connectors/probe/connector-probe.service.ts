import { Injectable } from '@nestjs/common';
import { Client as PgClient } from 'pg';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { HealthStatus } from '@provenance/types';
import type { ConnectorEntity } from '../entities/connector.entity.js';
import type { SourceRegistrationEntity } from '../entities/source-registration.entity.js';
import { SecretsManagerService } from './secrets-manager.service.js';

export interface ProbeResult {
  status: HealthStatus;
  responseTimeMs: number | null;
  errorMessage: string | null;
}

export interface SchemaInferenceResult {
  schemaDefinition: Record<string, unknown>;
  columnCount: number | null;
  rowEstimate: number | null;
}

export interface DiscoveredTable {
  catalog: string;
  schema: string;
  name: string;
  fullName: string; // catalog.schema.name
}

export interface WorkspaceWalkResult {
  catalogs: string[];
  schemasWalked: number;
  tables: DiscoveredTable[];
}

export interface DiscoveredLineageEdge {
  /**
   * Source side of the edge — the upstream table whose data flows
   * INTO the target. Format: catalog.schema.table.
   */
  sourceFullName: string;
  /**
   * Target side of the edge — the downstream table that derives from
   * the source. Format: catalog.schema.table.
   */
  targetFullName: string;
}

@Injectable()
export class ConnectorProbeService {
  constructor(private readonly secretsManager: SecretsManagerService) {}

  /**
   * Runs a live connectivity check for the connector.
   * Every `ConnectorType` value has a real probe implementation; the
   * `never` default enforces this at compile time — adding a new value
   * to `ConnectorType` without a branch here fails the build. See PRD
   * F3.2a for the tranche discipline.
   */
  async probe(connector: ConnectorEntity): Promise<ProbeResult> {
    switch (connector.connectorType) {
      case 'postgresql':
        return this.probePostgres(connector);
      case 's3':
        return this.probeS3(connector);
      case 'databricks':
        return this.probeDatabricks(connector);
      default: {
        // Exhaustiveness: every ConnectorType must have a branch above.
        // The runtime throw is reachable only if a row carries a value
        // outside the enum (data corruption or a stale row that escaped
        // V32's cleanup) — fail loudly rather than synthesize healthy.
        const _exhaustive: never = connector.connectorType;
        throw new Error(`Unhandled connector type: ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Connects to the external system and infers the source schema.
   * Same exhaustiveness contract as `probe()` — adding a `ConnectorType`
   * value without an `inferSchema` branch fails the build.
   */
  async inferSchema(
    connector: ConnectorEntity,
    source: SourceRegistrationEntity,
  ): Promise<SchemaInferenceResult> {
    switch (connector.connectorType) {
      case 'postgresql':
        return this.introspectPostgres(connector, source);
      case 's3':
        return this.introspectS3(connector, source);
      case 'databricks':
        return this.introspectDatabricks(connector, source);
      default: {
        const _exhaustive: never = connector.connectorType;
        throw new Error(`Unhandled connector type: ${String(_exhaustive)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PostgreSQL
  // ---------------------------------------------------------------------------

  private async probePostgres(connector: ConnectorEntity): Promise<ProbeResult> {
    const client = await this.buildPgClient(connector, 5000);
    const start = Date.now();
    try {
      await client.connect();
      await client.query('SELECT 1');
      const responseTimeMs = Date.now() - start;
      await client.end();
      return { status: 'healthy', responseTimeMs, errorMessage: null };
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown error';
      return {
        status: classifyPgError(msg),
        responseTimeMs: null,
        errorMessage: msg,
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async introspectPostgres(
    connector: ConnectorEntity,
    source: SourceRegistrationEntity,
  ): Promise<SchemaInferenceResult> {
    const client = await this.buildPgClient(connector, 10000);
    await client.connect();
    try {
      // sourceRef format: "schema.table" or just "table" (defaults to public)
      const parts = source.sourceRef.split('.');
      const schemaName = parts.length > 1 ? parts[0] : 'public';
      const tableName = parts.length > 1 ? parts[1] : parts[0];

      const colResult = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schemaName, tableName],
      );

      const rowResult = await client.query<{ n_live_tup: string }>(
        `SELECT n_live_tup
         FROM pg_stat_user_tables
         WHERE schemaname = $1 AND relname = $2`,
        [schemaName, tableName],
      );

      const columns = colResult.rows.map((r) => ({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        defaultValue: r.column_default,
      }));

      const rowEstimate =
        rowResult.rows.length > 0
          ? Number(rowResult.rows[0].n_live_tup)
          : null;

      return {
        schemaDefinition: { columns },
        columnCount: columns.length,
        rowEstimate,
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async buildPgClient(
    connector: ConnectorEntity,
    connectionTimeoutMillis: number,
  ): Promise<PgClient> {
    const cfg = connector.connectionConfig;
    let creds: Record<string, string> = {};
    if (connector.credentialArn) {
      creds = await this.secretsManager.getSecretValue(connector.credentialArn);
    }
    return new PgClient({
      host: String(cfg.host ?? 'localhost'),
      port: Number(cfg.port ?? 5432),
      database: String(cfg.database ?? ''),
      user: creds.username ?? creds.user ?? '',
      password: creds.password ?? '',
      ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis,
    });
  }

  // ---------------------------------------------------------------------------
  // S3
  // ---------------------------------------------------------------------------

  private async probeS3(connector: ConnectorEntity): Promise<ProbeResult> {
    const cfg = connector.connectionConfig;
    const s3Client = await this.buildS3Client(connector);
    const start = Date.now();
    try {
      await s3Client.send(
        new ListObjectsV2Command({
          Bucket: String(cfg.bucket ?? ''),
          MaxKeys: 1,
        }),
      );
      const responseTimeMs = Date.now() - start;
      return { status: 'healthy', responseTimeMs, errorMessage: null };
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown error';
      return {
        status: classifyS3Error(err as Error & { name?: string }),
        responseTimeMs: null,
        errorMessage: msg,
      };
    }
  }

  private async introspectS3(
    connector: ConnectorEntity,
    source: SourceRegistrationEntity,
  ): Promise<SchemaInferenceResult> {
    const cfg = connector.connectionConfig;
    const s3Client = await this.buildS3Client(connector);

    // sourceRef can be "s3://bucket/prefix/" or just "prefix/"
    const prefix = source.sourceRef.startsWith('s3://')
      ? source.sourceRef.replace(/^s3:\/\/[^/]+\//, '')
      : source.sourceRef;

    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: String(cfg.bucket ?? ''),
        Prefix: prefix,
        MaxKeys: 100,
      }),
    );

    const objects = response.Contents ?? [];
    const totalSizeBytes = objects.reduce(
      (sum, obj) => sum + (obj.Size ?? 0),
      0,
    );

    return {
      schemaDefinition: {
        type: 's3_prefix',
        prefix,
        objectCount: response.KeyCount ?? 0,
        totalSizeBytes,
        sampleKeys: objects.slice(0, 5).map((o) => o.Key ?? ''),
      },
      columnCount: null,
      rowEstimate: null,
    };
  }

  private async buildS3Client(connector: ConnectorEntity): Promise<S3Client> {
    let creds: Record<string, string> = {};
    if (connector.credentialArn) {
      creds = await this.secretsManager.getSecretValue(connector.credentialArn);
    }
    return new S3Client({
      ...(creds.accessKeyId
        ? {
            credentials: {
              accessKeyId: creds.accessKeyId,
              secretAccessKey: creds.secretAccessKey ?? '',
            },
          }
        : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Databricks
  // ---------------------------------------------------------------------------

  /**
   * Connectivity probe for a Databricks workspace. Hits the SCIM /Me endpoint
   * — the cheapest authenticated call available — and treats 200 as healthy.
   *
   * Credential resolution: credentialArn must be set. Either a real AWS
   * Secrets Manager ARN (production) or the local-dev sentinel
   * `local-env:VARNAME` (laptop dev — see SecretsManagerService for how it
   * resolves). The secret payload must be JSON with shape `{"token":"dapi..."}`.
   * Raw plaintext credentials in connection_config are blocked by the
   * raw-credential-guard at registration time.
   */
  private async probeDatabricks(connector: ConnectorEntity): Promise<ProbeResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      return {
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage:
          'Databricks connector requires connection_config.host (the workspace URL, e.g. https://dbc-xxxxxx.cloud.databricks.com)',
      };
    }

    const token = await this.resolveDatabricksToken(connector);
    if (!token) {
      return {
        status: 'credential_error',
        responseTimeMs: null,
        errorMessage:
          'Databricks connector requires a personal access token — set credentialArn to a Secrets Manager ARN or local-env:VARNAME sentinel pointing at a JSON value of shape {"token":"dapi..."}',
      };
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${host}/api/2.0/preview/scim/v2/Me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - start;
      if (response.ok) {
        return { status: 'healthy', responseTimeMs, errorMessage: null };
      }
      const bodySnippet = await safeReadSnippet(response);
      return {
        status: classifyDatabricksHttpStatus(response.status),
        responseTimeMs: null,
        errorMessage: `Databricks returned HTTP ${response.status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        return {
          status: 'timeout',
          responseTimeMs: null,
          errorMessage: 'Databricks probe timed out after 5s',
        };
      }
      return {
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage: error.message ?? 'Unknown error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async resolveDatabricksToken(
    connector: ConnectorEntity,
  ): Promise<string | null> {
    if (!connector.credentialArn) return null;
    try {
      const creds = await this.secretsManager.getSecretValue(connector.credentialArn);
      if (typeof creds.token === 'string' && creds.token.length > 0) {
        return creds.token;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Schema inference via the Unity Catalog REST API.
   * GET /api/2.1/unity-catalog/tables/{catalog}.{schema}.{table} returns
   * column metadata including type, nullability, and (often) a comment.
   *
   * sourceRef must be a three-part name: catalog.schema.table. Two-part
   * (schema.table without catalog) is not accepted — Databricks tables
   * are always three-part in Unity Catalog, and defaulting the catalog
   * here would silently hide a misconfigured source registration.
   *
   * Row estimates are not returned: Unity Catalog doesn't expose them
   * cheaply, and the only path that would (running a count query through
   * a SQL Warehouse) is heavyweight and would require warehouse
   * configuration on the connector. Deferred to a later layer if
   * operators ask for it.
   */
  private async introspectDatabricks(
    connector: ConnectorEntity,
    source: SourceRegistrationEntity,
  ): Promise<SchemaInferenceResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error(
        'Databricks connector requires connection_config.host (the workspace URL)',
      );
    }
    const token = await this.resolveDatabricksToken(connector);
    if (!token) {
      throw new Error(
        'Databricks connector requires a credentialArn pointing at a secret with shape {"token":"dapi..."}',
      );
    }
    const parts = source.sourceRef.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      throw new Error(
        `Databricks sourceRef must be a three-part name (catalog.schema.table); got "${source.sourceRef}"`,
      );
    }
    const fullName = parts.join('.');

    const response = await fetch(
      `${host}/api/2.1/unity-catalog/tables/${encodeURIComponent(fullName)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      const snippet = await safeReadSnippet(response);
      throw new Error(
        `Unity Catalog returned HTTP ${response.status} for ${fullName}${snippet ? `: ${snippet}` : ''}`,
      );
    }

    const tableInfo = (await response.json()) as UnityCatalogTableResponse;
    const rawColumns = Array.isArray(tableInfo.columns) ? tableInfo.columns : [];
    const columns = rawColumns
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((col) => ({
        name: col.name,
        type: col.type_text ?? col.type_name ?? 'unknown',
        nullable: col.nullable !== false,
        position: col.position ?? null,
        comment: col.comment ?? null,
      }));

    return {
      schemaDefinition: {
        columns,
        tableType: tableInfo.table_type ?? null,
        dataSourceFormat: tableInfo.data_source_format ?? null,
        comment: tableInfo.comment ?? null,
      },
      columnCount: columns.length,
      rowEstimate: null,
    };
  }

  /**
   * Walks a Databricks workspace via Unity Catalog REST and returns every
   * table the connector's principal can see. Used by ConnectorsService's
   * discovery crawl to pre-populate source registrations.
   *
   * - catalogScope (optional) limits the walk to a named subset. When
   *   absent or empty, walks every catalog the principal can list. The
   *   built-in `information_schema` schema is always skipped — it's
   *   metadata-about-metadata, not user-facing data.
   * - Pagination uses Unity Catalog's `next_page_token`.
   * - Network errors and HTTP failures bubble; the orchestration layer
   *   records them on the discovery_crawl_events row.
   */
  async walkDatabricksWorkspace(
    connector: ConnectorEntity,
    catalogScope?: string[],
  ): Promise<WorkspaceWalkResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error('Databricks connector requires connection_config.host');
    }
    const token = await this.resolveDatabricksToken(connector);
    if (!token) {
      throw new Error(
        'Databricks connector requires a credentialArn pointing at a secret with shape {"token":"dapi..."}',
      );
    }
    const auth = { Authorization: `Bearer ${token}` };

    const catalogs = await this.uc_listCatalogs(host, auth, catalogScope);
    const tables: DiscoveredTable[] = [];
    let schemasWalked = 0;

    for (const catalog of catalogs) {
      const schemas = await this.uc_listSchemas(host, auth, catalog);
      for (const schema of schemas) {
        if (schema === 'information_schema') continue;
        schemasWalked++;
        const tableNames = await this.uc_listTables(host, auth, catalog, schema);
        for (const name of tableNames) {
          tables.push({
            catalog,
            schema,
            name,
            fullName: `${catalog}.${schema}.${name}`,
          });
        }
      }
    }

    return { catalogs, schemasWalked, tables };
  }

  private async uc_listCatalogs(
    host: string,
    auth: Record<string, string>,
    catalogScope?: string[],
  ): Promise<string[]> {
    if (catalogScope && catalogScope.length > 0) {
      return catalogScope;
    }
    const all = await this.uc_paged<{ name: string }>(
      host,
      auth,
      '/api/2.1/unity-catalog/catalogs',
      'catalogs',
    );
    return all.map((c) => c.name);
  }

  private async uc_listSchemas(
    host: string,
    auth: Record<string, string>,
    catalog: string,
  ): Promise<string[]> {
    const all = await this.uc_paged<{ name: string }>(
      host,
      auth,
      `/api/2.1/unity-catalog/schemas?catalog_name=${encodeURIComponent(catalog)}`,
      'schemas',
    );
    return all.map((s) => s.name);
  }

  private async uc_listTables(
    host: string,
    auth: Record<string, string>,
    catalog: string,
    schema: string,
  ): Promise<string[]> {
    const all = await this.uc_paged<{ name: string }>(
      host,
      auth,
      `/api/2.1/unity-catalog/tables?catalog_name=${encodeURIComponent(catalog)}&schema_name=${encodeURIComponent(schema)}`,
      'tables',
    );
    return all.map((t) => t.name);
  }

  /**
   * Pulls lineage edges for each discovered table from Unity Catalog's
   * Lineage Tracking API. Returns a deduplicated list of edges, where
   * each edge is (source_full_name → target_full_name). Used by the
   * discovery crawl to project system-discovered lineage into Neo4j.
   *
   * - GET /api/2.0/lineage-tracking/table-lineage?table_name=X returns
   *   both upstreams AND downstreams for table X. Walking every table
   *   in the discovered set thus produces edges twice (once from each
   *   side); the dedupe pass collapses them.
   * - Tables outside the discovered set still appear in lineage if they
   *   feed into one of the discovered tables — those are kept (the
   *   upstream `workspace.bronze.raw_mro_inputs → workspace.silver.mro_clean`
   *   edge is part of the lineage graph even if the bronze table wasn't
   *   in catalogScope).
   * - The Lineage Tracking API returns 404 or an empty body for tables
   *   that have no lineage yet (workspace freshly seeded, no query
   *   activity through SQL Warehouses). Both are treated as "no edges"
   *   silently — not every table has lineage and that's normal.
   * - Network/HTTP errors on individual table calls are logged but do
   *   not abort the walk; the orchestration layer counts errors and
   *   surfaces them on the crawl event row.
   */
  async walkDatabricksLineage(
    connector: ConnectorEntity,
    tableFullNames: string[],
  ): Promise<{ edges: DiscoveredLineageEdge[]; tablesWithErrors: string[] }> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error('Databricks connector requires connection_config.host');
    }
    const token = await this.resolveDatabricksToken(connector);
    if (!token) {
      throw new Error(
        'Databricks connector requires a credentialArn pointing at a secret with shape {"token":"dapi..."}',
      );
    }
    const auth = { Authorization: `Bearer ${token}` };

    // (sourceFullName, targetFullName) string keys for dedupe.
    const seen = new Set<string>();
    const edges: DiscoveredLineageEdge[] = [];
    const tablesWithErrors: string[] = [];

    for (const fullName of tableFullNames) {
      try {
        const url = `${host}/api/2.0/lineage-tracking/table-lineage?table_name=${encodeURIComponent(fullName)}`;
        const response = await fetch(url, { headers: auth });
        if (response.status === 404) continue; // no lineage yet — normal
        if (!response.ok) {
          tablesWithErrors.push(fullName);
          continue;
        }
        const body = (await response.json()) as DatabricksLineageResponse;
        for (const up of body.upstreams ?? []) {
          const upName = extractFullName(up.tableInfo);
          if (!upName) continue;
          const key = `${upName}\x1f${fullName}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({ sourceFullName: upName, targetFullName: fullName });
          }
        }
        for (const dn of body.downstreams ?? []) {
          const dnName = extractFullName(dn.tableInfo);
          if (!dnName) continue;
          const key = `${fullName}\x1f${dnName}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push({ sourceFullName: fullName, targetFullName: dnName });
          }
        }
      } catch {
        tablesWithErrors.push(fullName);
      }
    }

    return { edges, tablesWithErrors };
  }

  private async uc_paged<T>(
    host: string,
    auth: Record<string, string>,
    pathAndQuery: string,
    arrayKey: 'catalogs' | 'schemas' | 'tables',
  ): Promise<T[]> {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const aggregated: T[] = [];
    let pageToken: string | undefined;
    // Cap at 50 pages defensively — Databricks pages at ~100 items by
    // default, so this allows up to ~5000 items in a single resource list
    // before we bail out and force the operator to scope down.
    for (let i = 0; i < 50; i++) {
      const url = `${host}${pathAndQuery}${pageToken ? `${sep}page_token=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await fetch(url, { headers: auth });
      if (!response.ok) {
        const snippet = await safeReadSnippet(response);
        throw new Error(
          `Unity Catalog returned HTTP ${response.status} for ${pathAndQuery}${snippet ? `: ${snippet}` : ''}`,
        );
      }
      const body = (await response.json()) as Record<string, unknown>;
      const items = (body[arrayKey] as T[] | undefined) ?? [];
      aggregated.push(...items);
      const next = body.next_page_token;
      if (typeof next !== 'string' || next.length === 0) break;
      pageToken = next;
    }
    return aggregated;
  }
}

interface UnityCatalogColumn {
  name: string;
  type_text?: string;
  type_name?: string;
  position?: number;
  nullable?: boolean;
  comment?: string | null;
}

interface DatabricksLineageTableInfo {
  name?: string;
  catalog_name?: string;
  schema_name?: string;
}

interface DatabricksLineageEntry {
  tableInfo?: DatabricksLineageTableInfo;
}

interface DatabricksLineageResponse {
  upstreams?: DatabricksLineageEntry[];
  downstreams?: DatabricksLineageEntry[];
}

function extractFullName(info?: DatabricksLineageTableInfo): string | null {
  if (!info) return null;
  const { catalog_name: c, schema_name: s, name: n } = info;
  if (!c || !s || !n) return null;
  return `${c}.${s}.${n}`;
}

interface UnityCatalogTableResponse {
  name?: string;
  catalog_name?: string;
  schema_name?: string;
  table_type?: string;
  data_source_format?: string;
  columns?: UnityCatalogColumn[];
  comment?: string | null;
}

// ---------------------------------------------------------------------------
// Error classifiers
// ---------------------------------------------------------------------------

function classifyPgError(message: string): HealthStatus {
  if (
    /password authentication failed|role .* does not exist|invalid authorization|pg_hba/i.test(
      message,
    )
  ) {
    return 'credential_error';
  }
  if (/timeout|timed out|connect timeout/i.test(message)) {
    return 'timeout';
  }
  return 'unreachable';
}

function classifyS3Error(err: Error & { name?: string; Code?: string }): HealthStatus {
  const code = err.name ?? err.Code ?? '';
  if (/AccessDenied|InvalidClientTokenId|AuthFailure|InvalidAccessKeyId|SignatureDoesNotMatch/i.test(code)) {
    return 'credential_error';
  }
  if (/Timeout|RequestTimeout/i.test(code)) {
    return 'timeout';
  }
  return 'unreachable';
}

function classifyDatabricksHttpStatus(status: number): HealthStatus {
  if (status === 401 || status === 403) return 'credential_error';
  if (status === 408 || status === 504) return 'timeout';
  return 'unreachable';
}

async function safeReadSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200).replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}
