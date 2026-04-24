import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionReferenceEntity } from './entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from './entities/connection-reference-outbox.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { ConsentService } from './consent.service.js';

// Domain 12 — Connection References and Per-Use-Case Consent (ADR-005 through ADR-008).
//
// Currently exposes the request-initiation service (F12.9). Activation,
// suspension, revocation, expiration, REST and MCP surfaces, outbox
// publisher, and Temporal workflows land in subsequent F-IDs.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectionReferenceEntity,
      ConnectionReferenceOutboxEntity,
      DataProductEntity,
      AgentIdentityEntity,
      AccessGrantEntity,
    ]),
  ],
  providers: [ConsentService],
  exports: [ConsentService, TypeOrmModule],
})
export class ConsentModule {}
