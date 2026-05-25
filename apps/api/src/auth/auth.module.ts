import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

// @Global + `exports: [TypeOrmModule]` so the AgentIdentityEntity repository
// token is resolvable in every module's injector. `JwtAuthGuard` is applied
// per-controller via `@UseGuards(JwtAuthGuard)`, and Nest resolves the guard's
// `@InjectRepository(AgentIdentityEntity) agentRepo` from the *consuming*
// module's context — so modules that apply the guard without the repo in scope
// (e.g. ProductsModule) got `agentRepo === undefined`. Exporting TypeOrmModule
// from a @Global module re-exports the repositories it registered, making them
// globally injectable. That repo is only touched by the MCP service-token +
// x-agent-id flow (ADR-002 Phase 5b-8) the Agent Query Layer uses to call the
// control plane — normal human JWTs never reach jwt-auth.guard.ts:55 — which is
// why the crash stayed invisible until the agent auth path was repaired. B-076.
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RoleAssignmentEntity, PrincipalEntity, AgentIdentityEntity]),
  ],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [PassportModule, JwtAuthGuard, TypeOrmModule],
})
export class AuthModule {}
