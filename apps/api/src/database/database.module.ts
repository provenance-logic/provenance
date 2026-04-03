import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getConfig } from '../config.js';
import { OrgEntity } from '../organizations/entities/org.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { ProductVersionEntity } from '../products/entities/product-version.entity.js';
import { LifecycleEventEntity } from '../products/entities/lifecycle-event.entity.js';
import { ConnectorEntity } from '../connectors/entities/connector.entity.js';
import { ConnectorHealthEventEntity } from '../connectors/entities/connector-health-event.entity.js';
import { SourceRegistrationEntity } from '../connectors/entities/source-registration.entity.js';
import { SchemaSnapshotEntity } from '../connectors/entities/schema-snapshot.entity.js';
import { PolicySchemaEntity } from '../governance/entities/policy-schema.entity.js';
import { PolicyVersionEntity } from '../governance/entities/policy-version.entity.js';
import { EffectivePolicyEntity } from '../governance/entities/effective-policy.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { ExceptionEntity } from '../governance/entities/exception.entity.js';
import { GracePeriodEntity } from '../governance/entities/grace-period.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../access/entities/access-request.entity.js';
import { ApprovalEventEntity } from '../access/entities/approval-event.entity.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const config = getConfig();
        return {
          type: 'postgres',
          host: config.DATABASE_HOST,
          port: config.DATABASE_PORT,
          database: config.DATABASE_NAME,
          username: config.DATABASE_USER,
          password: config.DATABASE_PASSWORD,
          entities: [
            OrgEntity,
            DomainEntity,
            PrincipalEntity,
            RoleAssignmentEntity,
            DataProductEntity,
            PortDeclarationEntity,
            ProductVersionEntity,
            LifecycleEventEntity,
            ConnectorEntity,
            ConnectorHealthEventEntity,
            SourceRegistrationEntity,
            SchemaSnapshotEntity,
            PolicySchemaEntity,
            PolicyVersionEntity,
            EffectivePolicyEntity,
            ComplianceStateEntity,
            ExceptionEntity,
            GracePeriodEntity,
            AccessGrantEntity,
            AccessRequestEntity,
            ApprovalEventEntity,
          ],
          // Migrations are managed by Flyway — TypeORM never runs them.
          synchronize: false,
          migrationsRun: false,
          logging: config.NODE_ENV === 'development',
        };
      },
    }),
  ],
})
export class DatabaseModule {}
