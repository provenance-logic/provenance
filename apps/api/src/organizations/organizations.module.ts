import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { OrgEntity } from './entities/org.entity.js';
import { DomainEntity } from './entities/domain.entity.js';
import { PrincipalEntity } from './entities/principal.entity.js';
import { RoleAssignmentEntity } from './entities/role-assignment.entity.js';
import { InvitationEntity } from './entities/invitation.entity.js';
import { GovernanceConfigEntity } from './entities/governance-config.entity.js';
import { EmailModule } from '../email/email.module.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import { PolicySchemaEntity } from '../governance/entities/policy-schema.entity.js';

// This module exports OrganizationsService so that the products module can
// resolve domain membership without importing implementation files directly.
export { OrganizationsService };

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrgEntity,
      DomainEntity,
      PrincipalEntity,
      RoleAssignmentEntity,
      InvitationEntity,
      GovernanceConfigEntity,
      PolicySchemaEntity,
    ]),
    EmailModule,
  ],
  controllers: [OrganizationsController, InvitationsController],
  providers: [OrganizationsService, InvitationsService, KeycloakAdminService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
