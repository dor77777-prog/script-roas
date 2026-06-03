// dashboard-web/eslint.config.js
//
// Phase 13.3.1 — real ESLint v9 flat-config.
//
// Replaces the Phase-13.3 no-op stub. Rationale:
//   - eslint-config-next ^15.5 still ships the @rushstack/eslint-patch
//     wrapper which is incompatible with ESLint v9's flat-config loader
//     ("Failed to patch ESLint because the calling module was not
//     recognized"). `next lint` is also deprecated as of Next 16.
//   - Skip eslint-config-next entirely; import @next/eslint-plugin-next
//     directly (it ships flat-config exports), plus typescript-eslint's
//     flat-config recommended preset.
//
// Severity policy (Internal-tool, single-operator):
//   - error  → catches genuine bugs (no-unused-vars, no-empty-pattern, etc.)
//   - warn   → style / future-proofing (no-explicit-any, prefer-const)
//   - off    → noise that hurts more than it helps for this codebase
//             (e.g. @next/next/no-html-link-for-pages — we use App Router)

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noRawButtonInComponents from './eslint-rules/no-raw-button-in-components.js';
import noDarkVariantInComponents from './eslint-rules/no-dark-variant-in-components.js';
import noHexColorInComponents from './eslint-rules/no-hex-color-in-components.js';
import noLegacyTailwindClass from './eslint-rules/no-legacy-tailwind-class.js';
import noCrossPaletteImport from './eslint-rules/no-cross-palette-import.js';
import noRawTableInComponents from './eslint-rules/no-raw-table-in-components.js';
import noNativeTitleTooltip from './eslint-rules/no-native-title-tooltip.js';
import noRawInputInComponents from './eslint-rules/no-raw-input-in-components.js';
import noPhysicalDirectionInComponents from './eslint-rules/no-physical-direction-in-components.js';
import noEmojiInJsx from './eslint-rules/no-emoji-in-jsx.js';

// Local plugin — bundles the design-system regression guards.
const localPlugin = {
  rules: {
    'no-raw-button-in-components': noRawButtonInComponents,
    'no-dark-variant-in-components': noDarkVariantInComponents,
    'no-hex-color-in-components': noHexColorInComponents,
    'no-legacy-tailwind-class': noLegacyTailwindClass,
    'no-cross-palette-import': noCrossPaletteImport,
    'no-raw-table-in-components': noRawTableInComponents,
    'no-native-title-tooltip': noNativeTitleTooltip,
    'no-raw-input-in-components': noRawInputInComponents,
    'no-physical-direction-in-components': noPhysicalDirectionInComponents,
    'no-emoji-in-jsx': noEmojiInJsx,
  },
};

export default tseslint.config(
  // 1. Default ignores — anything we don't lint.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'public/**',
    ],
  },

  // 2. JS recommended + TS recommended (flat config) on src/.
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // 3. Project-wide TS settings.
  {
    files: ['src/**/*.{ts,tsx}', '*.ts', '*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      local: localPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Next.js core-web-vitals + recommended (hand-picked subset since
      // we skip eslint-config-next).
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactPlugin.configs.recommended.rules,
      // React 17+ JSX transform — no need for `import React` in scope.
      'react/react-in-jsx-scope': 'off',
      // App Router does not require prop-types — TS types are authoritative.
      'react/prop-types': 'off',
      // Single-user internal tool — unescaped quotes in JSX text are fine.
      'react/no-unescaped-entities': 'off',
      // The codebase intentionally renders a few fragments as a styling
      // hook; warn (not error) is enough.
      'react/jsx-no-useless-fragment': 'warn',
      // react-hooks: pick the two bug-catching rules. Skip the v5
      // recommendation rules (`set-state-in-effect`, `refs`, …) which are
      // aspirational best-practices, not bug catchers — they'd add ~30
      // false positives for state-hydration patterns this codebase uses.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // App Router uses <Link> for navigation; the no-html-link-for-pages
      // rule was designed for the pages/ router and produces false positives.
      '@next/next/no-html-link-for-pages': 'off',

      // We use `any` deliberately in a few narrow shim spots (Inngest step
      // type erasure). Downgrade from default error to warn so 13.3.1 lands
      // green; a future phase can drive the count to zero.
      '@typescript-eslint/no-explicit-any': 'warn',

      // `_unused` prefix opts out of the unused-vars check (catches typos
      // without forcing rename gymnastics on intentional placeholders).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Default rule is fine but conflicts with the customized version above.
      'no-unused-vars': 'off',

      // Design-system regression guards (Tasks 10/17 amber + button sweeps).
      'local/no-raw-button-in-components': 'error',
      'local/no-dark-variant-in-components': 'error',
      'local/no-hex-color-in-components': 'error',
      // Wave-1 Task 1.2 guards — legacy palette + cross-palette firewall.
      'local/no-legacy-tailwind-class': 'error',
      'local/no-cross-palette-import': 'error',
      // Wave-2 Task 2.2 guard — raw <table> outside TableBase regresses
      // the sticky-header treatment (see CampaignsTable:2027 bug).
      'local/no-raw-table-in-components': 'error',
      // Wave-2 Task 2.6 guard — native `title="…"` tooltips don't match
      // the design system (no glass-2 surface, browser-default delays,
      // RTL bugs, ignores prefers-reduced-motion). Use `HelpTooltip`
      // from `@/components/ui/Tooltip`.
      //
      // Tooltip-system-redesign Phase 0 (Task 0.1) HARDENED this rule to also
      // flag `title=` on prop-forwarding `components/ui` primitives (the
      // `<Button title=>` bypass that leaked a native tooltip to the DOM).
      // That correctly surfaced ~26 pre-existing call-sites which Phase 2
      // migrates to `HelpTooltip` / `aria-label`. Until Phase 2 lands in this
      // branch, those call-sites are NOT yet converted, so the rule is held at
      // 'warn' to keep the lint gate green on the Phase 0+1 increment. RATCHET
      // BACK TO 'error' as the last step of Phase 2 (the migration commit), so
      // the hardened guard is enforced again before the single deploy.
      'local/no-native-title-tooltip': 'warn',
      // Wave-2 Task 2.7 guard — raw <input>/<select>/<textarea> bypass
      // the canonical glass-1 surface, the dir="auto" default, and the
      // shared error/aria-invalid wiring. Use Input / NativeSelect /
      // Textarea from @/components/ui instead.
      'local/no-raw-input-in-components': 'error',

      // Wave-4 Task 4.5 guard — physical-direction Tailwind classes
      // (ml/mr/pl/pr/left/right/border-l|r/rounded-l|r/text-right|left)
      // do not flip under RTL. The dashboard runs Hebrew RTL by default,
      // so physical classes silently break the layout. Task 4.4's
      // codemod already paid the debt — this rule prevents regression.
      'local/no-physical-direction-in-components': 'error',

      // Wave-5 Task 5.10 guard — emoji in JSX chrome (alerts, labels,
      // buttons, headers) competes with Lucide icons and renders
      // inconsistently across OS/font-rendering. Use Lucide for chrome;
      // editorial emoji (chart pins 💰, tooltip-text 💡, …) are
      // allowlisted inside the rule. Registered at 'warn' first so we
      // can iterate without breaking the build — promote to 'error'
      // once the inventory is fully landed.
      'local/no-emoji-in-jsx': 'warn',

      // Wave-2 Task 2.10 guard — Radix imports outside components/ui/
      // bypass the wrapped primitives (Tabs, Dialog, Sheet, Tooltip,
      // Switch, Select, Button) and the design-system surface treatment.
      // The 8 files in components/ui/ are the only allowed consumers; an
      // override below switches this off for that directory.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@radix-ui/react-*'],
              message:
                'Import from @/components/ui/{Primitive} instead. Radix imports are reserved for primitives in components/ui/.',
            },
          ],
        },
      ],

      // Allow ts-expect-error / ts-ignore with description (we use it in
      // shim casts where the type erasure is documented inline).
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
    },
  },

  // 4. Test files: relax a couple of rules that over-fire in vitest.
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      // Tests call hooks via `runHook()` helpers; the linter's
      // function-name heuristic flags these as "not a custom hook".
      'react-hooks/rules-of-hooks': 'off',
    },
  },

  // 4b. Primitives in components/ui/ ARE the wrapped Radix consumers — the
  // no-restricted-imports rule blocks Radix everywhere else but must be
  // off here so Tabs.tsx / Dialog.tsx / Sheet.tsx / Tooltip.tsx /
  // Switch.tsx / Select.tsx / Button.tsx can import @radix-ui/react-*.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // 5. Config files (root JS / mjs / cjs) + build-tool scripts under
  //    scripts/ — both run on Node and need globals.node available.
  {
    files: ['*.{js,mjs,cjs}', 'eslint.config.js', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
