import { EncryptionService } from '../encryption.service.js';

const DEV_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('EncryptionService', () => {
  let svc: EncryptionService;

  beforeEach(() => {
    process.env.CONNECTION_DETAILS_DEV_KEY = DEV_KEY;
    delete process.env.CONNECTION_DETAILS_SECRET_ARN;
    svc = new EncryptionService();
  });

  it('round-trips a JSON payload through encrypt + decrypt', async () => {
    const payload = { host: 'db.example.com', password: 'hunter2' };
    const envelope = await svc.encrypt(payload);
    const decrypted = await svc.decrypt(envelope);
    expect(decrypted).toEqual(payload);
  });

  it('emits an envelope with version + iv + authTag + ciphertext', async () => {
    const envelope = await svc.encrypt({ a: 1 });
    expect(envelope).toEqual(
      expect.objectContaining({
        version: expect.any(Number),
        iv: expect.any(String),
        authTag: expect.any(String),
        ciphertext: expect.any(String),
      }),
    );
  });

  it('produces a different ciphertext for the same plaintext each call (unique IV)', async () => {
    const a = await svc.encrypt({ x: 1 });
    const b = await svc.encrypt({ x: 1 });
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.iv).not.toEqual(b.iv);
  });

  it('fails to decrypt a tampered ciphertext', async () => {
    const envelope = await svc.encrypt({ host: 'h' });
    // Flip the last char to *something different* — naively replacing with '0'
    // is a no-op ~1/64 of the time when the ciphertext already ends in '0',
    // which made this test flake on CI. Ensure the tampered string is always
    // distinct from the original.
    const last = envelope.ciphertext.slice(-1);
    const replacement = last === '0' ? '1' : '0';
    const tampered = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -1) + replacement,
    };
    await expect(svc.decrypt(tampered)).rejects.toThrow();
  });

  it('isEnvelope() detects encrypted blobs vs plain records', () => {
    expect(
      EncryptionService.isEnvelope({ version: 1, iv: 'x', authTag: 'y', ciphertext: 'z' }),
    ).toBe(true);
    expect(EncryptionService.isEnvelope({ host: 'h', password: 'p' })).toBe(false);
    expect(EncryptionService.isEnvelope(null)).toBe(false);
  });

  it('throws at construction when neither ARN nor dev key is configured', () => {
    delete process.env.CONNECTION_DETAILS_DEV_KEY;
    delete process.env.CONNECTION_DETAILS_SECRET_ARN;
    expect(() => new EncryptionService()).toThrow(/CONNECTION_DETAILS_/);
  });

  it('rejects a dev key of the wrong length', () => {
    process.env.CONNECTION_DETAILS_DEV_KEY = 'deadbeef';
    expect(() => new EncryptionService()).toThrow();
  });
});
