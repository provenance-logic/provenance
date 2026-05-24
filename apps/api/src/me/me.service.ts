import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrgEntity } from '../organizations/entities/org.entity.js';
import type { MeProfileResponse, RequestContext } from '@provenance/types';

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(OrgEntity)
    private readonly orgRepo: Repository<OrgEntity>,
  ) {}

  // F7.48 — assemble the account-surface profile from the request context
  // (which already carries JWT-derived identity + server-resolved roles)
  // plus a single org row read for the org name/slug. The caller is asking
  // about their own org by definition, so the cross-tenant lookup is
  // legitimate — the `@cross-tenant-by-design` escape hatch applies here
  // because we look up by primary key, not by any tenant-scoped predicate.
  async getProfile(ctx: RequestContext): Promise<MeProfileResponse> {
    // @cross-tenant-by-design: callers asking about their own org.
    const org = await this.orgRepo.findOne({ where: { id: ctx.orgId } });
    if (!org) {
      // Shouldn't happen — JwtAuthGuard rejects no-org callers before they
      // reach here. Treat as a programming error rather than silent fallback.
      throw new NotFoundException(`Org ${ctx.orgId} not found`);
    }
    return {
      principalId: ctx.principalId,
      keycloakSubject: ctx.keycloakSubject,
      principalType: ctx.principalType,
      displayName: ctx.displayName ?? null,
      email: ctx.email ?? null,
      org: { id: org.id, name: org.name, slug: org.slug },
      roles: ctx.roles,
    };
  }
}
