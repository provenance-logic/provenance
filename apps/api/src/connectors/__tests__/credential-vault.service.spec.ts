import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConnectorCredentialVaultService, isVaultRef, VAULT_PREFIX } from '../credential-vault.service.js';
import { ConnectorSecretEntity } from '../entities/connector-secret.entity.js';
import { EncryptionService } from '../../common/encryption.service.js';
import type { EncryptedEnvelope } from '../../common/encryption.service.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeEnvelope(): EncryptedEnvelope {
  return { version: 1, iv: 'aWk=', authTag: 'dGFn', ciphertext: 'Y2lwaGVy' };
}

function mockEncryption(): jest.Mocked<EncryptionService> {
  return {
    encrypt: jest.fn().mockResolvedValue(makeEnvelope()),
    decrypt: jest.fn().mockResolvedValue({ token: 'dapi-test' }),
  } as unknown as jest.Mocked<EncryptionService>;
}

const mockRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000002';
const SECRET_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeEntity(overrides: Partial<ConnectorSecretEntity> = {}): ConnectorSecretEntity {
  return {
    id: SECRET_ID,
    orgId: ORG_A,
    envelope: makeEnvelope(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectorCredentialVaultService', () => {
  let service: ConnectorCredentialVaultService;
  let encryption: jest.Mocked<EncryptionService>;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectorCredentialVaultService,
        { provide: EncryptionService, useFactory: mockEncryption },
        { provide: getRepositoryToken(ConnectorSecretEntity), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(ConnectorCredentialVaultService);
    encryption = module.get(EncryptionService);
    repo = module.get(getRepositoryToken(ConnectorSecretEntity));
  });

  // ── isVaultRef / VAULT_PREFIX ────────────────────────────────────────────

  describe('isVaultRef()', () => {
    it('returns true for a vault: prefixed UUID', () => {
      expect(isVaultRef(`vault:${SECRET_ID}`)).toBe(true);
    });

    it('returns false for an ARN', () => {
      expect(isVaultRef('arn:aws:secretsmanager:us-east-1:123456789012:secret:x')).toBe(false);
    });

    it('returns false for a local-env sentinel', () => {
      expect(isVaultRef('local-env:MY_VAR')).toBe(false);
    });

    it('returns false for a bare UUID without vault: prefix', () => {
      expect(isVaultRef(SECRET_ID)).toBe(false);
    });

    it('exports VAULT_PREFIX as "vault:"', () => {
      expect(VAULT_PREFIX).toBe('vault:');
    });
  });

  // ── store() ──────────────────────────────────────────────────────────────

  describe('store() — new secret', () => {
    beforeEach(() => {
      repo.create.mockReturnValue(makeEntity());
      repo.save.mockResolvedValue(makeEntity());
    });

    it('encrypts the secret and returns a vault: reference', async () => {
      const ref = await service.store(ORG_A, { token: 'dapi-test' });
      expect(ref).toMatch(/^vault:[0-9a-f-]{36}$/i);
      expect(encryption.encrypt).toHaveBeenCalledWith({ token: 'dapi-test' });
    });

    it('never persists the plaintext — saves only the envelope', async () => {
      await service.store(ORG_A, { token: 'dapi-test' });
      const savedArg = (repo.save as jest.Mock).mock.calls[0][0] as ConnectorSecretEntity;
      expect(savedArg.envelope).toEqual(makeEnvelope());
      // No plaintext field anywhere in what was saved
      expect(JSON.stringify(savedArg)).not.toContain('dapi-test');
    });

    it('sets orgId on the persisted entity', async () => {
      await service.store(ORG_A, { token: 'dapi-test' });
      const createArg = (repo.create as jest.Mock).mock.calls[0][0] as Partial<ConnectorSecretEntity>;
      expect(createArg.orgId).toBe(ORG_A);
    });
  });

  describe('store() — credential rotation (existingRef provided)', () => {
    it('overwrites the envelope when existingRef matches an existing vault row', async () => {
      const existing = makeEntity();
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(existing);

      const ref = await service.store(ORG_A, { token: 'new-token' }, `vault:${SECRET_ID}`);

      // Returns the same ref (same row, overwritten)
      expect(ref).toBe(`vault:${SECRET_ID}`);
      // save called once with the existing entity (mutated envelope)
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates a new row when existingRef is not found (org mismatch or not exists)', async () => {
      repo.findOne.mockResolvedValue(null); // row not found for this org
      repo.create.mockReturnValue(makeEntity());
      repo.save.mockResolvedValue(makeEntity());

      const ref = await service.store(ORG_A, { token: 'new-token' }, `vault:${SECRET_ID}`);

      expect(ref).toMatch(/^vault:/);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('ignores a non-vault existingRef and creates fresh', async () => {
      repo.create.mockReturnValue(makeEntity());
      repo.save.mockResolvedValue(makeEntity());

      // ARN passed as existingRef — not a vault ref, treat as "no existing"
      await service.store(ORG_A, { token: 'tok' }, 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x');

      expect(repo.findOne).not.toHaveBeenCalled(); // no lookup for non-vault ref
      expect(repo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── resolve() ────────────────────────────────────────────────────────────

  describe('resolve()', () => {
    it('decrypts and returns the secret object', async () => {
      repo.findOne.mockResolvedValue(makeEntity());
      const result = await service.resolve(ORG_A, `vault:${SECRET_ID}`);
      expect(result).toEqual({ token: 'dapi-test' });
      expect(encryption.decrypt).toHaveBeenCalledWith(makeEnvelope());
    });

    it('is org-scoped — ORG_B cannot resolve ORG_A\'s secret', async () => {
      // findOne filtered on {id, orgId} returns null for wrong org
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolve(ORG_B, `vault:${SECRET_ID}`))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the vault row does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolve(ORG_A, `vault:${SECRET_ID}`))
        .rejects.toThrow(NotFoundException);
    });

    it('throws when called with a non-vault ref', async () => {
      await expect(service.resolve(ORG_A, 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x'))
        .rejects.toThrow(/vault:/);
    });
  });
});
