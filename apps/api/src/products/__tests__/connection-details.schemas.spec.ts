import { validateConnectionDetails, isCredentialField } from '../connection-details.schemas.js';

describe('validateConnectionDetails', () => {
  describe('sql_jdbc', () => {
    it('accepts a complete payload', () => {
      const result = validateConnectionDetails('sql_jdbc', {
        kind: 'sql_jdbc',
        host: 'db.example.com',
        port: 5432,
        database: 'orders',
        schema: 'public',
        authMethod: 'username_password',
        sslMode: 'require',
        username: 'reader',
        password: 'hunter2',
      });
      expect(result.kind).toBe('sql_jdbc');
    });

    it('rejects a missing required field (port)', () => {
      expect(() =>
        validateConnectionDetails('sql_jdbc', {
          kind: 'sql_jdbc',
          host: 'db.example.com',
          database: 'orders',
          schema: 'public',
          authMethod: 'iam',
          sslMode: 'require',
        }),
      ).toThrow();
    });

    it('rejects an unknown authMethod', () => {
      expect(() =>
        validateConnectionDetails('sql_jdbc', {
          kind: 'sql_jdbc',
          host: 'h',
          port: 5432,
          database: 'd',
          schema: 's',
          authMethod: 'kerberos',
          sslMode: 'require',
        }),
      ).toThrow();
    });
  });

  describe('rest_api', () => {
    it('accepts a complete payload', () => {
      const result = validateConnectionDetails('rest_api', {
        kind: 'rest_api',
        baseUrl: 'https://api.example.com/v1',
        authMethod: 'bearer_token',
        bearerToken: 'xyz',
      });
      expect(result.kind).toBe('rest_api');
    });

    it('rejects an invalid base URL', () => {
      expect(() =>
        validateConnectionDetails('rest_api', {
          kind: 'rest_api',
          baseUrl: 'not a url',
          authMethod: 'none',
        }),
      ).toThrow();
    });
  });

  describe('graphql', () => {
    it('accepts a minimal payload', () => {
      const result = validateConnectionDetails('graphql', {
        kind: 'graphql',
        endpointUrl: 'https://graphql.example.com',
        authMethod: 'none',
      });
      expect(result.kind).toBe('graphql');
    });
  });

  describe('streaming_topic', () => {
    it('accepts SASL/SCRAM with credentials', () => {
      const result = validateConnectionDetails('streaming_topic', {
        kind: 'streaming_topic',
        bootstrapServers: 'kafka1:9092,kafka2:9092',
        topic: 'orders.v1',
        authMethod: 'sasl_scram',
        saslUsername: 'u',
        saslPassword: 'p',
      });
      expect(result.kind).toBe('streaming_topic');
    });

    it('rejects empty bootstrapServers', () => {
      expect(() =>
        validateConnectionDetails('streaming_topic', {
          kind: 'streaming_topic',
          bootstrapServers: '',
          topic: 'x',
          authMethod: 'none',
        }),
      ).toThrow();
    });
  });

  describe('file_object_export', () => {
    it('accepts a complete S3 payload', () => {
      const result = validateConnectionDetails('file_object_export', {
        kind: 'file_object_export',
        storage: 's3',
        bucket: 'orders-exports',
        pathPrefix: 'daily/',
        authMethod: 'iam',
        fileFormat: 'parquet',
        compression: 'snappy',
      });
      expect(result.kind).toBe('file_object_export');
    });

    it('rejects an unknown storage backend', () => {
      expect(() =>
        validateConnectionDetails('file_object_export', {
          kind: 'file_object_export',
          storage: 'dropbox',
          bucket: 'x',
          pathPrefix: '',
          authMethod: 'iam',
          fileFormat: 'json',
        }),
      ).toThrow();
    });
  });

  describe('semantic_query_endpoint', () => {
    it('is not user-configurable — validation throws', () => {
      expect(() =>
        validateConnectionDetails('semantic_query_endpoint', { kind: 'semantic_query_endpoint' }),
      ).toThrow(/not user-configurable/);
    });
  });
});

describe('isCredentialField', () => {
  it('flags credential fields', () => {
    ['password', 'apiKey', 'bearerToken', 'saslPassword', 'secretAccessKey', 'serviceAccountJson'].forEach(
      (f) => expect(isCredentialField(f)).toBe(true),
    );
  });

  it('does not flag non-credential fields', () => {
    ['host', 'port', 'database', 'bucket', 'topic', 'baseUrl', 'endpointUrl'].forEach((f) =>
      expect(isCredentialField(f)).toBe(false),
    );
  });
});
