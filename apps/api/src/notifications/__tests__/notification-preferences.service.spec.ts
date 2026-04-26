import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { NotificationPreferencesService } from '../notification-preferences.service.js';
import { NotificationPreferenceEntity } from '../entities/notification-preference.entity.js';
import { PrincipalNotificationSettingsEntity } from '../entities/principal-notification-settings.entity.js';

const ORG_ID = 'org-1';
const PRINCIPAL_A = 'principal-a';

function makeRow(
  overrides: Partial<NotificationPreferenceEntity> = {},
): NotificationPreferenceEntity {
  return {
    orgId: ORG_ID,
    principalId: PRINCIPAL_A,
    category: 'slo_violation',
    enabled: true,
    channels: [],
    updatedAt: new Date('2026-04-26T12:00:00Z'),
    ...overrides,
  };
}

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };
  let settingsRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          updatedAt: new Date('2026-04-26T12:00:00Z'),
        }),
      ),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    settingsRepo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          updatedAt: new Date('2026-04-26T12:00:00Z'),
        }),
      ),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: getRepositoryToken(NotificationPreferenceEntity), useValue: repo },
        { provide: getRepositoryToken(PrincipalNotificationSettingsEntity), useValue: settingsRepo },
      ],
    }).compile();
    service = moduleRef.get(NotificationPreferencesService);
  });

  describe('list', () => {
    it('returns all rows for the calling principal ordered by category', async () => {
      repo.find.mockResolvedValue([
        makeRow({ category: 'slo_violation' }),
        makeRow({ category: 'access_request_submitted' }),
      ]);
      const result = await service.list(ORG_ID, PRINCIPAL_A);
      expect(result).toHaveLength(2);
      expect(repo.find).toHaveBeenCalledWith({
        where: { orgId: ORG_ID, principalId: PRINCIPAL_A },
        order: { category: 'ASC' },
      });
    });
  });

  describe('loadByRecipients', () => {
    it('returns an empty map when no recipients are supplied', async () => {
      const result = await service.loadByRecipients(ORG_ID, []);
      expect(result.size).toBe(0);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('keys results by `${principalId}::${category}` for fast resolver lookup', async () => {
      repo.find.mockResolvedValue([
        makeRow({ principalId: PRINCIPAL_A, category: 'slo_violation' }),
        makeRow({ principalId: 'principal-b', category: 'product_deprecated' }),
      ]);
      const result = await service.loadByRecipients(ORG_ID, [PRINCIPAL_A, 'principal-b']);
      expect(result.size).toBe(2);
      expect(result.has(`${PRINCIPAL_A}::slo_violation`)).toBe(true);
      expect(result.has(`principal-b::product_deprecated`)).toBe(true);
    });
  });

  describe('upsert', () => {
    it('creates a new row when none exists', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.upsert(ORG_ID, PRINCIPAL_A, 'slo_violation', {
        enabled: false,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.orgId).toBe(ORG_ID);
      expect(savedArg.principalId).toBe(PRINCIPAL_A);
      expect(savedArg.category).toBe('slo_violation');
      expect(savedArg.enabled).toBe(false);
      expect(result.enabled).toBe(false);
    });

    it('merges into the existing row, leaving unchanged fields alone', async () => {
      const existing = makeRow({ enabled: true, channels: ['email'] });
      repo.findOne.mockResolvedValue(existing);
      // Update only enabled — channels override should remain.
      await service.upsert(ORG_ID, PRINCIPAL_A, 'slo_violation', {
        enabled: false,
      });
      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.enabled).toBe(false);
      expect(savedArg.channels).toEqual(['email']);
    });

    it('rejects unknown channel values', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.upsert(ORG_ID, PRINCIPAL_A, 'slo_violation', {
          channels: ['email', 'pigeon' as 'email'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects duplicate channel entries', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.upsert(ORG_ID, PRINCIPAL_A, 'slo_violation', {
          channels: ['email', 'email'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an empty channels array as "clear override"', async () => {
      repo.findOne.mockResolvedValue(makeRow({ channels: ['email'] }));
      await service.upsert(ORG_ID, PRINCIPAL_A, 'slo_violation', {
        channels: [],
      });
      const savedArg = repo.save.mock.calls[0][0];
      expect(savedArg.channels).toEqual([]);
    });
  });

  describe('reset', () => {
    it('deletes the preference row', async () => {
      await service.reset(PRINCIPAL_A, 'slo_violation');
      expect(repo.delete).toHaveBeenCalledWith({
        principalId: PRINCIPAL_A,
        category: 'slo_violation',
      });
    });
  });

  describe('settings — getSettings', () => {
    it('returns a synthetic null-webhook record when no settings row exists', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.getSettings(ORG_ID, PRINCIPAL_A);
      expect(result.principalId).toBe(PRINCIPAL_A);
      expect(result.webhookUrl).toBeNull();
    });

    it('returns the saved row when one exists', async () => {
      settingsRepo.findOne.mockResolvedValue({
        orgId: ORG_ID,
        principalId: PRINCIPAL_A,
        webhookUrl: 'https://hooks.example.com/abc',
        updatedAt: new Date('2026-04-26T12:00:00Z'),
      });
      const result = await service.getSettings(ORG_ID, PRINCIPAL_A);
      expect(result.webhookUrl).toBe('https://hooks.example.com/abc');
    });
  });

  describe('settings — upsertSettings', () => {
    it('creates a new row with the supplied URL', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.upsertSettings(ORG_ID, PRINCIPAL_A, {
        webhookUrl: 'https://hooks.example.com/abc',
      });
      expect(settingsRepo.save).toHaveBeenCalledTimes(1);
      expect(result.webhookUrl).toBe('https://hooks.example.com/abc');
    });

    it('clears the URL when null is supplied', async () => {
      settingsRepo.findOne.mockResolvedValue({
        orgId: ORG_ID,
        principalId: PRINCIPAL_A,
        webhookUrl: 'https://old.example.com/hook',
        updatedAt: new Date(),
      });
      const result = await service.upsertSettings(ORG_ID, PRINCIPAL_A, {
        webhookUrl: null,
      });
      expect(result.webhookUrl).toBeNull();
    });

    it('treats an empty string as a clear request', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const result = await service.upsertSettings(ORG_ID, PRINCIPAL_A, {
        webhookUrl: '',
      });
      expect(result.webhookUrl).toBeNull();
    });

    it('rejects non-https URLs', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.upsertSettings(ORG_ID, PRINCIPAL_A, {
          webhookUrl: 'http://example.com/hook',
        }),
      ).rejects.toThrow('https');
    });

    it('rejects malformed URLs', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.upsertSettings(ORG_ID, PRINCIPAL_A, {
          webhookUrl: 'not a url',
        }),
      ).rejects.toThrow('valid URL');
    });

    it('rejects URLs over the length cap', async () => {
      settingsRepo.findOne.mockResolvedValue(null);
      const huge = 'https://example.com/' + 'a'.repeat(2100);
      await expect(
        service.upsertSettings(ORG_ID, PRINCIPAL_A, { webhookUrl: huge }),
      ).rejects.toThrow('maximum length');
    });
  });

  describe('settings — loadWebhookUrls', () => {
    it('returns an empty map for empty principal list', async () => {
      const result = await service.loadWebhookUrls(ORG_ID, []);
      expect(result.size).toBe(0);
      expect(settingsRepo.find).not.toHaveBeenCalled();
    });

    it('skips principals whose settings row has a null webhookUrl', async () => {
      settingsRepo.find.mockResolvedValue([
        {
          orgId: ORG_ID,
          principalId: PRINCIPAL_A,
          webhookUrl: 'https://a.example.com/hook',
          updatedAt: new Date(),
        },
        {
          orgId: ORG_ID,
          principalId: 'principal-b',
          webhookUrl: null,
          updatedAt: new Date(),
        },
      ]);
      const result = await service.loadWebhookUrls(ORG_ID, [PRINCIPAL_A, 'principal-b']);
      expect(result.size).toBe(1);
      expect(result.get(PRINCIPAL_A)).toBe('https://a.example.com/hook');
      expect(result.has('principal-b')).toBe(false);
    });
  });
});
