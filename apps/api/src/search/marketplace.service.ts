import { Injectable, Inject } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch.client.js';
import { PRODUCT_INDEX } from './product-index.service.js';

export interface ProductSearchResult {
  id: string;
  orgId: string;
  domainId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  version: string;
  classification: string;
  ownerPrincipalId: string;
  tags: string[];
  trustScore: number;
}

export interface ProductSearchResponse {
  total: number;
  page: number;
  limit: number;
  results: ProductSearchResult[];
}

@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
  ) {}

  async search(
    orgId: string,
    query: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<ProductSearchResponse> {
    const page  = Math.max(1, options.page  ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const from  = (page - 1) * limit;

    const mustClauses = query
      ? [
          {
            multi_match: {
              query,
              fields: ['name^3', 'description', 'tags^2'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
        ]
      : [{ match_all: {} }];

    const response = await this.client.search({
      index: PRODUCT_INDEX,
      body: {
        from,
        size: limit,
        query: {
          bool: {
            must:   mustClauses,
            filter: [
              { term: { orgId } },
              { term: { status: 'published' } },
            ],
          },
        },
        sort: [{ _score: 'desc' }, { trustScore: 'desc' }],
      },
    });

    interface HitObject { _source: ProductSearchResult }
    interface HitsResult { hits: HitObject[]; total: number | { value: number; relation: string } }
    interface SearchBody { hits: HitsResult }
    const body = response.body as SearchBody;
    const hits = body.hits;
    const results: ProductSearchResult[] = hits.hits.map((hit) => hit._source);
    const total = typeof hits.total === 'number' ? hits.total : hits.total.value;

    return { total, page, limit, results };
  }
}
