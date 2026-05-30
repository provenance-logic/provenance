/**
 * Tests for Phase 5b-6: session-bound agent identity in MCP tools.
 *
 * Verifies:
 * - agent_id removed from ALL tool input schemas
 * - get_agent_status uses session identity, not tool args
 * - audit logging uses session identity, not tool args
 * - org_id resolution falls back to session identity
 */

// Env must be set before config is imported
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';
process.env['AQL_INTERNAL_TOKEN'] = 'test-internal-token-at-least-16-chars';

import { makeTools, registerTools, SessionIdentity } from './tools.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Mock ControlPlaneClient
// ---------------------------------------------------------------------------

function mockClient() {
  return {
    listProducts: jest.fn().mockResolvedValue([]),
    getProduct: jest.fn().mockResolvedValue({ name: 'P', slug: 'p', status: 'published', version: '1', classification: 'internal', description: '', ports: [], tags: [] }),
    getTrustScore: jest.fn().mockResolvedValue({ score: 0.8, band: 'good', components: {}, computed_at: '2026-04-16T00:00:00Z' }),
    getLineage: jest.fn().mockResolvedValue({ upstream: { nodes: [], edges: [] } }),
    getSloSummary: jest.fn().mockResolvedValue({ slo_health: 'healthy', total_slos: 1, active_slos: 1, pass_rate_7d: 1.0, pass_rate_30d: 1.0, slos_with_no_data: 0, last_evaluated_at: '2026-04-16' }),
    getAgentInfo: jest.fn().mockResolvedValue({ agent_id: 'a1', current_classification: 'Observed', human_oversight_contact: 'oversight@test.com', org_id: 'o1' }),
    getAgentStatus: jest.fn().mockResolvedValue({ agent_id: 'a1', display_name: 'Agent', current_classification: 'Observed', human_oversight_contact: 'o@t.com', last_activity_at: null, activity_count_24h: 0 }),
    writeAuditEntry: jest.fn().mockResolvedValue(undefined),
    registerAgent: jest.fn().mockResolvedValue({ agent_id: 'new-id', display_name: 'A', model_name: 'm', model_provider: 'p', current_classification: 'Observed', human_oversight_contact: 'h@t.com', created_at: '2026-04-16' }),
    getSemanticSearch: jest.fn().mockResolvedValue({ intent: {}, results: [] }),
    searchProducts: jest.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION: SessionIdentity = {
  agentId: '550e8400-e29b-41d4-a716-446655440000',
  orgId: '660e8400-e29b-41d4-a716-446655440001',
};

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('Tool input schemas — agent_id removed (Phase 5b-6)', () => {
  const client = mockClient();
  const tools = makeTools(client as any, SESSION);

  it('no tool has agent_id in its input schema properties', () => {
    for (const tool of tools) {
      const props = Object.keys(tool.inputSchema.properties);
      expect(props).not.toContain('agent_id');
    }
  });

  it('no tool has agent_id in its required array', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.required).not.toContain('agent_id');
    }
  });

  it('get_agent_status has no required args', () => {
    const tool = tools.find((t) => t.name === 'get_agent_status');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// get_agent_status uses session identity
// ---------------------------------------------------------------------------

describe('get_agent_status — session identity (Phase 5b-6)', () => {
  it('calls client.getAgentStatus with the session agentId', async () => {
    const client = mockClient();
    const tools = makeTools(client as any, SESSION);
    const tool = tools.find((t) => t.name === 'get_agent_status')!;

    await tool.handler({});

    expect(client.getAgentStatus).toHaveBeenCalledWith(SESSION.agentId);
  });

  it('ignores any agent_id passed in args', async () => {
    const client = mockClient();
    const tools = makeTools(client as any, SESSION);
    const tool = tools.find((t) => t.name === 'get_agent_status')!;

    await tool.handler({ agent_id: 'injected-evil-id' });

    // Still uses session identity, not the injected arg
    expect(client.getAgentStatus).toHaveBeenCalledWith(SESSION.agentId);
  });
});

// ---------------------------------------------------------------------------
// register_agent uses session orgId
// ---------------------------------------------------------------------------

describe('register_agent — session orgId (Phase 5b-6)', () => {
  it('uses session orgId when org_id not in args', async () => {
    const client = mockClient();
    const tools = makeTools(client as any, SESSION);
    const tool = tools.find((t) => t.name === 'register_agent')!;

    await tool.handler({
      display_name: 'Test',
      model_name: 'claude',
      model_provider: 'Anthropic',
      human_oversight_contact: 'h@t.com',
    });

    expect(client.registerAgent).toHaveBeenCalledWith(
      SESSION.orgId,
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// B-082: get_product no longer requires domain_id; missing required args
// return a structured tool error instead of a downstream 500.
// ---------------------------------------------------------------------------

/** Capture the CallToolRequestSchema handler registered by registerTools. */
function captureCallToolHandler(client: ReturnType<typeof mockClient>) {
  let callHandler:
    | ((req: { params: { name: string; arguments?: Record<string, string> } }) => Promise<{
        content: { type: string; text: string }[];
        isError?: boolean;
      }>)
    | undefined;
  const mockServer = {
    server: {
      setRequestHandler: (schema: unknown, handler: unknown) => {
        if (schema === CallToolRequestSchema) {
          callHandler = handler as typeof callHandler;
        }
      },
    },
  };
  // No guard — exercise the dispatch path directly.
  registerTools(mockServer as never, client as never, SESSION, {});
  if (!callHandler) throw new Error('CallTool handler was not registered');
  return callHandler;
}

describe('B-082 — get_product domain_id optional + required-arg enforcement', () => {
  it('get_product requires only product_id (domain_id is no longer required)', () => {
    const tools = makeTools(mockClient() as never, SESSION);
    const tool = tools.find((t) => t.name === 'get_product');
    expect(tool!.inputSchema.required).toEqual(['product_id']);
  });

  it('get_product handler calls client.getProduct with (orgId, product_id) — no domain_id', async () => {
    const client = mockClient();
    const tools = makeTools(client as never, SESSION);
    const tool = tools.find((t) => t.name === 'get_product')!;
    await tool.handler({ product_id: 'prod-123' });
    expect(client.getProduct).toHaveBeenCalledWith(SESSION.orgId, 'prod-123');
  });

  it('returns a structured tool_args_missing error (not a 500) when product_id is omitted', async () => {
    const client = mockClient();
    const handler = captureCallToolHandler(client);
    const res = await handler({ params: { name: 'get_product', arguments: {} } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('tool_args_missing');
    expect(res.content[0].text).toContain('product_id');
    // The handler must NOT have been dispatched (no downstream call).
    expect(client.getProduct).not.toHaveBeenCalled();
  });

  it('dispatches get_product when product_id is present', async () => {
    const client = mockClient();
    const handler = captureCallToolHandler(client);
    const res = await handler({ params: { name: 'get_product', arguments: { product_id: 'prod-123' } } });
    expect(res.isError).toBeFalsy();
    expect(client.getProduct).toHaveBeenCalledWith(SESSION.orgId, 'prod-123');
  });
});
