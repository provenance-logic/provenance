import type { ConnectorType } from '@provenance/types';

// Declarative per-connector registration spec (ADR-012, decision 1; ADR-013 credential vault).
//
// Each connector type declares its non-sensitive connection_config fields (rendered
// as typed, labeled inputs) and a credential definition describing the secret input
// fields the user fills in directly (ADR-013 self-service vault path). The form
// assembles `credentialSecret` from those inputs and submits to the API, which
// encrypts it at rest (AES-256-GCM) and returns a `vault:<uuid>` reference in
// `credentialArn`. The plaintext secret never comes back.
//
// An "Advanced" affordance lets operators supply a pre-staged ARN or local-env
// sentinel directly in `credentialArn` instead.

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

/**
 * A single masked input field in the self-service secret entry form (ADR-013).
 * The `key` maps to a property in the `credentialSecret` object the form assembles.
 */
export interface SecretFieldSpec {
  /** Key in the assembled credentialSecret object (e.g. "token", "privateKeyPem"). */
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
}

export interface CredentialSpec {
  required: boolean;
  label: string;
  /** Describes what the user should enter; shown as section help text. */
  help: string;
  /**
   * Secret input fields the user fills in directly (ADR-013 self-service path).
   * The form assembles these into `credentialSecret` and submits to the API.
   * The plaintext is encrypted at rest server-side and is never returned.
   */
  secretFields: SecretFieldSpec[];
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
      label: 'Database credentials (optional)',
      help: 'Leave blank if the database allows unauthenticated connections.',
      secretFields: [
        { key: 'username', label: 'Username', placeholder: 'provenance_reader' },
        { key: 'password', label: 'Password', placeholder: '••••••••' },
      ],
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
      label: 'AWS credentials (optional)',
      help: "Leave blank to use the platform's ambient IAM identity. Fill in for cross-account buckets.",
      secretFields: [
        { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AKIA…' },
        { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '••••••••' },
      ],
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
      label: 'Personal access token',
      help: 'Generate in Databricks → Settings → Developer → Access tokens.',
      secretFields: [
        {
          key: 'token',
          label: 'Access token',
          placeholder: 'dapi…',
          required: true,
        },
      ],
    },
  },
  snowflake: {
    type: 'snowflake',
    label: 'Snowflake',
    blurb: 'Connect a Snowflake account (INFORMATION_SCHEMA discovery + OBJECT_DEPENDENCIES lineage).',
    smartFill: {
      label: 'Paste your Snowflake URL or account identifier',
      placeholder: 'https://xy12345.us-east-1.snowflakecomputing.com  (or  xy12345.us-east-1)',
      help: "We'll fill in the host below and show your account identifier for the credential.",
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
      label: 'Programmatic access token (PAT)',
      help: 'Generate in Snowsight → your user → Programmatic access tokens. For key-pair auth, use the Advanced option below.',
      secretFields: [
        {
          key: 'token',
          label: 'Access token (PAT)',
          placeholder: '••••••••',
          help: 'Note: Snowflake requires a network policy before PATs can be used.',
          required: true,
        },
      ],
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

/**
 * Assembles the `credentialSecret` object from the secret field values.
 * Drops empty-string values so the backend doesn't receive blank keys.
 * Returns null when all fields are empty (no credential provided).
 */
export function buildCredentialSecret(
  type: ConnectorType,
  values: Record<string, string>,
): Record<string, string> | null {
  const spec = CONNECTOR_SPECS[type];
  const secret: Record<string, string> = {};
  for (const f of spec.credential.secretFields) {
    const raw = (values[f.key] ?? '').trim();
    if (raw !== '') secret[f.key] = raw;
  }
  return Object.keys(secret).length > 0 ? secret : null;
}
