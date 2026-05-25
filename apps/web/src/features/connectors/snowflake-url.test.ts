import { describe, it, expect } from 'vitest';
import { parseSnowflakeUrl } from './snowflake-url.js';

describe('parseSnowflakeUrl', () => {
  it('parses a full account hostname with region', () => {
    expect(parseSnowflakeUrl('xy12345.us-east-1.snowflakecomputing.com')).toEqual({
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      account: 'xy12345',
      region: 'us-east-1',
    });
  });

  it('strips scheme and trailing path from a hostname', () => {
    expect(parseSnowflakeUrl('https://xy12345.us-east-1.snowflakecomputing.com/console')).toEqual({
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      account: 'xy12345',
      region: 'us-east-1',
    });
  });

  it('keeps a multi-segment region (cloud-qualified)', () => {
    expect(parseSnowflakeUrl('xy12345.us-east-1.aws.snowflakecomputing.com')).toEqual({
      host: 'xy12345.us-east-1.aws.snowflakecomputing.com',
      account: 'xy12345',
      region: 'us-east-1.aws',
    });
  });

  it('handles the org-account hostname form (no region segment)', () => {
    expect(parseSnowflakeUrl('myorg-myaccount.snowflakecomputing.com')).toEqual({
      host: 'myorg-myaccount.snowflakecomputing.com',
      account: 'myorg-myaccount',
      region: null,
    });
  });

  it('parses a Snowsight app URL (region/account in the path)', () => {
    expect(parseSnowflakeUrl('https://app.snowflake.com/us-east-1/xy12345/worksheets')).toEqual({
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      account: 'xy12345',
      region: 'us-east-1',
    });
  });

  it('expands a bare region-qualified account identifier', () => {
    expect(parseSnowflakeUrl('xy12345.us-east-1')).toEqual({
      host: 'xy12345.us-east-1.snowflakecomputing.com',
      account: 'xy12345',
      region: 'us-east-1',
    });
  });

  it('expands a bare account locator', () => {
    expect(parseSnowflakeUrl('XY12345')).toEqual({
      host: 'xy12345.snowflakecomputing.com',
      account: 'XY12345',
      region: null,
    });
  });

  it('trims whitespace', () => {
    expect(parseSnowflakeUrl('  xy12345.us-east-1.snowflakecomputing.com  ')?.host).toBe(
      'xy12345.us-east-1.snowflakecomputing.com',
    );
  });

  it('returns null for empty or nonsense input', () => {
    expect(parseSnowflakeUrl('')).toBeNull();
    expect(parseSnowflakeUrl('   ')).toBeNull();
    expect(parseSnowflakeUrl('https://')).toBeNull();
  });
});
