// eslint-rules/no-dark-variant-in-components.js
// Prevents dark: Tailwind variants in components outside components/ui/.
// Use CSS-var tokens that are mode-aware in globals.css instead.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid dark: Tailwind variants in components. Use CSS-var tokens.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (
      filename.includes('/components/ui/') ||
      filename.includes('.test.') ||
      filename.includes('__tests__')
    )
      return {};
    return {
      JSXAttribute(node) {
        if (
          node.name.name === 'className' &&
          node.value &&
          node.value.type === 'Literal'
        ) {
          if (/\bdark:[\w[-]+/.test(String(node.value.value))) {
            context.report({
              node,
              message:
                'Use CSS-var tokens instead of dark: Tailwind variant. Token should be mode-aware in globals.css.',
            });
          }
        }
      },
    };
  },
};
