import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { getConfig } from '../config.js';

const INDEX_NAME = 'data_products';

@Injectable()
export class SearchIndexingService {
  private readonly logger = new Logger(SearchIndexingService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
  ) {}

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
