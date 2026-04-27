import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorsController } from './connectors.controller.js';
import { ConnectorsService } from './connectors.service.js';
import { ConnectorProbeService } from './probe/connector-probe.service.js';
import { SecretsManagerService } from './probe/secrets-manager.service.js';
import { ConnectorEntity } from './entities/connector.entity.js';
import { ConnectorHealthEventEntity } from './entities/connector-health-event.entity.js';
import { SourceRegistrationEntity } from './entities/source-registration.entity.js';
import { SchemaSnapshotEntity } from './entities/schema-snapshot.entity.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { KafkaModule } from '../kafka/kafka.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectorEntity,
      ConnectorHealthEventEntity,
      SourceRegistrationEntity,
      SchemaSnapshotEntity,
      RoleAssignmentEntity,
    ]),
    KafkaModule,
    NotificationsModule,
  ],
  providers: [
    SecretsManagerService,
    ConnectorProbeService,
    ConnectorsService,
  ],
  controllers: [ConnectorsController],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
