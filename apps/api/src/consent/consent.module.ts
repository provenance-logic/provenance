import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionReferenceEntity } from './entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from './entities/connection-reference-outbox.entity.js';

// Domain 12 — Connection References and Per-Use-Case Consent (ADR-005 through ADR-008).
//
// This module currently exposes the connection reference entities and their
// repositories only. Service logic (request/approve/suspend/revoke), API
// surface, outbox publisher, and Temporal workflows land in subsequent F-IDs:
//   F12.9  — request initiation
//   F12.13 — activation (emits connection package)
//   F12.19 — principal-initiated revocation
//   F12.21 — automatic cascade triggers
//   F12.22 — automatic expiration
//
// Keeping the module registered with no providers is intentional: it establishes
// the module graph entry point and makes the entities available to TypeORM
// repository injection without prematurely committing to a service surface.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectionReferenceEntity,
      ConnectionReferenceOutboxEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class ConsentModule {}
