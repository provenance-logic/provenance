import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ControlPlaneClient } from '../control-plane/control-plane.client.js';
import { registerTools, SessionIdentity } from './tools.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface SessionEntry {
  transport: SSEServerTransport;
  identity: SessionIdentity;
}

const sessions = new Map<string, SessionEntry>();

function createMcpServer(identity: SessionIdentity): McpServer {
  const server = new McpServer(
    { name: 'provenance', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  // Each session gets its own ControlPlaneClient that forwards
  // the authenticated agent's identity headers (ADR-002 Phase 5b-7).
  const client = new ControlPlaneClient(identity);
  registerTools(server, client, identity);
  return server;
}

export function initMcpServer(): void {
  // Validate that a server can be created (tools register without error)
  createMcpServer({ agentId: '__init__', orgId: '__init__' });
  console.log('[MCP] Server initialized with 9 tools');
}

export async function handleSseConnection(
  _req: IncomingMessage,
  res: ServerResponse,
  identity: SessionIdentity,
): Promise<void> {
  // Each SSE connection gets its own McpServer instance bound to the
  // authenticated agent's identity.
  const server = createMcpServer(identity);
  const transport = new SSEServerTransport('/mcp/messages', res);
  sessions.set(transport.sessionId, { transport, identity });

  transport.onclose = () => {
    sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
}

export async function handleSseMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  body: unknown,
): Promise<void> {
  const entry = sessions.get(sessionId);
  if (!entry) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }
  await entry.transport.handlePostMessage(req as IncomingMessage & { auth?: never }, res, body);
}

/** Retrieve the stored identity for a session (used in tests). */
export function getSessionIdentity(sessionId: string): SessionIdentity | undefined {
  return sessions.get(sessionId)?.identity;
}
