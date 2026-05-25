import { describe, it, expect } from 'vitest';
import { CONNECTOR_SPECS, defaultConfigValues, buildConnectionConfig } from './connector-specs.js';

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
