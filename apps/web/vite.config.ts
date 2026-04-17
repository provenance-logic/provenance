import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: ['dev.provenancelogic.com'],
    proxy: {
      '/api': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://api:3001',
        changeOrigin: true,
      },
    },
  },
});
