import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { AccessRequestEntity } from './entities/access-request.entity.js';
import { ApprovalEventEntity } from './entities/approval-event.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { temporalClientProvider } from './temporal/temporal-client.provider.js';
import { TemporalWorkerService } from './temporal/temporal-worker.service.js';
import { AccessService } from './access.service.js';
import { AccessController } from './access.controller.js';
import { ConnectionPackageService } from './connection-package.service.js';
import { ConsentModule } from '../consent/consent.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccessGrantEntity,
      AccessRequestEntity,
      ApprovalEventEntity,
      DataProductEntity,
      PortDeclarationEntity,
    ]),
    forwardRef(() => ConsentModule),
  ],
  exports: [AccessService, ConnectionPackageService],
  providers: [
    temporalClientProvider,
    TemporalWorkerService,
    AccessService,
    ConnectionPackageService,
  ],
  controllers: [AccessController],
})
export class AccessModule {}
