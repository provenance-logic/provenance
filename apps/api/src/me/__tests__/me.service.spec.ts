import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MeService } from '../me.service.js';
import { OrgEntity } from '../../organizations/entities/org.entity.js';
import type { RequestContext } from '@provenance/types';

const mockOrgRepo = () => ({
  findOne: jest.fn(),
});

const baseCtx: RequestContext = {
  principalId: 'principal-1',
  orgId: 'org-1',
  principalType: 'human_user',
  roles: ['domain_owner'],
  keycloakSubject: 'kc-sub-1',
  email: 'maya@acme.example.com',
  displayName: 'Maya Lopez',
};

describe('MeService', () => {
  let service: MeService;
  let orgRepo: ReturnType<typeof mockOrgRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: getRepositoryToken(OrgEntity), useFactory: mockOrgRepo },
      ],
    }).compile();
    service = module.get(MeService);
    orgRepo = module.get(getRepositoryToken(OrgEntity));
  });

  it('returns the assembled profile when the org exists', async () => {
    orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' });

    const profile = await service.getProfile(baseCtx);

    expect(profile).toEqual({
      principalId: 'principal-1',
      keycloakSubject: 'kc-sub-1',
      principalType: 'human_user',
      displayName: 'Maya Lopez',
      email: 'maya@acme.example.com',
      org: { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' },
      roles: ['domain_owner'],
    });
  });

  it('looks up the org by the request-context orgId (primary key, not tenant-scoped predicate)', async () => {
    orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' });

    await service.getProfile(baseCtx);

    expect(orgRepo.findOne).toHaveBeenCalledWith({ where: { id: 'org-1' } });
  });

  it('normalises missing displayName and email to null', async () => {
    orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' });
    const ctxWithoutOptionalClaims: RequestContext = {
      principalId: 'principal-1',
      orgId: 'org-1',
      principalType: 'human_user',
      roles: [],
      keycloakSubject: 'kc-sub-1',
    };

    const profile = await service.getProfile(ctxWithoutOptionalClaims);

    expect(profile.displayName).toBeNull();
    expect(profile.email).toBeNull();
  });

  it('throws NotFoundException when the org row is missing (programming error path)', async () => {
    orgRepo.findOne.mockResolvedValue(null);

    await expect(service.getProfile(baseCtx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
