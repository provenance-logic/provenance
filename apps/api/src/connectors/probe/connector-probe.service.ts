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

@Injectable()
export class ConnectorProbeService {
  constructor(private readonly secretsManager: SecretsManagerService) {}

  /**
   * Runs a live connectivity check for the connector.
   * Phase 2 supports postgresql and s3. Other types return a synthetic healthy
   * result so the connector can be registered without a live probe.
   */
  async probe(connector: ConnectorEntity): Promise<ProbeResult> {
    switch (connector.connectorType) {
      case 'postgresql':
        return this.probePostgres(connector);
      case 's3':
        return this.probeS3(connector);
      default:
        // Unsupported in Phase 2 — skip live probe, leave status as pending.
        return { status: 'healthy', responseTimeMs: null, errorMessage: null };
    }
  }

  /**
   * Connects to the external system and infers the source schema.
   * Phase 2: PostgreSQL (column introspection via information_schema) and S3 (object listing).
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
      default:
        return { schemaDefinition: {}, columnCount: null, rowEstimate: null };
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
