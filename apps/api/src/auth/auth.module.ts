import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { AgentIdentityEntity } from '../agents/entities/agent-identity.entity.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RoleAssignmentEntity, PrincipalEntity, AgentIdentityEntity]),
  ],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [PassportModule, JwtAuthGuard],
})
export class AuthModule {}
