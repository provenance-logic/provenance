import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy.js';
import { RoleAssignmentEntity } from '../organizations/entities/role-assignment.entity.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([RoleAssignmentEntity]),
  ],
  providers: [JwtStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
