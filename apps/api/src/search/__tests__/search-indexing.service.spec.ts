import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchIndexingService } from '../search-indexing.service.js';
import { OPENSEARCH_CLIENT } from '../opensearch.client.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { DomainEntity } from '../../organizations/entities/domain.entity.js';

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

describe('SearchIndexingService', () => {
  let service: SearchIndexingService;
  let osClient: ReturnType<typeof mockOsClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SearchIndexingService,
        { provide: OPENSEARCH_CLIENT, useFactory: mockOsClient },
        { provide: getRepositoryToken(DataProductEntity), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(DomainEntity), useValue: { findOne: jest.fn() } },
      ],
    }).compile();

    service = module.get(SearchIndexingService);
    osClient = module.get(OPENSEARCH_CLIENT);
  });

  describe('ensureIndex()', () => {
    it('creates the kNN index with knn enabled and embedding mapped as knn_vector (B-077)', async () => {
      await service.ensureIndex();

      expect(osClient.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'data_products',
          body: expect.objectContaining({
            settings: expect.objectContaining({
              index: expect.objectContaining({ knn: true }),
            }),
            mappings: expect.objectContaining({
              properties: expect.objectContaining({
                embedding: { type: 'knn_vector', dimension: 384 },
                org_id:    expect.objectContaining({ type: 'keyword' }),
                domain:    expect.objectContaining({ type: 'keyword' }),
              }),
            }),
          }),
        }),
      );
    });

    it('runs on module init', async () => {
      const spy = jest.spyOn(service, 'ensureIndex').mockResolvedValue();
      await service.onModuleInit();
      expect(spy).toHaveBeenCalled();
    });

    it('silently ignores resource_already_exists_exception', async () => {
      const err: any = new Error('index already exists');
      err.meta = { body: { error: { type: 'resource_already_exists_exception' } } };
      osClient.indices.create.mockRejectedValueOnce(err);

      await expect(service.ensureIndex()).resolves.toBeUndefined();
    });

    it('logs and continues on unknown index creation errors', async () => {
      osClient.indices.create.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.ensureIndex()).resolves.toBeUndefined();
    });
  });
});
