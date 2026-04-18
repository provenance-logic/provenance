import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { getConfig } from '../config.js';
import { OrgEntity } from './entities/org.entity.js';
import { DomainEntity } from './entities/domain.entity.js';
import { PrincipalEntity } from './entities/principal.entity.js';
import { RoleAssignmentEntity } from './entities/role-assignment.entity.js';
import { PolicySchemaEntity } from '../governance/entities/policy-schema.entity.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import { EmailService } from '../email/email.service.js';
import { buildWelcomeEmail } from '../email/templates/welcome.js';
import type {
  Organization,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  OrganizationList,
  Domain,
  CreateDomainRequest,
  UpdateDomainRequest,
  DomainList,
  Member,
  AddMemberRequest,
  MemberList,
  RequestContext,
  PolicyDomain,
} from '@provenance/types';

export interface SelfServeOrganizationResponse {
  organization: Organization;
  principalId: string;
  requiresTokenRefresh: true;
}

const DEFAULT_POLICY_DOMAINS: PolicyDomain[] = [
  'product_schema',
  'classification_taxonomy',
  'versioning_deprecation',
  'access_control',
  'lineage',
  'slo',
  'agent_access',
  'interoperability',
];

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectRepository(OrgEntity)
    private readonly orgRepo: Repository<OrgEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(PrincipalEntity)
    private readonly principalRepo: Repository<PrincipalEntity>,
    @InjectRepository(RoleAssignmentEntity)
    private readonly roleAssignmentRepo: Repository<RoleAssignmentEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly emailService: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  async listOrganizations(limit: number, offset: number): Promise<OrganizationList> {
    const [items, total] = await this.orgRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toOrganization(i)),
      meta: { total, limit, offset },
    };
  }

  async createOrganization(dto: CreateOrganizationRequest): Promise<Organization> {
    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Organization with slug '${dto.slug}' already exists`);
    }
    const org = this.orgRepo.create({
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      contactEmail: dto.contactEmail ?? null,
      status: 'active',
    });
    const saved = await this.orgRepo.save(org);
    return this.toOrganization(saved);
  }

  async getOrganization(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
    return this.toOrganization(org);
  }

  async updateOrganization(orgId: string, dto: UpdateOrganizationRequest): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.description !== undefined) org.description = dto.description;
    if (dto.contactEmail !== undefined) org.contactEmail = dto.contactEmail;
    const saved = await this.orgRepo.save(org);
    return this.toOrganization(saved);
  }

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------

  async listDomains(orgId: string, limit: number, offset: number): Promise<DomainList> {
    const [items, total] = await this.domainRepo.findAndCount({
      where: { orgId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map((i) => this.toDomain(i)),
      meta: { total, limit, offset },
    };
  }

  async createDomain(orgId: string, dto: CreateDomainRequest, ctx: RequestContext): Promise<Domain> {
    await this.getOrganization(orgId);
    const existing = await this.domainRepo.findOne({ where: { orgId, slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Domain with slug '${dto.slug}' already exists in this organization`);
    }
    const principal = await this.ensurePrincipal(orgId, ctx);
    const domain = this.domainRepo.create({
      orgId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      ownerPrincipalId: principal.id,
    });
    const saved = await this.domainRepo.save(domain);
    return this.toDomain(saved);
  }

  private async ensurePrincipal(orgId: string, ctx: RequestContext): Promise<PrincipalEntity> {
    const existing = await this.principalRepo.findOne({
      where: { keycloakSubject: ctx.keycloakSubject },
    });
    if (existing) return existing;
    await this.principalRepo
      .createQueryBuilder()
      .insert()
      .into(PrincipalEntity)
      .values({
        orgId,
        principalType: ctx.principalType,
        keycloakSubject: ctx.keycloakSubject,
        email: ctx.email ?? null,
        displayName: ctx.displayName ?? null,
      })
      .orIgnore()
      .execute();
    return this.principalRepo.findOneOrFail({
      where: { keycloakSubject: ctx.keycloakSubject },
    });
  }

  async getDomain(orgId: string, domainId: string): Promise<Domain> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    return this.toDomain(domain);
  }

  async updateDomain(orgId: string, domainId: string, dto: UpdateDomainRequest): Promise<Domain> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    if (dto.name !== undefined) domain.name = dto.name;
    if (dto.description !== undefined) domain.description = dto.description;
    if (dto.ownerPrincipalId !== undefined) domain.ownerPrincipalId = dto.ownerPrincipalId;
    const saved = await this.domainRepo.save(domain);
    return this.toDomain(saved);
  }

  async deleteDomain(orgId: string, domainId: string): Promise<void> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    await this.domainRepo.remove(domain);
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async listMembers(orgId: string, limit: number, offset: number): Promise<MemberList> {
    const [assignments, total] = await this.roleAssignmentRepo.findAndCount({
      where: { orgId },
      order: { grantedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const principalIds = [...new Set(assignments.map((a) => a.principalId))];
    const principals = principalIds.length
      ? await this.principalRepo.find({ where: { orgId, id: In(principalIds) } })
      : [];
    const principalMap = new Map(principals.map((p) => [p.id, p]));

    return {
      items: assignments.map((ra) => this.toMember(ra, principalMap.get(ra.principalId) ?? null)),
      meta: { total, limit, offset },
    };
  }

  async addMember(orgId: string, dto: AddMemberRequest, grantedByPrincipalId: string): Promise<Member> {
    await this.getOrganization(orgId);

    const principal = await this.principalRepo.findOne({ where: { id: dto.principalId, orgId } });
    if (!principal) {
      throw new NotFoundException(`Principal ${dto.principalId} not found in organization ${orgId}`);
    }

    const existing = await this.roleAssignmentRepo.findOne({
      where: { orgId, principalId: dto.principalId, role: dto.role, domainId: IsNull() },
    });
    if (existing) {
      throw new ConflictException(`Principal already has role '${dto.role}' in this organization`);
    }

    const assignment = this.roleAssignmentRepo.create({
      orgId,
      principalId: dto.principalId,
      role: dto.role,
      domainId: null,
      grantedBy: grantedByPrincipalId,
    });
    const saved = await this.roleAssignmentRepo.save(assignment);
    return this.toMember(saved, principal);
  }

  async removeMember(orgId: string, principalId: string): Promise<void> {
    const assignments = await this.roleAssignmentRepo.find({ where: { orgId, principalId } });
    if (assignments.length === 0) {
      throw new NotFoundException(`Principal ${principalId} is not a member of organization ${orgId}`);
    }
    await this.roleAssignmentRepo.remove(assignments);
  }

  // ---------------------------------------------------------------------------
  // Self-serve organization creation (F10.2 — Domain 10)
  // ---------------------------------------------------------------------------

  /**
   * Creates a new organization, seeds the default governance layer, and makes
   * the calling Keycloak user the first org_admin — in a single transaction.
   *
   * Pre-condition: ctx has a valid keycloakSubject but no orgId yet. This is
   * the post-registration flow: the user has just completed Keycloak signup,
   * email verification, and is landing on the onboarding screen for the first
   * time. No platform operator action is required.
   */
  async selfServeOrganization(
    dto: CreateOrganizationRequest,
    ctx: RequestContext,
  ): Promise<SelfServeOrganizationResponse> {
    if (!ctx.keycloakSubject) {
      throw new BadRequestException('Missing Keycloak subject on request context');
    }
    if (ctx.orgId) {
      throw new ConflictException(
        'This account already belongs to an organization; cannot run self-serve signup.',
      );
    }

    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Organization with slug '${dto.slug}' already exists`);
    }

    const result = await this.dataSource.transaction(async (mgr) => {
      const orgRepo = mgr.getRepository(OrgEntity);
      const principalRepo = mgr.getRepository(PrincipalEntity);
      const roleRepo = mgr.getRepository(RoleAssignmentEntity);
      const policySchemaRepo = mgr.getRepository(PolicySchemaEntity);

      const org = await orgRepo.save(
        orgRepo.create({
          name: dto.name,
          slug: dto.slug,
          description: dto.description ?? null,
          contactEmail: dto.contactEmail ?? ctx.email ?? null,
          status: 'active',
        }),
      );

      // Set RLS org context for inserts into identity / governance.
      await mgr.query(`SET LOCAL "provenance.current_org_id" = $1`, [org.id]);

      const principal = await principalRepo.save(
        principalRepo.create({
          orgId: org.id,
          principalType: 'platform_admin',
          keycloakSubject: ctx.keycloakSubject,
          email: ctx.email ?? null,
          displayName: ctx.displayName ?? null,
        }),
      );

      await roleRepo.save(
        roleRepo.create({
          orgId: org.id,
          principalId: principal.id,
          role: 'org_admin',
          domainId: null,
          grantedBy: principal.id,
        }),
      );

      await this.seedDefaultGovernanceLayer(policySchemaRepo, org.id);

      return { org, principal };
    });

    // Bind Keycloak user attributes so future tokens carry the provenance_* claims.
    try {
      await this.keycloakAdmin.updateUserAttributes(ctx.keycloakSubject, {
        provenance_principal_id: result.principal.id,
        provenance_org_id: result.org.id,
        provenance_principal_type: 'platform_admin',
      });
      await this.keycloakAdmin.assignRealmRoles(ctx.keycloakSubject, ['org_admin']);
    } catch (err) {
      this.logger.warn(
        `Self-serve signup succeeded but Keycloak attribute binding failed for user ${ctx.keycloakSubject}: ${(err as Error).message}. ` +
          `User will need their attributes bound before tokens carry provenance_* claims.`,
      );
    }

    // Welcome email — best-effort, non-blocking failure mode.
    if (ctx.email) {
      try {
        const config = getConfig();
        await this.emailService.send(
          buildWelcomeEmail({
            recipientEmail: ctx.email,
            recipientName: ctx.displayName ?? '',
            organizationName: result.org.name,
            appUrl: config.APP_BASE_URL,
          }),
        );
      } catch (err) {
        this.logger.warn(`Failed to send welcome email: ${(err as Error).message}`);
      }
    }

    return {
      organization: this.toOrganization(result.org),
      principalId: result.principal.id,
      requiresTokenRefresh: true,
    };
  }

  private async seedDefaultGovernanceLayer(
    policySchemaRepo: Repository<PolicySchemaEntity>,
    orgId: string,
  ): Promise<void> {
    // One platform-default policy schema per governance domain. The
    // schemaDefinition is the JSONSchema rule shape authors fill in when they
    // publish a policy version via the Policy Authoring Studio.
    const rows = DEFAULT_POLICY_DOMAINS.map((domain) =>
      policySchemaRepo.create({
        orgId,
        policyDomain: domain,
        schemaVersion: '1.0.0',
        schemaDefinition: this.defaultPolicySchemaDefinition(domain),
        isPlatformDefault: true,
      }),
    );
    await policySchemaRepo.save(rows);
  }

  private defaultPolicySchemaDefinition(domain: PolicyDomain): Record<string, unknown> {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: `Provenance default ${domain} policy schema`,
      description: `Platform-default rule shape for the ${domain} governance domain. Seeded at organization creation; editable by governance members.`,
      type: 'object',
      properties: {
        rules: {
          type: 'array',
          items: { type: 'object' },
          default: [],
        },
      },
      required: ['rules'],
    };
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toOrganization(entity: OrgEntity): Organization {
    return {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      status: entity.status,
      contactEmail: entity.contactEmail,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toDomain(entity: DomainEntity): Domain {
    return {
      id: entity.id,
      orgId: entity.orgId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      ownerPrincipalId: entity.ownerPrincipalId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toMember(assignment: RoleAssignmentEntity, principal: PrincipalEntity | null): Member {
    return {
      principalId: assignment.principalId,
      principalType: principal?.principalType ?? 'human_user',
      role: assignment.role,
      email: principal?.email ?? null,
      displayName: principal?.displayName ?? null,
      joinedAt: assignment.grantedAt.toISOString(),
    };
  }
}
