import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_SPECS,
  defaultConfigValues,
  buildConnectionConfig,
  buildCredentialSecret,
} from './connector-specs.js';

describe('defaultConfigValues', () => {
  it('seeds field defaults for snowflake', () => {
    expect(defaultConfigValues('snowflake')).toEqual({
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
    });
  });

  it('seeds postgres port + ssl defaults', () => {
    expect(defaultConfigValues('postgresql')).toEqual({ port: '5432', ssl: 'true' });
  });
});

describe('buildConnectionConfig', () => {
  it('coerces number and boolean fields and keeps text', () => {
    const cfg = buildConnectionConfig('postgresql', {
      host: 'db.example.com',
      port: '5432',
      database: 'analytics',
      ssl: 'false',
    });
    expect(cfg).toEqual({ host: 'db.example.com', port: 5432, database: 'analytics', ssl: false });
  });

  it('omits empty optional fields rather than sending blanks', () => {
    const cfg = buildConnectionConfig('snowflake', {
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
      database: '',
      schema: '   ',
    });
    expect(cfg).toEqual({
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      warehouse: 'COMPUTE_WH',
      role: 'ACCOUNTADMIN',
    });
    expect('database' in cfg).toBe(false);
    expect('schema' in cfg).toBe(false);
  });

  it('drops a non-numeric value for a number field', () => {
    const cfg = buildConnectionConfig('postgresql', { host: 'h', database: 'd', port: 'not-a-number' });
    expect('port' in cfg).toBe(false);
  });

  it('every connector type has a spec with at least one field and credential guidance', () => {
    for (const type of ['postgresql', 's3', 'databricks', 'snowflake'] as const) {
      const spec = CONNECTOR_SPECS[type];
      expect(spec.fields.length).toBeGreaterThan(0);
      expect(spec.credential.help).toBeTruthy();
    }
  });
});

describe('buildCredentialSecret (ADR-013)', () => {
  it('returns null when all secret fields are empty', () => {
    const result = buildCredentialSecret('databricks', { token: '' });
    expect(result).toBeNull();
  });

  it('returns null when no secret field values provided', () => {
    const result = buildCredentialSecret('databricks', {});
    expect(result).toBeNull();
  });

  it('assembles the token for databricks', () => {
    const result = buildCredentialSecret('databricks', { token: 'dapi-live-token' });
    expect(result).toEqual({ token: 'dapi-live-token' });
  });

  it('assembles the token for snowflake', () => {
    const result = buildCredentialSecret('snowflake', { token: 'my-pat' });
    expect(result).toEqual({ token: 'my-pat' });
  });

  it('assembles username+password for postgresql, dropping blank ones', () => {
    const result = buildCredentialSecret('postgresql', { username: 'reader', password: '' });
    expect(result).toEqual({ username: 'reader' });
    expect('password' in (result ?? {})).toBe(false);
  });

  it('assembles accessKeyId+secretAccessKey for s3', () => {
    const result = buildCredentialSecret('s3', {
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secret123',
    });
    expect(result).toEqual({ accessKeyId: 'AKIATEST', secretAccessKey: 'secret123' });
  });

  it('every connector has secretFields declared', () => {
    for (const type of ['postgresql', 's3', 'databricks', 'snowflake'] as const) {
      expect(CONNECTOR_SPECS[type].credential.secretFields.length).toBeGreaterThan(0);
    }
  });
});
