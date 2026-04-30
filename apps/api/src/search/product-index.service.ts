import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { TrustScoreService } from './trust-score.service.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import type { DataProduct } from '@provenance/types';

export const PRODUCT_INDEX = 'provenance-products';

@Injectable()
export class ProductIndexService implements OnModuleInit {
  private readonly logger = new Logger(ProductIndexService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    private readonly trustScoreService: TrustScoreService,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
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
        this.logger.warn('OpenSearch unreachable or index creation failed — search disabled', (err as Error).message);
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

  // Mirrors `SearchIndexingService.indexProduct(productId, orgId)` so the
  // BM25 index is updated synchronously alongside the kNN index from the
  // same call sites in `ProductsService` (publish, update on searchable-
  // field change, etc.). Without this, BM25 indexing depends solely on the
  // Redpanda `product.lifecycle` consumer, which leaves the index empty
  // whenever the broker queue is reset (every dev-stack rebuild) and
  // silently breaks marketplace keyword search. See B-009.
  async indexProductById(productId: string, orgId: string): Promise<void> {
    const entity = await this.productRepo.findOne({ where: { id: productId, orgId } });
    if (!entity) {
      this.logger.warn(`Product ${productId} not found in org ${orgId} — skipping BM25 indexing`);
      return;
    }
    await this.indexProduct(orgId, this.entityToDto(entity));
  }

  private entityToDto(entity: DataProductEntity): DataProduct {
    return {
      id:               entity.id,
      orgId:            entity.orgId,
      domainId:         entity.domainId,
      name:             entity.name,
      slug:             entity.slug,
      description:      entity.description,
      status:           entity.status,
      version:          entity.version,
      classification:   entity.classification,
      ownerPrincipalId: entity.ownerPrincipalId,
      tags:             entity.tags,
      ports:            [],
      createdAt:        entity.createdAt.toISOString(),
      updatedAt:        entity.updatedAt.toISOString(),
    };
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
