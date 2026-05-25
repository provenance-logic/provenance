import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { getConfig } from '../config.js';

const INDEX_NAME = 'data_products';

// all-MiniLM-L6-v2 produces 384-dimensional embeddings. This must match the
// embedding service output and the `knn` query vector length in
// HybridSearchService — a mismatch makes every semantic query throw.
const EMBEDDING_DIMENSION = 384;

@Injectable()
export class SearchIndexingService implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexingService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureIndex();
  }

  // Create the kNN index with an explicit mapping BEFORE any document is
  // written. Without this, the first `client.index()` call auto-creates
  // `data_products` with a dynamic mapping that types `embedding` as a plain
  // `float` array and never enables `index.knn`. The `knn` query clause in
  // HybridSearchService then fails with `query_shard_exception: Field
  // 'embedding' is not knn_vector type`, so semantic search returns zero hits
  // on every fresh stand-up. See B-077.
  async ensureIndex(): Promise<void> {
    try {
      await this.client.indices.create({
        index: INDEX_NAME,
        body: {
          settings: {
            index: { knn: true },
          },
          mappings: {
            properties: {
              product_id:      { type: 'keyword' },
              org_id:          { type: 'keyword' },
              name:            { type: 'text' },
              description:     { type: 'text' },
              domain:          { type: 'keyword' },
              tags:            { type: 'keyword' },
              trust_score:     { type: 'float' },
              lifecycle_state: { type: 'keyword' },
              embedding:       { type: 'knn_vector', dimension: EMBEDDING_DIMENSION },
              embedded_at:     { type: 'date' },
              embedded_text:   { type: 'text' },
            },
          },
        },
      });
    } catch (err: unknown) {
      // resource_already_exists_exception is expected when the service restarts
      const errType = (err as { meta?: { body?: { error?: { type?: string } } } }).meta?.body?.error?.type;
      if (errType !== 'resource_already_exists_exception') {
        this.logger.warn('OpenSearch unreachable or kNN index creation failed — semantic search disabled', (err as Error).message);
      }
    }
  }

  async indexProduct(productId: string, orgId: string): Promise<void> {
    try {
      const product = await this.productRepo.findOne({
        where: { id: productId, orgId },
      });
      if (!product) {
        this.logger.warn(`Product ${productId} not found — skipping indexing`);
        return;
      }

      const domain = await this.domainRepo.findOne({
        where: { id: product.domainId, orgId },
      });

      const embeddedText = this.buildEmbeddingText(
        product.name,
        product.description,
        product.tags,
      );

      let embedding: number[];
      try {
        embedding = await this.fetchEmbedding(embeddedText);
      } catch (err) {
        this.logger.error(
          `Embedding service unavailable for product ${productId} — indexing without vector`,
          (err as Error).message,
        );
        return;
      }

      await this.client.index({
        index: INDEX_NAME,
        id: productId,
        body: {
          product_id: productId,
          org_id: orgId,
          name: product.name,
          description: product.description ?? '',
          domain: domain?.name ?? product.domainId,
          tags: product.tags,
          trust_score: null,
          lifecycle_state: product.status,
          embedding,
          embedded_at: new Date().toISOString(),
          embedded_text: embeddedText,
        },
        refresh: true,
      });
    } catch (err) {
      this.logger.error(
        `Failed to index product ${productId}`,
        (err as Error).message,
      );
    }
  }

  async deleteFromIndex(productId: string): Promise<void> {
    try {
      await this.client.delete({
        index: INDEX_NAME,
        id: productId,
        refresh: true,
      });
    } catch (err: unknown) {
      // 404 is acceptable — the product may never have been indexed
      if ((err as { meta?: { statusCode?: number } }).meta?.statusCode !== 404) {
        this.logger.error(`Failed to delete product ${productId} from index`, (err as Error).message);
      }
    }
  }

  private buildEmbeddingText(
    name: string,
    description: string | null,
    tags: string[],
  ): string {
    const parts = [name];
    if (description) parts.push(description);
    if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`);
    return parts.join('. ');
  }

  private async fetchEmbedding(text: string): Promise<number[]> {
    const config = getConfig();
    const res = await fetch(`${config.EMBEDDING_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Embedding service returned ${res.status}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }
}
