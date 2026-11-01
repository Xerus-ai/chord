import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { artifactRuntimePlugin } from './scripts/artifact-runtime/artifact-runtime-plugin.mjs';
import { pageTokenSheetPlugin } from './scripts/artifact-runtime/page-tokens-plugin.mjs';
import { chordMcpShimPlugin } from './scripts/chord-mcp/chord-mcp-shim-plugin.mjs';

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    plugins: [pageTokenSheetPlugin(), artifactRuntimePlugin(), chordMcpShimPlugin()],
    resolve: {
      alias: {
        '@': resolve('src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
  },
  preload: {
    root: 'src/preload',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    envDir: resolve('.'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
        yjs: resolve('node_modules/yjs'),
        'd3-path': resolve('node_modules/d3-path'),
      },
      dedupe: ['yjs', 'd3-path'],
    },
    optimizeDeps: {
      include: [
        'recharts',
        'd3-shape',
        'd3-path',
        'd3-scale',
        'd3-array',
        'd3-interpolate',
        'd3-format',
        'd3-time',
        'd3-time-format',
        'd3-color',
      ],
    },
    server: {
      port: 3001,
      // Fail loudly if 3001 is already taken instead of silently drifting to
      // 3002. A drifted renderer loads from an origin the cloud server's CORS
      // allow-list doesn't cover (['app://chord', ..., 'http://localhost:3001']
      // in server/src/server.ts), so every HTTP cloud call dies as an opaque
      // "Failed to fetch" while WS (no CORS gate) keeps working — a confusing
      // half-broken state. strictPort turns a duplicate `pnpm dev` into an
      // immediate "Port 3001 is already in use", matching the server's own
      // EADDRINUSE fail-fast on 1234.
      strictPort: true,
    },
  },
});
