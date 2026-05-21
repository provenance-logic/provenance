import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CapabilityManifestEntity,
  type DiscoveryGranularity,
} from './entities/capability-manifest.entity.js';

export interface CapabilityManifest {
  id: string;
  connectorType: string;
  version: string;
  supportsProbe: boolean;
  supportsSchemaInference: boolean;
  supportsDiscoveryCrawl: boolean;
  supportsLineageEmission: boolean;
  supportsLineageDiscovery: boolean;
  discoveryGranularity: DiscoveryGranularity | null;
  reCrawlIntervalHoursDefault: number | null;
  capabilitiesDoc: Record<string, unknown>;
  createdAt: string;
}

/**
 * Read-only service for connector capability manifests.
 *
 * Per CLAUDE.md: "Connector capability manifests are immutable per version.
 * Never mutate a capability manifest in place — create a new connector
 * version." This service deliberately exposes NO write surface. New
 * manifests land via Flyway migrations (see V31). When a connector type's
 * behavior changes (e.g. lineage discovery ships in B-063 Layer 4), the
 * fix is a new migration inserting a v1.1.0 row, not an update of v1.0.0.
 */
@Injectable()
export class CapabilityManifestService {
  constructor(
    @InjectRepository(CapabilityManifestEntity)
    private readonly repo: Repository<CapabilityManifestEntity>,
  ) {}

  async listManifests(): Promise<CapabilityManifest[]> {
    const rows = await this.repo.find({
      order: { connectorType: 'ASC', version: 'DESC' },
    });
    return rows.map((r) => this.toManifest(r));
  }

  /**
   * Returns the latest-version manifest for a connector type, or null if
   * the type has no manifest at all. "Latest version" here is the
   * lexicographically-highest version string (works for the SemVer-shaped
   * versions we use); when manifests grow beyond simple SemVer we'll need
   * a real version comparator.
   */
  async getLatestForType(connectorType: string): Promise<CapabilityManifest | null> {
    const row = await this.repo.findOne({
      where: { connectorType },
      order: { version: 'DESC' },
    });
    return row ? this.toManifest(row) : null;
  }

  async getLatestForTypeOrThrow(connectorType: string): Promise<CapabilityManifest> {
    const manifest = await this.getLatestForType(connectorType);
    if (!manifest) {
      throw new NotFoundException(
        `No capability manifest registered for connector type '${connectorType}'`,
      );
    }
    return manifest;
  }

  private toManifest(row: CapabilityManifestEntity): CapabilityManifest {
    return {
      id: row.id,
      connectorType: row.connectorType,
      version: row.version,
      supportsProbe: row.supportsProbe,
      supportsSchemaInference: row.supportsSchemaInference,
      supportsDiscoveryCrawl: row.supportsDiscoveryCrawl,
      supportsLineageEmission: row.supportsLineageEmission,
      supportsLineageDiscovery: row.supportsLineageDiscovery,
      discoveryGranularity: row.discoveryGranularity,
      reCrawlIntervalHoursDefault: row.reCrawlIntervalHoursDefault,
      capabilitiesDoc: row.capabilitiesDoc,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
