import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  build: {
    // relative to root
    outDir: '../../dist/ui',
    rollupOptions: {
      external: ['reefjs', 'marked'],
    },
  },
  server: {
    proxy: {
      '/api/': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
        rewriteWsOrigin: true,
      },
      '/files/': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/api/tinybase': {
        target: 'ws://localhost:8787',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
});
