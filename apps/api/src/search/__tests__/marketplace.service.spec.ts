import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketplaceService } from '../marketplace.service.js';
import { TrustScoreService } from '../trust-score.service.js';
import { OPENSEARCH_CLIENT } from '../opensearch.client.js';
import { PRODUCT_INDEX } from '../product-index.service.js';
import { ProductEnrichmentService } from '../../products/product-enrichment.service.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../../products/entities/port-declaration.entity.js';
import { ProductVersionEntity } from '../../products/entities/product-version.entity.js';
import { ComplianceStateEntity } from '../../governance/entities/compliance-state.entity.js';
import { DomainEntity } from '../../organizations/entities/domain.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../../access/entities/access-request.entity.js';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

const makeHit = (overrides: Record<string, unknown> = {}) => ({
  _source: {
    id:               'product-1',
    orgId:            'org-1',
    domainId:         'domain-1',
    name:             'Orders Product',
    slug:             'orders-product',
    description:      'Order data',
    status:           'published',
    version:          '1.0.0',
    classification:   'internal',
    ownerPrincipalId: 'principal-1',
    tags:             ['orders'],
    trustScore:       1.0,
    ...overrides,
  },
});

const makeSearchResponse = (hits: object[], total: number) => ({
  body: {
    hits: {
      total: { value: total },
      hits,
    },
  },
});

const mockOsClient = () => ({
  search: jest.fn().mockResolvedValue(makeSearchResponse([], 0)),
});

const mockRepo = () => ({
  find:           jest.fn().mockResolvedValue([]),
  findOne:        jest.fn().mockResolvedValue(null),
  findAndCount:   jest.fn().mockResolvedValue([[], 0]),
  createQueryBuilder: jest.fn().mockReturnValue({
    where:        jest.fn().mockReturnThis(),
    andWhere:     jest.fn().mockReturnThis(),
    orderBy:      jest.fn().mockReturnThis(),
    take:         jest.fn().mockReturnThis(),
    skip:         jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getMany:      jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getCount:     jest.fn().mockResolvedValue(0),
  }),
});

const mockTrustScoreService = () => ({
  computeTrustScore: jest.fn().mockResolvedValue(1.0),
});

const mockEnrichmentService = () => ({
  enrich: jest.fn().mockResolvedValue({
    owner:         null,
    domainTeam:    null,
    freshness:     null,
    accessStatus:  null,
    columnSchema:  null,
  }),
  disclosePortConnectionDetails: jest.fn().mockResolvedValue({
    connectionDetails: null,
    connectionDetailsPreview: null,
  }),
  hasActiveGrant: jest.fn().mockResolvedValue(false),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let osClient: ReturnType<typeof mockOsClient>;
  let module: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: OPENSEARCH_CLIENT,                                  useFactory: mockOsClient          },
        { provide: TrustScoreService,                                  useFactory: mockTrustScoreService },
        { provide: ProductEnrichmentService,                           useFactory: mockEnrichmentService },
        { provide: getRepositoryToken(DataProductEntity),              useFactory: mockRepo              },
        { provide: getRepositoryToken(PortDeclarationEntity),          useFactory: mockRepo              },
        { provide: getRepositoryToken(ProductVersionEntity),           useFactory: mockRepo              },
        { provide: getRepositoryToken(ComplianceStateEntity),          useFactory: mockRepo              },
        { provide: getRepositoryToken(DomainEntity),                   useFactory: mockRepo              },
        { provide: getRepositoryToken(AccessGrantEntity),              useFactory: mockRepo              },
        { provide: getRepositoryToken(AccessRequestEntity),            useFactory: mockRepo              },
      ],
    }).compile();

    service  = module.get(MarketplaceService);
    osClient = module.get(OPENSEARCH_CLIENT);
  });

  it('returns empty results when no documents match', async () => {
    const result = await service.search('org-1', '');

    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('always filters by orgId and status=published', async () => {
    await service.search('org-1', 'orders');

    expect(osClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: PRODUCT_INDEX,
        body:  expect.objectContaining({
          query: expect.objectContaining({
            bool: expect.objectContaining({
              filter: expect.arrayContaining([
                { term: { orgId: 'org-1' } },
                { term: { status: 'published' } },
              ]),
            }),
          }),
        }),
      }),
    );
  });

  it('uses multi_match when a search query is provided', async () => {
    await service.search('org-1', 'orders');

    const call = osClient.search.mock.calls[0][0] as { body: { query: { bool: { must: Array<{ multi_match: { query: string; fields: string[] } }> } } } };
    const must = call.body.query.bool.must;
    expect(must[0]).toMatchObject({
      multi_match: expect.objectContaining({
        query:  'orders',
        fields: expect.arrayContaining(['name^3', 'tags^2']),
      }),
    });
  });

  it('uses match_all when the query string is empty', async () => {
    await service.search('org-1', '');

    const call = osClient.search.mock.calls[0][0] as { body: { query: { bool: { must: Array<{ match_all: object }> } } } };
    const must = call.body.query.bool.must;
    expect(must[0]).toEqual({ match_all: {} });
  });

  it('maps hits to ProductSearchResult objects', async () => {
    osClient.search.mockResolvedValueOnce(
      makeSearchResponse([makeHit()], 1),
    );

    const result = await service.search('org-1', 'orders');

    expect(result.total).toBe(1);
    expect(result.results[0].name).toBe('Orders Product');
    expect(result.results[0].trustScore).toBe(1.0);
  });

  it('applies page and limit pagination correctly', async () => {
    await service.search('org-1', '', { page: 3, limit: 10 });

    const call = osClient.search.mock.calls[0][0] as { body: { from: number; size: number } };
    expect(call.body.from).toBe(20); // (page 3 - 1) * limit 10
    expect(call.body.size).toBe(10);
  });

  it('defaults page to 1 and limit to 20', async () => {
    await service.search('org-1', '');

    const call = osClient.search.mock.calls[0][0] as { body: { from: number; size: number } };
    expect(call.body.from).toBe(0);
    expect(call.body.size).toBe(20);
  });

  it('caps limit at 100', async () => {
    await service.search('org-1', '', { limit: 999 });

    const call = osClient.search.mock.calls[0][0] as { body: { size: number } };
    expect(call.body.size).toBe(100);
  });

  it('returns empty results gracefully when OpenSearch is unavailable', async () => {
    osClient.search.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await service.search('org-1', 'orders');

    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Product detail — 5.4 P1 enrichment wiring
  // ---------------------------------------------------------------------------

  describe('getProductDetail — enrichment fields', () => {
    const baseProduct = {
      id: 'product-1',
      orgId: 'org-1',
      domainId: 'domain-1',
      name: 'Orders',
      slug: 'orders',
      description: null,
      status: 'published',
      version: '1.0.0',
      classification: 'internal',
      ownerPrincipalId: 'principal-1',
      tags: [],
      ports: [],
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-02T00:00:00Z'),
    };

    beforeEach(() => {
      const dpRepo = (service as unknown as { productRepo: { findOne: jest.Mock; find: jest.Mock } }).productRepo;
      dpRepo.findOne.mockResolvedValue(baseProduct);
      dpRepo.find.mockResolvedValue([baseProduct]);
    });

    it('calls ProductEnrichmentService.enrich and merges the returned fields into the response', async () => {
      const enrichment = module.get(ProductEnrichmentService) as ReturnType<typeof mockEnrichmentService>;
      enrichment.enrich.mockResolvedValueOnce({
        owner:        { id: 'principal-1', displayName: 'Alice', email: 'alice@example.com' },
        domainTeam:   { id: 'domain-1', name: 'Finance', ownerDisplayName: 'Dana', ownerEmail: 'dana@example.com' },
        freshness:    { lastRefreshedAt: null, sloType: 'freshness', passed: true, measuredValue: 0.99, evaluatedAt: '2024-01-02T00:00:00.000Z' },
        accessStatus: { status: 'granted', grantedAt: '2024-01-01T00:00:00.000Z', expiresAt: null },
        columnSchema: null,
      });

      const result = await service.getProductDetail('org-1', 'product-1');

      expect(enrichment.enrich).toHaveBeenCalledTimes(1);
      expect(result.owner).toEqual({ id: 'principal-1', displayName: 'Alice', email: 'alice@example.com' });
      expect(result.domainTeam).toMatchObject({ name: 'Finance' });
      expect(result.freshness).toMatchObject({ passed: true });
      expect(result.accessStatus).toMatchObject({ status: 'granted' });
      expect(result.columnSchema).toBeNull();
    });

    it('forwards ctx to enrich when provided', async () => {
      const enrichment = module.get(ProductEnrichmentService) as ReturnType<typeof mockEnrichmentService>;
      const ctx = {
        principalId: 'principal-1',
        orgId: 'org-1',
        principalType: 'human_user' as const,
        roles: [],
        keycloakSubject: 'kc-1',
      };

      await service.getProductDetail('org-1', 'product-1', ctx);

      expect(enrichment.enrich).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'product-1', orgId: 'org-1' }),
        ctx,
      );
    });
  });
});
