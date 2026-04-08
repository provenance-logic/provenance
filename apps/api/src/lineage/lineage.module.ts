import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LineageController } from './lineage.controller.js';
import { LineageService } from './lineage.service.js';
import { EmissionLogEntity } from './entities/emission-log.entity.js';
import { TrustScoreModule } from '../trust-score/trust-score.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmissionLogEntity]),
    forwardRef(() => TrustScoreModule),
  ],
  providers: [LineageService],
  controllers: [LineageController],
  exports: [LineageService],
})
export class LineageModule {}
