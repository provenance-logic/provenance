import { Test } from '@nestjs/testing';
import { MarketplaceService } from '../marketplace.service.js';
import { OPENSEARCH_CLIENT } from '../opensearch.client.js';
import { PRODUCT_INDEX } from '../product-index.service.js';

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

const makeSearchResponse = (hits: any[], total: number) => ({
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let osClient: ReturnType<typeof mockOsClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: OPENSEARCH_CLIENT, useFactory: mockOsClient },
      ],
    }).compile();

    service = module.get(MarketplaceService);
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

    const call = osClient.search.mock.calls[0][0];
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

    const call = osClient.search.mock.calls[0][0];
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

    const call = osClient.search.mock.calls[0][0];
    expect(call.body.from).toBe(20); // (page 3 - 1) * limit 10
    expect(call.body.size).toBe(10);
  });

  it('defaults page to 1 and limit to 20', async () => {
    await service.search('org-1', '');

    const call = osClient.search.mock.calls[0][0];
    expect(call.body.from).toBe(0);
    expect(call.body.size).toBe(20);
  });

  it('caps limit at 100', async () => {
    await service.search('org-1', '', { limit: 999 });

    const call = osClient.search.mock.calls[0][0];
    expect(call.body.size).toBe(100);
  });
});
