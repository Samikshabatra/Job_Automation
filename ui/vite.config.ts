import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The config is loaded from the repo root (`vite --config ui/vite.config.ts`),
// so the root has to be stated explicitly or Vite looks for index.html beside
// package.json.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API talks to a local SQLite file and can start real pipeline runs,
    // so it stays on loopback. The dev server proxies to it rather than the
    // API opening itself up to CORS.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        // Server-sent events must not be buffered by the proxy.
        ws: false,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
