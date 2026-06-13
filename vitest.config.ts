import { defineConfig } from 'vitest/config';
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
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/*.d.ts'],
    },
  },
});
