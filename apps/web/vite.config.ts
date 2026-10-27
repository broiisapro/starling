import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The Sky's dev server. `/api` is proxied to the Starling server on 7777 (ARCHITECTURE §6), so the
 * dashboard can open an SSE stream with no CORS games. In production the server serves `dist/`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
