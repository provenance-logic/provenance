import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { temporalClientProvider } from './temporal/temporal-client.provider.js';
import { TemporalWorkerService } from './temporal/temporal-worker.service.js';
import { AccessService } from './access.service.js';
import { AccessController } from './access.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessGrantEntity,
      AccessRequestEntity,
      ApprovalEventEntity,
      DataProductEntity,
    ]),
  ],
  providers: [
    temporalClientProvider,
    TemporalWorkerService,
    AccessService,
  ],
  controllers: [AccessController],
})
export class AccessModule {}
