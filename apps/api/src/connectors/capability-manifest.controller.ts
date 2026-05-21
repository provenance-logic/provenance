import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityManifestService } from './capability-manifest.service.js';

/**
 * Read-only API surface for connector capability manifests (B-063 Layer 3b).
 *
 * Mounted at the platform level (not under /organizations/:orgId) because
 * capability manifests are global facts about the platform, not per-tenant
 * state. Frontend uses these to know whether to show the "Crawl" button on
 * a registered connector, what credential shape to ask for at registration
 * time, etc.
 */
@UseGuards(JwtAuthGuard)
@Controller('connector-capability-manifests')
export class CapabilityManifestController {
  constructor(private readonly service: CapabilityManifestService) {}

  @Get()
  list() {
    return this.service.listManifests();
  }

  @Get(':connectorType')
  getByType(@Param('connectorType') connectorType: string) {
    return this.service.getLatestForTypeOrThrow(connectorType);
  }
}
