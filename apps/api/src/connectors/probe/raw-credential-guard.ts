/**
 * Raw credential detection for connector registration.
 *
 * Security rule: connectionConfig must NEVER contain raw credentials.
 * Sensitive values must be stored in AWS Secrets Manager; only the ARN
 * reference is stored in the connectors table.
 */

const FORBIDDEN_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'secretkey',
  'secret_key',
  'accesskey',
  'access_key',
  'accesskeyid',
  'access_key_id',
  'secretaccesskey',
  'secret_access_key',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'token',
  'authtoken',
  'auth_token',
  'bearertoken',
  'bearer_token',
]);

/**
 * Returns the first suspicious field name found in the config, or null if clean.
 */
export function detectRawCredentialKey(
  config: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(config)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      return key;
    }
  }
  return null;
}

/**
 * AWS Secrets Manager ARN pattern.
 * Covers standard, GovCloud (aws-us-gov), and China (aws-cn) partitions.
 */
const ARN_PATTERN =
  /^arn:aws[a-z0-9-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/;

/**
 * Local-dev sentinel pattern. `local-env:VARNAME` instructs
 * `SecretsManagerService` to resolve the secret from `process.env[VARNAME]`
 * instead of AWS. Production deployments never set those env vars, so any
 * accidental use of the sentinel in prod fails closed. Exists so the
 * connector framework is testable end-to-end on a laptop without an AWS
 * account.
 */
const LOCAL_ENV_PATTERN = /^local-env:[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Platform vault reference pattern (ADR-013).
 * `vault:<uuid>` references a row in connectors.connector_secrets that holds
 * an AES-256-GCM encrypted envelope. UUID v4 format: 8-4-4-4-12 hex groups.
 */
const VAULT_PATTERN = /^vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the string is one of the three valid credential reference
 * schemes:
 *   - `arn:aws:secretsmanager:…`  — AWS Secrets Manager (cloud deployments)
 *   - `local-env:VARNAME`          — process.env sentinel (dev/test only)
 *   - `vault:<uuid>`               — platform encrypted store (ADR-013, default)
 *
 * Used to reject credentialArn fields that contain raw values instead of
 * reference-shaped strings. Never accepts a plaintext secret.
 */
export function isValidCredentialArn(arn: string): boolean {
  return ARN_PATTERN.test(arn) || LOCAL_ENV_PATTERN.test(arn) || VAULT_PATTERN.test(arn);
}
