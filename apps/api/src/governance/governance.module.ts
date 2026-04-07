import { Module } from '@nestjs/common';
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
  ],
  providers: [
    {
      provide: OPA_BASE_URL,
      useFactory: () => getConfig().OPA_BASE_URL,
    },
    OpaClient,
    RegoCompiler,
    GovernanceService,
  ],
  controllers: [GovernanceController],
  // Export GovernanceService so ProductsModule can call evaluate() at publish time.
  exports: [GovernanceService],
})
export class GovernanceModule {}
