// eslint-rules/no-raw-button-in-components.js
// Prevents raw <button> elements outside of components/ui/.
// Use the Button primitive from @/components/ui/Button instead.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw <button> outside components/ui/. Use the Button primitive.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isUI = filename.includes('/components/ui/');
    const isOAuthCallback = filename.includes('/api/oauth/');
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isUI || isOAuthCallback || isTest) return {};
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === 'button'
        ) {
          context.report({
            node,
            message:
              'Use the Button primitive from @/components/ui/Button instead of raw <button>.',
          });
        }
      },
    };
  },
};
