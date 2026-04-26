import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { temporalClientProvider } from './temporal/temporal-client.provider.js';
import { TemporalWorkerService } from './temporal/temporal-worker.service.js';
import { AccessService } from './access.service.js';
import { AccessController } from './access.controller.js';
import { ConnectionPackageService } from './connection-package.service.js';
import { ConsentModule } from '../consent/consent.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccessNotificationsTriggerWorker } from './access-notifications-trigger.worker.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessGrantEntity,
      AccessRequestEntity,
      ApprovalEventEntity,
      DataProductEntity,
      PortDeclarationEntity,
      RoleAssignmentEntity,
    ]),
    forwardRef(() => ConsentModule),
    NotificationsModule,
  ],
  exports: [AccessService, ConnectionPackageService],
  providers: [
    temporalClientProvider,
    TemporalWorkerService,
    AccessService,
    ConnectionPackageService,
    AccessNotificationsTriggerWorker,
  ],
  controllers: [AccessController],
})
export class AccessModule {}
