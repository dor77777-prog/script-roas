// eslint-rules/no-native-title-tooltip.js
//
// Wave-2 Task 2.6 — forbid the native `title="…"` JSX attribute on plain
// HTML elements. Use the `HelpTooltip` (or `Tooltip` + `TooltipTrigger` +
// `TooltipContent`) primitive from `@/components/ui/Tooltip` instead.
//
// Why this matters:
//   - Browser-native `title` tooltips do not match the design-system look
//     (glass-2 + neon ring), have inconsistent delays across browsers,
//     don't respect RTL flipping, and ignore `prefers-reduced-motion`.
//   - The Radix-backed Tooltip primitive is portalled, keyboard-accessible,
//     and themable — but only when the entire app routes through it.
//
// Exemptions:
//   - The `<title>` element itself (SVG accessible name, HTML <head> title)
//     — it's a different DOM concept.
//   - The `title` prop on user-defined Components (PascalCase tags) — these
//     are component props, not HTML attributes. (`<Card title="…">` etc.)
//   - Test files (`__tests__/**`, `*.test.tsx`).
//   - The Tooltip primitive itself (so it can forward its own props).
//
// Note on <input>:
//   Some teams keep `title=` on form inputs for HTML5 validation
//   ("the value must match the pattern…"). The dashboard does not rely on
//   that pattern today (every `title` on `<input>` was a hover tooltip),
//   so we treat <input> the same as the rest. If a future input genuinely
//   needs validation copy, prefer a Tooltip + aria-describedby pairing.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid native title="…" on HTML elements. Use the HelpTooltip primitive from @/components/ui/Tooltip instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isTooltipPrimitive = filename.includes('/components/ui/Tooltip.');
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isTooltipPrimitive || isTest) return {};
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'title') {
          return;
        }
        const opening = node.parent;
        if (!opening || opening.type !== 'JSXOpeningElement') return;
        const nameNode = opening.name;
        // Member expressions like <Foo.Bar title="…" /> are component
        // props, not HTML attributes.
        if (nameNode.type !== 'JSXIdentifier') return;
        const tag = nameNode.name;
        // PascalCase = user component, not HTML element. The `title` prop
        // here is whatever the component author decided to call it.
        if (tag[0] === tag[0].toUpperCase()) return;
        // <title> is the SVG accessible-name element / HTML <head> tag.
        // The `title` attribute on it is content, not a tooltip hint.
        if (tag === 'title') return;
        context.report({
          node,
          message:
            'Native title="…" tooltips don\'t match the design system. Wrap the element in <HelpTooltip content="…"> from @/components/ui/Tooltip (or use <Tooltip><TooltipTrigger asChild>…</TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>).',
        });
      },
    };
  },
};
