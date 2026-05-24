import { Injectable } from '@nestjs/common';
import { Client as PgClient } from 'pg';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
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
      case 'snowflake':
        return this.probeSnowflake(connector);
      default: {
        // Exhaustiveness: every ConnectorType must have a branch above.
        // The runtime throw is reachable only if a row carries a value
        // outside the enum (data corruption or a stale row that escaped
        // migration cleanup) — fail loudly rather than synthesize healthy.
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
      case 'snowflake':
        return this.inferSchemaSnowflake(connector, source);
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

  // ---------------------------------------------------------------------------
  // Snowflake
  // ---------------------------------------------------------------------------

  /**
   * Connectivity probe for a Snowflake account.
   *
   * Uses the Snowflake SQL REST API (POST /api/v2/statements) with key-pair
   * JWT authentication — no npm driver required, pure `fetch` like Databricks.
   * See `documents/architecture/snowflake-integration-sketch.md` §Layer 1 for
   * the driver decision rationale (Option B, SQL REST API).
   *
   * Credential resolution: credentialArn must be set. Either a real AWS
   * Secrets Manager ARN or the local-dev sentinel `local-env:VARNAME`.
   * The secret payload must be JSON with shape:
   *   { "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...", "user": "...", "account": "..." }
   *
   * connection_config fields:
   *   host        — full account hostname (e.g. en92180.us-east-1.snowflakecomputing.com)
   *   warehouse   — compute warehouse name (default: COMPUTE_WH)
   *   role        — Snowflake role (default: ACCOUNTADMIN)
   *   database    — optional, narrowing context
   *   schema      — optional, narrowing context
   */
  private async probeSnowflake(connector: ConnectorEntity): Promise<ProbeResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      return {
        status: 'unreachable',
        responseTimeMs: null,
        errorMessage:
          'Snowflake connector requires connection_config.host (the full account hostname, e.g. xy12345.us-east-1.snowflakecomputing.com)',
      };
    }

    const creds = await this.resolveSnowflakeCreds(connector);
    if (!creds) {
      return {
        status: 'credential_error',
        responseTimeMs: null,
        errorMessage:
          'Snowflake connector requires a credentialArn pointing at a secret with shape {"privateKeyPem":"...","user":"...","account":"..."}',
      };
    }

    let jwt: string;
    try {
      jwt = generateSnowflakeJwt(creds.privateKeyPem, creds.account, creds.user);
    } catch (err) {
      return {
        status: 'credential_error',
        responseTimeMs: null,
        errorMessage: `Failed to generate Snowflake JWT from private key: ${(err as Error).message}`,
      };
    }

    const warehouse = String(connector.connectionConfig.warehouse ?? 'COMPUTE_WH');
    const role = String(connector.connectionConfig.role ?? 'ACCOUNTADMIN');

    const body: Record<string, unknown> = {
      statement: 'SELECT 1',
      timeout: 60,
      warehouse,
      role,
    };
    if (connector.connectionConfig.database) {
      body.database = String(connector.connectionConfig.database);
    }
    if (connector.connectionConfig.schema) {
      body.schema = String(connector.connectionConfig.schema);
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://${host}/api/v2/statements`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseTimeMs = Date.now() - start;

      if (response.ok) {
        // Parse the body and run the sqlState check as a defensive layer.
        // In practice, Snowflake returns SQL errors as HTTP 422 (non-2xx),
        // but we check here too so a hypothetical 200-with-error body
        // (e.g. async statement pending with an error sqlState) is not
        // silently reported as healthy.
        const parsed = await safeReadJson(response);
        const sqlError = extractSnowflakeSqlError(parsed);
        if (sqlError) {
          return {
            status: classifySnowflakeError(sqlError),
            responseTimeMs: null,
            errorMessage: `Snowflake SQL error: ${sqlError}`,
          };
        }
        return { status: 'healthy', responseTimeMs, errorMessage: null };
      }

      const bodySnippet = await safeReadSnippet(response);
      return {
        status: classifySnowflakeHttpStatus(response.status),
        responseTimeMs: null,
        errorMessage: `Snowflake returned HTTP ${response.status}${bodySnippet ? `: ${bodySnippet}` : ''}`,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        return {
          status: 'timeout',
          responseTimeMs: null,
          errorMessage: 'Snowflake probe timed out after 5s',
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

  /**
   * Schema inference for a Snowflake table via INFORMATION_SCHEMA.COLUMNS.
   *
   * sourceRef must be a three-part name: database.schema.table. Two-part
   * (schema.table without database) is not accepted — Snowflake tables are
   * always three-part, and defaulting the database would silently hide a
   * misconfigured source registration.
   *
   * Snowflake stores unquoted identifiers uppercased; the UPPER() calls in
   * the WHERE clause ensure the query matches regardless of the casing the
   * operator registered.
   *
   * As a bonus over Databricks, INFORMATION_SCHEMA.TABLES exposes ROW_COUNT
   * cheaply — the second query populates rowEstimate without a costly COUNT(*).
   */
  private async inferSchemaSnowflake(
    connector: ConnectorEntity,
    source: SourceRegistrationEntity,
  ): Promise<SchemaInferenceResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error(
        'Snowflake connector requires connection_config.host (the full account hostname)',
      );
    }

    const creds = await this.resolveSnowflakeCreds(connector);
    if (!creds) {
      throw new Error(
        'Snowflake connector requires a credentialArn pointing at a secret with shape {"privateKeyPem":"...","user":"...","account":"..."}',
      );
    }

    let jwt: string;
    try {
      jwt = generateSnowflakeJwt(creds.privateKeyPem, creds.account, creds.user);
    } catch (err) {
      throw new Error(
        `Failed to generate Snowflake JWT from private key: ${(err as Error).message}`,
      );
    }

    const parts = source.sourceRef.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      throw new Error(
        `Snowflake sourceRef must be a three-part name (database.schema.table); got "${source.sourceRef}"`,
      );
    }
    const [database, schema, table] = parts;

    const warehouse = String(connector.connectionConfig.warehouse ?? 'COMPUTE_WH');
    const role = String(connector.connectionConfig.role ?? 'ACCOUNTADMIN');
    const opts = { warehouse, role, database };

    // Query 1: column metadata from INFORMATION_SCHEMA.COLUMNS.
    // UPPER() on the comparison values because Snowflake stores unquoted
    // identifiers as uppercase.
    const columnsSql = `SELECT column_name, data_type, is_nullable, comment, ordinal_position FROM ${database}.INFORMATION_SCHEMA.COLUMNS WHERE table_schema = UPPER('${schema.replace(/'/g, "''")}') AND table_name = UPPER('${table.replace(/'/g, "''")}') ORDER BY ordinal_position`;

    const colResult = await submitSnowflakeStatement(host, jwt, columnsSql, opts);
    const colRows = parseSnowflakeRows(colResult);

    const columns = colRows.map((row) => ({
      name: String(row[0] ?? ''),
      type: String(row[1] ?? 'unknown'),
      nullable: String(row[2] ?? 'YES') === 'YES',
      comment: row[3] !== null && row[3] !== undefined ? String(row[3]) : null,
      position: row[4] !== null && row[4] !== undefined ? parseInt(String(row[4]), 10) : null,
    }));

    // Query 2: table metadata from INFORMATION_SCHEMA.TABLES (ROW_COUNT + TABLE_TYPE + comment).
    // This is cheap — Snowflake pre-computes ROW_COUNT; no COUNT(*) needed.
    let tableType: string | null = null;
    let tableComment: string | null = null;
    let rowEstimate: number | null = null;
    try {
      const tablesSql = `SELECT table_type, comment, row_count FROM ${database}.INFORMATION_SCHEMA.TABLES WHERE table_schema = UPPER('${schema.replace(/'/g, "''")}') AND table_name = UPPER('${table.replace(/'/g, "''")}')`;
      const tblResult = await submitSnowflakeStatement(host, jwt, tablesSql, opts);
      const tblRows = parseSnowflakeRows(tblResult);
      if (tblRows.length > 0) {
        tableType = tblRows[0][0] !== null ? String(tblRows[0][0]) : null;
        tableComment = tblRows[0][1] !== null ? String(tblRows[0][1]) : null;
        const rawCount = tblRows[0][2];
        if (rawCount !== null && rawCount !== undefined && rawCount !== '') {
          const n = parseInt(String(rawCount), 10);
          if (!isNaN(n)) rowEstimate = n;
        }
      }
    } catch {
      // Table metadata query is best-effort; column metadata is the primary result.
      // Failure here does not fail the overall inference.
    }

    return {
      schemaDefinition: {
        columns,
        tableType,
        comment: tableComment,
      },
      columnCount: columns.length,
      rowEstimate,
    };
  }

  private async resolveSnowflakeCreds(
    connector: ConnectorEntity,
  ): Promise<{ privateKeyPem: string; user: string; account: string } | null> {
    if (!connector.credentialArn) return null;
    try {
      const creds = await this.secretsManager.getSecretValue(connector.credentialArn);
      if (
        typeof creds.privateKeyPem === 'string' && creds.privateKeyPem.length > 0 &&
        typeof creds.user === 'string' && creds.user.length > 0 &&
        typeof creds.account === 'string' && creds.account.length > 0
      ) {
        return {
          privateKeyPem: creds.privateKeyPem,
          user: creds.user,
          account: creds.account,
        };
      }
    } catch {
      return null;
    }
    return null;
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

  /**
   * Walks Snowflake's ACCOUNT_USAGE.OBJECT_DEPENDENCIES view and returns
   * system-discovered static lineage edges for the supplied set of table
   * full names.
   *
   * **OBJECT_DEPENDENCIES only (Layer 4a).** ACCESS_HISTORY query-derived
   * lineage is deliberately deferred to a later "Layer 4b" PR because:
   *   1. It requires Snowflake Enterprise tier — not available on trial/standard.
   *   2. Query history has an inherent ~3h processing lag before rows appear.
   *   3. Writing a reliable test needs live read→write test data against an
   *      Enterprise account.
   * TODO(layer4b): implement ACCESS_HISTORY-based lineage in a follow-up PR
   * (snowflake capability manifest 1.2.0) once an Enterprise account is available
   * for live verification.
   *
   * Design decisions:
   * - **One SELECT, not N.** Derives the database set from `tableFullNames` and
   *   issues a single `WHERE REFERENCING_DATABASE IN (...) OR
   *   REFERENCED_DATABASE IN (...)` query — deterministic, cheap.
   * - **Edge direction.** REFERENCED_* is the upstream/source; REFERENCING_* is
   *   the downstream/target. Edge = `sourceFullName=REFERENCED_*` →
   *   `targetFullName=REFERENCING_*` (same DERIVES_FROM direction as Databricks).
   * - **Cross-db edges are kept.** If the REFERENCING (target) object is within
   *   the discovered scope and the REFERENCED (source) is from another non-system
   *   database, the edge is still emitted — cross-db lineage is real and useful.
   * - **System filtering.** Edges involving INFORMATION_SCHEMA schema or a system
   *   database (SNOWFLAKE, SNOWFLAKE_SAMPLE_DATA, USER$*) on either endpoint are
   *   silently dropped.
   * - **Graceful degradation.** If ACCOUNT_USAGE access is denied (needs
   *   ACCOUNTADMIN or IMPORTED PRIVILEGES), the query will throw; we catch that,
   *   return `{ edges: [], tablesWithErrors: ['<OBJECT_DEPENDENCIES_QUERY_FAILED>'] }`,
   *   and do NOT re-throw — the crawl completes with zero lineage rather than
   *   failing entirely. "No lineage available" is a normal operating condition.
   * - **Requires ACCOUNTADMIN.** Confirmed working against a real trial account.
   *   SNOWFLAKE.ACCOUNT_USAGE requires ACCOUNTADMIN or IMPORTED PRIVILEGES on the
   *   SNOWFLAKE database.
   */
  async walkSnowflakeLineage(
    connector: ConnectorEntity,
    tableFullNames: string[],
  ): Promise<{ edges: DiscoveredLineageEdge[]; tablesWithErrors: string[] }> {
    // Short-circuit: no tables → no databases → skip the query.
    if (tableFullNames.length === 0) {
      return { edges: [], tablesWithErrors: [] };
    }

    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error(
        'Snowflake connector requires connection_config.host (the full account hostname)',
      );
    }

    const creds = await this.resolveSnowflakeCreds(connector);
    if (!creds) {
      throw new Error(
        'Snowflake connector requires a credentialArn pointing at a secret with shape {"privateKeyPem":"...","user":"...","account":"..."}',
      );
    }

    const jwt = generateSnowflakeJwt(creds.privateKeyPem, creds.account, creds.user);
    const warehouse = String(connector.connectionConfig.warehouse ?? 'COMPUTE_WH');
    const role = String(connector.connectionConfig.role ?? 'ACCOUNTADMIN');
    const opts = { warehouse, role };

    // ── System-database / system-schema predicates ──────────────────────────
    // Reuse the same skip logic as walkSnowflakeAccount: SNOWFLAKE,
    // SNOWFLAKE_SAMPLE_DATA, and USER$<login> on the database side; always
    // skip INFORMATION_SCHEMA on the schema side.
    const SYSTEM_DATABASES = new Set(['SNOWFLAKE', 'SNOWFLAKE_SAMPLE_DATA']);
    const isSystemDatabase = (name: string): boolean => {
      const upper = name.toUpperCase();
      return SYSTEM_DATABASES.has(upper) || upper.startsWith('USER$');
    };
    const isSystemSchema = (schema: string): boolean =>
      schema.toUpperCase() === 'INFORMATION_SCHEMA';

    const shouldSkipEndpoint = (db: string, schema: string): boolean =>
      isSystemDatabase(db) || isSystemSchema(schema);

    // ── Derive unique database set from tableFullNames ───────────────────────
    // Format: "DATABASE.SCHEMA.NAME" — extract first segment.
    const databaseSet = new Set<string>();
    for (const fullName of tableFullNames) {
      const db = fullName.split('.')[0];
      if (db && !isSystemDatabase(db)) {
        databaseSet.add(db.toUpperCase());
      }
    }

    if (databaseSet.size === 0) {
      // All provided names were from system databases — nothing to query.
      return { edges: [], tablesWithErrors: [] };
    }

    // ── Build the IN-list SQL safely using string literals ───────────────────
    // Snowflake SQL REST API uses string substitution in the statement body,
    // not parameterized queries in the JDBC sense. Database names from our
    // own walkSnowflakeAccount output are already uppercase Snowflake identifiers
    // — safe to embed as quoted literals. We still escape single quotes
    // defensively (should never be present in a valid Snowflake db name).
    const dbInList = Array.from(databaseSet)
      .map((db) => `'${db.replace(/'/g, "''")}'`)
      .join(', ');

    const sql = [
      'SELECT',
      '  REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME, REFERENCED_OBJECT_DOMAIN,',
      '  REFERENCING_DATABASE, REFERENCING_SCHEMA, REFERENCING_OBJECT_NAME, REFERENCING_OBJECT_DOMAIN,',
      '  DEPENDENCY_TYPE',
      'FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES',
      `WHERE REFERENCING_DATABASE IN (${dbInList})`,
      `   OR REFERENCED_DATABASE IN (${dbInList})`,
    ].join(' ');

    try {
      const result = await submitSnowflakeStatement(host, jwt, sql, opts);

      // Use sfShowRowsToObjects to resolve columns by name — robust against
      // Snowflake adding columns or changing column order in future.
      const rows = sfShowRowsToObjects(result);

      const seen = new Set<string>();
      const edges: DiscoveredLineageEdge[] = [];

      for (const row of rows) {
        const refDb = String(row['REFERENCED_DATABASE'] ?? '');
        const refSchema = String(row['REFERENCED_SCHEMA'] ?? '');
        const refName = String(row['REFERENCED_OBJECT_NAME'] ?? '');
        const ingDb = String(row['REFERENCING_DATABASE'] ?? '');
        const ingSchema = String(row['REFERENCING_SCHEMA'] ?? '');
        const ingName = String(row['REFERENCING_OBJECT_NAME'] ?? '');

        // Skip any endpoint touching a system schema or system database.
        if (shouldSkipEndpoint(refDb, refSchema) || shouldSkipEndpoint(ingDb, ingSchema)) {
          continue;
        }

        // Skip rows with empty identifiers (defensive; should not occur).
        if (!refDb || !refSchema || !refName || !ingDb || !ingSchema || !ingName) {
          continue;
        }

        const sourceFullName = `${refDb}.${refSchema}.${refName}`;
        const targetFullName = `${ingDb}.${ingSchema}.${ingName}`;

        // Deduplicate: OBJECT_DEPENDENCIES can theoretically return the same
        // dependency row from multiple angles.
        const key = `${sourceFullName}\x1f${targetFullName}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ sourceFullName, targetFullName });
        }
      }

      return { edges, tablesWithErrors: [] };
    } catch {
      // Graceful degradation: ACCOUNT_USAGE access denied, network error,
      // SQL error — any throw means we return empty lineage rather than
      // failing the entire crawl. The orchestration layer records the marker
      // in tablesWithErrors and sets status=partial on the crawl event.
      return {
        edges: [],
        tablesWithErrors: ['OBJECT_DEPENDENCIES_QUERY_FAILED'],
      };
    }
  }

  /**
   * Walks a Snowflake account via the SQL REST API (SHOW DATABASES / SHOW TABLES
   * / SHOW VIEWS) and returns every table + view the connector's principal can see.
   * Used by ConnectorsService's discovery crawl to pre-populate source registrations.
   *
   * - `databaseScope` (optional) limits the walk to a named subset of databases.
   *   When absent or empty, walks every database the principal can list.
   * - System / sample databases SNOWFLAKE and SNOWFLAKE_SAMPLE_DATA are always
   *   skipped (case-insensitive) — they are Snowflake-managed and not user data.
   * - INFORMATION_SCHEMA is skipped per-database — metadata-about-metadata, not
   *   user-facing tables.
   * - Column names are resolved from `resultSetMetaData.rowType` by name (NOT by
   *   fixed index) because SHOW TABLES and SHOW VIEWS have different column orders
   *   and Snowflake adds columns over time. Use `sfShowRowsToObjects` helper.
   * - Pagination: SHOW commands return up to ~10k rows by default. For the first
   *   cut, no cursor pagination is implemented — a TODO is noted.
   *   TODO: implement `LIMIT ... FROM '<last>'` cursor pagination for accounts
   *   with >10k tables or views in a single database.
   * - Network errors and HTTP / SQL failures bubble; the orchestration layer in
   *   ConnectorsService records them on the discovery_crawl_events row.
   */
  async walkSnowflakeAccount(
    connector: ConnectorEntity,
    databaseScope?: string[],
  ): Promise<WorkspaceWalkResult> {
    const host = String(connector.connectionConfig.host ?? '').replace(/\/+$/, '');
    if (!host) {
      throw new Error(
        'Snowflake connector requires connection_config.host (the full account hostname)',
      );
    }

    const creds = await this.resolveSnowflakeCreds(connector);
    if (!creds) {
      throw new Error(
        'Snowflake connector requires a credentialArn pointing at a secret with shape {"privateKeyPem":"...","user":"...","account":"..."}',
      );
    }

    // Generate JWT once and reuse for all SHOW calls in this walk.
    const jwt = generateSnowflakeJwt(creds.privateKeyPem, creds.account, creds.user);

    const warehouse = String(connector.connectionConfig.warehouse ?? 'COMPUTE_WH');
    const role = String(connector.connectionConfig.role ?? 'ACCOUNTADMIN');
    const opts = { warehouse, role };

    // ── 1. Resolve the list of databases to walk ────────────────────────────
    // System / sample databases carry no user-owned data products. SNOWFLAKE
    // (ACCOUNT_USAGE / system) and SNOWFLAKE_SAMPLE_DATA (shared sample) are
    // named; USER$<login> are per-user scratch databases Snowflake surfaces in
    // SHOW DATABASES on some account types (seen live on the trial account) —
    // skip them by prefix.
    const SYSTEM_DATABASES = new Set(['SNOWFLAKE', 'SNOWFLAKE_SAMPLE_DATA']);
    const isSystemDatabase = (name: string): boolean => {
      const upper = name.toUpperCase();
      return SYSTEM_DATABASES.has(upper) || upper.startsWith('USER$');
    };

    let databases: string[];
    if (databaseScope && databaseScope.length > 0) {
      // Scope provided — use it directly, but still skip system databases.
      databases = databaseScope.filter((db) => !isSystemDatabase(db));
    } else {
      // No scope — list all databases the principal can see.
      const showDbResult = await submitSnowflakeStatement(
        host, jwt, 'SHOW DATABASES', opts,
      );
      const dbRows = sfShowRowsToObjects(showDbResult);
      databases = dbRows
        .map((row) => String(row['name'] ?? ''))
        .filter((name) => name.length > 0 && !isSystemDatabase(name));
    }

    // ── 2. Walk each database ───────────────────────────────────────────────
    const tables: DiscoveredTable[] = [];
    const seenSchemas = new Set<string>();

    for (const db of databases) {
      // SHOW TABLES IN DATABASE returns a flat list across all schemas.
      // Each row has name, database_name, schema_name, kind.
      const tableResult = await submitSnowflakeStatement(
        host, jwt, `SHOW TABLES IN DATABASE "${db}"`, opts,
      );
      const tableRows = sfShowRowsToObjects(tableResult);

      for (const row of tableRows) {
        const schemaName = String(row['schema_name'] ?? '');
        if (schemaName.toUpperCase() === 'INFORMATION_SCHEMA') continue;

        const name = String(row['name'] ?? '');
        const databaseName = String(row['database_name'] ?? db);
        if (!name) continue;

        seenSchemas.add(`${databaseName}.${schemaName}`);
        tables.push({
          catalog: databaseName,
          schema: schemaName,
          name,
          fullName: `${databaseName}.${schemaName}.${name}`,
        });
      }

      // SHOW VIEWS IN DATABASE — NOTE: different column ORDER than SHOW TABLES;
      // that's exactly why we resolve indices by column name, not hardcoded index.
      const viewResult = await submitSnowflakeStatement(
        host, jwt, `SHOW VIEWS IN DATABASE "${db}"`, opts,
      );
      const viewRows = sfShowRowsToObjects(viewResult);

      for (const row of viewRows) {
        const schemaName = String(row['schema_name'] ?? '');
        if (schemaName.toUpperCase() === 'INFORMATION_SCHEMA') continue;

        const name = String(row['name'] ?? '');
        const databaseName = String(row['database_name'] ?? db);
        if (!name) continue;

        seenSchemas.add(`${databaseName}.${schemaName}`);
        tables.push({
          catalog: databaseName,
          schema: schemaName,
          name,
          fullName: `${databaseName}.${schemaName}.${name}`,
        });
      }
    }

    return {
      catalogs: databases,
      schemasWalked: seenSchemas.size,
      tables,
    };
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
// Snowflake helpers
// ---------------------------------------------------------------------------

/**
 * Generates a Snowflake key-pair JWT for use with the SQL REST API.
 *
 * The JWT is signed with RS256. Claims follow Snowflake's key-pair auth spec:
 *   iss  = "<ACCOUNT>.<USER>.SHA256:<base64(sha256(DER-SPKI of public key))>"
 *   sub  = "<ACCOUNT>.<USER>"
 *   iat  = now (seconds)
 *   exp  = now + 3600 (1 hour)
 *
 * Both ACCOUNT and USER are uppercased per Snowflake's requirement.
 * The fingerprint uses the SHA-256 of the DER-encoded SubjectPublicKeyInfo
 * (SPKI) of the RSA public key derived from the supplied private key — this
 * is what Snowflake actually checks when validating the JWT.
 *
 * @param privateKeyPem  PEM-encoded PKCS#8 RSA private key (no passphrase).
 * @param account        Snowflake account identifier (e.g. "EN92180" or "xy12345.us-east-1").
 * @param user           Snowflake username (e.g. "PROVENANCE_SVC").
 * @returns              Signed JWT string.
 */
export function generateSnowflakeJwt(
  privateKeyPem: string,
  account: string,
  user: string,
): string {
  const accountUpper = account.toUpperCase();
  const userUpper = user.toUpperCase();

  // Load the private key object.
  const privateKeyObject = crypto.createPrivateKey(privateKeyPem);

  // Derive the public key and export as DER-encoded SPKI.
  const publicKeyObject = crypto.createPublicKey(privateKeyObject);
  const spkiDer = publicKeyObject.export({ type: 'spki', format: 'der' });

  // Compute SHA-256 fingerprint of the SPKI DER bytes, base64-encoded.
  const fp = 'SHA256:' + crypto.createHash('sha256').update(spkiDer).digest('base64');

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: `${accountUpper}.${userUpper}.${fp}`,
    sub: `${accountUpper}.${userUpper}`,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const b64Header = toBase64Url(Buffer.from(JSON.stringify(header)));
  const b64Payload = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${b64Header}.${b64Payload}`;

  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(signingInput),
    privateKeyObject,
  );

  return `${signingInput}.${toBase64Url(signature)}`;
}

/**
 * Submits a SQL statement to the Snowflake SQL REST API and returns the
 * parsed response body.
 *
 * POST https://<host>/api/v2/statements
 * Auth: Bearer <jwt>, X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT
 *
 * Throws on non-2xx responses (Snowflake returns SQL errors as HTTP 422) or
 * if a 200 response body carries a non-"00000" sqlState (defensive check).
 * The caller is responsible for parsing `data` rows from the result.
 */
export async function submitSnowflakeStatement(
  host: string,
  jwt: string,
  sql: string,
  opts: { warehouse: string; role: string; database?: string; schema?: string },
): Promise<SnowflakeStatementResult> {
  const body: Record<string, unknown> = {
    statement: sql,
    timeout: 60,
    warehouse: opts.warehouse,
    role: opts.role,
  };
  if (opts.database) body.database = opts.database;
  if (opts.schema) body.schema = opts.schema;

  const response = await fetch(`https://${host}/api/v2/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const parsed = await safeReadJson(response);

  if (!response.ok) {
    const msg = extractSnowflakeSqlError(parsed) ?? `HTTP ${response.status}`;
    throw new Error(`Snowflake statement failed: ${msg}`);
  }

  const sqlError = extractSnowflakeSqlError(parsed);
  if (sqlError) {
    throw new Error(`Snowflake SQL error: ${sqlError}`);
  }

  return parsed as SnowflakeStatementResult;
}

/**
 * Extracts the row array from a Snowflake SQL REST API response.
 * Each element of the outer array is an array of strings (one per column,
 * in the order defined by `resultSetMetaData.rowType`).
 */
export function parseSnowflakeRows(result: SnowflakeStatementResult): Array<Array<string | null>> {
  return Array.isArray(result?.data) ? result.data : [];
}

/**
 * Converts a Snowflake SHOW command result into an array of plain objects
 * keyed by column name.
 *
 * SHOW commands (DATABASES, TABLES, VIEWS, …) return rows whose column order
 * is not guaranteed to be stable across Snowflake versions — and SHOW TABLES
 * and SHOW VIEWS actually have different column orders today. Using fixed
 * numeric indices would produce silently wrong data when Snowflake adds a
 * column or reorders them. This helper resolves each value by looking up the
 * column name in `resultSetMetaData.rowType`, making the caller
 * order-independent.
 *
 * @param result  Parsed Snowflake SQL REST API response.
 * @returns       Array of `{ columnName: value }` objects — one per row.
 */
export function sfShowRowsToObjects(
  result: SnowflakeStatementResult,
): Array<Record<string, string | null>> {
  const rowType = result?.resultSetMetaData?.rowType ?? [];
  const columnNames = rowType.map((col) => col.name);
  const rows = parseSnowflakeRows(result);
  return rows.map((row) => {
    const obj: Record<string, string | null> = {};
    for (let i = 0; i < columnNames.length; i++) {
      obj[columnNames[i]] = row[i] ?? null;
    }
    return obj;
  });
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Extracts a SQL error string from a Snowflake SQL REST API response body.
 *
 * Detection is based exclusively on `sqlState` — the SQL-standard completion
 * code — NOT on Snowflake's proprietary `code` field. This matters because:
 *   - A successful Snowflake response carries `code: "090001"` (success
 *     statement code) and `sqlState: "00000"`. Using `code` for error
 *     detection would false-positive on every successful query.
 *   - SQL errors (HTTP 422 in practice) carry `sqlState` values like "42S02"
 *     (object not found), "57014" (query cancelled), "08001" (auth failure),
 *     etc.
 *   - `sqlState === "00000"` (or absent/empty) is SQL-standard successful
 *     completion — never an error.
 *
 * The function is intentionally null-safe: a non-object body (e.g. an HTML
 * 404 page) returns null, letting the caller fall back to HTTP-status
 * classification.
 */
function extractSnowflakeSqlError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const sqlState = typeof b.sqlState === 'string' ? b.sqlState : '';
  // sqlState absent or "00000" → successful completion, not an error.
  if (!sqlState || sqlState === '00000') return null;
  // Any other sqlState → SQL-level error. Prefer the human-readable message;
  // prefix with the Snowflake code when present so operators can look it up.
  const code = typeof b.code === 'string' && b.code.length > 0 ? b.code : null;
  const message = typeof b.message === 'string' ? b.message : `sqlState ${sqlState}`;
  return code ? `[${code}] ${message}` : message;
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

interface SnowflakeStatementResult {
  resultSetMetaData?: {
    rowType?: Array<{ name: string; type: string }>;
    numRows?: number;
  };
  data?: Array<Array<string | null>>;
  code?: string;
  message?: string;
  sqlState?: string;
  status?: string;
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

function classifySnowflakeHttpStatus(status: number): HealthStatus {
  if (status === 401 || status === 403) return 'credential_error';
  if (status === 408 || status === 504) return 'timeout';
  return 'unreachable';
}

/**
 * Classifies a SQL-level error message extracted from a Snowflake response.
 * In practice these arrive as HTTP 422, but the classification logic is the
 * same regardless of transport status. Most SQL errors indicate a
 * reachable-but-misconfigured state (suspended warehouse, wrong role,
 * object not found) → unreachable. JWT/auth errors at the SQL layer →
 * credential_error.
 */
function classifySnowflakeError(message: string): HealthStatus {
  if (/jwt|token|authentication|invalid credentials/i.test(message)) {
    return 'credential_error';
  }
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
