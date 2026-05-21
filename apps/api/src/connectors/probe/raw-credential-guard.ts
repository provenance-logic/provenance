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
 * Returns true if the string looks like a valid Secrets Manager ARN, or
 * the local-dev environment-variable sentinel. Used to reject credentialArn
 * fields that contain raw values instead of ARN-shaped references.
 */
export function isValidCredentialArn(arn: string): boolean {
  return ARN_PATTERN.test(arn) || LOCAL_ENV_PATTERN.test(arn);
}
