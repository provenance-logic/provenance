import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionReferenceEntity } from './entities/connection-reference.entity.js';
import { ConnectionReferenceOutboxEntity } from './entities/connection-reference-outbox.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { AccessModule } from '../access/access.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ConsentService } from './consent.service.js';
import { ConsentController } from './consent.controller.js';
import { InternalConsentController } from './internal-consent.controller.js';
import { InternalServiceGuard } from '../auth/internal-service.guard.js';
import { ConnectionReferenceOutboxPublisher } from './connection-reference-outbox.publisher.js';
import { KafkaModule } from '../kafka/kafka.module.js';

// Domain 12 — Connection References and Per-Use-Case Consent (ADR-005 through ADR-008).
//
// Currently exposes:
//   - ConsentService: request / approve / deny / revoke / cascade-revoke, get,
//     list. State-machine invariants live here.
//   - ConsentController: REST surface over the service at
//     /organizations/{orgId}/consent/connection-references.
//
// Still deferred: MCP tool surface, outbox publisher, Temporal workflows
// (expiration, MAJOR-version suspension), frontend UI.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectionReferenceEntity,
      ConnectionReferenceOutboxEntity,
      DataProductEntity,
      AgentIdentityEntity,
      AccessGrantEntity,
      RoleAssignmentEntity,
    ]),
    // forwardRef breaks the circular module dependency introduced by
    // AccessModule needing ConsentService (for F12.21 grant-revoke cascade)
    // while ConsentService needs ConnectionPackageService (for ADR-008
    // package emission at activation). Both halves live behind forwardRef;
    // NestJS resolves the cycle at DI time.
    forwardRef(() => AccessModule),
    NotificationsModule,
    KafkaModule,
  ],
  providers: [ConsentService, InternalServiceGuard, ConnectionReferenceOutboxPublisher],
  controllers: [ConsentController, InternalConsentController],
  exports: [ConsentService, TypeOrmModule],
})
export class ConsentModule {}
