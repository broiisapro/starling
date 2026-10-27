import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const nodeBuiltinsStub = fileURLToPath(new URL('./src/lib/browser-stubs.ts', import.meta.url));

/**
 * The Sky's dev server. `/api` is proxied to the Starling server on 7777 (ARCHITECTURE §6), so the
 * dashboard can open an SSE stream with no CORS games. In production the server serves `dist/`.
 *
 * `@starling/core`'s root barrel imports `node:fs` / `node:path` for its config loader. The browser
 * never loads config, so those are aliased to a loud stub (see src/lib/browser-stubs.ts). The real
 * fix is a browser-safe core subpath — filed as a CONTRACT REQUEST under Epic 23.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      'node:fs': nodeBuiltinsStub,
      'node:path': nodeBuiltinsStub,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7777',
        changeOrigin: true,
      },
    },
  },
});
