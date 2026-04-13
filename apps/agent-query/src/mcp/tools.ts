import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ControlPlaneClient, ProductSummary, LineageNode } from '../control-plane/control-plane.client.js';
import { getConfig } from '../config.js';

type ToolHandler = (args: Record<string, string>) => Promise<CallToolResult>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: ToolHandler;
}

/** Resolve org_id from args or fall back to the configured default. */
function resolveOrgId(args: Record<string, string>): string {
  return args.org_id || getConfig().DEFAULT_ORG_ID;
}

function makeTools(client: ControlPlaneClient): ToolDef[] {
  return [
    // ── Tool 1: list_products ──────────────────────────────────────────
    {
      name: 'list_products',
      description: 'List all data products in the Provenance platform. Returns product names, domains, status, and trust scores.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          status_filter: { type: 'string', description: 'Filter by status: published, draft, or all (default: all)' },
        },
        required: [],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const products = await client.listProducts(orgId);
        const filtered = args.status_filter && args.status_filter !== 'all'
          ? products.filter((p: ProductSummary) => p.status === args.status_filter)
          : products;

        if (filtered.length === 0) {
          return { content: [{ type: 'text', text: 'No data products found.' }] };
        }

        const lines = filtered.map((p: ProductSummary) => {
          const score = p.trustScore != null
            ? ` | Trust: ${(p.trustScore * 100).toFixed(0)}% (${p.trustBand})`
            : '';
          return `- ${p.name} [${p.status}] — Domain: ${p.domainName}${score}\n  ID: ${p.id} | Domain ID: ${p.domainId}`;
        });

        return { content: [{ type: 'text', text: `Found ${filtered.length} data products:\n\n${lines.join('\n\n')}` }] };
      },
    },

    // ── Tool 2: get_product ────────────────────────────────────────────
    {
      name: 'get_product',
      description: 'Get detailed information about a specific data product including its description, ports, classification, and metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          product_id: { type: 'string', description: 'The product ID' },
          domain_id: { type: 'string', description: 'The domain ID' },
        },
        required: ['product_id', 'domain_id'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const p = await client.getProduct(orgId, args.domain_id, args.product_id);
        const ports = (p.ports ?? []).map((port: { portType: string; name: string; interfaceType?: string }) =>
          `  - ${port.name} (${port.portType}${port.interfaceType ? `, ${port.interfaceType}` : ''})`,
        ).join('\n');

        const text = [
          `Name: ${p.name}`,
          `Slug: ${p.slug}`,
          `Status: ${p.status}`,
          `Version: ${p.version}`,
          `Classification: ${p.classification}`,
          `Domain ID: ${p.domainId}`,
          `Description: ${p.description ?? 'None'}`,
          `Tags: ${(p.tags ?? []).join(', ') || 'None'}`,
          '',
          `Ports (${(p.ports ?? []).length}):`,
          ports || '  None',
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 3: get_trust_score ────────────────────────────────────────
    {
      name: 'get_trust_score',
      description: 'Get the trust score for a data product. Returns the overall score (0-1), band (excellent/good/fair/poor/critical), and breakdown of all 5 components: governance compliance, SLO pass rate, lineage completeness, usage activity, and exception history.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          product_id: { type: 'string', description: 'The product ID' },
        },
        required: ['product_id'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const ts = await client.getTrustScore(orgId, args.product_id);
        const components = ts.components as Record<string, { raw_value: unknown; component_score: number; weight: number; weighted_score: number }>;
        const componentLines = Object.entries(components).map(([name, c]) =>
          `  - ${name}: score=${c.component_score.toFixed(2)}, weight=${c.weight}, weighted=${c.weighted_score.toFixed(3)}`,
        );

        const text = [
          `Trust Score: ${(ts.score * 100).toFixed(1)}% (${ts.band})`,
          `Computed at: ${ts.computed_at}`,
          '',
          'Component Breakdown:',
          ...componentLines,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 4: get_lineage ────────────────────────────────────────────
    {
      name: 'get_lineage',
      description: 'Get the lineage graph for a data product. Shows upstream source systems and downstream consumers. Helps understand data provenance and impact.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          product_id: { type: 'string', description: 'The product ID' },
          direction: { type: 'string', description: 'upstream, downstream, or both (default: both)' },
        },
        required: ['product_id'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const dir = (args.direction ?? 'both') as 'upstream' | 'downstream' | 'both';
        const lineage = await client.getLineage(orgId, args.product_id, dir);
        const sections: string[] = [];

        if (lineage.upstream) {
          const upstreamNodes = lineage.upstream.nodes.filter((n: LineageNode) => n.id !== args.product_id);
          sections.push('Upstream Sources:');
          if (upstreamNodes.length > 0) {
            const seen = new Set<string>();
            for (const n of upstreamNodes) {
              const key = `${n.label}|${n.type}`;
              if (!seen.has(key)) { seen.add(key); sections.push(`  - ${n.label} (${n.type})`); }
            }
          } else { sections.push('  None'); }
        }

        if (lineage.downstream) {
          const downstreamNodes = lineage.downstream.nodes.filter((n: LineageNode) => n.id !== args.product_id);
          sections.push('\nDownstream Consumers:');
          if (downstreamNodes.length > 0) {
            const seen = new Set<string>();
            for (const n of downstreamNodes) {
              const key = `${n.label}|${n.type}`;
              if (!seen.has(key)) { seen.add(key); sections.push(`  - ${n.label} (${n.type})`); }
            }
          } else { sections.push('  None'); }
        }

        return { content: [{ type: 'text', text: sections.join('\n') }] };
      },
    },

    // ── Tool 5: get_slo_summary ────────────────────────────────────────
    {
      name: 'get_slo_summary',
      description: 'Get the SLO (Service Level Objective) health summary for a data product. Shows pass rates, health status, and how many SLOs are declared.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          product_id: { type: 'string', description: 'The product ID' },
        },
        required: ['product_id'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const slo = await client.getSloSummary(orgId, args.product_id);
        const text = [
          `SLO Health: ${slo.slo_health}`,
          `Total SLOs: ${slo.total_slos}`,
          `Active SLOs: ${slo.active_slos}`,
          `Pass Rate (7d): ${(slo.pass_rate_7d * 100).toFixed(1)}%`,
          `Pass Rate (30d): ${(slo.pass_rate_30d * 100).toFixed(1)}%`,
          `SLOs with no data: ${slo.slos_with_no_data}`,
          `Last evaluated: ${slo.last_evaluated_at}`,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 6: semantic_search ─────────────────────────────────────────
    {
      name: 'semantic_search',
      description: 'Search for data products using natural language. Understands intent, domain context, and semantic meaning. Returns ranked results with trust scores.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of the data you are looking for' },
          limit: { type: 'string', description: 'Maximum results to return (default 10, max 10)' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const limit = Math.min(parseInt(args.limit || '10', 10) || 10, 10);
        const result = await client.getSemanticSearch(orgId, args.query, limit);

        if (!result.results || result.results.length === 0) {
          return { content: [{ type: 'text', text: `No products found matching "${args.query}".` }] };
        }

        const lines = result.results.map((r: Record<string, unknown>, i: number) => {
          const trustStr = r.trust_score != null ? ` | Trust: ${r.trust_score}` : '';
          return `${i + 1}. ${r.name} [${r.lifecycle_state}] — Domain: ${r.domain}${trustStr}\n   Score: ${(r.score as number).toFixed(4)} | ID: ${r.product_id}\n   Tags: ${(r.tags as string[]).join(', ')}`;
        });

        const intentSummary = Object.entries(result.intent)
          .filter(([k]) => k !== 'raw_query')
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(', ');

        const text = [
          `Search intent: ${intentSummary || 'keyword only'}`,
          '',
          `Found ${result.results.length} matching products:`,
          '',
          ...lines,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 7: register_agent ──────────────────────────────────────────
    {
      name: 'register_agent',
      description: 'Register a new AI agent identity in the Provenance platform. The agent will be assigned Observed trust classification by default. Requires human_oversight_contact to be a registered platform user.',
      inputSchema: {
        type: 'object',
        properties: {
          display_name: { type: 'string', description: 'Human-readable name for this agent' },
          model_name: { type: 'string', description: 'The model identifier, e.g. claude-sonnet-4-20250514' },
          model_provider: { type: 'string', description: 'The model provider, e.g. Anthropic' },
          human_oversight_contact: { type: 'string', description: 'Email address of the registered platform user responsible for overseeing this agent' },
        },
        required: ['display_name', 'model_name', 'model_provider', 'human_oversight_contact'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const result = await client.registerAgent(orgId, {
          display_name: args.display_name,
          model_name: args.model_name,
          model_provider: args.model_provider,
          human_oversight_contact: args.human_oversight_contact,
        });

        const text = [
          `Agent registered successfully:`,
          `  Agent ID: ${result.agent_id}`,
          `  Display Name: ${result.display_name}`,
          `  Model: ${result.model_name} (${result.model_provider})`,
          `  Classification: ${result.current_classification}`,
          `  Oversight Contact: ${result.human_oversight_contact}`,
          `  Created: ${result.created_at}`,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 8: get_agent_status ──────────────────────────────────────
    {
      name: 'get_agent_status',
      description: 'Get the current identity, trust classification, and recent activity summary for a registered agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to look up' },
        },
        required: ['agent_id'],
      },
      handler: async (args) => {
        const result = await client.getAgentStatus(args.agent_id);

        const text = [
          `Agent Status:`,
          `  Agent ID: ${result.agent_id}`,
          `  Display Name: ${result.display_name}`,
          `  Classification: ${result.current_classification}`,
          `  Oversight Contact: ${result.human_oversight_contact}`,
          `  Last Activity: ${result.last_activity_at ?? 'None'}`,
          `  Activity Count (24h): ${result.activity_count_24h}`,
        ].join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },

    // ── Tool 9: search_products ────────────────────────────────────────
    {
      name: 'search_products',
      description: 'Search for data products by keyword. Returns matching products with their domain, status, and trust score.',
      inputSchema: {
        type: 'object',
        properties: {
          org_id: { type: 'string', description: 'Organization ID (optional — uses default if omitted)' },
          query: { type: 'string', description: 'Search keywords' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const orgId = resolveOrgId(args);
        const results = await client.searchProducts(orgId, args.query);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No products found matching "${args.query}".` }] };
        }

        const lines = results.map((p: ProductSummary) => {
          const score = p.trustScore != null
            ? ` | Trust: ${(p.trustScore * 100).toFixed(0)}%`
            : '';
          return `- ${p.name} [${p.status}] — Domain: ${p.domainName}${score}\n  ID: ${p.id} | Domain ID: ${p.domainId}`;
        });

        return { content: [{ type: 'text', text: `Found ${results.length} matching products:\n\n${lines.join('\n\n')}` }] };
      },
    },
  ];
}

export function registerTools(server: McpServer, client: ControlPlaneClient): void {
  const tools = makeTools(client);

  const underlying = server.server;

  underlying.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }),
  );

  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
      }

      // Audit logging: write synchronously before returning tool response.
      // Never throws — if audit fails, log and continue.
      const args = (request.params.arguments ?? {}) as Record<string, string>;
      const orgId = args.org_id || getConfig().DEFAULT_ORG_ID;
      try {
        const inputSummary = JSON.stringify(args).slice(0, 500);

        // Resolve agent identity if agent_id is provided in arguments
        let agentId: string | null = args.agent_id || null;
        let agentClassification: string | null = null;
        let humanOversightContact: string | null = null;

        if (agentId) {
          const agentInfo = await client.getAgentInfo(agentId);
          if (agentInfo) {
            agentClassification = agentInfo.current_classification;
            humanOversightContact = agentInfo.human_oversight_contact;
          }
        }

        const auditEntry: Record<string, unknown> = {
          org_id: orgId,
          principal_id: null,
          principal_type: agentId ? 'ai_agent' : 'service_account',
          action: 'mcp_tool_call',
          resource_type: 'mcp_tool',
          resource_id: null,
          tool_name: request.params.name,
          mcp_input_summary: inputSummary,
          agent_id: agentId,
          agent_trust_classification_at_time: agentClassification,
          human_oversight_contact: humanOversightContact,
        };

        await client.writeAuditEntry(auditEntry);
      } catch (err) {
        console.error('[Audit] Tool call audit failed (non-blocking):', err);
      }

      try {
        return await tool.handler((request.params.arguments ?? {}) as Record<string, string>);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}
