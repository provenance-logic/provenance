import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ControlPlaneClient } from '../control-plane/control-plane.client.js';
import { registerTools } from './tools.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const transports = new Map<string, SSEServerTransport>();
let controlPlaneClient: ControlPlaneClient;

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'provenance', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerTools(server, controlPlaneClient);
  return server;
}

export function initMcpServer(): void {
  controlPlaneClient = new ControlPlaneClient();
  // Validate that a server can be created (tools register without error)
  createMcpServer();
  console.log('[MCP] Server initialized with 6 tools');
}

export async function handleSseConnection(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Each SSE connection gets its own McpServer instance
  const server = createMcpServer();
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  await server.connect(transport);
}

export async function handleSseMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  body: unknown,
): Promise<void> {
  const transport = transports.get(sessionId);
  if (!transport) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }
  await transport.handlePostMessage(req as IncomingMessage & { auth?: never }, res, body);
}
