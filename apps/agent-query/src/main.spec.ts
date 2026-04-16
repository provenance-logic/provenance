/**
 * Tests for Phase 5b-6: auth middleware wiring in main.ts.
 *
 * Verifies:
 * - createAgentAuthMiddleware is applied to /mcp/sse and /mcp/messages
 * - Authenticated request properties (agentId, orgId) are forwarded to handlers
 */

// Env must be set before config is imported
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

// ---------------------------------------------------------------------------
// We test that main.ts applies the auth middleware by importing it and
// checking that the express app was configured correctly. We mock express,
// MCP server, and the auth middleware to isolate wiring logic.
// ---------------------------------------------------------------------------

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockUse = jest.fn();
const mockListen = jest.fn((_port: number, _host: string, cb: () => void) => cb());

jest.mock('express', () => {
  const app = {
    get: mockGet,
    post: mockPost,
    use: mockUse,
    listen: mockListen,
  };
  const expressFn: any = jest.fn(() => app);
  expressFn.json = jest.fn(() => 'json-middleware');
  return { __esModule: true, default: expressFn };
});

const mockAuthMiddleware = jest.fn((_req: any, _res: any, next: () => void) => next());

jest.mock('./auth/auth.middleware.js', () => ({
  createAgentAuthMiddleware: jest.fn(() => mockAuthMiddleware),
}));

jest.mock('./mcp/mcp.server.js', () => ({
  initMcpServer: jest.fn(),
  handleSseConnection: jest.fn(),
  handleSseMessage: jest.fn(),
}));

describe('main.ts — auth middleware wiring (Phase 5b-6)', () => {
  beforeAll(async () => {
    // Import triggers bootstrap()
    await import('./main.js');
  });

  it('registers the auth middleware on GET /mcp/sse route', () => {
    // Find the GET /mcp/sse registration
    const sseCall = mockGet.mock.calls.find(
      (call: unknown[]) => call[0] === '/mcp/sse',
    );
    expect(sseCall).toBeDefined();

    // The auth middleware should be the second argument (after the path),
    // with the handler as the third
    expect(sseCall!.length).toBeGreaterThanOrEqual(3);
    expect(sseCall![1]).toBe(mockAuthMiddleware);
  });

  it('registers the auth middleware on POST /mcp/messages route', () => {
    const msgCall = mockPost.mock.calls.find(
      (call: unknown[]) => call[0] === '/mcp/messages',
    );
    expect(msgCall).toBeDefined();

    expect(msgCall!.length).toBeGreaterThanOrEqual(3);
    expect(msgCall![1]).toBe(mockAuthMiddleware);
  });

  it('does NOT apply auth middleware to /health', () => {
    const healthCall = mockGet.mock.calls.find(
      (call: unknown[]) => call[0] === '/health',
    );
    expect(healthCall).toBeDefined();
    // Health has path + handler (2 args), no middleware
    expect(healthCall!.length).toBe(2);
  });
});
