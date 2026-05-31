// eslint-rules/no-physical-direction-in-components.js
//
// Wave-4 Task 4.5 — blocks physical-direction Tailwind classes
// (ml/mr/pl/pr, left/right insets, border-l/r, rounded-l/r, text-right/left)
// inside className strings under src/. The dashboard runs Hebrew RTL by
// default; physical classes do not auto-flip and silently break the
// layout in RTL.
//
// Use the logical equivalents instead:
//   ml-* → ms-*       mr-* → me-*
//   pl-* → ps-*       pr-* → pe-*
//   left-* → start-*  right-* → end-*
//   border-l[-*] → border-s[-*]
//   border-r[-*] → border-e[-*]
//   rounded-l[-*] → rounded-s[-*]
//   rounded-r[-*] → rounded-e[-*]
//   text-right → text-end
//   text-left → text-start
//
// Scope:
//   - Fires on every src/ file.
//   - Skips __tests__/** and *.test.* (tests may assert legacy strings).
//   - Skips /components/ui/ — primitives are allowed to bridge if needed,
//     same exemption pattern as the other Wave-1/2 className guards.
//   - Inspects className attribute values: string literals, template
//     literals, AND any string literal or template element living inside
//     a className={…} expression (so it catches cn('ml-2', …) too).

const PHYSICAL_PATTERNS = [
  // border-l / border-r (with or without size/color suffix)
  { re: /(?<![A-Za-z0-9_-])border-l(?:-[A-Za-z0-9]+)?(?![A-Za-z0-9_-])/, fix: (m) => m.replace('border-l', 'border-s') },
  { re: /(?<![A-Za-z0-9_-])border-r(?:-[A-Za-z0-9]+)?(?![A-Za-z0-9_-])/, fix: (m) => m.replace('border-r', 'border-e') },
  // rounded-l / rounded-r
  { re: /(?<![A-Za-z0-9_-])rounded-l(?:-[A-Za-z0-9]+)?(?![A-Za-z0-9_-])/, fix: (m) => m.replace('rounded-l', 'rounded-s') },
  { re: /(?<![A-Za-z0-9_-])rounded-r(?:-[A-Za-z0-9]+)?(?![A-Za-z0-9_-])/, fix: (m) => m.replace('rounded-r', 'rounded-e') },
  // text-right / text-left
  { re: /(?<![A-Za-z0-9_-])text-right(?![A-Za-z0-9_-])/, fix: () => 'text-end' },
  { re: /(?<![A-Za-z0-9_-])text-left(?![A-Za-z0-9_-])/, fix: () => 'text-start' },
  // ml-… / mr-… / pl-… / pr-…
  { re: /(?<![A-Za-z0-9_-])ml-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('ml-', 'ms-') },
  { re: /(?<![A-Za-z0-9_-])mr-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('mr-', 'me-') },
  { re: /(?<![A-Za-z0-9_-])pl-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('pl-', 'ps-') },
  { re: /(?<![A-Za-z0-9_-])pr-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('pr-', 'pe-') },
  // left-N / right-N (inset utilities)
  { re: /(?<![A-Za-z0-9_-])left-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('left-', 'start-') },
  { re: /(?<![A-Za-z0-9_-])right-[A-Za-z0-9[][^\s"'`]*/, fix: (m) => m.replace('right-', 'end-') },
];

function findPhysical(raw) {
  for (const { re, fix } of PHYSICAL_PATTERNS) {
    const m = raw.match(re);
    if (m) return { match: m[0], replacement: fix(m[0]) };
  }
  return null;
}

function report(context, node, raw) {
  const hit = findPhysical(raw);
  if (!hit) return;
  context.report({
    node,
    message:
      `Physical-direction class "${hit.match}" does not flip under RTL. ` +
      `Use the logical equivalent "${hit.replacement}" instead. ` +
      `(See Wave-4 Task 4.4 codemod.)`,
  });
}

/**
 * Walks a className attribute's value, reporting any physical-direction
 * class found in strings, templates, or nested cn()/clsx() arguments.
 */
function inspectExpression(context, node) {
  if (!node) return;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    report(context, node, node.value);
    return;
  }
  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      const raw = quasi.value && (quasi.value.cooked ?? quasi.value.raw);
      if (typeof raw === 'string') report(context, quasi, raw);
    }
    for (const expr of node.expressions) inspectExpression(context, expr);
    return;
  }
  if (node.type === 'CallExpression') {
    // cn(…) / clsx(…) / twMerge(…) — inspect every argument.
    for (const arg of node.arguments) inspectExpression(context, arg);
    return;
  }
  if (node.type === 'ConditionalExpression') {
    inspectExpression(context, node.consequent);
    inspectExpression(context, node.alternate);
    return;
  }
  if (node.type === 'LogicalExpression') {
    inspectExpression(context, node.left);
    inspectExpression(context, node.right);
    return;
  }
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) inspectExpression(context, el);
    return;
  }
  if (node.type === 'ObjectExpression') {
    // clsx({ 'ml-2': cond }) — inspect each key as a string.
    for (const prop of node.properties) {
      if (prop.type !== 'Property') continue;
      const key = prop.key;
      if (key && key.type === 'Literal' && typeof key.value === 'string') {
        report(context, key, key.value);
      } else if (key && key.type === 'Identifier') {
        // bare identifier keys: nothing to do (no string content).
      }
    }
    return;
  }
  // Anything else (Identifier, MemberExpression, etc.) — opaque, skip.
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid physical-direction Tailwind classes (ml/mr/pl/pr/left/right/border-l|r/rounded-l|r/text-right|left) in components. Use the logical equivalents that flip under RTL.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isUI = filename.includes('/components/ui/');
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    const isOAuthCallback = filename.includes('/api/oauth/');
    if (isUI || isTest || isOAuthCallback) return {};
    return {
      JSXAttribute(node) {
        if (!node.name || node.name.name !== 'className') return;
        if (!node.value) return;
        if (node.value.type === 'Literal') {
          report(context, node, String(node.value.value));
        } else if (node.value.type === 'JSXExpressionContainer') {
          inspectExpression(context, node.value.expression);
        }
      },
    };
  },
};
