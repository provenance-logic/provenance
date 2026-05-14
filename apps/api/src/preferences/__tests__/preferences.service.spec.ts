import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PreferencesService } from '../preferences.service.js';
import { PrincipalPreferencesEntity } from '../../organizations/entities/principal-preferences.entity.js';

const mockPrefsRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((dto) => dto),
  save: jest.fn((row) => Promise.resolve({
    ...row,
    createdAt: row.createdAt ?? new Date('2026-05-14T00:00:00Z'),
    updatedAt: new Date('2026-05-14T00:01:00Z'),
  })),
});

describe('PreferencesService (F7.46)', () => {
  let service: PreferencesService;
  let repo: ReturnType<typeof mockPrefsRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PreferencesService,
        { provide: getRepositoryToken(PrincipalPreferencesEntity), useFactory: mockPrefsRepo },
      ],
    }).compile();
    service = module.get(PreferencesService);
    repo = module.get(getRepositoryToken(PrincipalPreferencesEntity));
  });

  describe('getPreferences', () => {
    it('returns empty preferences when no row exists yet (first-load case)', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.getPreferences('org-1', 'p-1');

      expect(result.preferences).toEqual({});
      // Epoch updatedAt — the wizard treats absence as "fresh user".
      expect(new Date(result.updatedAt).getTime()).toBe(0);
    });

    it('returns the persisted preferences shape when a row exists', async () => {
      const onboarding = {
        completedSteps: ['confirm_org'],
        skippedSteps: [],
        completedAt: null,
        dismissedAt: null,
        lastStep: 'invite_team',
      };
      repo.findOne.mockResolvedValue({
        principalId: 'p-1',
        orgId: 'org-1',
        preferences: { onboarding },
        createdAt: new Date('2026-05-14T00:00:00Z'),
        updatedAt: new Date('2026-05-14T00:05:00Z'),
      });

      const result = await service.getPreferences('org-1', 'p-1');

      expect(result.preferences.onboarding).toEqual(onboarding);
      expect(result.updatedAt).toBe('2026-05-14T00:05:00.000Z');
    });
  });

  describe('updatePreferences', () => {
    it('creates a new row on first write', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.updatePreferences('org-1', 'p-1', {
        onboarding: {
          completedSteps: ['confirm_org'],
          skippedSteps: [],
          completedAt: null,
          dismissedAt: null,
          lastStep: 'invite_team',
        },
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        principalId: 'p-1',
        orgId: 'org-1',
      }));
      expect(repo.save).toHaveBeenCalled();
    });

    it('merges the patch into an existing preferences blob at the top level', async () => {
      repo.findOne.mockResolvedValue({
        principalId: 'p-1',
        orgId: 'org-1',
        preferences: {
          onboarding: { completedSteps: ['confirm_org'], skippedSteps: [], completedAt: null, dismissedAt: null, lastStep: 'invite_team' },
        },
        createdAt: new Date('2026-05-14T00:00:00Z'),
        updatedAt: new Date('2026-05-14T00:01:00Z'),
      });

      await service.updatePreferences('org-1', 'p-1', {
        onboarding: { completedSteps: ['confirm_org', 'invite_team'], skippedSteps: [], completedAt: null, dismissedAt: null, lastStep: 'publish_product' },
      });

      // The whole `onboarding` key is replaced (replace-at-top-level
      // merge), not recursively merged — the test confirms the new
      // state wins rather than the old state's `lastStep` being preserved.
      const persisted = repo.save.mock.calls[0][0];
      expect(persisted.preferences.onboarding.lastStep).toBe('publish_product');
      expect(persisted.preferences.onboarding.completedSteps).toEqual(['confirm_org', 'invite_team']);
    });
  });
});
