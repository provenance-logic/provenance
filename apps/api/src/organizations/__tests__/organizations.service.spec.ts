import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../organizations.service.js';
import { OrgEntity } from '../entities/org.entity.js';
import { DomainEntity } from '../entities/domain.entity.js';
import { PrincipalEntity } from '../entities/principal.entity.js';
import { RoleAssignmentEntity } from '../entities/role-assignment.entity.js';
import { PolicySchemaEntity } from '../../governance/entities/policy-schema.entity.js';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service.js';
import { EmailService } from '../../email/email.service.js';

const mockOrgRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockDomainRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockPrincipalRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  }),
});

const mockRoleAssignmentRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

const mockPolicySchemaRepo = () => ({
  create: jest.fn((dto: any) => dto),
  save: jest.fn((rows: any) => rows),
});

let seededPolicyRows: any[] = [];
const mockDataSource = () => ({
  transaction: jest.fn(async (cb: (mgr: any) => Promise<any>) => {
    seededPolicyRows = [];
    const mgr: any = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: (entity: any) => {
        if (entity === OrgEntity) {
          return {
            create: jest.fn((dto: any) => dto),
            save: jest.fn((e: any) => ({ id: 'org-new', createdAt: new Date(), updatedAt: new Date(), ...e })),
          };
        }
        if (entity === PrincipalEntity) {
          return {
            create: jest.fn((dto: any) => dto),
            save: jest.fn((e: any) => ({ id: 'principal-new', createdAt: new Date(), updatedAt: new Date(), ...e })),
          };
        }
        if (entity === RoleAssignmentEntity) {
          return {
            create: jest.fn((dto: any) => dto),
            save: jest.fn((e: any) => e),
          };
        }
        if (entity === PolicySchemaEntity) {
          return {
            create: jest.fn((dto: any) => dto),
            save: jest.fn((rows: any) => {
              seededPolicyRows = Array.isArray(rows) ? rows : [rows];
              return seededPolicyRows;
            }),
          };
        }
        return { findOne: jest.fn(), save: jest.fn() };
      },
    };
    return cb(mgr);
  }),
});

const mockKeycloakAdmin = () => ({
  updateUserAttributes: jest.fn().mockResolvedValue(undefined),
  assignRealmRoles: jest.fn().mockResolvedValue(undefined),
  findUserByEmail: jest.fn(),
  createUser: jest.fn(),
});

const mockEmailService = () => ({
  send: jest.fn().mockResolvedValue({ messageId: 'm-1', accepted: true }),
});

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let orgRepo: ReturnType<typeof mockOrgRepo>;
  let domainRepo: ReturnType<typeof mockDomainRepo>;
  let principalRepo: ReturnType<typeof mockPrincipalRepo>;
  let roleAssignmentRepo: ReturnType<typeof mockRoleAssignmentRepo>;
  let keycloakAdmin: ReturnType<typeof mockKeycloakAdmin>;
  let emailService: ReturnType<typeof mockEmailService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(OrgEntity), useFactory: mockOrgRepo },
        { provide: getRepositoryToken(DomainEntity), useFactory: mockDomainRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useFactory: mockRoleAssignmentRepo },
        { provide: getRepositoryToken(PolicySchemaEntity), useFactory: mockPolicySchemaRepo },
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: KeycloakAdminService, useFactory: mockKeycloakAdmin },
        { provide: EmailService, useFactory: mockEmailService },
      ],
    }).compile();

    service = module.get(OrganizationsService);
    orgRepo = module.get(getRepositoryToken(OrgEntity));
    domainRepo = module.get(getRepositoryToken(DomainEntity));
    principalRepo = module.get(getRepositoryToken(PrincipalEntity));
    roleAssignmentRepo = module.get(getRepositoryToken(RoleAssignmentEntity));
    keycloakAdmin = module.get(KeycloakAdminService);
    emailService = module.get(EmailService);
  });

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  describe('listOrganizations', () => {
    const makeCtx = (orgId: string) => ({
      principalId: 'p-1',
      orgId,
      principalType: 'human_user' as const,
      roles: [],
      keycloakSubject: 'kc-1',
    });

    it('returns an empty list when caller has no org claim', async () => {
      const result = await service.listOrganizations(makeCtx(''), 20, 0);

      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({ total: 0, limit: 20, offset: 0 });
      expect(orgRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('returns only the caller\'s own org, never other tenants', async () => {
      const now = new Date();
      const callerOrg = {
        id: 'org-caller', name: 'Caller', slug: 'caller', description: null,
        status: 'active', contactEmail: null, createdAt: now, updatedAt: now,
      };
      orgRepo.findAndCount.mockResolvedValue([[callerOrg], 1]);

      const result = await service.listOrganizations(makeCtx('org-caller'), 20, 0);

      expect(orgRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-caller' } }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('org-caller');
    });
  });

  describe('createOrganization', () => {
    it('creates and returns an organization when slug is unique', async () => {
      orgRepo.findOne.mockResolvedValue(null);
      const now = new Date();
      const saved = {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        description: null,
        status: 'active' as const,
        contactEmail: null,
        createdAt: now,
        updatedAt: now,
        domains: [],
      };
      orgRepo.create.mockReturnValue(saved);
      orgRepo.save.mockResolvedValue(saved);

      const result = await service.createOrganization({ name: 'Acme', slug: 'acme' });

      expect(result.slug).toBe('acme');
      expect(result.status).toBe('active');
    });

    it('throws ConflictException when slug already exists', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'existing', slug: 'acme' });

      await expect(
        service.createOrganization({ name: 'Acme 2', slug: 'acme' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getOrganization', () => {
    it('returns an organization when found', async () => {
      const now = new Date();
      orgRepo.findOne.mockResolvedValue({
        id: 'org-1', name: 'Acme', slug: 'acme', description: null,
        status: 'active', contactEmail: null, createdAt: now, updatedAt: now,
      });

      const result = await service.getOrganization('org-1');
      expect(result.id).toBe('org-1');
    });

    it('throws NotFoundException when organization does not exist', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      await expect(service.getOrganization('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createDomain', () => {
    it('creates a domain within an existing organization', async () => {
      const now = new Date();
      // getOrganization call
      orgRepo.findOne.mockResolvedValue({
        id: 'org-1', name: 'Acme', slug: 'acme', description: null,
        status: 'active', contactEmail: null, createdAt: now, updatedAt: now,
      });
      // slug uniqueness check
      domainRepo.findOne.mockResolvedValue(null);
      // ensurePrincipal — return existing so no insert path is hit
      principalRepo.findOne.mockResolvedValue({
        id: 'principal-1', orgId: 'org-1', principalType: 'human_user',
        keycloakSubject: 'keycloak-sub-1', email: null, displayName: null,
        createdAt: now, updatedAt: now,
      });
      const saved = {
        id: 'dom-1', orgId: 'org-1', name: 'Analytics', slug: 'analytics',
        description: null, ownerPrincipalId: 'principal-1', createdAt: now, updatedAt: now,
      };
      domainRepo.create.mockReturnValue(saved);
      domainRepo.save.mockResolvedValue(saved);

      const ctx = {
        principalId: 'principal-1',
        orgId: 'org-1',
        principalType: 'human_user' as const,
        roles: [],
        keycloakSubject: 'keycloak-sub-1',
      };
      const result = await service.createDomain('org-1', {
        name: 'Analytics',
        slug: 'analytics',
        ownerPrincipalId: 'principal-1',
      }, ctx);

      expect(result.orgId).toBe('org-1');
      expect(result.slug).toBe('analytics');
    });
  });

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  describe('listMembers', () => {
    it('returns a paginated list of members with principal info joined', async () => {
      const now = new Date();
      const assignment = {
        id: 'ra-1', orgId: 'org-1', principalId: 'principal-1',
        role: 'consumer' as const, domainId: null, grantedBy: null, grantedAt: now,
      };
      roleAssignmentRepo.findAndCount.mockResolvedValue([[assignment], 1]);
      principalRepo.find.mockResolvedValue([{
        id: 'principal-1', orgId: 'org-1', principalType: 'human_user',
        keycloakSubject: 'kc-sub-1', email: 'user@example.com',
        displayName: 'Test User', createdAt: now, updatedAt: now,
      }]);

      const result = await service.listMembers('org-1', 20, 0);

      expect(result.meta.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].principalId).toBe('principal-1');
      expect(result.items[0].role).toBe('consumer');
      expect(result.items[0].email).toBe('user@example.com');
      expect(result.items[0].displayName).toBe('Test User');
      expect(result.items[0].principalType).toBe('human_user');
    });

    it('returns an empty list when no role assignments exist', async () => {
      roleAssignmentRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listMembers('org-1', 20, 0);

      expect(result.items).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(principalRepo.find).not.toHaveBeenCalled();
    });

    it('returns members with null principal fields when principal record is missing', async () => {
      const now = new Date();
      const assignment = {
        id: 'ra-1', orgId: 'org-1', principalId: 'principal-orphan',
        role: 'consumer' as const, domainId: null, grantedBy: null, grantedAt: now,
      };
      roleAssignmentRepo.findAndCount.mockResolvedValue([[assignment], 1]);
      principalRepo.find.mockResolvedValue([]); // principal missing from principals table

      const result = await service.listMembers('org-1', 20, 0);

      expect(result.items[0].email).toBeNull();
      expect(result.items[0].displayName).toBeNull();
      expect(result.items[0].principalType).toBe('human_user'); // safe fallback
    });
  });

  describe('addMember', () => {
    const now = new Date();
    const org = {
      id: 'org-1', name: 'Acme', slug: 'acme', description: null,
      status: 'active' as const, contactEmail: null, createdAt: now, updatedAt: now,
    };
    const principal = {
      id: 'principal-1', orgId: 'org-1', principalType: 'human_user' as const,
      keycloakSubject: 'kc-sub-1', email: 'user@example.com',
      displayName: 'Test User', createdAt: now, updatedAt: now,
    };
    const dto = { principalId: 'principal-1', principalType: 'human_user' as const, role: 'consumer' as const };

    it('creates a role assignment and returns the member', async () => {
      orgRepo.findOne.mockResolvedValue(org);
      principalRepo.findOne.mockResolvedValue(principal);
      roleAssignmentRepo.findOne.mockResolvedValue(null); // no existing assignment
      const saved = {
        id: 'ra-1', orgId: 'org-1', principalId: 'principal-1',
        role: 'consumer' as const, domainId: null, grantedBy: 'granter-1', grantedAt: now,
      };
      roleAssignmentRepo.create.mockReturnValue(saved);
      roleAssignmentRepo.save.mockResolvedValue(saved);

      const result = await service.addMember('org-1', dto, 'granter-1');

      expect(result.principalId).toBe('principal-1');
      expect(result.role).toBe('consumer');
      expect(result.email).toBe('user@example.com');
      expect(roleAssignmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1', principalId: 'principal-1', role: 'consumer', domainId: null, grantedBy: 'granter-1' }),
      );
    });

    it('throws NotFoundException when organization does not exist', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      await expect(service.addMember('org-missing', dto, 'granter-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when principal is not in the organization', async () => {
      orgRepo.findOne.mockResolvedValue(org);
      principalRepo.findOne.mockResolvedValue(null);

      await expect(service.addMember('org-1', dto, 'granter-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when principal already holds this role in the org', async () => {
      orgRepo.findOne.mockResolvedValue(org);
      principalRepo.findOne.mockResolvedValue(principal);
      roleAssignmentRepo.findOne.mockResolvedValue({ id: 'ra-existing' }); // already assigned

      await expect(service.addMember('org-1', dto, 'granter-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    it('removes all role assignments for the principal and returns void', async () => {
      const now = new Date();
      const assignments = [
        { id: 'ra-1', orgId: 'org-1', principalId: 'principal-1', role: 'consumer', domainId: null, grantedBy: null, grantedAt: now },
        { id: 'ra-2', orgId: 'org-1', principalId: 'principal-1', role: 'org_admin', domainId: null, grantedBy: null, grantedAt: now },
      ];
      roleAssignmentRepo.find.mockResolvedValue(assignments);
      roleAssignmentRepo.remove.mockResolvedValue(undefined);

      await expect(service.removeMember('org-1', 'principal-1')).resolves.toBeUndefined();
      expect(roleAssignmentRepo.remove).toHaveBeenCalledWith(assignments);
    });

    it('throws NotFoundException when principal has no role assignments in the org', async () => {
      roleAssignmentRepo.find.mockResolvedValue([]);

      await expect(service.removeMember('org-1', 'principal-unknown')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // selfServeOrganization (F10.2)
  // ---------------------------------------------------------------------------

  describe('selfServeOrganization', () => {
    const freshCtx = {
      principalId: 'kc-sub-new',
      orgId: '',
      principalType: 'human_user' as const,
      roles: [],
      keycloakSubject: 'kc-sub-new',
      email: 'new-admin@example.com',
      displayName: 'New Admin',
    };

    it('creates org, principal, org_admin assignment, and seeds default governance layer', async () => {
      orgRepo.findOne.mockResolvedValue(null);

      const result = await service.selfServeOrganization(
        { name: 'Acme', slug: 'acme' },
        freshCtx,
      );

      expect(result.organization.slug).toBe('acme');
      expect(result.principalId).toBeTruthy();
      expect(result.requiresTokenRefresh).toBe(true);
      expect(seededPolicyRows).toHaveLength(8);
      expect(seededPolicyRows.every((r) => r.isPlatformDefault === true)).toBe(true);
      expect(seededPolicyRows.map((r) => r.policyDomain).sort()).toEqual(
        [
          'access_control',
          'agent_access',
          'classification_taxonomy',
          'interoperability',
          'lineage',
          'product_schema',
          'slo',
          'versioning_deprecation',
        ],
      );
      expect(keycloakAdmin.updateUserAttributes).toHaveBeenCalledWith(
        'kc-sub-new',
        expect.objectContaining({
          provenance_org_id: 'org-new',
          provenance_principal_type: 'platform_admin',
        }),
      );
      expect(keycloakAdmin.assignRealmRoles).toHaveBeenCalledWith('kc-sub-new', ['org_admin']);
      expect(emailService.send).toHaveBeenCalled();
    });

    it('throws ConflictException if slug already exists', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-existing', slug: 'acme' });

      await expect(
        service.selfServeOrganization({ name: 'Acme', slug: 'acme' }, freshCtx),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if caller already has an orgId', async () => {
      await expect(
        service.selfServeOrganization(
          { name: 'Acme', slug: 'acme' },
          { ...freshCtx, orgId: 'org-existing' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('succeeds even when Keycloak attribute binding or email send fails', async () => {
      orgRepo.findOne.mockResolvedValue(null);
      keycloakAdmin.updateUserAttributes.mockRejectedValue(new Error('keycloak unreachable'));
      emailService.send.mockRejectedValue(new Error('smtp unreachable'));

      const result = await service.selfServeOrganization(
        { name: 'Beta', slug: 'beta' },
        freshCtx,
      );

      expect(result.organization.slug).toBe('beta');
      expect(result.requiresTokenRefresh).toBe(true);
    });
  });
});
