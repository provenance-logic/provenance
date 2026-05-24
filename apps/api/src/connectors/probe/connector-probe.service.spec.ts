import * as crypto from 'crypto';
import { ConnectorProbeService, generateSnowflakeJwt, submitSnowflakeStatement, parseSnowflakeRows } from './connector-probe.service.js';
import { SecretsManagerService } from './secrets-manager.service.js';
import type { ConnectorEntity } from '../entities/connector.entity.js';
import type { SourceRegistrationEntity } from '../entities/source-registration.entity.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_URL = 'https://dbc-test.cloud.databricks.com';
const VALID_PAT = 'dapi-test-token';
const TEST_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-databricks-AbCdEf';

function makeDatabricksConnector(
  overrides: Partial<ConnectorEntity> = {},
): ConnectorEntity {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    orgId: '00000000-0000-0000-0000-000000000099',
    domainId: '00000000-0000-0000-0000-0000000000aa',
    name: 'test-databricks',
    description: null,
    connectorType: 'databricks',
    connectionConfig: { host: WORKSPACE_URL },
    credentialArn: TEST_ARN,
    healthStatus: 'pending',
    lastValidatedAt: null,
    createdByPrincipalId: '00000000-0000-0000-0000-0000000000bb',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ConnectorEntity;
}

function mockSecretsManager(): jest.Mocked<SecretsManagerService> {
  return {
    getSecretValue: jest.fn(),
  } as unknown as jest.Mocked<SecretsManagerService>;
}

function makeDatabricksSource(
  sourceRef = 'workspace.mro.mro_work_enriched',
): SourceRegistrationEntity {
  return {
    id: '00000000-0000-0000-0000-00000000c001',
    orgId: '00000000-0000-0000-0000-000000000099',
    connectorId: '00000000-0000-0000-0000-000000000001',
    sourceType: 'table',
    sourceRef,
    displayName: sourceRef,
    description: null,
    registeredBy: '00000000-0000-0000-0000-0000000000bb',
    registeredAt: new Date(),
    updatedAt: new Date(),
  } as SourceRegistrationEntity;
}

// Minimal Unity Catalog table response — fields the introspection cares about.
function ucTableResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'mro_work_enriched',
    catalog_name: 'workspace',
    schema_name: 'mro',
    table_type: 'MANAGED',
    data_source_format: 'DELTA',
    comment: 'Enriched MRO work table',
    columns: [
      {
        name: 'ship_id',
        type_text: 'string',
        type_name: 'STRING',
        position: 0,
        nullable: false,
        comment: 'Hull number identifier',
      },
      {
        name: 'work_order_id',
        type_text: 'bigint',
        type_name: 'LONG',
        position: 1,
        nullable: true,
        comment: null,
      },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectorProbeService.probeDatabricks (B-063 Layer 1)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = mockSecretsManager();
    // Default: every test gets a working credential resolution. Tests that
    // want to exercise missing/broken credentials override this explicitly.
    secretsManager.getSecretValue.mockResolvedValue({ token: VALID_PAT });
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ---------- happy path ----------

  it('returns healthy with responseTimeMs when SCIM /Me returns 200', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: '1', userName: 'test@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('healthy');
    expect(result.responseTimeMs).not.toBeNull();
    expect(result.responseTimeMs!).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeNull();
  });

  it('hits the SCIM /Me endpoint with bearer auth on the configured host', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));

    await service.probe(makeDatabricksConnector());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORKSPACE_URL}/api/2.0/preview/scim/v2/Me`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${VALID_PAT}`,
    );
  });

  it('strips trailing slashes from the host URL', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));

    await service.probe(
      makeDatabricksConnector({
        connectionConfig: { host: `${WORKSPACE_URL}/`, token: VALID_PAT },
      }),
    );

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe(`${WORKSPACE_URL}/api/2.0/preview/scim/v2/Me`);
  });

  // ---------- HTTP error classification ----------

  it('classifies 401 as credential_error', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"error":"invalid token"}', { status: 401 }),
    );

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('401');
  });

  it('classifies 403 as credential_error', async () => {
    fetchSpy.mockResolvedValue(new Response('forbidden', { status: 403 }));

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('403');
  });

  it('classifies 504 gateway timeout as timeout', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 504 }));

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('timeout');
  });

  it('classifies arbitrary 5xx as unreachable', async () => {
    fetchSpy.mockResolvedValue(new Response('server error', { status: 500 }));

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('500');
  });

  // ---------- network / timeout ----------

  it('classifies a thrown network error as unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND dbc-test.cloud.databricks.com'));

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('ENOTFOUND');
  });

  it('classifies an AbortError (5s timeout) as timeout', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchSpy.mockRejectedValue(abortErr);

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('5s');
  });

  // ---------- config validation ----------

  it('returns unreachable with a clear message when host is missing', async () => {
    const result = await service.probe(
      makeDatabricksConnector({ connectionConfig: { token: VALID_PAT } }),
    );

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('connection_config.host');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when credentialArn is not set', async () => {
    const result = await service.probe(
      makeDatabricksConnector({ credentialArn: null }),
    );

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('credentialArn');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- credential resolution ----------

  it('fetches the bearer token from Secrets Manager via credentialArn', async () => {
    secretsManager.getSecretValue.mockResolvedValue({ token: 'dapi-from-secrets-manager' });
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));

    await service.probe(makeDatabricksConnector());

    expect(secretsManager.getSecretValue).toHaveBeenCalledWith(TEST_ARN);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer dapi-from-secrets-manager',
    );
  });

  it('returns credential_error when Secrets Manager resolution throws', async () => {
    secretsManager.getSecretValue.mockRejectedValue(
      new Error('Local-dev secret not set'),
    );

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('credential_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when the resolved secret lacks a token field', async () => {
    secretsManager.getSecretValue.mockResolvedValue({ otherField: 'value' });

    const result = await service.probe(makeDatabricksConnector());

    expect(result.status).toBe('credential_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- exhaustiveness — values outside the enum throw ----------

  it('throws rather than synthesizing healthy for a connector type outside the enum', async () => {
    // 'bigquery' was retired by V32 and never returned — use it as the
    // "stale value outside the enum" sentinel. ('snowflake' is now a valid
    // type with a real implementation after V37.)
    await expect(
      service.probe(
        makeDatabricksConnector({
          connectorType: 'bigquery' as unknown as 'databricks',
          connectionConfig: {},
        }),
      ),
    ).rejects.toThrow(/Unhandled connector type: bigquery/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Schema inference (Layer 2) — Unity Catalog REST
// ---------------------------------------------------------------------------

describe('ConnectorProbeService.introspectDatabricks (B-063 Layer 2)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = mockSecretsManager();
    secretsManager.getSecretValue.mockResolvedValue({ token: VALID_PAT });
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ---------- happy path ----------

  it('returns column-level schema from Unity Catalog', async () => {
    fetchSpy.mockResolvedValue(new Response(ucTableResponse(), { status: 200 }));

    const result = await service.inferSchema(
      makeDatabricksConnector(),
      makeDatabricksSource(),
    );

    expect(result.columnCount).toBe(2);
    const def = result.schemaDefinition as {
      columns: Array<{
        name: string;
        type: string;
        nullable: boolean;
        position: number | null;
        comment: string | null;
      }>;
      tableType: string;
      dataSourceFormat: string;
      comment: string;
    };
    expect(def.tableType).toBe('MANAGED');
    expect(def.dataSourceFormat).toBe('DELTA');
    expect(def.comment).toBe('Enriched MRO work table');
    expect(def.columns).toEqual([
      {
        name: 'ship_id',
        type: 'string',
        nullable: false,
        position: 0,
        comment: 'Hull number identifier',
      },
      {
        name: 'work_order_id',
        type: 'bigint',
        nullable: true,
        position: 1,
        comment: null,
      },
    ]);
    expect(result.rowEstimate).toBeNull();
  });

  it('hits the Unity Catalog tables endpoint with the three-part name', async () => {
    fetchSpy.mockResolvedValue(new Response(ucTableResponse(), { status: 200 }));

    await service.inferSchema(
      makeDatabricksConnector(),
      makeDatabricksSource('workspace.mro.mro_work_enriched'),
    );

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${WORKSPACE_URL}/api/2.1/unity-catalog/tables/workspace.mro.mro_work_enriched`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${VALID_PAT}`,
    );
  });

  it('sorts columns by position', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        ucTableResponse({
          columns: [
            { name: 'c', type_text: 'string', position: 2 },
            { name: 'a', type_text: 'string', position: 0 },
            { name: 'b', type_text: 'string', position: 1 },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await service.inferSchema(
      makeDatabricksConnector(),
      makeDatabricksSource(),
    );

    const def = result.schemaDefinition as { columns: Array<{ name: string }> };
    expect(def.columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to type_name when type_text is absent', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        ucTableResponse({
          columns: [{ name: 'x', type_name: 'INT', position: 0, nullable: true }],
        }),
        { status: 200 },
      ),
    );

    const result = await service.inferSchema(
      makeDatabricksConnector(),
      makeDatabricksSource(),
    );

    const def = result.schemaDefinition as { columns: Array<{ type: string }> };
    expect(def.columns[0].type).toBe('INT');
  });

  it('handles tables with zero columns gracefully', async () => {
    fetchSpy.mockResolvedValue(
      new Response(ucTableResponse({ columns: [] }), { status: 200 }),
    );

    const result = await service.inferSchema(
      makeDatabricksConnector(),
      makeDatabricksSource(),
    );

    expect(result.columnCount).toBe(0);
    expect(
      (result.schemaDefinition as { columns: unknown[] }).columns,
    ).toEqual([]);
  });

  // ---------- source-ref validation ----------

  it('rejects a two-part source ref (no catalog prefix)', async () => {
    await expect(
      service.inferSchema(
        makeDatabricksConnector(),
        makeDatabricksSource('mro.mro_work_enriched'),
      ),
    ).rejects.toThrow(/three-part name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a one-part source ref', async () => {
    await expect(
      service.inferSchema(
        makeDatabricksConnector(),
        makeDatabricksSource('mro_work_enriched'),
      ),
    ).rejects.toThrow(/three-part name/);
  });

  it('rejects a source ref with empty segments', async () => {
    await expect(
      service.inferSchema(
        makeDatabricksConnector(),
        makeDatabricksSource('workspace..mro_work_enriched'),
      ),
    ).rejects.toThrow(/three-part name/);
  });

  // ---------- HTTP error surface ----------

  it('throws a clean error when the table is not found (404)', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        '{"error_code":"TABLE_DOES_NOT_EXIST","message":"Table not found"}',
        { status: 404 },
      ),
    );

    await expect(
      service.inferSchema(makeDatabricksConnector(), makeDatabricksSource()),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('throws on 401 (credential failure during introspect)', async () => {
    fetchSpy.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(
      service.inferSchema(makeDatabricksConnector(), makeDatabricksSource()),
    ).rejects.toThrow(/HTTP 401/);
  });

  // ---------- config validation ----------

  it('throws a clear error when host is missing', async () => {
    await expect(
      service.inferSchema(
        makeDatabricksConnector({ connectionConfig: {} }),
        makeDatabricksSource(),
      ),
    ).rejects.toThrow(/connection_config\.host/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws a clear error when credentialArn is missing', async () => {
    await expect(
      service.inferSchema(
        makeDatabricksConnector({ credentialArn: null }),
        makeDatabricksSource(),
      ),
    ).rejects.toThrow(/credentialArn/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Workspace walk (Layer 3a) — Unity Catalog catalog/schema/table enumeration
// ---------------------------------------------------------------------------

describe('ConnectorProbeService.walkDatabricksWorkspace (B-063 Layer 3a)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = mockSecretsManager();
    secretsManager.getSecretValue.mockResolvedValue({ token: VALID_PAT });
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // Helpers to script multi-call sequences. The walker fans out across
  // catalogs/schemas/tables, so tests need ordered fetch responses.

  function queueResponses(...responses: Array<{ status?: number; body: unknown }>) {
    for (const r of responses) {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(r.body), { status: r.status ?? 200 }),
      );
    }
  }

  // ---------- happy path ----------

  it('walks scoped catalogs, schemas, and tables and returns the discovered set', async () => {
    // Scope to one catalog ("workspace") → no /catalogs call, jump to schemas.
    queueResponses(
      { body: { schemas: [{ name: 'bronze' }, { name: 'silver' }, { name: 'information_schema' }] } },
      { body: { tables: [{ name: 'mro_raw' }] } }, // bronze
      { body: { tables: [{ name: 'mro_clean' }, { name: 'mro_enriched' }] } }, // silver
    );

    const result = await service.walkDatabricksWorkspace(makeDatabricksConnector(), ['workspace']);

    expect(result.catalogs).toEqual(['workspace']);
    expect(result.schemasWalked).toBe(2); // information_schema skipped
    expect(result.tables).toEqual([
      { catalog: 'workspace', schema: 'bronze', name: 'mro_raw', fullName: 'workspace.bronze.mro_raw' },
      { catalog: 'workspace', schema: 'silver', name: 'mro_clean', fullName: 'workspace.silver.mro_clean' },
      { catalog: 'workspace', schema: 'silver', name: 'mro_enriched', fullName: 'workspace.silver.mro_enriched' },
    ]);
  });

  it('lists catalogs when no scope is provided', async () => {
    queueResponses(
      { body: { catalogs: [{ name: 'workspace' }, { name: 'samples' }] } },
      { body: { schemas: [{ name: 'bronze' }] } },
      { body: { tables: [{ name: 'mro_raw' }] } },
      { body: { schemas: [] } }, // samples has no schemas the principal can see
    );

    const result = await service.walkDatabricksWorkspace(makeDatabricksConnector());

    expect(result.catalogs).toEqual(['workspace', 'samples']);
    expect(result.tables.map((t) => t.fullName)).toEqual(['workspace.bronze.mro_raw']);
  });

  it('skips the information_schema schema entirely', async () => {
    queueResponses(
      { body: { schemas: [{ name: 'information_schema' }, { name: 'gold' }] } },
      { body: { tables: [{ name: 'fact_readiness' }] } },
    );

    const result = await service.walkDatabricksWorkspace(makeDatabricksConnector(), ['workspace']);

    expect(result.schemasWalked).toBe(1);
    expect(result.tables.map((t) => t.fullName)).toEqual(['workspace.gold.fact_readiness']);
  });

  it('returns an empty result when a scoped catalog has zero schemas', async () => {
    queueResponses({ body: { schemas: [] } });

    const result = await service.walkDatabricksWorkspace(makeDatabricksConnector(), ['empty_catalog']);

    expect(result.catalogs).toEqual(['empty_catalog']);
    expect(result.schemasWalked).toBe(0);
    expect(result.tables).toEqual([]);
  });

  // ---------- pagination ----------

  it('follows next_page_token to aggregate paged table lists', async () => {
    queueResponses(
      { body: { schemas: [{ name: 'silver' }] } },
      {
        body: {
          tables: [{ name: 'a' }, { name: 'b' }],
          next_page_token: 'TOKEN_PAGE_2',
        },
      },
      { body: { tables: [{ name: 'c' }] } }, // no token = done
    );

    const result = await service.walkDatabricksWorkspace(makeDatabricksConnector(), ['workspace']);

    expect(result.tables.map((t) => t.name)).toEqual(['a', 'b', 'c']);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [page2Url] = fetchSpy.mock.calls[2] as [string];
    expect(page2Url).toContain('page_token=TOKEN_PAGE_2');
  });

  // ---------- failures bubble ----------

  it('throws when a Unity Catalog page returns non-OK', async () => {
    queueResponses(
      { body: { schemas: [{ name: 'silver' }] } },
      { status: 403, body: { error_code: 'PERMISSION_DENIED', message: 'no access' } },
    );

    await expect(
      service.walkDatabricksWorkspace(makeDatabricksConnector(), ['workspace']),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('rejects missing host / missing credentialArn up front', async () => {
    await expect(
      service.walkDatabricksWorkspace(
        makeDatabricksConnector({ connectionConfig: {} }),
      ),
    ).rejects.toThrow(/connection_config\.host/);

    await expect(
      service.walkDatabricksWorkspace(
        makeDatabricksConnector({ credentialArn: null }),
      ),
    ).rejects.toThrow(/credentialArn/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lineage walk (Layer 4) — Unity Catalog Lineage Tracking API
// ---------------------------------------------------------------------------

describe('ConnectorProbeService.walkDatabricksLineage (B-063 Layer 4)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = mockSecretsManager();
    secretsManager.getSecretValue.mockResolvedValue({ token: VALID_PAT });
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function lineageResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function tableInfo(catalog: string, schema: string, name: string) {
    return { tableInfo: { catalog_name: catalog, schema_name: schema, name } };
  }

  it('returns upstream + downstream edges as (source, target) pairs', async () => {
    fetchSpy.mockResolvedValueOnce(
      lineageResponse({
        upstreams: [tableInfo('workspace', 'bronze', 'mro_raw')],
        downstreams: [tableInfo('workspace', 'gold', 'mro_summary_by_ship')],
      }),
    );

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.silver.mro_clean',
    ]);

    expect(result.edges).toEqual([
      { sourceFullName: 'workspace.bronze.mro_raw', targetFullName: 'workspace.silver.mro_clean' },
      { sourceFullName: 'workspace.silver.mro_clean', targetFullName: 'workspace.gold.mro_summary_by_ship' },
    ]);
    expect(result.tablesWithErrors).toEqual([]);
  });

  it('deduplicates edges seen from both sides of the lineage relationship', async () => {
    // silver.mro_clean lists workspace.bronze.mro_raw as upstream
    fetchSpy.mockResolvedValueOnce(
      lineageResponse({ upstreams: [tableInfo('workspace', 'bronze', 'mro_raw')] }),
    );
    // bronze.mro_raw lists workspace.silver.mro_clean as downstream — same edge
    fetchSpy.mockResolvedValueOnce(
      lineageResponse({ downstreams: [tableInfo('workspace', 'silver', 'mro_clean')] }),
    );

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.silver.mro_clean',
      'workspace.bronze.mro_raw',
    ]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      sourceFullName: 'workspace.bronze.mro_raw',
      targetFullName: 'workspace.silver.mro_clean',
    });
  });

  it('treats a 404 (no lineage available for this table) as "no edges", not an error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 404 }));

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.bronze.freshly_created',
    ]);

    expect(result.edges).toEqual([]);
    expect(result.tablesWithErrors).toEqual([]);
  });

  it('records tables that returned 5xx in tablesWithErrors but continues the walk', async () => {
    fetchSpy
      .mockResolvedValueOnce(lineageResponse({}, 500))
      .mockResolvedValueOnce(
        lineageResponse({ upstreams: [tableInfo('workspace', 'bronze', 'mro_raw')] }),
      );

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.bronze.flaky_table',
      'workspace.silver.mro_clean',
    ]);

    expect(result.tablesWithErrors).toEqual(['workspace.bronze.flaky_table']);
    expect(result.edges).toEqual([
      { sourceFullName: 'workspace.bronze.mro_raw', targetFullName: 'workspace.silver.mro_clean' },
    ]);
  });

  it('records tables that threw a network error in tablesWithErrors', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.silver.mro_clean',
    ]);

    expect(result.tablesWithErrors).toEqual(['workspace.silver.mro_clean']);
    expect(result.edges).toEqual([]);
  });

  it('skips lineage entries missing any of catalog/schema/name', async () => {
    fetchSpy.mockResolvedValueOnce(
      lineageResponse({
        upstreams: [
          { tableInfo: { catalog_name: 'workspace', schema_name: 'bronze' /* name missing */ } },
          tableInfo('workspace', 'bronze', 'mro_raw'),
        ],
      }),
    );

    const result = await service.walkDatabricksLineage(makeDatabricksConnector(), [
      'workspace.silver.mro_clean',
    ]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceFullName).toBe('workspace.bronze.mro_raw');
  });

  it('rejects missing host / missing credentialArn up front', async () => {
    await expect(
      service.walkDatabricksLineage(
        makeDatabricksConnector({ connectionConfig: {} }),
        ['workspace.silver.x'],
      ),
    ).rejects.toThrow(/connection_config\.host/);

    await expect(
      service.walkDatabricksLineage(
        makeDatabricksConnector({ credentialArn: null }),
        ['workspace.silver.x'],
      ),
    ).rejects.toThrow(/credentialArn/);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Snowflake — JWT generation (Layer 1, key-pair auth)
// ---------------------------------------------------------------------------

describe('generateSnowflakeJwt (Snowflake Layer 1 — key-pair JWT)', () => {
  // Generate a fresh throwaway RSA-2048 key for every test group.
  // This ensures all fingerprint assertions are internally consistent —
  // we compute the expected fingerprint from the same key we generate,
  // never from a hardcoded value.
  let privateKeyPem: string;
  let spkiDer: Buffer;

  beforeAll(() => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  });

  function decodeJwtPart(b64url: string): unknown {
    // base64url → base64 → Buffer → JSON
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  }

  it('produces a three-part JWT (header.payload.signature)', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'EN92180', 'PROVENANCE_SVC');
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    // Each part must be non-empty base64url.
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('header declares alg=RS256 and typ=JWT', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'EN92180', 'PROVENANCE_SVC');
    const header = decodeJwtPart(jwt.split('.')[0]) as Record<string, unknown>;
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');
  });

  it('sub is <ACCOUNT>.<USER> uppercased', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'en92180', 'provenance_svc');
    const payload = decodeJwtPart(jwt.split('.')[1]) as Record<string, unknown>;
    expect(payload.sub).toBe('EN92180.PROVENANCE_SVC');
  });

  it('iss is <ACCOUNT>.<USER>.SHA256:<fingerprint> uppercased', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'en92180', 'provenance_svc');
    const payload = decodeJwtPart(jwt.split('.')[1]) as Record<string, unknown>;
    const expectedFp =
      'SHA256:' + crypto.createHash('sha256').update(spkiDer).digest('base64');
    expect(payload.iss).toBe(`EN92180.PROVENANCE_SVC.${expectedFp}`);
  });

  it('exp - iat === 3600 (1 hour token lifetime)', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'EN92180', 'PROVENANCE_SVC');
    const payload = decodeJwtPart(jwt.split('.')[1]) as Record<string, string | number>;
    expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);
  });

  it('iat is close to now (within 5 seconds)', () => {
    const before = Math.floor(Date.now() / 1000);
    const jwt = generateSnowflakeJwt(privateKeyPem, 'EN92180', 'PROVENANCE_SVC');
    const after = Math.floor(Date.now() / 1000);
    const payload = decodeJwtPart(jwt.split('.')[1]) as Record<string, number>;
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after + 1);
  });

  it('signature is verifiable with the derived public key', () => {
    const jwt = generateSnowflakeJwt(privateKeyPem, 'EN92180', 'PROVENANCE_SVC');
    const [h, p, sig] = jwt.split('.');
    const signingInput = `${h}.${p}`;
    // Reconstruct base64 from base64url for verification.
    const sigBuf = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const publicKey = crypto.createPublicKey(privateKeyPem);
    const valid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(signingInput),
      publicKey,
      sigBuf,
    );
    expect(valid).toBe(true);
  });

  it('throws on invalid/non-PEM private key input', () => {
    expect(() => generateSnowflakeJwt('not-a-key', 'EN92180', 'SVC')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snowflake — probe (Layer 1)
// ---------------------------------------------------------------------------

const SNOWFLAKE_HOST = 'en92180.us-east-1.snowflakecomputing.com';
const SNOWFLAKE_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-snowflake-AbCdEf';

// Build a minimal valid RSA key for probe/inferSchema tests.
// Generated once at module scope so tests don't pay key-gen cost each run.
const { privateKey: THROWAWAY_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const THROWAWAY_KEY_PEM = THROWAWAY_KEY.export({ type: 'pkcs8', format: 'pem' }) as string;

const SNOWFLAKE_SECRET = {
  privateKeyPem: THROWAWAY_KEY_PEM,
  user: 'PROVENANCE_SVC',
  account: 'EN92180',
};

function makeSnowflakeConnector(
  overrides: Partial<ConnectorEntity> = {},
): ConnectorEntity {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    orgId: '00000000-0000-0000-0000-000000000099',
    domainId: '00000000-0000-0000-0000-0000000000aa',
    name: 'test-snowflake',
    description: null,
    connectorType: 'snowflake',
    connectionConfig: {
      host: SNOWFLAKE_HOST,
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
    },
    credentialArn: SNOWFLAKE_ARN,
    healthStatus: 'pending',
    lastValidatedAt: null,
    createdByPrincipalId: '00000000-0000-0000-0000-0000000000bb',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ConnectorEntity;
}

function makeSnowflakeSource(
  sourceRef = 'PROD_DB.SALES.ORDERS',
): SourceRegistrationEntity {
  return {
    id: '00000000-0000-0000-0000-00000000d001',
    orgId: '00000000-0000-0000-0000-000000000099',
    connectorId: '00000000-0000-0000-0000-000000000002',
    sourceType: 'table',
    sourceRef,
    displayName: sourceRef,
    description: null,
    registeredBy: '00000000-0000-0000-0000-0000000000bb',
    registeredAt: new Date(),
    updatedAt: new Date(),
  } as SourceRegistrationEntity;
}

/**
 * Representative Snowflake SQL REST API success envelope for SELECT 1.
 *
 * Captured from a live Snowflake account (HTTP 200). Key fields:
 *   code: "090001"   — Snowflake's proprietary *success* statement code,
 *                      NOT an error indicator. Must NOT trip extractSnowflakeSqlError.
 *   sqlState: "00000" — SQL-standard successful completion.
 *   message: "Statement executed successfully." — informational, not an error.
 *
 * This envelope is the regression test for the bug where using `code` for
 * error detection false-positived on every successful Snowflake query.
 */
function sfOkResponse(): string {
  return JSON.stringify({
    resultSetMetaData: {
      numRows: 1,
      rowType: [{ name: '1', type: 'fixed' }],
    },
    data: [['1']],
    code: '090001',
    sqlState: '00000',
    message: 'Statement executed successfully.',
    status: undefined,
  });
}

describe('ConnectorProbeService.probeSnowflake (Layer 1)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = {
      getSecretValue: jest.fn(),
    } as unknown as jest.Mocked<SecretsManagerService>;
    secretsManager.getSecretValue.mockResolvedValue(SNOWFLAKE_SECRET as unknown as Record<string, string>);
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ---------- happy path ----------

  it('returns healthy with responseTimeMs when Snowflake returns 200 with valid result', async () => {
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('healthy');
    expect(result.responseTimeMs).not.toBeNull();
    expect(result.responseTimeMs!).toBeGreaterThanOrEqual(0);
    expect(result.errorMessage).toBeNull();
  });

  it('POSTs to the SQL REST API endpoint on the configured host', async () => {
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    await service.probe(makeSnowflakeConnector());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://${SNOWFLAKE_HOST}/api/v2/statements`);
    expect((init.headers as Record<string, string>)['X-Snowflake-Authorization-Token-Type']).toBe(
      'KEYPAIR_JWT',
    );
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer /);
    expect(init.method).toBe('POST');
  });

  it('sends SELECT 1 as the statement with warehouse and role', async () => {
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    await service.probe(makeSnowflakeConnector());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.statement).toBe('SELECT 1');
    expect(body.warehouse).toBe('COMPUTE_WH');
    expect(body.role).toBe('ACCOUNTADMIN');
  });

  it('includes optional database and schema in the request body when set', async () => {
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    await service.probe(
      makeSnowflakeConnector({
        connectionConfig: {
          host: SNOWFLAKE_HOST,
          warehouse: 'COMPUTE_WH',
          role: 'ACCOUNTADMIN',
          database: 'PROD_DB',
          schema: 'SALES',
        },
      }),
    );

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.database).toBe('PROD_DB');
    expect(body.schema).toBe('SALES');
  });

  it('omits database and schema from the request body when not set', async () => {
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    await service.probe(makeSnowflakeConnector());

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('database' in body).toBe(false);
    expect('schema' in body).toBe(false);
  });

  // ---------- HTTP error classification ----------

  it('classifies 401 as credential_error', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"message":"JWT token is invalid"}', { status: 401 }),
    );

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('401');
  });

  it('classifies 403 as credential_error', async () => {
    fetchSpy.mockResolvedValue(new Response('{"message":"access denied"}', { status: 403 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('403');
  });

  it('classifies 504 gateway timeout as timeout', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 504 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('timeout');
  });

  it('classifies 500 as unreachable', async () => {
    fetchSpy.mockResolvedValue(new Response('internal server error', { status: 500 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('500');
  });

  // ---------- success-envelope regression test ----------

  it('returns healthy for the real live Snowflake success envelope (code 090001 + sqlState 00000)', async () => {
    // Regression test for the bug where extractSnowflakeSqlError checked
    // `code !== "00000"` and false-positived on Snowflake's proprietary
    // success code "090001". A healthy account must report healthy.
    fetchSpy.mockResolvedValue(new Response(sfOkResponse(), { status: 200 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('healthy');
    expect(result.errorMessage).toBeNull();
    expect(result.responseTimeMs).not.toBeNull();
  });

  // ---------- 422 SQL error (real Snowflake behaviour) ----------

  it('classifies a 422 SQL error response as unreachable', async () => {
    // Snowflake returns HTTP 422 (not 200) for SQL-level errors.
    // Body carries code "002003" and sqlState "42S02" for object-not-found.
    const errorBody = JSON.stringify({
      code: '002003',
      sqlState: '42S02',
      message: "SQL compilation error:\nObject 'X' does not exist or not authorized.",
      status: undefined,
    });
    fetchSpy.mockResolvedValue(new Response(errorBody, { status: 422 }));

    const result = await service.probe(makeSnowflakeConnector());

    // Non-2xx path: classifySnowflakeHttpStatus(422) → unreachable.
    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('422');
  });

  it('classifies a 401 JWT error response as credential_error', async () => {
    const errorBody = JSON.stringify({
      code: '390144',
      sqlState: '08001',
      message: 'JWT token is invalid. Invalid token: JWT is expired.',
    });
    fetchSpy.mockResolvedValue(new Response(errorBody, { status: 401 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
  });

  // ---------- defensive: 200 with bad sqlState ----------

  it('classifies a hypothetical 200 response with non-"00000" sqlState as unreachable', async () => {
    // Defensive edge case: if Snowflake ever returns HTTP 200 with an error
    // sqlState (e.g. async statement that resolved to an error), the probe
    // must not report healthy.
    const edgeBody = JSON.stringify({
      code: '090001',
      sqlState: '42S02',
      message: "Object 'X' does not exist or not authorized.",
    });
    fetchSpy.mockResolvedValue(new Response(edgeBody, { status: 200 }));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('SQL error');
  });

  // ---------- network / timeout ----------

  it('classifies an AbortError (5s timeout) as timeout', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchSpy.mockRejectedValue(abortErr);

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('5s');
  });

  it('classifies a thrown network error as unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('ENOTFOUND en92180.snowflakecomputing.com'));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('ENOTFOUND');
  });

  // ---------- config and credential validation ----------

  it('returns unreachable with a clear message when host is missing', async () => {
    const result = await service.probe(
      makeSnowflakeConnector({ connectionConfig: {} }),
    );

    expect(result.status).toBe('unreachable');
    expect(result.errorMessage).toContain('connection_config.host');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when credentialArn is not set', async () => {
    const result = await service.probe(
      makeSnowflakeConnector({ credentialArn: null }),
    );

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('credentialArn');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when the resolved secret lacks required fields', async () => {
    secretsManager.getSecretValue.mockResolvedValue({ someOtherField: 'value' } as unknown as Record<string, string>);

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when secrets manager resolution throws', async () => {
    secretsManager.getSecretValue.mockRejectedValue(new Error('Local-dev secret not set'));

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns credential_error when the private key PEM is malformed', async () => {
    secretsManager.getSecretValue.mockResolvedValue({
      privateKeyPem: 'NOT-A-VALID-PEM',
      user: 'SVC',
      account: 'EN92180',
    } as unknown as Record<string, string>);

    const result = await service.probe(makeSnowflakeConnector());

    expect(result.status).toBe('credential_error');
    expect(result.errorMessage).toContain('JWT');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Snowflake — schema inference (Layer 2)
// ---------------------------------------------------------------------------

/**
 * Representative Snowflake INFORMATION_SCHEMA.COLUMNS REST response.
 * Includes the real success-envelope fields (code, sqlState, message) so that
 * schema-inference tests pin that those fields don't cause false SQL errors.
 */
function sfColumnsResponse(
  cols: Array<{
    name: string;
    type: string;
    nullable: string;
    comment: string | null;
    position: string;
  }>,
): string {
  return JSON.stringify({
    resultSetMetaData: {
      numRows: cols.length,
      rowType: [
        { name: 'COLUMN_NAME', type: 'text' },
        { name: 'DATA_TYPE', type: 'text' },
        { name: 'IS_NULLABLE', type: 'text' },
        { name: 'COMMENT', type: 'text' },
        { name: 'ORDINAL_POSITION', type: 'fixed' },
      ],
    },
    data: cols.map((c) => [c.name, c.type, c.nullable, c.comment, c.position]),
    code: '090001',
    sqlState: '00000',
    message: 'Statement executed successfully.',
  });
}

/**
 * Representative INFORMATION_SCHEMA.TABLES response.
 * Includes the real success-envelope fields (code, sqlState, message).
 */
function sfTablesResponse(tableType: string, comment: string | null, rowCount: string): string {
  return JSON.stringify({
    resultSetMetaData: {
      numRows: 1,
      rowType: [
        { name: 'TABLE_TYPE', type: 'text' },
        { name: 'COMMENT', type: 'text' },
        { name: 'ROW_COUNT', type: 'fixed' },
      ],
    },
    data: [[tableType, comment, rowCount]],
    code: '090001',
    sqlState: '00000',
    message: 'Statement executed successfully.',
  });
}

describe('ConnectorProbeService.inferSchemaSnowflake (Layer 2)', () => {
  let secretsManager: jest.Mocked<SecretsManagerService>;
  let service: ConnectorProbeService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    secretsManager = {
      getSecretValue: jest.fn(),
    } as unknown as jest.Mocked<SecretsManagerService>;
    secretsManager.getSecretValue.mockResolvedValue(SNOWFLAKE_SECRET as unknown as Record<string, string>);
    service = new ConnectorProbeService(secretsManager);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ---------- happy path ----------

  it('returns column-level schema from INFORMATION_SCHEMA.COLUMNS', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          sfColumnsResponse([
            { name: 'ORDER_ID', type: 'NUMBER', nullable: 'NO', comment: 'PK', position: '1' },
            { name: 'CUSTOMER_ID', type: 'NUMBER', nullable: 'NO', comment: null, position: '2' },
            { name: 'STATUS', type: 'TEXT', nullable: 'YES', comment: 'Order status', position: '3' },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(sfTablesResponse('BASE TABLE', 'Orders table', '42000'), { status: 200 }),
      );

    const result = await service.inferSchema(
      makeSnowflakeConnector(),
      makeSnowflakeSource('PROD_DB.SALES.ORDERS'),
    );

    expect(result.columnCount).toBe(3);
    expect(result.rowEstimate).toBe(42000);
    const def = result.schemaDefinition as {
      columns: Array<{ name: string; type: string; nullable: boolean; comment: string | null; position: number | null }>;
      tableType: string | null;
      comment: string | null;
    };
    expect(def.tableType).toBe('BASE TABLE');
    expect(def.comment).toBe('Orders table');
    expect(def.columns).toEqual([
      { name: 'ORDER_ID', type: 'NUMBER', nullable: false, comment: 'PK', position: 1 },
      { name: 'CUSTOMER_ID', type: 'NUMBER', nullable: false, comment: null, position: 2 },
      { name: 'STATUS', type: 'TEXT', nullable: true, comment: 'Order status', position: 3 },
    ]);
  });

  it('maps IS_NULLABLE YES→true and NO→false correctly', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          sfColumnsResponse([
            { name: 'A', type: 'TEXT', nullable: 'YES', comment: null, position: '1' },
            { name: 'B', type: 'TEXT', nullable: 'NO', comment: null, position: '2' },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(sfTablesResponse('BASE TABLE', null, '0'), { status: 200 }),
      );

    const result = await service.inferSchema(makeSnowflakeConnector(), makeSnowflakeSource());
    const def = result.schemaDefinition as { columns: Array<{ nullable: boolean }> };
    expect(def.columns[0].nullable).toBe(true);
    expect(def.columns[1].nullable).toBe(false);
  });

  it('returns rowEstimate from INFORMATION_SCHEMA.TABLES ROW_COUNT', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(sfColumnsResponse([
          { name: 'X', type: 'TEXT', nullable: 'YES', comment: null, position: '1' },
        ]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(sfTablesResponse('BASE TABLE', null, '100000'), { status: 200 }),
      );

    const result = await service.inferSchema(makeSnowflakeConnector(), makeSnowflakeSource());
    expect(result.rowEstimate).toBe(100000);
  });

  it('returns rowEstimate null when INFORMATION_SCHEMA.TABLES query fails (best-effort)', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(sfColumnsResponse([
          { name: 'X', type: 'TEXT', nullable: 'YES', comment: null, position: '1' },
        ]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{"message":"access denied"}', { status: 403 }));

    const result = await service.inferSchema(makeSnowflakeConnector(), makeSnowflakeSource());
    // rowEstimate is null because the TABLES query failed, but columnCount is still populated.
    expect(result.rowEstimate).toBeNull();
    expect(result.columnCount).toBe(1);
  });

  it('handles zero columns gracefully (empty table)', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(sfColumnsResponse([]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(sfTablesResponse('BASE TABLE', null, '0'), { status: 200 }),
      );

    const result = await service.inferSchema(makeSnowflakeConnector(), makeSnowflakeSource());
    expect(result.columnCount).toBe(0);
    expect((result.schemaDefinition as { columns: unknown[] }).columns).toEqual([]);
  });

  // ---------- source-ref validation ----------

  it('rejects a two-part source ref (database.table — missing schema)', async () => {
    await expect(
      service.inferSchema(
        makeSnowflakeConnector(),
        makeSnowflakeSource('PROD_DB.ORDERS'),
      ),
    ).rejects.toThrow(/three-part name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a one-part source ref', async () => {
    await expect(
      service.inferSchema(
        makeSnowflakeConnector(),
        makeSnowflakeSource('ORDERS'),
      ),
    ).rejects.toThrow(/three-part name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a source ref with empty segments', async () => {
    await expect(
      service.inferSchema(
        makeSnowflakeConnector(),
        makeSnowflakeSource('PROD_DB..ORDERS'),
      ),
    ).rejects.toThrow(/three-part name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- config validation ----------

  it('throws a clear error when host is missing', async () => {
    await expect(
      service.inferSchema(
        makeSnowflakeConnector({ connectionConfig: {} }),
        makeSnowflakeSource(),
      ),
    ).rejects.toThrow(/connection_config\.host/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws a clear error when credentialArn is missing', async () => {
    await expect(
      service.inferSchema(
        makeSnowflakeConnector({ credentialArn: null }),
        makeSnowflakeSource(),
      ),
    ).rejects.toThrow(/credentialArn/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ---------- HTTP errors on the columns query ----------

  it('throws a clean error when the columns query returns 401', async () => {
    fetchSpy.mockResolvedValue(new Response('{"message":"JWT invalid"}', { status: 401 }));

    await expect(
      service.inferSchema(makeSnowflakeConnector(), makeSnowflakeSource()),
    ).rejects.toThrow(/statement failed/);
  });
});

// ---------------------------------------------------------------------------
// Snowflake — parseSnowflakeRows utility
// ---------------------------------------------------------------------------

describe('parseSnowflakeRows', () => {
  it('returns the data array from a Snowflake REST result', () => {
    const result = {
      data: [['A', 'B'], ['C', 'D']],
    };
    expect(parseSnowflakeRows(result as Parameters<typeof parseSnowflakeRows>[0])).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  it('returns an empty array when data is absent', () => {
    expect(parseSnowflakeRows({} as Parameters<typeof parseSnowflakeRows>[0])).toEqual([]);
  });

  it('returns an empty array when data is null', () => {
    expect(parseSnowflakeRows({ data: null } as unknown as Parameters<typeof parseSnowflakeRows>[0])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Snowflake — submitSnowflakeStatement utility
// ---------------------------------------------------------------------------

describe('submitSnowflakeStatement', () => {
  let fetchSpy: jest.SpyInstance;

  // Use a throw-away JWT string for the utility tests — the JWT is passed in
  // and not validated inside the function (the server would validate it).
  const FAKE_JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig';

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns the parsed response body on success', async () => {
    const body = { resultSetMetaData: { numRows: 1 }, data: [['1']] };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await submitSnowflakeStatement(
      SNOWFLAKE_HOST,
      FAKE_JWT,
      'SELECT 1',
      { warehouse: 'COMPUTE_WH', role: 'ACCOUNTADMIN' },
    );

    expect(result).toMatchObject({ data: [['1']] });
  });

  it('throws on a non-2xx HTTP response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"message":"not found","code":"002003"}', { status: 404 }),
    );

    await expect(
      submitSnowflakeStatement(SNOWFLAKE_HOST, FAKE_JWT, 'SELECT 1', {
        warehouse: 'COMPUTE_WH',
        role: 'ACCOUNTADMIN',
      }),
    ).rejects.toThrow(/statement failed/);
  });

  it('throws on a 200 response with a non-"00000" sqlState (defensive check)', async () => {
    // Defensive: if Snowflake returns HTTP 200 with an error sqlState, the
    // function must throw rather than silently return the body as success.
    // The real SQL error path is HTTP 422 (tested separately), but
    // submitSnowflakeStatement checks sqlState on the 200 path too.
    const errorBody = JSON.stringify({
      code: '002043',
      sqlState: '57014',
      message: 'Statement reached its statement or warehouse timeout of 60 second(s).',
    });
    fetchSpy.mockResolvedValue(new Response(errorBody, { status: 200 }));

    await expect(
      submitSnowflakeStatement(SNOWFLAKE_HOST, FAKE_JWT, 'SELECT 1', {
        warehouse: 'COMPUTE_WH',
        role: 'ACCOUNTADMIN',
      }),
    ).rejects.toThrow(/SQL error/);
  });

  it('returns the parsed body on a 200 with the real success envelope (code 090001 + sqlState 00000)', async () => {
    // Regression: the real success envelope must not be flagged as an error.
    const body = {
      resultSetMetaData: { numRows: 1, rowType: [{ name: '1', type: 'fixed' }] },
      data: [['1']],
      code: '090001',
      sqlState: '00000',
      message: 'Statement executed successfully.',
    };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await submitSnowflakeStatement(SNOWFLAKE_HOST, FAKE_JWT, 'SELECT 1', {
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
    });

    expect(result).toMatchObject({ data: [['1']] });
  });

  it('throws on a 422 SQL error and includes the structured message from the body', async () => {
    // Real Snowflake SQL error path: HTTP 422 with structured JSON body.
    // The error message should come from the body, not just "HTTP 422".
    const errorBody = JSON.stringify({
      code: '002003',
      sqlState: '42S02',
      message: "SQL compilation error:\nObject 'PROD_DB.SALES.MISSING_TABLE' does not exist or not authorized.",
    });
    fetchSpy.mockResolvedValue(new Response(errorBody, { status: 422 }));

    await expect(
      submitSnowflakeStatement(SNOWFLAKE_HOST, FAKE_JWT, 'SELECT 1', {
        warehouse: 'COMPUTE_WH',
        role: 'ACCOUNTADMIN',
      }),
    ).rejects.toThrow(/SQL compilation error/);
  });

  it('includes optional database in the request body when provided', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await submitSnowflakeStatement(SNOWFLAKE_HOST, FAKE_JWT, 'SELECT 1', {
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
      database: 'PROD_DB',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const reqBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(reqBody.database).toBe('PROD_DB');
  });
});
