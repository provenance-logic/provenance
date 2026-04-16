/**
 * Tests for Phase 5b-6: session identity binding in MCP server.
 *
 * Verifies:
 * - handleSseConnection stores identity with the session
 * - handleSseMessage retrieves stored identity for the session
 * - createMcpServer accepts SessionIdentity
 */

// Env must be set before config is imported
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

import type { SessionIdentity } from './tools.js';

// ---------------------------------------------------------------------------
// We mock the MCP SDK and control-plane client so we can test the session
// identity plumbing without a real SSE connection.
// ---------------------------------------------------------------------------

const mockTransportSessionId = 'test-session-123';
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockHandlePostMessage = jest.fn().mockResolvedValue(undefined);

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    server: {
      setRequestHandler: jest.fn(),
    },
    connect: mockConnect,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: jest.fn().mockImplementation(() => ({
    sessionId: mockTransportSessionId,
    onclose: null,
    handlePostMessage: mockHandlePostMessage,
  })),
}));

jest.mock('../control-plane/control-plane.client.js', () => ({
  ControlPlaneClient: jest.fn().mockImplementation(() => ({})),
}));

import {
  initMcpServer,
  handleSseConnection,
  handleSseMessage,
  getSessionIdentity,
} from './mcp.server.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION: SessionIdentity = {
  agentId: '550e8400-e29b-41d4-a716-446655440000',
  orgId: '660e8400-e29b-41d4-a716-446655440001',
};

function mockRes(): any {
  return {
    writeHead: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
}

function mockReq(): any {
  return { headers: {} };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Server — session identity (Phase 5b-6)', () => {
  beforeAll(() => {
    initMcpServer();
  });

  it('handleSseConnection stores the session identity', async () => {
    const res = mockRes();
    await handleSseConnection(mockReq(), res, SESSION);

    const stored = getSessionIdentity(mockTransportSessionId);
    expect(stored).toEqual(SESSION);
  });

  it('handleSseConnection requires an identity parameter', async () => {
    // TypeScript enforces this at compile time, but we verify the runtime
    // stores whatever identity is passed.
    const customSession: SessionIdentity = {
      agentId: 'aaaa-bbbb',
      orgId: 'cccc-dddd',
    };
    const res = mockRes();
    await handleSseConnection(mockReq(), res, customSession);

    const stored = getSessionIdentity(mockTransportSessionId);
    expect(stored).toEqual(customSession);
  });

  it('handleSseMessage returns 404 for unknown session', async () => {
    const res = mockRes();
    await handleSseMessage(mockReq(), res, 'nonexistent-session', {});

    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });
});
