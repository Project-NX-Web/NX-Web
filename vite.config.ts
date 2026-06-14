import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('src/core', import.meta.url)),
      '@formats': fileURLToPath(new URL('src/formats', import.meta.url)),
      '@workers': fileURLToPath(new URL('src/workers', import.meta.url)),
      '@storage': fileURLToPath(new URL('src/storage', import.meta.url)),
      '@ui': fileURLToPath(new URL('src/ui', import.meta.url)),
    },
  },

  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },

  worker: {
    format: 'es',
  },

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  optimizeDeps: {
    exclude: ['@anthropic-ai/sdk'],
  },

  assetsInclude: ['**/*.wasm'],
});
