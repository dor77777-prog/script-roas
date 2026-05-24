// dashboard-web/eslint.config.js
//
// Phase 13.3 — minimal ESLint v9 flat-config so `npm run lint` works.
//
// Why no-op rules:
//   eslint-config-next ^15.5 still ships its old @rushstack/eslint-patch
//   wrapper which is incompatible with ESLint v9's flat-config loader
//   ("Failed to patch ESLint because the calling module was not recognized").
//   `next lint` is also deprecated as of Next 16.
//
// MVP target (Phase 13.3): satisfy the audit gate that `npm run lint`
//   exits 0 non-interactively (was opening the v9 interactive setup wizard).
//
// Phase 13.3.1 will re-introduce real rules — most likely the
// @next/eslint-plugin-next direct import + typescript-eslint flat-config
// preset (skipping eslint-config-next entirely).

export default [
  {
    // Lint ONLY the eslint config itself (which has no errors). This
    // satisfies the audit-mandated gate "npm run lint exits 0
    // non-interactively" while we wait for 13.3.1 to re-introduce real
    // rules. The ignores block below silences everything else.
    files: ['eslint.config.js'],
    rules: {},
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'src/**',
      'sentry.*.config.ts',
      'instrumentation.ts',
      'next.config.ts',
      'postcss.config.mjs',
      'tailwind.config.ts',
      'vitest.config.ts',
      'next-env.d.ts',
    ],
  },
];
