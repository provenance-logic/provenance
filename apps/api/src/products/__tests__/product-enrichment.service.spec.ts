import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductEnrichmentService } from '../product-enrichment.service.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import { DomainEntity } from '../../organizations/entities/domain.entity.js';
import { SloDeclarationEntity } from '../../observability/entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../../observability/entities/slo-evaluation.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../../access/entities/access-request.entity.js';
import { SchemaSnapshotEntity } from '../../connectors/entities/schema-snapshot.entity.js';

const mockRepo = () => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
});

const mockCtx = {
  principalId: 'principal-1',
  orgId: 'org-1',
  principalType: 'human_user' as const,
  roles: [],
  keycloakSubject: 'keycloak-sub-1',
};

describe('ProductEnrichmentService', () => {
  let service: ProductEnrichmentService;
  let principalRepo: ReturnType<typeof mockRepo>;
  let domainRepo: ReturnType<typeof mockRepo>;
  let sloDeclRepo: ReturnType<typeof mockRepo>;
  let sloEvalRepo: ReturnType<typeof mockRepo>;
  let accessGrantRepo: ReturnType<typeof mockRepo>;
  let accessRequestRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductEnrichmentService,
        { provide: getRepositoryToken(PrincipalEntity),       useFactory: mockRepo },
        { provide: getRepositoryToken(DomainEntity),          useFactory: mockRepo },
        { provide: getRepositoryToken(SloDeclarationEntity),  useFactory: mockRepo },
        { provide: getRepositoryToken(SloEvaluationEntity),   useFactory: mockRepo },
        { provide: getRepositoryToken(AccessGrantEntity),     useFactory: mockRepo },
        { provide: getRepositoryToken(AccessRequestEntity),   useFactory: mockRepo },
        { provide: getRepositoryToken(SchemaSnapshotEntity),  useFactory: mockRepo },
      ],
    }).compile();

    service           = module.get(ProductEnrichmentService);
    principalRepo     = module.get(getRepositoryToken(PrincipalEntity));
    domainRepo        = module.get(getRepositoryToken(DomainEntity));
    sloDeclRepo       = module.get(getRepositoryToken(SloDeclarationEntity));
    sloEvalRepo       = module.get(getRepositoryToken(SloEvaluationEntity));
    accessGrantRepo   = module.get(getRepositoryToken(AccessGrantEntity));
    accessRequestRepo = module.get(getRepositoryToken(AccessRequestEntity));
  });

  describe('resolveOwner', () => {
    it('returns null when the principal is missing', async () => {
      principalRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.resolveOwner('missing')).resolves.toBeNull();
    });

    it('returns id, displayName, email when found', async () => {
      principalRepo.findOne.mockResolvedValueOnce({
        id: 'p-1', displayName: 'Alice', email: 'alice@example.com',
      });
      await expect(service.resolveOwner('p-1')).resolves.toEqual({
        id: 'p-1', displayName: 'Alice', email: 'alice@example.com',
      });
    });

    it('returns null rather than throwing when the repo errors', async () => {
      principalRepo.findOne.mockRejectedValueOnce(new Error('db down'));
      await expect(service.resolveOwner('p-1')).resolves.toBeNull();
    });
  });

  describe('resolveDomainTeam', () => {
    it('includes owner display name and email from the principal row', async () => {
      domainRepo.findOne.mockResolvedValueOnce({
        id: 'domain-1', name: 'Finance', ownerPrincipalId: 'p-owner',
      });
      principalRepo.findOne.mockResolvedValueOnce({
        id: 'p-owner', displayName: 'Dana', email: 'dana@example.com',
      });
      await expect(service.resolveDomainTeam('domain-1')).resolves.toEqual({
        id: 'domain-1',
        name: 'Finance',
        ownerDisplayName: 'Dana',
        ownerEmail: 'dana@example.com',
      });
    });

    it('returns null when domain is missing', async () => {
      domainRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.resolveDomainTeam('nope')).resolves.toBeNull();
    });
  });

  describe('resolveFreshness', () => {
    it('returns null when no freshness SLO is declared', async () => {
      sloDeclRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.resolveFreshness('org-1', 'product-1')).resolves.toBeNull();
    });

    it('maps the latest evaluation into the freshness shape', async () => {
      sloDeclRepo.findOne.mockResolvedValueOnce({ id: 'slo-1', sloType: 'freshness' });
      sloEvalRepo.findOne.mockResolvedValueOnce({
        passed: true,
        measuredValue: 0.99,
        evaluatedAt: new Date('2024-01-02T00:00:00Z'),
      });
      await expect(service.resolveFreshness('org-1', 'product-1')).resolves.toEqual({
        lastRefreshedAt: null,
        sloType: 'freshness',
        passed: true,
        measuredValue: 0.99,
        evaluatedAt: '2024-01-02T00:00:00.000Z',
      });
    });
  });

  describe('resolveAccessStatus', () => {
    it('returns granted when an active grant exists', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce({
        grantedAt: new Date('2024-01-01T00:00:00Z'),
        expiresAt: null,
        revokedAt: null,
      });
      await expect(service.resolveAccessStatus('org-1', 'product-1', mockCtx))
        .resolves.toMatchObject({ status: 'granted' });
    });

    it('returns pending when a pending request exists and no grant', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce(null);
      accessRequestRepo.findOne
        .mockResolvedValueOnce({ status: 'pending' })   // pending lookup
        .mockResolvedValueOnce(null);                    // denied lookup (not reached)
      await expect(service.resolveAccessStatus('org-1', 'product-1', mockCtx))
        .resolves.toEqual({ status: 'pending', grantedAt: null, expiresAt: null });
    });

    it('returns not_requested when no grant and no pending/denied request', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce(null);
      accessRequestRepo.findOne
        .mockResolvedValueOnce(null)   // pending
        .mockResolvedValueOnce(null);  // denied
      await expect(service.resolveAccessStatus('org-1', 'product-1', mockCtx))
        .resolves.toEqual({ status: 'not_requested', grantedAt: null, expiresAt: null });
    });
  });

  describe('enrich', () => {
    it('runs all five resolvers and returns a combined object', async () => {
      principalRepo.findOne.mockResolvedValueOnce({
        id: 'p-1', displayName: 'Alice', email: 'alice@example.com',
      });
      domainRepo.findOne.mockResolvedValueOnce(null);
      sloDeclRepo.findOne.mockResolvedValueOnce(null);
      accessGrantRepo.findOne.mockResolvedValueOnce(null);
      accessRequestRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.enrich(
        { ownerPrincipalId: 'p-1', orgId: 'org-1', domainId: 'domain-1', id: 'product-1' },
        mockCtx,
      );

      expect(result).toEqual({
        owner:         { id: 'p-1', displayName: 'Alice', email: 'alice@example.com' },
        domainTeam:    null,
        freshness:     null,
        accessStatus:  { status: 'not_requested', grantedAt: null, expiresAt: null },
        columnSchema:  null,
      });
    });

    it('passes null accessStatus when ctx is not provided', async () => {
      const result = await service.enrich(
        { ownerPrincipalId: 'p-1', orgId: 'org-1', domainId: 'domain-1', id: 'product-1' },
        undefined,
      );
      expect(result.accessStatus).toBeNull();
    });
  });
});
