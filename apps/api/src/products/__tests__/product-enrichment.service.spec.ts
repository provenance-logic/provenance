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
import { EncryptionService } from '../../common/encryption.service.js';
import type { PortDeclarationEntity } from '../entities/port-declaration.entity.js';

const mockRepo = () => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
});

const mockEncryptionService = () => ({
  encrypt: jest.fn().mockImplementation((payload: Record<string, unknown>) =>
    Promise.resolve({
      version: 1,
      iv: 'iv',
      authTag: 'tag',
      ciphertext: Buffer.from(JSON.stringify(payload)).toString('base64'),
    }),
  ),
  decrypt: jest.fn().mockImplementation((env: { ciphertext: string }) =>
    Promise.resolve(JSON.parse(Buffer.from(env.ciphertext, 'base64').toString('utf8'))),
  ),
});

const encryptedEnvelope = (payload: Record<string, unknown>) => ({
  version: 1,
  iv: 'iv',
  authTag: 'tag',
  ciphertext: Buffer.from(JSON.stringify(payload)).toString('base64'),
});

const makePort = (overrides: Partial<PortDeclarationEntity> = {}): PortDeclarationEntity => ({
  id: 'port-1',
  orgId: 'org-1',
  productId: 'product-1',
  portType: 'output',
  name: 'Orders Output',
  description: null,
  interfaceType: 'sql_jdbc',
  contractSchema: null,
  slaDescription: null,
  connectionDetails: encryptedEnvelope({
    kind: 'sql_jdbc',
    host: 'db.example.com',
    port: 5432,
    database: 'orders',
    schema: 'public',
    authMethod: 'username_password',
    sslMode: 'require',
    password: 'hunter2',
  }) as unknown as Record<string, unknown>,
  connectionDetailsEncrypted: true,
  connectionDetailsValidated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: null as any,
  ...overrides,
});

const productCtx = { id: 'product-1', orgId: 'org-1', ownerPrincipalId: 'owner-1' };

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
        { provide: EncryptionService,                         useFactory: mockEncryptionService },
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

  describe('disclosePortConnectionDetails', () => {
    const grantedCtx = {
      principalId: 'consumer-1',
      orgId: 'org-1',
      principalType: 'human_user' as const,
      roles: [],
      keycloakSubject: 'kc-1',
    };

    it('returns null/null for unauthenticated callers', async () => {
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, undefined);
      expect(result).toEqual({ connectionDetails: null, connectionDetailsPreview: null });
    });

    it('returns full decrypted details when the principal has an active grant', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce({
        grantedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      });
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, grantedCtx);
      expect(result.connectionDetailsPreview).toBeNull();
      expect(result.connectionDetails).toMatchObject({
        kind: 'sql_jdbc',
        host: 'db.example.com',
        password: 'hunter2',
      });
    });

    it('treats the product owner as a grantee (returns full details)', async () => {
      const ownerCtx = { ...grantedCtx, principalId: 'owner-1' };
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, ownerCtx);
      expect(result.connectionDetails).toMatchObject({ host: 'db.example.com' });
      // Owner path must not hit the grants repo at all.
      expect(accessGrantRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns a redacted preview with host and no credentials for authed non-grantees', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce(null);
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, grantedCtx);
      expect(result.connectionDetails).toBeNull();
      expect(result.connectionDetailsPreview).toEqual({
        kind: 'sql_jdbc',
        host: 'db.example.com',
        redacted: true,
      });
    });

    it('treats a revoked grant as no grant', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce({
        grantedAt: new Date(),
        expiresAt: null,
        revokedAt: new Date(),
      });
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, grantedCtx);
      expect(result.connectionDetails).toBeNull();
      expect(result.connectionDetailsPreview).toMatchObject({ redacted: true });
    });

    it('treats an expired grant as no grant', async () => {
      accessGrantRepo.findOne.mockResolvedValueOnce({
        grantedAt: new Date('2024-01-01'),
        expiresAt: new Date('2024-01-02'),
        revokedAt: null,
      });
      const result = await service.disclosePortConnectionDetails(makePort(), productCtx, grantedCtx);
      expect(result.connectionDetails).toBeNull();
      expect(result.connectionDetailsPreview).toMatchObject({ redacted: true });
    });

    it('returns null/null when the port has no connection details', async () => {
      const port = makePort({ connectionDetails: null, connectionDetailsEncrypted: false });
      const result = await service.disclosePortConnectionDetails(port, productCtx, grantedCtx);
      expect(result).toEqual({ connectionDetails: null, connectionDetailsPreview: null });
    });
  });
});
