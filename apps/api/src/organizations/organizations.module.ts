import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { OrgEntity } from './entities/org.entity.js';
import { DomainEntity } from './entities/domain.entity.js';
import { PrincipalEntity } from './entities/principal.entity.js';
import { RoleAssignmentEntity } from './entities/role-assignment.entity.js';

// This module exports OrganizationsService so that the products module can
// resolve domain membership without importing implementation files directly.
export { OrganizationsService };

@Module({
  imports: [TypeOrmModule.forFeature([OrgEntity, DomainEntity, PrincipalEntity, RoleAssignmentEntity])],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
