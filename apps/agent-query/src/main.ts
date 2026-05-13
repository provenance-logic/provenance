import 'reflect-metadata';
import express from 'express';
import { loadConfig } from './config.js';
import { createAgentAuthMiddleware } from './auth/auth.middleware.js';
import { initMcpServer, handleSseConnection, handleSseMessage } from './mcp/mcp.server.js';
import { ConnectionReferenceCache } from './cache/connection-reference-cache.js';
import { AccessGrantCache } from './cache/access-grant-cache.js';
import { ConnectionReferenceConsumer } from './cache/connection-reference-consumer.js';
import { InternalControlPlaneClient } from './control-plane/internal-control-plane.client.js';

async function bootstrap() {
  const config = loadConfig();
  const app = express();

  // Domain 12 runtime-enforcement plumbing (ADR-006 / ADR-007).
  //
  // No request path reads these caches yet — the connection-reference
  // guard wires up in PR #5 of the runtime-enforcement arc and is
  // behind a feature flag. PR #3 only populates and invalidates so
  // operators can observe the data flow in the logs before enforcement
  // activates.
  const connectionReferenceCache = new ConnectionReferenceCache();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const accessGrantCache = new AccessGrantCache();
  const internalControlPlane = new InternalControlPlaneClient();
  const connectionReferenceConsumer = new ConnectionReferenceConsumer(
    config.KAFKA_BROKERS.split(','),
    connectionReferenceCache,
    internalControlPlane,
  );

  // Cold-load the default org's active references before the consumer
  // starts so the cache is warm by the time the consumer's first event
  // arrives. Per ADR-006 § "Cold-cache MCP request" the request path
  // tolerates a cold cache via fallback (PR #5), so a slow cold-load
  // is not a request-availability issue at MVP.
  try {
    const refs = await internalControlPlane.listActiveReferencesForOrg(
      config.DEFAULT_ORG_ID,
    );
    const loaded = connectionReferenceCache.loadFromArray(
      config.DEFAULT_ORG_ID,
      refs,
    );
    console.log(
      `[AQL] Cold-loaded ${loaded} active connection references for org ${config.DEFAULT_ORG_ID}`,
    );
  } catch (err) {
    // Cold-load failure leaves the cache empty; the cache-miss path
    // in PR #5 will repopulate per-triple as agent requests come in.
    console.warn(
      `[AQL] Cold-load skipped — control plane unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await connectionReferenceConsumer.start();

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

  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`[Agent Query] MCP server listening on port ${config.PORT}`);
    console.log(`[Agent Query] Health: http://localhost:${config.PORT}/health`);
    console.log(`[Agent Query] SSE:    http://localhost:${config.PORT}/mcp/sse`);
  });

  // Graceful shutdown — close the consumer first so kafkajs commits
  // outstanding offsets cleanly, then the HTTP server.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Agent Query] ${signal} received, shutting down`);
    try {
      await connectionReferenceConsumer.stop();
    } catch (err) {
      console.error(
        `[Agent Query] Consumer stop error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start agent-query service:', err);
  process.exit(1);
});
