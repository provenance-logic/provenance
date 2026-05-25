// Parses whatever a user is likely to paste when pointing Provenance at a
// Snowflake account — a browser URL, the SQL API hostname, a Snowsight app
// URL, or a bare account identifier — into the pieces the connector needs.
//
// `host` is what goes into connection_config.host (the SQL REST API endpoint).
// `account` is surfaced for the credential JSON ({"account": "..."}), which the
// operator assembles separately. Snowflake's account-identifier formats are
// notoriously inconsistent, so this is best-effort: it always yields a usable
// host, and a best-guess account/region for display.

export interface SnowflakeAccountRef {
  host: string;
  account: string | null;
  region: string | null;
}

const SUFFIX = '.snowflakecomputing.com';

export function parseSnowflakeUrl(input: string): SnowflakeAccountRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip an optional scheme.
  let rest = trimmed.replace(/^https?:\/\//i, '');
  if (!rest) return null;

  // Snowsight app URL: app.snowflake.com/<region>/<account>[/...]
  const appMatch = rest.match(/^app\.snowflake\.com\/([^/]+)\/([^/]+)/i);
  if (appMatch) {
    const region = appMatch[1];
    const account = appMatch[2];
    return {
      host: `${account}.${region}.snowflakecomputing.com`.toLowerCase(),
      account,
      region,
    };
  }

  // Drop any path / query string after the host.
  rest = rest.split('/')[0].split('?')[0];
  if (!rest) return null;

  // Full SQL-API hostname (…snowflakecomputing.com).
  if (rest.toLowerCase().endsWith(SUFFIX)) {
    const host = rest.toLowerCase();
    const prefix = rest.slice(0, rest.length - SUFFIX.length);
    if (!prefix) return null;
    const dot = prefix.indexOf('.');
    if (dot === -1) {
      // org-account form (e.g. myorg-myaccount) — no region segment.
      return { host, account: prefix, region: null };
    }
    return { host, account: prefix.slice(0, dot), region: prefix.slice(dot + 1) || null };
  }

  // Bare account identifier: "xy12345", "xy12345.us-east-1", "org-account".
  const dot = rest.indexOf('.');
  if (dot === -1) {
    return { host: `${rest}.snowflakecomputing.com`.toLowerCase(), account: rest, region: null };
  }
  return {
    host: `${rest}.snowflakecomputing.com`.toLowerCase(),
    account: rest.slice(0, dot),
    region: rest.slice(dot + 1) || null,
  };
}
