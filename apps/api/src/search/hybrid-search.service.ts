import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { getConfig } from '../config.js';
import type { SearchIntent } from './nl-query.service.js';

export interface HybridSearchResult {
  product_id: string;
  name: string;
  domain: string;
  tags: string[];
  trust_score: number | null;
  lifecycle_state: string;
  score: number;
  embedded_text: string;
}

const INDEX_NAME = 'data_products';

@Injectable()
export class HybridSearchService {
  private readonly logger = new Logger(HybridSearchService.name);

  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
  ) {}

  async search(intent: SearchIntent, orgId: string, limit = 10): Promise<HybridSearchResult[]> {
    const cappedLimit = Math.min(limit, 10);

    let embedding: number[];
    try {
      embedding = await this.fetchEmbedding(intent.raw_query);
    } catch (err) {
      this.logger.error('Embedding service unavailable — cannot perform semantic search', (err as Error).message);
      return [];
    }

    const filters: Record<string, unknown>[] = [
      { term: { org_id: orgId } },
    ];

    if (intent.domain) {
      // Domain is a keyword field — use wildcard with case_insensitive
      // to match regardless of how NL query extraction cased it
      filters.push({ wildcard: { domain: { value: intent.domain, case_insensitive: true } } });
    }
    if (intent.tags && intent.tags.length > 0) {
      filters.push({ terms: { tags: intent.tags } });
    }
    if (intent.lifecycle_state) {
      filters.push({ term: { lifecycle_state: intent.lifecycle_state } });
    }
    if (intent.trust_score_min !== undefined) {
      filters.push({ range: { trust_score: { gte: intent.trust_score_min } } });
    }

    const hasKeywords = intent.keywords && intent.keywords.length > 0;
    const keywordQuery = hasKeywords ? intent.keywords!.join(' ') : null;

    const body: Record<string, unknown> = {
      size: cappedLimit,
      query: {
        bool: {
          filter: filters,
          ...(hasKeywords
            ? {
                should: [
                  {
                    knn: {
                      embedding: {
                        vector: embedding,
                        k: cappedLimit,
                        boost: 0.7,
                      },
                    },
                  },
                  {
                    multi_match: {
                      query: keywordQuery,
                      fields: ['name^2', 'description'],
                      boost: 0.3,
                    },
                  },
                ],
                minimum_should_match: 1,
              }
            : {
                must: [
                  {
                    knn: {
                      embedding: {
                        vector: embedding,
                        k: cappedLimit,
                      },
                    },
                  },
                ],
              }),
        },
      },
    };

    try {
      const response = await this.client.search({
        index: INDEX_NAME,
        body,
      });

      interface HitSource {
        product_id: string;
        name: string;
        domain: string;
        tags: string[];
        trust_score: number | null;
        lifecycle_state: string;
        embedded_text: string;
      }
      interface Hit { _source: HitSource; _score: number }
      interface SearchBody { hits: { hits: Hit[] } }

      const hits = (response.body as SearchBody).hits.hits;
      return hits.map((hit) => ({
        product_id: hit._source.product_id,
        name: hit._source.name,
        domain: hit._source.domain,
        tags: hit._source.tags ?? [],
        trust_score: hit._source.trust_score,
        lifecycle_state: hit._source.lifecycle_state,
        score: hit._score,
        embedded_text: hit._source.embedded_text,
      }));
    } catch (err) {
      this.logger.error('Hybrid search failed', (err as Error).message);
      return [];
    }
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
