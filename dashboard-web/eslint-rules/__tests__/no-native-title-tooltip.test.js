// eslint-rules/__tests__/no-native-title-tooltip.test.js
//
// Tooltip-system-redesign · Phase 0 · Task 0.1 —
// Fixture coverage for the `no-native-title-tooltip` rule, with a focus on
// closing the prop-forwarding bypass: a `title=` on a `components/ui`
// primitive that spreads `{...props}` onto a host element (Button, Badge,
// Card, Input, NativeSelect, Textarea, Heading/Text) leaks a native browser
// tooltip to the DOM and MUST be flagged — even though the tag is PascalCase.
//
// Genuine PascalCase component props (that are NOT prop-forwarding) and the
// SVG/HTML `<title>` content element stay exempt.

import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from '../no-native-title-tooltip.js';

// RuleTester needs a JSX-aware parser. The dashboard uses TS + the React 17+
// automatic JSX transform, so the TS-ESLint parser with `ecmaFeatures.jsx`
// matches how production code is linted.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

// The rule short-circuits on test files and on the Tooltip primitive itself
// (by filename). RuleTester defaults the filename to `<input>`, which is
// neither — so the rule body runs as it would on a normal component file.

describe('no-native-title-tooltip', () => {
  it('passes the RuleTester fixtures', () => {
    ruleTester.run('no-native-title-tooltip', rule, {
      valid: [
        // Genuine PascalCase component prop on a NON-forwarding component:
        // `title` here is a real React prop the author named, not an HTML attr.
        { code: '<Chart title="rev" />' },
        // SVG / HTML <title> content element — the `title` *attribute* on it
        // would be content, and the element name itself is exempt.
        { code: '<title>label</title>' },
        // A genuine domain component that does not spread props to a host.
        { code: '<GoalTracker title="goal" />' },
        // A non-forwarding UI primitive that names `title` as a real prop and
        // routes it to its own internal label (e.g. Stat) — still exempt.
        { code: '<Stat title="ROAS" value={3} />' },
        // Member-expression component props (<Foo.Bar title=…/>) stay exempt.
        { code: '<Tabs.Trigger title="x">y</Tabs.Trigger>' },
        // No `title` attribute at all → nothing to report.
        { code: '<button type="button">x</button>' },
      ],
      invalid: [
        // Native HTML element with title= — the original rule already caught
        // this; keep it as a regression anchor.
        {
          code: '<span title="hint">x</span>',
          errors: 1,
        },
        {
          code: '<div title="hint" />',
          errors: 1,
        },
        // ── The bypass this task closes ──────────────────────────────────
        // <Button> spreads {...props} onto its host element, so title= leaks
        // a native browser tooltip. Must be flagged despite PascalCase.
        {
          code: '<Button title="פתח">x</Button>',
          errors: 1,
        },
        // The other verified prop-forwarding primitives in components/ui.
        {
          code: '<Badge title="hint">x</Badge>',
          errors: 1,
        },
        {
          code: '<Card title="hint">x</Card>',
          errors: 1,
        },
        {
          code: '<Input title="hint" />',
          errors: 1,
        },
        {
          code: '<NativeSelect title="hint" />',
          errors: 1,
        },
        {
          code: '<Textarea title="hint" />',
          errors: 1,
        },
        {
          code: '<Heading title="hint">x</Heading>',
          errors: 1,
        },
        {
          code: '<Text title="hint">x</Text>',
          errors: 1,
        },
      ],
    });
  });
});
