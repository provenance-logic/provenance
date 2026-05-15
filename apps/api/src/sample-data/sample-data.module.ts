import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';
import { SampleDataController } from './sample-data.controller.js';
import { SampleDataService } from './sample-data.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DomainEntity,
      DataProductEntity,
      PortDeclarationEntity,
      SloDeclarationEntity,
      NotificationEntity,
    ]),
  ],
  controllers: [SampleDataController],
  providers: [SampleDataService],
})
export class SampleDataModule {}
