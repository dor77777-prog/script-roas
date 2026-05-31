// eslint-rules/no-raw-table-in-components.js
//
// Wave-2 Task 2.2 — forbid raw `<table>` JSX outside of TableBase.
// Use `TableBase` from `@/components/ui/TableBase` instead. The
// primitive owns the canonical sticky-header treatment (glass-3 +
// backdrop-blur) and the `min-width` / `density` knobs, so every
// table in the dashboard inherits the same look and the same
// CampaignsTable:2027-class sticky-header bugs can never regress.
//
// Exemptions:
//   - `dashboard-web/src/components/ui/TableBase.tsx` itself.
//   - Test files (`__tests__/**`, `*.test.tsx`).

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw <table> outside TableBase. Use the TableBase primitive from @/components/ui/TableBase instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isTableBase = filename.includes('/components/ui/TableBase.');
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isTableBase || isTest) return {};
    return {
      JSXOpeningElement(node) {
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === 'table'
        ) {
          context.report({
            node,
            message:
              'Use the TableBase primitive from @/components/ui/TableBase instead of raw <table>. Pass `minWidth` + `stickyHeader` for the canonical sticky-header treatment.',
          });
        }
      },
    };
  },
};
