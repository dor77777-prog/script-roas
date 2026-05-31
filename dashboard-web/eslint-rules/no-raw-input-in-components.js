// eslint-rules/no-raw-input-in-components.js
//
// Wave-2 Task 2.7 — forbid raw <input>, <select>, <textarea> JSX outside of
// the primitives directory. Use the primitives from `@/components/ui`:
//
//   - <input>    → `Input` from '@/components/ui/Input'
//   - <select>   → `NativeSelect` from '@/components/ui/NativeSelect'
//                  (or `Select` + compound parts for richly-themed pickers)
//   - <textarea> → `Textarea` from '@/components/ui/Textarea'
//
// Rationale:
//   - The primitives own the canonical glass-1 surface + glass-edge border
//     + accent focus ring, so every form field in the dashboard inherits
//     the same look without a 5-line className soup at every call site.
//   - The Input primitive defaults `dir="auto"` for text/search inputs so
//     mixed Hebrew/English content renders with correct directional runs
//     in RTL pages. Raw <input> sites lose this.
//   - Error / prefix / suffix / aria-invalid wiring lives in one place.
//
// Exemptions:
//   - The primitives themselves (`src/components/ui/Input.tsx`,
//     `Textarea.tsx`, `NativeSelect.tsx`, `Select.tsx`).
//   - Test files (`__tests__/**`, `*.test.tsx`).

const PRIMITIVE_FILES = [
  '/components/ui/Input.',
  '/components/ui/Textarea.',
  '/components/ui/NativeSelect.',
  '/components/ui/Select.',
];

const FORBIDDEN = {
  input: { primitive: 'Input', path: '@/components/ui/Input' },
  select: { primitive: 'NativeSelect', path: '@/components/ui/NativeSelect' },
  textarea: { primitive: 'Textarea', path: '@/components/ui/Textarea' },
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw <input>/<select>/<textarea> outside the primitives directory. Use Input / NativeSelect / Textarea from @/components/ui instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isPrimitive = PRIMITIVE_FILES.some(p => filename.includes(p));
    const isTest =
      filename.includes('.test.') || filename.includes('__tests__');
    if (isPrimitive || isTest) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const tag = node.name.name;
        const target = FORBIDDEN[tag];
        if (!target) return;
        context.report({
          node,
          message: `Use the ${target.primitive} primitive from ${target.path} instead of raw <${tag}>.`,
        });
      },
    };
  },
};
