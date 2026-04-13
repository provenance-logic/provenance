import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';

export interface SearchIntent {
  domain?: string;
  tags?: string[];
  trust_score_min?: number;
  lifecycle_state?: string;
  keywords?: string[];
  raw_query: string;
}

const SYSTEM_PROMPT =
  'You are a search intent parser for a data mesh platform. Extract structured search intent from natural language queries about data products. Always respond with valid JSON only, no prose, no markdown. The JSON must conform to this schema: { domain?: string, tags?: string[], trust_score_min?: number, lifecycle_state?: string, keywords?: string[], raw_query: string }';

@Injectable()
export class NlQueryService {
  private readonly logger = new Logger(NlQueryService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = getConfig().ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — NL query translation will use fallback mode');
      this.client = null;
    }
  }

  async parseQuery(query: string): Promise<SearchIntent> {
    if (!this.client) {
      return this.fallback(query);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await this.client.messages.create(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: query }],
        },
        { signal: controller.signal },
      );

      clearTimeout(timeout);

      const text = response.content[0];
      if (text.type !== 'text') {
        return this.fallback(query);
      }

      // Strip markdown fences if the model wraps the JSON
      let jsonStr = text.text.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(jsonStr) as SearchIntent;
      parsed.raw_query = query;
      // TODO(Phase 5): The Claude API often infers domains from query text that don't
      // match any actual domain in the platform (e.g. "customer" when the real domain is
      // "Marketing"). This causes the downstream domain filter to return zero results even
      // though kNN ranking would find relevant products. Fix: validate the extracted domain
      // against known org domains before returning, and drop the domain field if no match
      // is found so the search falls through to pure semantic ranking.
      return parsed;
    } catch (err) {
      this.logger.warn(
        `Claude API call failed — falling back to keyword extraction: ${(err as Error).message}`,
      );
      return this.fallback(query);
    }
  }

  private fallback(query: string): SearchIntent {
    return { keywords: [query], raw_query: query };
  }
}
