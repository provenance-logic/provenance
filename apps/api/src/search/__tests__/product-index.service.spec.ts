import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductIndexService, PRODUCT_INDEX } from '../product-index.service.js';
import { TrustScoreService } from '../trust-score.service.js';
import { OPENSEARCH_CLIENT } from '../opensearch.client.js';
import { ComplianceStateEntity } from '../../governance/entities/compliance-state.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockOsClient = () => ({
  indices: {
    create: jest.fn().mockResolvedValue({ statusCode: 200 }),
  },
  index:  jest.fn().mockResolvedValue({ statusCode: 200 }),
  delete: jest.fn().mockResolvedValue({ statusCode: 200 }),
});

const mockComplianceRepo = () => ({
  findOne: jest.fn(),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-01T00:00:00Z');

const makeProduct = (overrides: Record<string, unknown> = {}) => ({
  id:               'product-1',
  orgId:            'org-1',
  domainId:         'domain-1',
  name:             'Orders Product',
  slug:             'orders-product',
  description:      'Order data',
  status:           'published' as const,
  version:          '1.0.0',
  classification:   'internal' as const,
  ownerPrincipalId: 'principal-1',
  tags:             ['orders', 'ecommerce'],
  ports:            [],
  createdAt:        now.toISOString(),
  updatedAt:        now.toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// TrustScoreService — unit tests (no OpenSearch needed)
// ---------------------------------------------------------------------------

describe('TrustScoreService', () => {
  let trustScoreService: TrustScoreService;
  let complianceRepo: ReturnType<typeof mockComplianceRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TrustScoreService,
        { provide: getRepositoryToken(ComplianceStateEntity), useFactory: mockComplianceRepo },
      ],
    }).compile();

    trustScoreService = module.get(TrustScoreService);
    complianceRepo = module.get(getRepositoryToken(ComplianceStateEntity));
  });

  it('returns 1.0 when no compliance record exists', async () => {
    complianceRepo.findOne.mockResolvedValue(null);
    expect(await trustScoreService.computeTrustScore('org-1', 'product-1')).toBe(1.0);
  });

  it('returns 1.0 for compliant state', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'compliant' });
    expect(await trustScoreService.computeTrustScore('org-1', 'product-1')).toBe(1.0);
  });

  it('returns 0.75 for grace_period state', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'grace_period' });
    expect(await trustScoreService.computeTrustScore('org-1', 'product-1')).toBe(0.75);
  });

  it('returns 0.5 for drift_detected state', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'drift_detected' });
    expect(await trustScoreService.computeTrustScore('org-1', 'product-1')).toBe(0.5);
  });

  it('returns 0.25 for non_compliant state', async () => {
    complianceRepo.findOne.mockResolvedValue({ state: 'non_compliant' });
    expect(await trustScoreService.computeTrustScore('org-1', 'product-1')).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// ProductIndexService
// ---------------------------------------------------------------------------

describe('ProductIndexService', () => {
  let service: ProductIndexService;
  let osClient: ReturnType<typeof mockOsClient>;
  let trustScoreService: jest.Mocked<TrustScoreService>;
  let productRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    productRepo = { findOne: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ProductIndexService,
        {
          provide: OPENSEARCH_CLIENT,
          useFactory: mockOsClient,
        },
        {
          provide: TrustScoreService,
          useValue: {
            computeTrustScore: jest.fn().mockResolvedValue(0.9),
          },
        },
        {
          provide: getRepositoryToken(DataProductEntity),
          useValue: productRepo,
        },
      ],
    }).compile();

    service = module.get(ProductIndexService);
    osClient = module.get(OPENSEARCH_CLIENT);
    trustScoreService = module.get(TrustScoreService) as jest.Mocked<TrustScoreService>;
  });

  describe('ensureIndex()', () => {
    it('creates the index with the correct mapping', async () => {
      await service.ensureIndex();

      expect(osClient.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          index: PRODUCT_INDEX,
          body: expect.objectContaining({
            mappings: expect.objectContaining({
              properties: expect.objectContaining({
                name:       expect.objectContaining({ type: 'text' }),
                orgId:      expect.objectContaining({ type: 'keyword' }),
                trustScore: expect.objectContaining({ type: 'float' }),
              }),
            }),
          }),
        }),
      );
    });

    it('silently ignores resource_already_exists_exception', async () => {
      const err: any = new Error('index already exists');
      err.meta = { body: { error: { type: 'resource_already_exists_exception' } } };
      osClient.indices.create.mockRejectedValueOnce(err);

      await expect(service.ensureIndex()).resolves.toBeUndefined();
    });

    it('logs and continues on unknown index creation errors', async () => {
      const err = new Error('connection refused');
      osClient.indices.create.mockRejectedValueOnce(err);

      await expect(service.ensureIndex()).resolves.toBeUndefined();
    });
  });

  describe('indexProduct()', () => {
    it('computes trust score and upserts a document into the index', async () => {
      const product = makeProduct();

      await service.indexProduct('org-1', product as any);

      expect(trustScoreService.computeTrustScore).toHaveBeenCalledWith('org-1', 'product-1');
      expect(osClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: PRODUCT_INDEX,
          id:    'product-1',
          body:  expect.objectContaining({
            id:         'product-1',
            orgId:      'org-1',
            name:       'Orders Product',
            trustScore: 0.9,
          }),
        }),
      );
    });
  });

  describe('indexProductById()', () => {
    it('looks up the entity by (productId, orgId) and indexes it (B-009)', async () => {
      productRepo.findOne.mockResolvedValue({
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
        createdAt:        now,
        updatedAt:        now,
      });

      await service.indexProductById('product-1', 'org-1');

      expect(productRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'product-1', orgId: 'org-1' },
      });
      expect(osClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: PRODUCT_INDEX,
          id:    'product-1',
          body:  expect.objectContaining({
            id:    'product-1',
            orgId: 'org-1',
            name:  'Orders Product',
            tags:  ['orders'],
          }),
        }),
      );
    });

    it('skips indexing when the product is not found (no throw)', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await service.indexProductById('missing', 'org-1');

      expect(osClient.index).not.toHaveBeenCalled();
    });
  });

  describe('removeProduct()', () => {
    it('deletes the document from the index', async () => {
      await service.removeProduct('product-1');

      expect(osClient.delete).toHaveBeenCalledWith(
        expect.objectContaining({ index: PRODUCT_INDEX, id: 'product-1' }),
      );
    });

    it('silently ignores 404 when product was never indexed', async () => {
      const err: any = new Error('not found');
      err.meta = { statusCode: 404 };
      osClient.delete.mockRejectedValueOnce(err);

      await expect(service.removeProduct('missing-product')).resolves.toBeUndefined();
    });

    it('re-throws non-404 errors', async () => {
      const err: any = new Error('cluster unavailable');
      err.meta = { statusCode: 503 };
      osClient.delete.mockRejectedValueOnce(err);

      await expect(service.removeProduct('product-1')).rejects.toThrow('cluster unavailable');
    });
  });
});
