import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../organizations.service.js';
import { OrgEntity } from '../entities/org.entity.js';
import { DomainEntity } from '../entities/domain.entity.js';
import { PrincipalEntity } from '../entities/principal.entity.js';
import { RoleAssignmentEntity } from '../entities/role-assignment.entity.js';

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

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let orgRepo: ReturnType<typeof mockOrgRepo>;
  let domainRepo: ReturnType<typeof mockDomainRepo>;
  let principalRepo: ReturnType<typeof mockPrincipalRepo>;
  let roleAssignmentRepo: ReturnType<typeof mockRoleAssignmentRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(OrgEntity), useFactory: mockOrgRepo },
        { provide: getRepositoryToken(DomainEntity), useFactory: mockDomainRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useFactory: mockRoleAssignmentRepo },
      ],
    }).compile();

    service = module.get(OrganizationsService);
    orgRepo = module.get(getRepositoryToken(OrgEntity));
    domainRepo = module.get(getRepositoryToken(DomainEntity));
    principalRepo = module.get(getRepositoryToken(PrincipalEntity));
    roleAssignmentRepo = module.get(getRepositoryToken(RoleAssignmentEntity));
  });

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

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
});
