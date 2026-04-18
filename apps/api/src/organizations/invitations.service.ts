import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import { getConfig } from '../config.js';
import { OrgEntity } from './entities/org.entity.js';
import { DomainEntity } from './entities/domain.entity.js';
import { InvitationEntity } from './entities/invitation.entity.js';
import { GovernanceConfigEntity } from './entities/governance-config.entity.js';
import { PrincipalEntity } from './entities/principal.entity.js';
import { RoleAssignmentEntity } from './entities/role-assignment.entity.js';
import { EmailService } from '../email/email.service.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import { buildInvitationEmail } from '../email/templates/invitation.js';
import type {
  Invitation,
  InvitationList,
  CreateInvitationRequest,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  InvitationStatus,
} from '@provenance/types';

const INVITATION_TTL_CONFIG_KEY = 'invitation_ttl_hours';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectRepository(OrgEntity)
    private readonly orgRepo: Repository<OrgEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(InvitationEntity)
    private readonly invitationRepo: Repository<InvitationEntity>,
    @InjectRepository(GovernanceConfigEntity)
    private readonly governanceConfigRepo: Repository<GovernanceConfigEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async createInvitation(
    orgId: string,
    dto: CreateInvitationRequest,
    invitedByPrincipalId: string,
  ): Promise<Invitation> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);

    if (!this.isValidEmail(dto.email)) {
      throw new BadRequestException(`Invalid email address: ${dto.email}`);
    }

    const normalizedEmail = dto.email.trim().toLowerCase();

    if (dto.domainId) {
      const domain = await this.domainRepo.findOne({
        where: { id: dto.domainId, orgId },
      });
      if (!domain) {
        throw new NotFoundException(`Domain ${dto.domainId} not found in org ${orgId}`);
      }
    }

    const existingActive = await this.invitationRepo.findOne({
      where: {
        orgId,
        email: normalizedEmail,
        role: dto.role,
        domainId: dto.domainId ?? IsNull(),
        consumedAt: IsNull(),
      },
    });
    if (existingActive) {
      throw new ConflictException(
        `An active invitation for ${normalizedEmail} (${dto.role}) already exists. Resend it instead.`,
      );
    }

    const ttlHours = await this.getTtlHours(orgId);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    const token = this.generateToken();

    const invitation = this.invitationRepo.create({
      orgId,
      email: normalizedEmail,
      role: dto.role,
      domainId: dto.domainId ?? null,
      invitedByPrincipalId,
      token,
      expiresAt,
      consumedAt: null,
      resendCount: 0,
    });
    const saved = await this.invitationRepo.save(invitation);

    await this.sendInvitationEmail(saved, org.name, invitedByPrincipalId);
    return this.toInvitation(saved);
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async listInvitations(
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<InvitationList> {
    const [items, total] = await this.invitationRepo.findAndCount({
      where: { orgId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toInvitation(i)),
      meta: { total, limit, offset },
    };
  }

  async listDomainInvitations(
    orgId: string,
    domainId: string,
    limit: number,
    offset: number,
  ): Promise<InvitationList> {
    const [items, total] = await this.invitationRepo.findAndCount({
      where: { orgId, domainId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toInvitation(i)),
      meta: { total, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Resend
  // ---------------------------------------------------------------------------

  async resendInvitation(orgId: string, invitationId: string): Promise<Invitation> {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId, orgId },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${invitationId} not found`);
    }
    if (invitation.consumedAt) {
      throw new BadRequestException(
        `Invitation ${invitationId} was already accepted at ${invitation.consumedAt.toISOString()}`,
      );
    }

    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);

    const ttlHours = await this.getTtlHours(orgId);
    invitation.expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    invitation.resendCount += 1;
    const saved = await this.invitationRepo.save(invitation);

    await this.sendInvitationEmail(saved, org.name, invitation.invitedByPrincipalId);
    return this.toInvitation(saved);
  }

  // ---------------------------------------------------------------------------
  // Accept (public — token-authenticated)
  // ---------------------------------------------------------------------------

  async acceptInvitation(
    token: string,
    dto: AcceptInvitationRequest,
  ): Promise<AcceptInvitationResponse> {
    const invitation = await this.findInvitationByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.consumedAt) {
      throw new ForbiddenException('Invitation has already been accepted');
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Invitation has expired — request a new one');
    }

    const config = getConfig();

    // Find or create the Keycloak user. Resolved before the transaction so
    // the id is available without non-null assertions inside it.
    const existingKcUser = await this.keycloakAdmin.findUserByEmail(invitation.email);
    const kcUser = existingKcUser ?? {
      id: await this.keycloakAdmin.createUser({
        email: invitation.email,
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        emailVerified: true,
        requiredActions: ['UPDATE_PASSWORD'],
      }),
      email: invitation.email,
      emailVerified: true,
    };

    // Find or create the identity.principals row in a transaction that sets
    // org context first (RLS requires it for inserts into the identity schema).
    const principal = await this.dataSource.transaction(async (mgr) => {
      await mgr.query(`SET LOCAL "provenance.current_org_id" = $1`, [invitation.orgId]);
      const principalRepo = mgr.getRepository(PrincipalEntity);

      let existing = await principalRepo.findOne({
        where: { keycloakSubject: kcUser.id },
      });
      if (!existing) {
        const created = principalRepo.create({
          orgId: invitation.orgId,
          principalType: 'human_user',
          keycloakSubject: kcUser.id,
          email: invitation.email,
          displayName: this.composeDisplayName(dto.firstName, dto.lastName, invitation.email),
        });
        existing = await principalRepo.save(created);
      }

      const assignmentRepo = mgr.getRepository(RoleAssignmentEntity);
      const existingAssignment = await assignmentRepo.findOne({
        where: {
          orgId: invitation.orgId,
          principalId: existing.id,
          role: invitation.role,
          domainId: invitation.domainId ?? IsNull(),
        },
      });
      if (!existingAssignment) {
        await assignmentRepo.save(
          assignmentRepo.create({
            orgId: invitation.orgId,
            principalId: existing.id,
            role: invitation.role,
            domainId: invitation.domainId,
            grantedBy: invitation.invitedByPrincipalId,
          }),
        );
      }

      const invitationRepo = mgr.getRepository(InvitationEntity);
      invitation.consumedAt = new Date();
      await invitationRepo.save(invitation);

      return existing;
    });

    // Bind the platform claims on the Keycloak user so subsequent tokens carry them.
    await this.keycloakAdmin.updateUserAttributes(kcUser.id, {
      provenance_principal_id: principal.id,
      provenance_org_id: invitation.orgId,
      provenance_principal_type: 'human_user',
    });
    await this.keycloakAdmin.assignRealmRoles(kcUser.id, [invitation.role]);

    const loginUrl = this.buildLoginUrl(config.APP_BASE_URL, invitation.email);

    return {
      orgId: invitation.orgId,
      principalId: principal.id,
      role: invitation.role,
      domainId: invitation.domainId,
      loginUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private generateToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private composeDisplayName(firstName?: string, lastName?: string, email?: string): string {
    const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
    return composed || (email ?? '');
  }

  /**
   * Look up an invitation by token bypassing org_id RLS. The token itself is
   * the bearer authorization — any caller who presents the token receives the
   * invitation. The DB session variable provenance.invitation_lookup_mode is
   * set to 'token' for the duration of this transaction so the RLS policy
   * allows the row to be returned.
   */
  private async findInvitationByToken(token: string): Promise<InvitationEntity | null> {
    return this.dataSource.transaction(async (mgr) => {
      await mgr.query(`SET LOCAL "provenance.invitation_lookup_mode" = 'token'`);
      const row = await mgr
        .getRepository(InvitationEntity)
        .findOne({ where: { token } });
      return row ?? null;
    });
  }

  private async getTtlHours(orgId: string): Promise<number> {
    const config = getConfig();
    try {
      const override = await this.governanceConfigRepo.findOne({
        where: { orgId, configKey: INVITATION_TTL_CONFIG_KEY },
      });
      if (override) {
        const value = override.valueJson;
        if (typeof value === 'number' && value > 0) return value;
        if (
          typeof value === 'object' &&
          value !== null &&
          'hours' in value &&
          typeof (value as { hours: unknown }).hours === 'number' &&
          (value as { hours: number }).hours > 0
        ) {
          return (value as { hours: number }).hours;
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to read invitation TTL override for org ${orgId}: ${(err as Error).message}`);
    }
    return config.INVITATION_DEFAULT_TTL_HOURS;
  }

  private async sendInvitationEmail(
    invitation: InvitationEntity,
    organizationName: string,
    invitedByPrincipalId: string,
  ): Promise<void> {
    const config = getConfig();
    const acceptUrl = `${config.APP_BASE_URL.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(invitation.token)}`;

    const inviter = await this.principalRepo.findOne({
      where: { id: invitedByPrincipalId },
    });
    const inviterName = inviter?.displayName || inviter?.email || 'A Provenance administrator';

    const message = buildInvitationEmail({
      recipientEmail: invitation.email,
      inviterName,
      organizationName,
      role: invitation.role,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });

    try {
      await this.emailService.send(message);
    } catch (err) {
      this.logger.error(
        `Failed to send invitation email to ${invitation.email}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private buildLoginUrl(appBaseUrl: string, email: string): string {
    return `${appBaseUrl.replace(/\/$/, '')}/?invited=${encodeURIComponent(email)}`;
  }

  private toInvitation(entity: InvitationEntity): Invitation {
    const status: InvitationStatus = entity.consumedAt
      ? 'accepted'
      : entity.expiresAt.getTime() < Date.now()
        ? 'expired'
        : 'pending';

    return {
      id: entity.id,
      orgId: entity.orgId,
      email: entity.email,
      role: entity.role,
      domainId: entity.domainId,
      invitedByPrincipalId: entity.invitedByPrincipalId,
      expiresAt: entity.expiresAt.toISOString(),
      consumedAt: entity.consumedAt?.toISOString() ?? null,
      resendCount: entity.resendCount,
      createdAt: entity.createdAt.toISOString(),
      status,
    };
  }
}
