import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PreferencesController } from './preferences.controller.js';
import { PreferencesService } from './preferences.service.js';
import { PrincipalPreferencesEntity } from '../organizations/entities/principal-preferences.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

// F7.46 onboarding wizard reads/writes per-principal preferences via this
// module. AgentIdentityEntity is registered so the JwtAuthGuard's
// agent-resolution path can do its lookup on these routes too (the guard
// shares one repository injection across every controller it protects).
@Module({
  imports: [
    TypeOrmModule.forFeature([PrincipalPreferencesEntity, AgentIdentityEntity]),
  ],
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class PreferencesModule {}
