// dashboard-web/src/lib/__tests__/productPickerModalRtl.test.ts
//
// HIGH-2 audit fix (2026-05-23): pin the logical-property positioning of
// the ProductPickerModal search icon. The icon used to be anchored with
// `right-2.5` — in a `dir="rtl"` Hebrew document that flipped the icon
// to the visual LEFT, overlapping the input's right-padded text area.
//
// Wave-2 Task 2.7 (2026-05-30): the search field migrated from raw
// `<input>` + absolutely-positioned `<Search>` icon to the `Input`
// primitive's `suffix` slot. The primitive owns the logical-property
// contract (suffix span uses `end-3`, input auto-receives `pe-9` when
// `suffix` is present — verified in Input.tsx). This test now asserts
// the modal opts into that contract by passing `suffix={<Search …>}`
// and by NOT regressing into the physical `right-…` anchor.
//
// Approach: vitest-node source-string check (the project vitest config
// runs in `node` env without jsdom, and component render tests are
// out-of-scope per the config's stated rule).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ProductPickerModal — search icon uses logical positioning for RTL (HIGH-2)', () => {
  const source = readFileSync(
    resolve(__dirname, '../../components/ProductPickerModal.tsx'),
    'utf8',
  );

  it('uses the Input primitive suffix slot to anchor the Search icon', () => {
    // The Input primitive's suffix is RTL-aware (`end-3`) and pairs with
    // the auto-applied `pe-9` padding. The modal must opt in via `suffix`.
    expect(source).toMatch(/suffix=\{<Search\b/);
  });

  it('does NOT contain right-2.5 (the broken physical-right that breaks in RTL)', () => {
    // Defensive: a regression that re-introduces the inline `right-2.5`
    // anchor would re-flip the icon in RTL. Stay on logical properties.
    expect(source).not.toMatch(/className="[^"]*\bright-2\.5\b[^"]*"/);
  });

  it('does NOT hand-roll an absolutely-positioned icon container', () => {
    // The whole point of the Input.suffix migration is that no caller
    // needs the absolute-positioning + padding boilerplate. If a future
    // edit re-introduces it here, that's a sign the suffix slot was
    // bypassed.
    expect(source).not.toMatch(/absolute\s+end-2\.5\s+top-1\/2/);
  });
});
