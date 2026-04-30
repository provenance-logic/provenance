import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getConfig } from '../config.js';
import { PolicySchemaEntity } from './entities/policy-schema.entity.js';
import { PolicyVersionEntity } from './entities/policy-version.entity.js';
import { EffectivePolicyEntity } from './entities/effective-policy.entity.js';
import { ComplianceStateEntity } from './entities/compliance-state.entity.js';
import { ExceptionEntity } from './entities/exception.entity.js';
import { GracePeriodEntity } from './entities/grace-period.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { OpaClient, OPA_BASE_URL } from './opa/opa-client.js';
import { RegoCompiler } from './compilation/rego-compiler.js';
import { GovernanceService } from './governance.service.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceNotificationsTriggerWorker } from './governance-notifications-trigger.worker.js';
import { TrustScoreModule } from '../trust-score/trust-score.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PolicySchemaEntity,
      PolicyVersionEntity,
      EffectivePolicyEntity,
      ComplianceStateEntity,
      ExceptionEntity,
      GracePeriodEntity,
      DataProductEntity,
      DomainEntity,
      PrincipalEntity,
    ]),
    forwardRef(() => TrustScoreModule),
    NotificationsModule,
  ],
  providers: [
    {
      provide: OPA_BASE_URL,
      useFactory: () => getConfig().OPA_BASE_URL,
    },
    OpaClient,
    RegoCompiler,
    GovernanceService,
    GovernanceNotificationsTriggerWorker,
  ],
  controllers: [GovernanceController],
  // Export GovernanceService so ProductsModule can call evaluate() at publish time.
  // Export OpaClient so SeedModule can push compiled Rego at seed time.
  exports: [GovernanceService, OpaClient],
})
export class GovernanceModule {}
