import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: ['dev.provenancelogic.com', 'demo.provenancelogic.com'],
    // Only `/api` proxies to NestJS. A previous `/agent` entry here was a
    // prefix match for the frontend `/agents` route and silently forwarded
    // post-logout reloads to the API, surfacing Express's "Cannot GET /agents"
    // 404 to the user. Agent endpoints all live under `/api/v1/agents/*` and
    // are already covered by the `/api` rule; the MCP/agent-query layer is
    // server-to-server and never reached from the browser. See B-056.
    proxy: {
      '/api': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
    },
  },
});
