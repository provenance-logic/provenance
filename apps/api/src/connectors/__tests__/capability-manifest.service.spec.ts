import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CapabilityManifestService } from '../capability-manifest.service.js';
import { CapabilityManifestEntity } from '../entities/capability-manifest.entity.js';

const now = new Date('2026-05-21T00:00:00Z');

const makeManifest = (
  overrides: Partial<CapabilityManifestEntity> = {},
): CapabilityManifestEntity => ({
  id: 'm-1',
  connectorType: 'databricks',
  version: '1.0.0',
  supportsProbe: true,
  supportsSchemaInference: true,
  supportsDiscoveryCrawl: true,
  supportsLineageEmission: false,
  supportsLineageDiscovery: false,
  discoveryGranularity: 'column_level',
  reCrawlIntervalHoursDefault: 24,
  capabilitiesDoc: { credentialFormat: { type: 'pat' } },
  createdAt: now,
  ...overrides,
});

describe('CapabilityManifestService', () => {
  let service: CapabilityManifestService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    repo = { find: jest.fn(), findOne: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        CapabilityManifestService,
        { provide: getRepositoryToken(CapabilityManifestEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(CapabilityManifestService);
  });

  describe('listManifests', () => {
    it('returns all manifests in the expected API shape', async () => {
      repo.find.mockResolvedValue([makeManifest()]);

      const result = await service.listManifests();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        connectorType: 'databricks',
        version: '1.0.0',
        supportsProbe: true,
        supportsDiscoveryCrawl: true,
        discoveryGranularity: 'column_level',
        reCrawlIntervalHoursDefault: 24,
      });
      expect(result[0].createdAt).toBe(now.toISOString());
    });

    it('returns empty array when no manifests are registered', async () => {
      repo.find.mockResolvedValue([]);
      expect(await service.listManifests()).toEqual([]);
    });
  });

  describe('getLatestForType', () => {
    it('returns the manifest for a known connector type', async () => {
      repo.findOne.mockResolvedValue(makeManifest());

      const result = await service.getLatestForType('databricks');

      expect(result).not.toBeNull();
      expect(result?.connectorType).toBe('databricks');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { connectorType: 'databricks' },
        order: { version: 'DESC' },
      });
    });

    it('returns null when no manifest exists for the type', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.getLatestForType('redshift')).toBeNull();
    });
  });

  describe('getLatestForTypeOrThrow', () => {
    it('throws NotFoundException when the type has no manifest', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.getLatestForTypeOrThrow('redshift'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the manifest when found', async () => {
      repo.findOne.mockResolvedValue(makeManifest());
      const result = await service.getLatestForTypeOrThrow('databricks');
      expect(result.connectorType).toBe('databricks');
    });
  });

  describe('immutability surface', () => {
    it('exposes no write methods on the service', () => {
      // Belt-and-suspenders against accidental future regression.
      // CLAUDE.md: "Connector capability manifests are immutable per version.
      // Never mutate a capability manifest in place — create a new connector
      // version." This means the service must never grow update/delete/save
      // surface; new manifests land via Flyway migrations only.
      const proto = Object.getPrototypeOf(service) as Record<string, unknown>;
      const methods = Object.getOwnPropertyNames(proto);
      for (const m of methods) {
        expect(m).not.toMatch(/^(update|delete|remove|save|create)/i);
      }
    });
  });
});
