import axios, { AxiosInstance } from 'axios';
import { getConfig } from '../config.js';

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  version: string;
  classification: string;
  description: string;
  domainId: string;
  domainName: string;
  trustScore?: number;
  trustBand?: string;
}

export interface TrustScoreDto {
  product_id: string;
  org_id: string;
  score: number;
  band: string;
  components: Record<string, unknown>;
  computed_at: string;
}

export interface LineageNode {
  id: string;
  type: string;
  label: string;
  metadata: Record<string, unknown>;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  confidence: string;
}

export interface LineageGraph {
  productId: string;
  depth: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface SloSummary {
  product_id: string;
  org_id: string;
  total_slos: number;
  active_slos: number;
  pass_rate_7d: number;
  pass_rate_30d: number;
  slos_with_no_data: number;
  last_evaluated_at: string;
  slo_health: string;
}

export class ControlPlaneClient {
  private http: AxiosInstance;

  constructor() {
    const config = getConfig();
    this.http = axios.create({
      baseURL: `${config.CONTROL_PLANE_URL}/api/v1`,
      headers: { Authorization: `Bearer ${config.MCP_API_KEY}` },
      timeout: 10000,
    });
  }

  async listProducts(orgId: string): Promise<ProductSummary[]> {
    const domainsRes = await this.http.get(`/organizations/${orgId}/domains`);
    const domains: Array<{ id: string; name: string }> = domainsRes.data.items;

    const products: ProductSummary[] = [];
    for (const domain of domains) {
      const productsRes = await this.http.get(
        `/organizations/${orgId}/domains/${domain.id}/products`,
      );
      for (const p of productsRes.data.items) {
        let trustScore: number | undefined;
        let trustBand: string | undefined;
        try {
          const ts = await this.http.get(
            `/organizations/${orgId}/products/${p.id}/trust-score`,
          );
          trustScore = ts.data.score;
          trustBand = ts.data.band;
        } catch {
          // trust score may not exist yet
        }
        products.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          status: p.status,
          version: p.version,
          classification: p.classification,
          description: p.description ?? '',
          domainId: domain.id,
          domainName: domain.name,
          trustScore,
          trustBand,
        });
      }
    }
    return products;
  }

  async getProduct(orgId: string, domainId: string, productId: string) {
    const res = await this.http.get(
      `/organizations/${orgId}/domains/${domainId}/products/${productId}`,
    );
    return res.data;
  }

  async getTrustScore(orgId: string, productId: string): Promise<TrustScoreDto> {
    const res = await this.http.get(
      `/organizations/${orgId}/products/${productId}/trust-score`,
    );
    return res.data;
  }

  async getLineage(
    orgId: string,
    productId: string,
    direction: 'upstream' | 'downstream' | 'both' = 'both',
  ): Promise<{ upstream?: LineageGraph; downstream?: LineageGraph }> {
    const result: { upstream?: LineageGraph; downstream?: LineageGraph } = {};
    if (direction === 'upstream' || direction === 'both') {
      const res = await this.http.get(
        `/organizations/${orgId}/lineage/products/${productId}/upstream`,
      );
      result.upstream = res.data;
    }
    if (direction === 'downstream' || direction === 'both') {
      const res = await this.http.get(
        `/organizations/${orgId}/lineage/products/${productId}/downstream`,
      );
      result.downstream = res.data;
    }
    return result;
  }

  async getSloSummary(orgId: string, productId: string): Promise<SloSummary> {
    const res = await this.http.get(
      `/organizations/${orgId}/products/${productId}/slo-summary`,
    );
    return res.data;
  }

  async getAgentInfo(agentId: string): Promise<{ agent_id: string; current_classification: string; human_oversight_contact: string; org_id: string } | null> {
    try {
      const res = await this.http.get(`/agents/${agentId}`);
      return res.data;
    } catch {
      return null;
    }
  }

  async writeAuditEntry(entry: Record<string, unknown>): Promise<void> {
    try {
      await this.http.post('/internal/audit', entry);
    } catch (err) {
      console.error('[Audit] Failed to write audit entry:', (err as Error).message);
    }
  }

  async registerAgent(orgId: string, dto: {
    display_name: string;
    model_name: string;
    model_provider: string;
    human_oversight_contact: string;
  }): Promise<Record<string, unknown>> {
    const res = await this.http.post('/agents', {
      ...dto,
      org_id: orgId,
    });
    return res.data;
  }

  async getAgentStatus(agentId: string): Promise<Record<string, unknown>> {
    const res = await this.http.get(`/agents/${agentId}/oversight`);
    return res.data;
  }

  async getSemanticSearch(orgId: string, query: string, limit = 10): Promise<{ intent: Record<string, unknown>; results: Array<Record<string, unknown>> }> {
    const res = await this.http.post('/internal/search/semantic', {
      query,
      org_id: orgId,
      limit,
    });
    return res.data;
  }

  async searchProducts(orgId: string, query: string): Promise<ProductSummary[]> {
    // Try marketplace search first
    try {
      const res = await this.http.get(
        `/organizations/${orgId}/marketplace/products`,
      );
      const items: Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        version: string;
        classification: string;
        description: string;
        domainId: string;
        domainName: string;
        trustScore: number;
      }> = res.data.items;
      const lowerQuery = query.toLowerCase();
      return items
        .filter(
          (p) =>
            p.name.toLowerCase().includes(lowerQuery) ||
            (p.description ?? '').toLowerCase().includes(lowerQuery) ||
            p.slug.toLowerCase().includes(lowerQuery),
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          status: p.status,
          version: p.version,
          classification: p.classification,
          description: p.description ?? '',
          domainId: p.domainId,
          domainName: p.domainName,
          trustScore: p.trustScore,
        }));
    } catch {
      // Fall back to listing all products and filtering
      const all = await this.listProducts(orgId);
      const lowerQuery = query.toLowerCase();
      return all.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          p.description.toLowerCase().includes(lowerQuery) ||
          p.slug.toLowerCase().includes(lowerQuery),
      );
    }
  }
}
