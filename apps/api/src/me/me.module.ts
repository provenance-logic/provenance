import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { OrgEntity } from '../organizations/entities/org.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

// F7.48 — Provenance Account Surface backend module.
//
// AgentIdentityEntity is registered so the JwtAuthGuard's agent-resolution
// path can do its lookup on routes protected by this module (the guard
// shares one repository injection across every controller it protects).
@Module({
  imports: [TypeOrmModule.forFeature([OrgEntity, AgentIdentityEntity])],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
