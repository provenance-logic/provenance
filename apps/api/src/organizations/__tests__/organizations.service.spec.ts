import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../organizations.service.js';
import { OrgEntity } from '../entities/org.entity.js';
import { DomainEntity } from '../entities/domain.entity.js';

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

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let orgRepo: ReturnType<typeof mockOrgRepo>;
  let domainRepo: ReturnType<typeof mockDomainRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: getRepositoryToken(OrgEntity), useFactory: mockOrgRepo },
        { provide: getRepositoryToken(DomainEntity), useFactory: mockDomainRepo },
      ],
    }).compile();

    service = module.get(OrganizationsService);
    orgRepo = module.get(getRepositoryToken(OrgEntity));
    domainRepo = module.get(getRepositoryToken(DomainEntity));
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
      const saved = {
        id: 'dom-1', orgId: 'org-1', name: 'Analytics', slug: 'analytics',
        description: null, ownerPrincipalId: 'principal-1', createdAt: now, updatedAt: now,
      };
      domainRepo.create.mockReturnValue(saved);
      domainRepo.save.mockResolvedValue(saved);

      const result = await service.createDomain('org-1', {
        name: 'Analytics',
        slug: 'analytics',
        ownerPrincipalId: 'principal-1',
      });

      expect(result.orgId).toBe('org-1');
      expect(result.slug).toBe('analytics');
    });
  });
});
