// eslint-rules/no-legacy-tailwind-class.js
//
// Wave-1 Task 1.2 — blocks the Phase-13 hex palette AND the Task-1.1
// interim aliases. The Tailwind `colors:` block now contains only
// canvas/glass/band/chart/store/accent/status/ink — any legacy class
// resolves to nothing (silently invisible borders / unstyled text).
//
// Runs on every src/ file (no UI-primitive exemption — the legacy palette
// is gone everywhere). Tests + OAuth callbacks are exempt because they
// frequently reference legacy strings in assertions.

const LEGACY_RX =
  // Phase-13 palette
  /\b(?:bg-background|bg-surface(?:Muted|Subtle|Sunken)?|bg-primary(?:-\w+)?|text-primary-\d+|bg-roas-\w+|text-roas-\w+|bg-border\w*|text-text-\w+|bg-text-\w+|border-border\w*|divide-border\w*|ring-border\w*)\b|\b(?:bg-elevated2?|bg-overlay|border-line(?:-(?:subtle|strong))?|divide-line(?:-(?:subtle|strong))?|ring-line(?:-(?:subtle|strong))?|text-ink-primary)\b/;

function report(context, node, raw) {
  const m = raw.match(LEGACY_RX);
  if (!m) return;
  context.report({
    node,
    message: `Legacy Tailwind class "${m[0]}" is gone. Use the canvas/glass/band/chart/store/accent/status/ink palette (see tailwind.config.ts).`,
  });
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid legacy Phase-13 + Task-1.1 interim Tailwind classes. Use the canonical canvas/glass/band/chart/store/accent/status/ink palette.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isOAuthCallback = filename.includes('/api/oauth/');
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isOAuthCallback || isTest) return {};
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        report(context, node, node.value);
      },
      TemplateElement(node) {
        const raw = node.value && (node.value.cooked ?? node.value.raw);
        if (typeof raw !== 'string') return;
        report(context, node, raw);
      },
    };
  },
};
