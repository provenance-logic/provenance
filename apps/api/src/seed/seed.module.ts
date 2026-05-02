import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrgEntity } from '../organizations/entities/org.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from '../agents/entities/agent-trust-classification.entity.js';
import { PolicyVersionEntity } from '../governance/entities/policy-version.entity.js';
import { EffectivePolicyEntity } from '../governance/entities/effective-policy.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';
import { GovernanceModule } from '../governance/governance.module.js';
import { LineageModule } from '../lineage/lineage.module.js';
import { TrustScoreModule } from '../trust-score/trust-score.module.js';
import { SearchModule } from '../search/search.module.js';
import { SeedController } from './seed.controller.js';
import { SeedGuard } from './seed.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrgEntity,
      DomainEntity,
      PrincipalEntity,
      RoleAssignmentEntity,
      DataProductEntity,
      PortDeclarationEntity,
      AgentIdentityEntity,
      AgentTrustClassificationEntity,
      PolicyVersionEntity,
      EffectivePolicyEntity,
      SloDeclarationEntity,
      AccessGrantEntity,
      AccessRequestEntity,
      NotificationEntity,
    ]),
    GovernanceModule,
    LineageModule,
    TrustScoreModule,
    SearchModule,
  ],
  controllers: [SeedController],
  providers: [SeedGuard],
})
export class SeedModule {}
