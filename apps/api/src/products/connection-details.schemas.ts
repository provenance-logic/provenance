import { z } from 'zod';
import type { ConnectionDetails, OutputPortInterfaceType } from '@provenance/types';

// ---------------------------------------------------------------------------
// Per-interface-type Zod schemas (F10.5). Semantic query endpoints are
// auto-populated by the platform at port registration — never user-supplied —
// so they do not have a user-facing schema here.
// ---------------------------------------------------------------------------

export const sqlJdbcConnectionDetailsSchema = z.object({
  kind: z.literal('sql_jdbc'),
  host: z.string().min(1),
  port: z.number().int().positive(),
  database: z.string().min(1),
  schema: z.string().min(1),
  authMethod: z.enum(['username_password', 'iam', 'certificate']),
  sslMode: z.enum(['disable', 'require', 'verify-ca', 'verify-full']),
  jdbcUrlTemplate: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

export const restApiConnectionDetailsSchema = z.object({
  kind: z.literal('rest_api'),
  baseUrl: z.string().url(),
  authMethod: z.enum(['api_key', 'oauth2', 'bearer_token', 'none']),
  apiVersion: z.string().optional(),
  requiredHeaders: z.record(z.string()).optional(),
  rateLimit: z
    .object({ requests: z.number().int().positive(), perSeconds: z.number().int().positive() })
    .optional(),
  apiKey: z.string().optional(),
  bearerToken: z.string().optional(),
  oauth2ClientId: z.string().optional(),
  oauth2ClientSecret: z.string().optional(),
  oauth2TokenUrl: z.string().url().optional(),
});

export const graphQlConnectionDetailsSchema = z.object({
  kind: z.literal('graphql'),
  endpointUrl: z.string().url(),
  authMethod: z.enum(['api_key', 'oauth2', 'bearer_token', 'none']),
  introspectionEndpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
  bearerToken: z.string().optional(),
});

export const kafkaConnectionDetailsSchema = z.object({
  kind: z.literal('streaming_topic'),
  bootstrapServers: z.string().min(1),
  topic: z.string().min(1),
  authMethod: z.enum(['sasl_plain', 'sasl_scram', 'mtls', 'none']),
  consumerGroupPrefix: z.string().optional(),
  schemaRegistryUrl: z.string().url().optional(),
  saslUsername: z.string().optional(),
  saslPassword: z.string().optional(),
  clientCertPem: z.string().optional(),
  clientKeyPem: z.string().optional(),
});

export const fileExportConnectionDetailsSchema = z.object({
  kind: z.literal('file_object_export'),
  storage: z.enum(['s3', 'gcs', 'adls']),
  bucket: z.string().min(1),
  pathPrefix: z.string(),
  authMethod: z.enum(['iam', 'service_account', 'access_key']),
  fileFormat: z.enum(['parquet', 'avro', 'json', 'csv', 'orc']),
  compression: z.enum(['none', 'gzip', 'snappy', 'zstd']).optional(),
  storageEndpoint: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  serviceAccountJson: z.string().optional(),
});

const SCHEMA_BY_INTERFACE: Partial<Record<OutputPortInterfaceType, z.ZodType>> = {
  sql_jdbc: sqlJdbcConnectionDetailsSchema,
  rest_api: restApiConnectionDetailsSchema,
  graphql: graphQlConnectionDetailsSchema,
  streaming_topic: kafkaConnectionDetailsSchema,
  file_object_export: fileExportConnectionDetailsSchema,
};

/**
 * Validate a connection-details payload against the schema for the given
 * interface type. Throws a ZodError on failure. Semantic query endpoints
 * reject any user-supplied payload — those are platform-populated.
 */
export function validateConnectionDetails(
  interfaceType: OutputPortInterfaceType,
  details: unknown,
): ConnectionDetails {
  const schema = SCHEMA_BY_INTERFACE[interfaceType];
  if (!schema) {
    throw new Error(
      `Connection details are not user-configurable for interface type '${interfaceType}'`,
    );
  }
  return schema.parse(details) as ConnectionDetails;
}

/** Fields that carry credentials and must never appear in a redacted preview. */
const CREDENTIAL_FIELDS = new Set<string>([
  'username',
  'password',
  'apiKey',
  'bearerToken',
  'oauth2ClientId',
  'oauth2ClientSecret',
  'oauth2TokenUrl',
  'saslUsername',
  'saslPassword',
  'clientCertPem',
  'clientKeyPem',
  'accessKeyId',
  'secretAccessKey',
  'serviceAccountJson',
]);

/** True if the field name is a credential (do not leak in previews or logs). */
export function isCredentialField(fieldName: string): boolean {
  return CREDENTIAL_FIELDS.has(fieldName);
}
