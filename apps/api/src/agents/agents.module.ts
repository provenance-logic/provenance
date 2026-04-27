import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsController } from './agents.controller.js';
import { AuditController } from './audit.controller.js';
import { AgentsService } from './agents.service.js';
import { AgentIdentityEntity } from './entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from './entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

export { AgentsService };

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentIdentityEntity,
      AgentTrustClassificationEntity,
      PrincipalEntity,
      RoleAssignmentEntity,
    ]),
    NotificationsModule,
  ],
  controllers: [AgentsController, AuditController],
  providers: [AgentsService, KeycloakAdminService],
  exports: [AgentsService],
})
export class AgentsModule {}
