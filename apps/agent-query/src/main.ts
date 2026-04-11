import 'reflect-metadata';
import express from 'express';
import { loadConfig } from './config.js';
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

  // SSE endpoint — client connects here to establish the event stream
  app.get('/mcp/sse', async (req, res) => {
    try {
      await handleSseConnection(req, res);
    } catch (err) {
      console.error('[MCP] SSE connection error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  // Message endpoint — client POSTs JSON-RPC messages here
  app.post('/mcp/messages', async (req, res) => {
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
