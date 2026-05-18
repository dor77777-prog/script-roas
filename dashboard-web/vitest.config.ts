import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node', // Phase 2 tests are pure functions — no JSDOM needed
    include: ['src/lib/__tests__/**/*.test.ts'],
    globals: false, // explicit imports — not relying on describe/it globals
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
