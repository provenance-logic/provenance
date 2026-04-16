import 'reflect-metadata';
import express from 'express';
import { loadConfig } from './config.js';
import { createAgentAuthMiddleware } from './auth/auth.middleware.js';
import { initMcpServer, handleSseConnection, handleSseMessage } from './mcp/mcp.server.js';

async function bootstrap() {
  const config = loadConfig();
  const app = express();

  // Parse JSON bodies for MCP message POST
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agent-query', version: '0.1.0' });
  });

  // Initialize MCP server
  initMcpServer();

  // ADR-002 Phase 5b: JWT auth middleware for MCP endpoints
  const agentAuth = createAgentAuthMiddleware();

  // Reject POST to /mcp/sse — mcp-remote tries Streamable HTTP first
  app.post('/mcp/sse', (_req, res) => {
    res.status(405).set('Allow', 'GET').json({ error: 'Method Not Allowed. Use GET for SSE.' });
  });

  // SSE endpoint — client connects here to establish the event stream
  app.get('/mcp/sse', agentAuth, async (req, res) => {
    try {
      const identity = { agentId: (req as any).agentId, orgId: (req as any).orgId };
      await handleSseConnection(req, res, identity);
    } catch (err) {
      console.error('[MCP] SSE connection error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  // Message endpoint — client POSTs JSON-RPC messages here
  app.post('/mcp/messages', agentAuth, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
      return;
    }
    try {
      await handleSseMessage(req, res, sessionId, req.body);
    } catch (err) {
      console.error('[MCP] Message handling error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[Agent Query] MCP server listening on port ${config.PORT}`);
    console.log(`[Agent Query] Health: http://localhost:${config.PORT}/health`);
    console.log(`[Agent Query] SSE:    http://localhost:${config.PORT}/mcp/sse`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start agent-query service:', err);
  process.exit(1);
});
