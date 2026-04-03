import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { TrustScoreService } from './trust-score.service.js';
import type { DataProduct } from '@provenance/types';

export const PRODUCT_INDEX = 'provenance-products';

@Injectable()
export class ProductIndexService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    private readonly trustScoreService: TrustScoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureIndex();
  }

  async ensureIndex(): Promise<void> {
    try {
      await this.client.indices.create({
        index: PRODUCT_INDEX,
        body: {
          mappings: {
            properties: {
              id:               { type: 'keyword' },
              orgId:            { type: 'keyword' },
              domainId:         { type: 'keyword' },
              name:             { type: 'text', fields: { keyword: { type: 'keyword' } } },
              slug:             { type: 'keyword' },
              description:      { type: 'text' },
              status:           { type: 'keyword' },
              version:          { type: 'keyword' },
              classification:   { type: 'keyword' },
              ownerPrincipalId: { type: 'keyword' },
              tags:             { type: 'keyword' },
              trustScore:       { type: 'float' },
              indexedAt:        { type: 'date' },
            },
          },
        },
      });
    } catch (err: unknown) {
      // resource_already_exists_exception is expected when the service restarts
      const errType = (err as { meta?: { body?: { error?: { type?: string } } } }).meta?.body?.error?.type;
      if (errType !== 'resource_already_exists_exception') {
        this.logger.error('Failed to ensure OpenSearch index', err);
        throw err;
      }
    }
  }

  async indexProduct(orgId: string, product: DataProduct): Promise<void> {
    const trustScore = await this.trustScoreService.computeTrustScore(orgId, product.id);
    await this.client.index({
      index: PRODUCT_INDEX,
      id: product.id,
      body: {
        id:               product.id,
        orgId,
        domainId:         product.domainId,
        name:             product.name,
        slug:             product.slug,
        description:      product.description ?? null,
        status:           product.status,
        version:          product.version,
        classification:   product.classification,
        ownerPrincipalId: product.ownerPrincipalId,
        tags:             product.tags,
        trustScore,
        indexedAt:        new Date().toISOString(),
      },
      refresh: true,
    });
  }

  async removeProduct(productId: string): Promise<void> {
    try {
      await this.client.delete({
        index: PRODUCT_INDEX,
        id: productId,
        refresh: true,
      });
    } catch (err: unknown) {
      // 404 is acceptable — the product may never have been indexed
      if ((err as { meta?: { statusCode?: number } }).meta?.statusCode !== 404) throw err;
    }
  }
}
