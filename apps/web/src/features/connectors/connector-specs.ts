import type { ConnectorType } from '@provenance/types';

// Declarative per-connector registration spec (ADR-012, decision 1).
//
// This is the seed of the spec-driven form: each connector type declares its
// non-sensitive connection_config fields (rendered as typed, labeled inputs
// instead of a raw JSON blob), plus guidance for the credential the operator
// supplies behind a Secrets Manager ARN / local-env sentinel. The renderer in
// ConnectorsPage builds connection_config from these field definitions, so the
// payload shape is identical to what the backend probe already reads — this is
// a pure UX layer, no contract change.
//
// Kept frontend-side for now; the intended end-state (ADR-012) is for the spec
// to be served from the connector capability manifest so the form and the
// backend share one source of truth. Lifting it server-side is a later slice.

export type ConnectorFieldType = 'text' | 'number' | 'boolean';

export interface ConnectorFieldSpec {
  /** connection_config key this field writes. */
  key: string;
  label: string;
  type: ConnectorFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number | boolean;
}

export interface CredentialSpec {
  required: boolean;
  label: string;
  /** Describes the secret's expected JSON shape, shown as field help. */
  help: string;
  placeholder?: string;
}

export interface SmartFillSpec {
  label: string;
  placeholder: string;
  help: string;
}

export interface ConnectorSpec {
  type: ConnectorType;
  label: string;
  /** One-line orientation shown under the connector picker. */
  blurb: string;
  fields: ConnectorFieldSpec[];
  credential: CredentialSpec;
  /** Optional paste-a-URL helper (Snowflake). */
  smartFill?: SmartFillSpec;
}

const ARN_PLACEHOLDER = 'arn:aws:secretsmanager:… or local-env:MY_VAR';

export const CONNECTOR_SPECS: Record<ConnectorType, ConnectorSpec> = {
  postgresql: {
    type: 'postgresql',
    label: 'PostgreSQL',
    blurb: 'Connect to a PostgreSQL database for schema discovery.',
    fields: [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.example.com' },
      { key: 'port', label: 'Port', type: 'number', default: 5432 },
      { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'analytics' },
      { key: 'ssl', label: 'Require SSL', type: 'boolean', default: true },
    ],
    credential: {
      required: false,
      label: 'Credential (optional)',
      help: 'AWS Secrets Manager ARN, or local-env:VAR in dev. Leave blank if the database is reachable without one.',
      placeholder: ARN_PLACEHOLDER,
    },
  },
  s3: {
    type: 's3',
    label: 'Amazon S3',
    blurb: 'Point at an S3 bucket as a source.',
    fields: [
      { key: 'bucket', label: 'Bucket', type: 'text', required: true, placeholder: 'my-data-bucket' },
      { key: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
    ],
    credential: {
      required: false,
      label: 'Credential (optional)',
      help: 'AWS Secrets Manager ARN, or local-env:VAR in dev. Leave blank to use the platform’s ambient AWS identity.',
      placeholder: ARN_PLACEHOLDER,
    },
  },
  databricks: {
    type: 'databricks',
    label: 'Databricks',
    blurb: 'Connect a Databricks workspace (Unity Catalog discovery + lineage).',
    fields: [
      {
        key: 'host',
        label: 'Workspace URL',
        type: 'text',
        required: true,
        placeholder: 'https://dbc-xxxxxxxx.cloud.databricks.com',
        help: 'The workspace URL you use to sign in to Databricks.',
      },
    ],
    credential: {
      required: true,
      label: 'Personal access token (via secret)',
      help: 'The secret must hold {"token":"dapi…"}. Generate the token in Databricks → Settings → Developer → Access tokens.',
      placeholder: ARN_PLACEHOLDER,
    },
  },
  snowflake: {
    type: 'snowflake',
    label: 'Snowflake',
    blurb: 'Connect a Snowflake account (INFORMATION_SCHEMA discovery + OBJECT_DEPENDENCIES lineage).',
    smartFill: {
      label: 'Paste your Snowflake URL or account identifier',
      placeholder: 'https://xy12345.us-east-1.snowflakecomputing.com  (or  xy12345.us-east-1)',
      help: 'We’ll fill in the host below and show your account identifier for the credential.',
    },
    fields: [
      {
        key: 'host',
        label: 'Account hostname',
        type: 'text',
        required: true,
        placeholder: 'xy12345.us-east-1.snowflakecomputing.com',
        help: 'The full SQL API hostname. Use the paste box above to fill this automatically.',
      },
      { key: 'warehouse', label: 'Warehouse', type: 'text', default: 'COMPUTE_WH', help: 'Compute warehouse used for discovery queries.' },
      { key: 'role', label: 'Role', type: 'text', default: 'ACCOUNTADMIN', help: 'Discovery sees only what this role can see. Prefer a scoped read-only role.' },
      { key: 'database', label: 'Database (optional)', type: 'text', placeholder: 'ANALYTICS' },
      { key: 'schema', label: 'Schema (optional)', type: 'text', placeholder: 'PUBLIC' },
    ],
    credential: {
      required: true,
      label: 'Credential (via secret)',
      help: 'Easiest: a programmatic access token (PAT) — the secret holds {"token":"<PAT>"} (generate it in Snowsight → your user → Programmatic access tokens). Prerequisite: Snowflake refuses every PAT (401 "Network policy is required") until your account has a network policy, or an authentication policy with PAT_POLICY NETWORK_POLICY_EVALUATION set to something other than REQUIRED. Or key-pair: {"privateKeyPem":"-----BEGIN PRIVATE KEY-----\\n…","user":"…","account":"…"}.',
      placeholder: ARN_PLACEHOLDER,
    },
  },
};

/** Initial form values for a connector type, seeded from field defaults. */
export function defaultConfigValues(type: ConnectorType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CONNECTOR_SPECS[type].fields) {
    if (f.default !== undefined) out[f.key] = String(f.default);
  }
  return out;
}

/**
 * Build the connection_config object the API expects from the typed field
 * values, coercing per the field's declared type and dropping empty optionals.
 */
export function buildConnectionConfig(
  type: ConnectorType,
  values: Record<string, string>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of CONNECTOR_SPECS[type].fields) {
    const raw = (values[f.key] ?? '').trim();
    if (raw === '') continue; // omit empties — backend applies its own defaults
    if (f.type === 'number') {
      const n = Number(raw);
      if (!Number.isNaN(n)) config[f.key] = n;
    } else if (f.type === 'boolean') {
      config[f.key] = raw === 'true';
    } else {
      config[f.key] = raw;
    }
  }
  return config;
}
