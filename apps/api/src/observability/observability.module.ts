import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SloDeclarationEntity } from './entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from './entities/slo-evaluation.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { SloService } from './slo.service.js';
import { SloController } from './slo.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SloDeclarationEntity,
      SloEvaluationEntity,
      DataProductEntity,
    ]),
  ],
  providers: [SloService],
  controllers: [SloController],
  exports: [SloService],
})
export class ObservabilityModule {}
