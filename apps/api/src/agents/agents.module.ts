import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsController } from './agents.controller.js';
import { AuditController } from './audit.controller.js';
import { AgentsService } from './agents.service.js';
import { AgentIdentityEntity } from './entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from './entities/agent-trust-classification.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';

export { AgentsService };

@Module({
  imports: [TypeOrmModule.forFeature([AgentIdentityEntity, AgentTrustClassificationEntity, PrincipalEntity])],
  controllers: [AgentsController, AuditController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
