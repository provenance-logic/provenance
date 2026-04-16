/**
 * Tests for Phase 5b-7: identity header forwarding in ControlPlaneClient.
 *
 * Verifies:
 * - X-Agent-Id and X-Org-Id headers are sent when SessionIdentity is provided
 * - Authorization (MCP_API_KEY) header is always present alongside identity headers
 * - Headers are absent when no SessionIdentity is provided
 */

// Env must be set before config is imported
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

import axios from 'axios';
import { ControlPlaneClient } from './control-plane.client.js';
import type { SessionIdentity } from '../mcp/tools.js';

// ---------------------------------------------------------------------------
// Mock axios — capture the config passed to axios.create
// ---------------------------------------------------------------------------

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

let capturedConfig: Record<string, any> = {};
const mockHttpInstance = {
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
};

mockedAxios.create.mockImplementation((config?: any) => {
  capturedConfig = config ?? {};
  return mockHttpInstance as any;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440001';

const SESSION: SessionIdentity = {
  agentId: AGENT_ID,
  orgId: ORG_ID,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ControlPlaneClient — identity header forwarding (Phase 5b-7)', () => {
  beforeEach(() => {
    capturedConfig = {};
    mockedAxios.create.mockClear();
    mockHttpInstance.get.mockClear();
    mockHttpInstance.post.mockClear();
  });

  it('includes X-Agent-Id and X-Org-Id headers when SessionIdentity is provided', () => {
    new ControlPlaneClient(SESSION);

    expect(capturedConfig.headers).toBeDefined();
    expect(capturedConfig.headers['X-Agent-Id']).toBe(AGENT_ID);
    expect(capturedConfig.headers['X-Org-Id']).toBe(ORG_ID);
  });

  it('preserves the MCP_API_KEY Authorization header alongside identity headers', () => {
    new ControlPlaneClient(SESSION);

    expect(capturedConfig.headers['Authorization']).toBe('Bearer test-mcp-key');
    expect(capturedConfig.headers['X-Agent-Id']).toBe(AGENT_ID);
  });

  it('does not include X-Agent-Id or X-Org-Id when no identity is provided', () => {
    new ControlPlaneClient();

    expect(capturedConfig.headers['Authorization']).toBe('Bearer test-mcp-key');
    expect(capturedConfig.headers['X-Agent-Id']).toBeUndefined();
    expect(capturedConfig.headers['X-Org-Id']).toBeUndefined();
  });

  it('sends identity headers on GET requests', async () => {
    const client = new ControlPlaneClient(SESSION);
    await client.getAgentInfo('some-agent-id');

    // The headers are baked into the axios instance via create(),
    // so any GET request carries them automatically.
    expect(mockHttpInstance.get).toHaveBeenCalled();
    expect(capturedConfig.headers['X-Agent-Id']).toBe(AGENT_ID);
  });

  it('sends identity headers on POST requests', async () => {
    const client = new ControlPlaneClient(SESSION);
    await client.writeAuditEntry({ action: 'test' });

    expect(mockHttpInstance.post).toHaveBeenCalled();
    expect(capturedConfig.headers['X-Agent-Id']).toBe(AGENT_ID);
    expect(capturedConfig.headers['X-Org-Id']).toBe(ORG_ID);
  });
});
