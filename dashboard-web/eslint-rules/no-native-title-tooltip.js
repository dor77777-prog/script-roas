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
//     are GENUINE component props, not HTML attributes. (`<Chart title="…">`,
//     `<GoalTracker title="…">` etc.)
//   - Test files (`__tests__/**`, `*.test.tsx`).
//   - The Tooltip primitive itself (so it can forward its own props).
//
// The prop-forwarding bypass (Tooltip-system-redesign · Task 0.1):
//   A small set of `components/ui` primitives spread `{...props}` straight
//   onto a HOST element (Button → <button>/Slot, Badge → <span>, Card → <div>,
//   Input → <input>, NativeSelect → <select>, Textarea → <textarea>,
//   Heading/Text → polymorphic host). For these, a `title=` is NOT a tamed
//   component prop — it leaks through `{...props}` and becomes a real native
//   browser tooltip on the rendered DOM node, defeating this rule. So although
//   the tag is PascalCase, `title=` on a FORWARDING primitive is REPORTED.
//   (Verified by grepping `{...props}` in each primitive's source.)
//
// Note on <input>:
//   Some teams keep `title=` on form inputs for HTML5 validation
//   ("the value must match the pattern…"). The dashboard does not rely on
//   that pattern today (every `title` on `<input>` was a hover tooltip),
//   so we treat <input> the same as the rest. If a future input genuinely
//   needs validation copy, prefer a Tooltip + aria-describedby pairing.

// Primitives in `components/ui` that spread `{...props}` onto a host element,
// so a `title=` placed on them leaks to the DOM as a native browser tooltip.
// Confirmed by `grep "{...props}"` against each component's source:
//   Button  → <Comp {...props}> (Comp = button | Radix Slot host)
//   Badge   → <span {...props}>
//   Card    → <div {...props}>  (root + Header/Title/Description/Content/Footer)
//   Input   → <input {...props}>
//   NativeSelect → <select {...props}>
//   Textarea → <textarea {...props}>
//   Heading / Text → polymorphic `as` element with {...props}
const FORWARDING = new Set([
  'Button',
  'Badge',
  'Card',
  'Input',
  'NativeSelect',
  'Textarea',
  'Heading',
  'Text',
]);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid native title="…" on HTML elements (and prop-forwarding UI primitives). Use the HelpTooltip primitive from @/components/ui/Tooltip instead.',
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
        // PascalCase = user component, not HTML element. The `title` prop here
        // is whatever the component author decided to call it — UNLESS the tag
        // is a known prop-forwarding `components/ui` primitive that spreads
        // `{...props}` onto a host element, in which case `title=` leaks a
        // native browser tooltip to the DOM and must be flagged.
        const isPascalCase = tag[0] === tag[0].toUpperCase();
        if (isPascalCase && !FORWARDING.has(tag)) return;
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
