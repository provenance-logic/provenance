import { SecretsManagerService } from './secrets-manager.service.js';
import { isValidCredentialArn } from './raw-credential-guard.js';

describe('SecretsManagerService — local-env sentinel (B-063)', () => {
  let service: SecretsManagerService;

  beforeEach(() => {
    service = new SecretsManagerService();
    delete process.env.TEST_LOCAL_SECRET;
  });

  afterEach(() => {
    delete process.env.TEST_LOCAL_SECRET;
  });

  it('resolves a local-env sentinel by reading the named env var', async () => {
    process.env.TEST_LOCAL_SECRET = '{"token":"dapi-from-env"}';

    const result = await service.getSecretValue('local-env:TEST_LOCAL_SECRET');

    expect(result).toEqual({ token: 'dapi-from-env' });
  });

  it('throws a clear error when the named env var is not set', async () => {
    await expect(
      service.getSecretValue('local-env:NEVER_SET_VAR_NAME'),
    ).rejects.toThrow(/not set in the environment/);
  });

  it('throws a clear error when the env var value is not valid JSON', async () => {
    process.env.TEST_LOCAL_SECRET = 'this is not json';

    await expect(
      service.getSecretValue('local-env:TEST_LOCAL_SECRET'),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the env var value is JSON but not an object', async () => {
    process.env.TEST_LOCAL_SECRET = '"just a string"';

    await expect(
      service.getSecretValue('local-env:TEST_LOCAL_SECRET'),
    ).rejects.toThrow(/not valid JSON object/);
  });
});

describe('isValidCredentialArn — sentinel format accepted (B-063)', () => {
  it('accepts a standard AWS Secrets Manager ARN', () => {
    expect(
      isValidCredentialArn(
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-AbCdEf',
      ),
    ).toBe(true);
  });

  it('accepts GovCloud and China partition ARNs', () => {
    expect(
      isValidCredentialArn(
        'arn:aws-us-gov:secretsmanager:us-gov-west-1:123456789012:secret:my-secret-X',
      ),
    ).toBe(true);
    expect(
      isValidCredentialArn(
        'arn:aws-cn:secretsmanager:cn-north-1:123456789012:secret:my-secret-X',
      ),
    ).toBe(true);
  });

  it('accepts the local-env sentinel for valid env var names', () => {
    expect(isValidCredentialArn('local-env:MY_TOKEN')).toBe(true);
    expect(isValidCredentialArn('local-env:_PRIVATE')).toBe(true);
    expect(isValidCredentialArn('local-env:mixedCase123')).toBe(true);
  });

  it('rejects a malformed local-env sentinel', () => {
    expect(isValidCredentialArn('local-env:')).toBe(false);
    expect(isValidCredentialArn('local-env:1starts-with-digit')).toBe(false);
    expect(isValidCredentialArn('local-env:has spaces')).toBe(false);
    expect(isValidCredentialArn('local-env:has-dashes')).toBe(false);
  });

  it('rejects raw values that pretend to be ARNs', () => {
    expect(isValidCredentialArn('dapi-just-a-pat-token')).toBe(false);
    expect(isValidCredentialArn('not-an-arn')).toBe(false);
    expect(isValidCredentialArn('')).toBe(false);
  });
});
