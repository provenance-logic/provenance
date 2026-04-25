import { ConnectionProbeService } from '../index.js';
import type {
  KafkaConnectionDetails,
  RestApiConnectionDetails,
  GraphQlConnectionDetails,
  SqlJdbcConnectionDetails,
  FileExportConnectionDetails,
} from '@provenance/types';

const restDetails: RestApiConnectionDetails = {
  kind: 'rest_api',
  baseUrl: 'https://api.example.com/v1',
  authMethod: 'none',
};

const graphQlDetails: GraphQlConnectionDetails = {
  kind: 'graphql',
  endpointUrl: 'https://api.example.com/graphql',
  authMethod: 'none',
};

const sqlDetails: SqlJdbcConnectionDetails = {
  kind: 'sql_jdbc',
  host: 'db.example.com',
  port: 5432,
  database: 'analytics',
  schema: 'public',
  authMethod: 'username_password',
  sslMode: 'require',
  username: 'u',
  password: 'p',
};

const fileDetails: FileExportConnectionDetails = {
  kind: 'file_object_export',
  storage: 's3',
  bucket: 'my-bucket',
  pathPrefix: 'data/',
  authMethod: 'iam',
  fileFormat: 'parquet',
};

const kafkaDetails: KafkaConnectionDetails = {
  kind: 'streaming_topic',
  bootstrapServers: '127.0.0.1:1', // a port nothing is listening on — fast failure
  topic: 't',
  authMethod: 'none',
};

describe('ConnectionProbeService', () => {
  let service: ConnectionProbeService;
  let originalFetch: typeof fetch;

  beforeAll(() => { originalFetch = global.fetch; });
  afterAll(() => { global.fetch = originalFetch; });

  beforeEach(() => { service = new ConnectionProbeService(); });

  it('returns unsupported when interfaceType is null', async () => {
    const result = await service.runProbe(null, restDetails);
    expect(result.status).toBe('unsupported');
    expect(result.interfaceType).toBeNull();
  });

  it('returns unsupported when details are null', async () => {
    const result = await service.runProbe('rest_api', null);
    expect(result.status).toBe('unsupported');
    expect(result.interfaceType).toBe('rest_api');
  });

  it('returns unsupported for sql_jdbc (probe not yet registered)', async () => {
    const result = await service.runProbe('sql_jdbc', sqlDetails);
    expect(result.status).toBe('unsupported');
    expect(result.message).toMatch(/sql_jdbc/);
  });

  it('returns unsupported for file_object_export (probe not yet registered)', async () => {
    const result = await service.runProbe('file_object_export', fileDetails);
    expect(result.status).toBe('unsupported');
    expect(result.message).toMatch(/file_object_export/);
  });

  describe('REST probe', () => {
    it('reports success on any HTTP response (including 4xx/5xx)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 401, statusText: 'Unauthorized' }) as never;
      const result = await service.runProbe('rest_api', restDetails);
      expect(result.status).toBe('success');
      expect(result.message).toContain('401');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reports failure on a network-level error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
      const result = await service.runProbe('rest_api', restDetails);
      expect(result.status).toBe('failure');
      expect(result.message).toContain('ECONNREFUSED');
    });

    it('attaches Authorization header for bearer_token auth', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ status: 200, statusText: 'OK' });
      global.fetch = fetchMock as never;
      await service.runProbe('rest_api', {
        ...restDetails,
        authMethod: 'bearer_token',
        bearerToken: 'tok-123',
      });
      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok-123');
    });
  });

  describe('GraphQL probe', () => {
    it('reports success on any HTTP response and notes the root type when present', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ data: { __typename: 'Query' } }),
      }) as never;
      const result = await service.runProbe('graphql', graphQlDetails);
      expect(result.status).toBe('success');
      expect(result.message).toContain('"Query"');
    });

    it('still reports success when the body is non-JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => { throw new Error('not json'); },
      }) as never;
      const result = await service.runProbe('graphql', graphQlDetails);
      expect(result.status).toBe('success');
    });

    it('reports failure on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('DNS lookup failed')) as never;
      const result = await service.runProbe('graphql', graphQlDetails);
      expect(result.status).toBe('failure');
      expect(result.message).toContain('DNS');
    });
  });

  describe('Kafka probe', () => {
    // Real broker connection against an unreachable address — must fail fast.
    it('reports failure for an unreachable broker without exceeding the outer timeout', async () => {
      const result = await service.runProbe('streaming_topic', kafkaDetails);
      expect(result.status).toBe('failure');
      // 10s default + 500ms slack — leaves comfortable margin in CI.
      expect((result.latencyMs ?? 0)).toBeLessThan(11_000);
    }, 15_000);

    it('reports failure when bootstrapServers is empty', async () => {
      const result = await service.runProbe('streaming_topic', { ...kafkaDetails, bootstrapServers: '' });
      expect(result.status).toBe('failure');
      expect(result.message).toMatch(/empty/);
    });
  });
});
