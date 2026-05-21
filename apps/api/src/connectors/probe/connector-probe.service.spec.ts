import { ConnectorProbeService } from './connector-probe.service.js';
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

  // ---------- unsupported types are unchanged ----------

  it('still returns synthetic healthy for not-yet-implemented connector types', async () => {
    const result = await service.probe(
      makeDatabricksConnector({
        connectorType: 'snowflake',
        connectionConfig: {},
      }),
    );

    expect(result.status).toBe('healthy');
    expect(result.responseTimeMs).toBeNull();
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
