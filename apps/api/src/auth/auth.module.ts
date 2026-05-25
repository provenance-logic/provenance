import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

// @Global so that the single JwtAuthGuard provider — the one whose
// `@InjectRepository(AgentIdentityEntity) agentRepo` is actually resolved here
// in AuthModule's context — is the instance every `@UseGuards(JwtAuthGuard)`
// across the app resolves to. Without this, modules that apply the guard
// without importing AuthModule (e.g. ProductsModule) instantiate their own
// copy in a context lacking the AgentIdentityEntity repository, so `agentRepo`
// is undefined. That path is only exercised by the MCP service-token +
// x-agent-id flow (ADR-002 Phase 5b-8) the Agent Query Layer uses to call the
// control plane — normal human JWTs never touch line 55 — which is why the
// crash stayed invisible until the agent auth path was repaired. See B-076.
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RoleAssignmentEntity, PrincipalEntity, AgentIdentityEntity]),
  ],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [PassportModule, JwtAuthGuard],
})
export class AuthModule {}
