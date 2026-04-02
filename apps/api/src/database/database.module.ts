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
