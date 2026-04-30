import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrustScoreHistoryEntity } from './entities/trust-score-history.entity.js';
import { ComplianceStateEntity } from '../governance/entities/compliance-state.entity.js';
import { ExceptionEntity } from '../governance/entities/exception.entity.js';
import { AccessGrantEntity } from '../access/entities/access-grant.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { LineageModule } from '../lineage/lineage.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TrustScoreService } from './trust-score.service.js';
import { TrustScoreController } from './trust-score.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TrustScoreHistoryEntity,
      ComplianceStateEntity,
      ExceptionEntity,
      AccessGrantEntity,
      DataProductEntity,
    ]),
    forwardRef(() => ObservabilityModule),
    forwardRef(() => LineageModule),
    NotificationsModule,
  ],
  providers: [TrustScoreService],
  controllers: [TrustScoreController],
  exports: [TrustScoreService],
})
export class TrustScoreModule {}
