// eslint-rules/no-hex-color-in-components.js
// Prevents hex color literals in src/components/.
// Use design tokens (CSS vars) instead.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid hex color literals in components. Use design tokens.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (
      filename.includes('/api/oauth/') ||
      filename.includes('.test.') ||
      filename.includes('__tests__')
    )
      return {};
    if (!filename.includes('/components/')) return {};
    return {
      Literal(node) {
        if (
          typeof node.value === 'string' &&
          /#[0-9a-fA-F]{3,8}\b/.test(node.value)
        ) {
          context.report({
            node,
            message:
              'Use a CSS-var token instead of hex literal in components.',
          });
        }
      },
    };
  },
};
