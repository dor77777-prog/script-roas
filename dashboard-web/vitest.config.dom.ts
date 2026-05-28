import { defineConfig } from 'vitest/config';
import path from 'path';

// Second Vitest config for component tests that require a DOM (Radix
// primitives, focus management, RTL flips). Kept separate from the
// project-wide node config so the existing pure-function suite stays
// fast (~5x faster than running everything under jsdom).
//
// Run with: npm run test:components
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'src/components/**/__tests__/*.dom.test.{ts,tsx}',
      'src/components/ui/**/__tests__/*.test.{ts,tsx}',
    ],
    setupFiles: ['./src/test/setup-dom.ts'],
    globals: false,
  },
  esbuild: {
    // Use React's automatic JSX runtime so test files don't need to import
    // React manually. Without @vitejs/plugin-react, vitest falls back to
    // esbuild for TSX transforms; jsxImportSource wires it to
    // react/jsx-runtime exactly as `"jsxImportSource": "react"` in tsconfig
    // would for tsc. This is the minimal change needed — no extra deps.
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
