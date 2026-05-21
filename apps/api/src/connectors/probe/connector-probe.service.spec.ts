import { ConnectorProbeService } from './connector-probe.service.js';
import { SecretsManagerService } from './secrets-manager.service.js';
import type { ConnectorEntity } from '../entities/connector.entity.js';

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
