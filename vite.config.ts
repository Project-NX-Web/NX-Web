import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@formats': resolve(__dirname, 'src/formats'),
      '@workers': resolve(__dirname, 'src/workers'),
      '@storage': resolve(__dirname, 'src/storage'),
      '@ui': resolve(__dirname, 'src/ui'),
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
