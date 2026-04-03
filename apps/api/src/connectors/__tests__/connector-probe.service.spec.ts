import { Test } from '@nestjs/testing';
import { ConnectorProbeService } from '../probe/connector-probe.service.js';
import { SecretsManagerService } from '../probe/secrets-manager.service.js';
import {
  detectRawCredentialKey,
  isValidCredentialArn,
} from '../probe/raw-credential-guard.js';
import type { ConnectorEntity } from '../entities/connector.entity.js';
import type { SourceRegistrationEntity } from '../entities/source-registration.entity.js';

// ---------------------------------------------------------------------------
// Module mocks — must be at the top before any imports
// ---------------------------------------------------------------------------
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockEnd = jest.fn().mockResolvedValue(undefined);
  const MockClient = jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: mockQuery,
    end: mockEnd,
  }));
  (MockClient as any).__mockQuery = mockQuery;
  (MockClient as any).__mockEnd = mockEnd;
  return { Client: MockClient };
});

jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn();
  const MockS3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  (MockS3Client as any).__mockSend = mockSend;
  return { S3Client: MockS3Client, ListObjectsV2Command: jest.fn() };
});

import { Client as PgClient } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';

const MockPgClient = PgClient as jest.MockedClass<typeof PgClient> & {
  __mockQuery: jest.Mock;
  __mockEnd: jest.Mock;
};
const MockS3Client = S3Client as jest.MockedClass<typeof S3Client> & {
  __mockSend: jest.Mock;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const makeConnector = (
  overrides: Partial<ConnectorEntity> = {},
): ConnectorEntity => ({
  id: 'connector-1',
  orgId: 'org-1',
  domainId: 'domain-1',
  name: 'Orders DB',
  description: null,
  connectorType: 'postgresql',
  connectionConfig: { host: 'db.example.com', port: 5432, database: 'orders' },
  credentialArn: null,
  validationStatus: 'pending',
  lastValidatedAt: null,
  createdBy: 'principal-1',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeSource = (
  overrides: Partial<SourceRegistrationEntity> = {},
): SourceRegistrationEntity => ({
  id: 'source-1',
  orgId: 'org-1',
  connectorId: 'connector-1',
  sourceRef: 'public.orders',
  sourceType: 'table',
  displayName: 'Orders table',
  description: null,
  registeredBy: 'principal-1',
  registeredAt: now,
  updatedAt: now,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Raw credential guard — unit tests (no DI needed)
// ---------------------------------------------------------------------------

describe('detectRawCredentialKey()', () => {
  it('returns null for a clean connectionConfig', () => {
    expect(detectRawCredentialKey({ host: 'db.example.com', port: 5432 })).toBeNull();
  });

  it('detects "password" field', () => {
    expect(detectRawCredentialKey({ host: 'db.example.com', password: 'secret' })).toBe('password');
  });

  it('detects "passwd" field', () => {
    expect(detectRawCredentialKey({ passwd: 'x' })).toBe('passwd');
  });

  it('detects "secret" field', () => {
    expect(detectRawCredentialKey({ secret: 'abc' })).toBe('secret');
  });

  it('detects "accessKeyId" field (camelCase)', () => {
    expect(detectRawCredentialKey({ accessKeyId: 'AKIA...' })).toBe('accessKeyId');
  });

  it('detects "secretAccessKey" field', () => {
    expect(detectRawCredentialKey({ secretAccessKey: 'xxx' })).toBe('secretAccessKey');
  });

  it('detects "token" field', () => {
    expect(detectRawCredentialKey({ token: 'bearer-xxx' })).toBe('token');
  });

  it('is case-insensitive — detects "PASSWORD"', () => {
    expect(detectRawCredentialKey({ PASSWORD: 'x' })).toBe('PASSWORD');
  });
});

describe('isValidCredentialArn()', () => {
  it('returns true for a valid standard ARN', () => {
    expect(
      isValidCredentialArn(
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:MySecret-ABCDEF',
      ),
    ).toBe(true);
  });

  it('returns true for a GovCloud ARN', () => {
    expect(
      isValidCredentialArn(
        'arn:aws-us-gov:secretsmanager:us-gov-east-1:123456789012:secret:MySecret-XYZ',
      ),
    ).toBe(true);
  });

  it('returns false for a raw password string', () => {
    expect(isValidCredentialArn('mysecretpassword')).toBe(false);
  });

  it('returns false for an ARN pointing to a different service', () => {
    expect(
      isValidCredentialArn('arn:aws:s3:::my-bucket'),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectorProbeService
// ---------------------------------------------------------------------------

describe('ConnectorProbeService', () => {
  let service: ConnectorProbeService;
  let secretsManager: jest.Mocked<SecretsManagerService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectorProbeService,
        {
          provide: SecretsManagerService,
          useValue: {
            getSecretValue: jest.fn().mockResolvedValue({
              username: 'app_user',
              password: 'db_pass',
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ConnectorProbeService);
    secretsManager = module.get(SecretsManagerService);

    // Reset module-level mocks between tests
    jest.clearAllMocks();
    // Re-register default implementations after clearAllMocks
    (MockPgClient as any).__mockQuery = jest.fn().mockResolvedValue({ rows: [] });
    (MockS3Client as any).__mockSend = jest.fn().mockResolvedValue({
      Contents: [],
      KeyCount: 0,
    });
    MockPgClient.mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: (MockPgClient as any).__mockQuery,
      end: jest.fn().mockResolvedValue(undefined),
    }) as unknown as PgClient);
    MockS3Client.mockImplementation(() => ({
      send: (MockS3Client as any).__mockSend,
    }) as unknown as S3Client);
    secretsManager.getSecretValue.mockResolvedValue({
      username: 'app_user',
      password: 'db_pass',
    });
  });

  // -------------------------------------------------------------------------
  // PostgreSQL probe
  // -------------------------------------------------------------------------

  describe('probe() — postgresql', () => {
    it('returns healthy when SELECT 1 succeeds', async () => {
      const result = await service.probe(makeConnector());

      expect(result.status).toBe('healthy');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.errorMessage).toBeNull();
    });

    it('fetches credentials from Secrets Manager when credentialArn is set', async () => {
      await service.probe(
        makeConnector({ credentialArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:MyDb-XYZ' }),
      );

      expect(secretsManager.getSecretValue).toHaveBeenCalledWith(
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:MyDb-XYZ',
      );
    });

    it('does not call Secrets Manager when credentialArn is null', async () => {
      await service.probe(makeConnector({ credentialArn: null }));
      expect(secretsManager.getSecretValue).not.toHaveBeenCalled();
    });

    it('returns credential_error when pg reports authentication failure', async () => {
      MockPgClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(
          new Error('password authentication failed for user "app_user"'),
        ),
        query: jest.fn(),
        end: jest.fn().mockResolvedValue(undefined),
      }) as unknown as PgClient);

      const result = await service.probe(makeConnector());
      expect(result.status).toBe('credential_error');
      expect(result.errorMessage).toMatch(/password authentication failed/);
    });

    it('returns timeout when connection times out', async () => {
      MockPgClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('connect timeout')),
        query: jest.fn(),
        end: jest.fn().mockResolvedValue(undefined),
      }) as unknown as PgClient);

      const result = await service.probe(makeConnector());
      expect(result.status).toBe('timeout');
    });

    it('returns unreachable on generic connection failure', async () => {
      MockPgClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432')),
        query: jest.fn(),
        end: jest.fn().mockResolvedValue(undefined),
      }) as unknown as PgClient);

      const result = await service.probe(makeConnector());
      expect(result.status).toBe('unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // S3 probe
  // -------------------------------------------------------------------------

  describe('probe() — s3', () => {
    const s3Connector = () =>
      makeConnector({
        connectorType: 's3',
        connectionConfig: { bucket: 'my-data-bucket', region: 'us-east-1' },
      });

    it('returns healthy when ListObjectsV2 succeeds', async () => {
      (MockS3Client as any).__mockSend.mockResolvedValueOnce({
        Contents: [],
        KeyCount: 0,
      });

      const result = await service.probe(s3Connector());
      expect(result.status).toBe('healthy');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns credential_error on AccessDenied', async () => {
      const err = new Error('Access Denied');
      (err as any).name = 'AccessDenied';
      (MockS3Client as any).__mockSend.mockRejectedValueOnce(err);

      const result = await service.probe(s3Connector());
      expect(result.status).toBe('credential_error');
    });

    it('returns unreachable on NoSuchBucket', async () => {
      const err = new Error('The specified bucket does not exist');
      (err as any).name = 'NoSuchBucket';
      (MockS3Client as any).__mockSend.mockRejectedValueOnce(err);

      const result = await service.probe(s3Connector());
      expect(result.status).toBe('unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported connector type
  // -------------------------------------------------------------------------

  describe('probe() — unsupported type', () => {
    it('returns healthy without any live probe for unsupported types', async () => {
      const result = await service.probe(
        makeConnector({ connectorType: 'snowflake' }),
      );
      expect(result.status).toBe('healthy');
      expect(result.responseTimeMs).toBeNull();
      expect(MockPgClient).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // PostgreSQL schema introspection
  // -------------------------------------------------------------------------

  describe('inferSchema() — postgresql', () => {
    it('returns column definitions and row estimate from information_schema', async () => {
      const colRows = [
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
        { column_name: 'amount', data_type: 'numeric', is_nullable: 'YES', column_default: null },
      ];
      const rowRows = [{ n_live_tup: '42000' }];

      const mockQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: colRows })
        .mockResolvedValueOnce({ rows: rowRows });

      MockPgClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query: mockQuery,
        end: jest.fn().mockResolvedValue(undefined),
      }) as unknown as PgClient);

      const result = await service.inferSchema(
        makeConnector(),
        makeSource({ sourceRef: 'public.orders' }),
      );

      expect(result.columnCount).toBe(2);
      expect(result.rowEstimate).toBe(42000);
      expect((result.schemaDefinition as any).columns).toHaveLength(2);
      expect((result.schemaDefinition as any).columns[0].name).toBe('id');
    });

    it('defaults to public schema when sourceRef has no schema prefix', async () => {
      const mockQuery = jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      MockPgClient.mockImplementationOnce(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query: mockQuery,
        end: jest.fn().mockResolvedValue(undefined),
      }) as unknown as PgClient);

      await service.inferSchema(makeConnector(), makeSource({ sourceRef: 'orders' }));

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['public', 'orders'],
      );
    });
  });
});
