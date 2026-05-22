// Vitest config kept separate from vite.config.ts so the dev server config
// (port, proxy, allowed hosts) doesn't have to load for test runs.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    // Component tests live next to the component as *.test.tsx.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
