// dashboard-web/src/lib/__tests__/productPickerModalRtl.test.ts
//
// HIGH-2 audit fix (2026-05-23): pin the logical-property migration of
// the ProductPickerModal search icon. The icon used to be anchored with
// `right-2.5` — in a `dir="rtl"` Hebrew document that flipped the icon
// to the visual LEFT, overlapping the input's right-padded text area.
//
// Approach: vitest-node source-string check (the project vitest config
// runs in `node` env without jsdom, and component render tests are
// out-of-scope per the config's stated rule). The test asserts:
//   1. the modal's source contains `end-2.5` (Tailwind logical property)
//   2. the modal's source DOES NOT contain `right-2.5` (the broken physical)
// This is robust to source reformatting and keeps the test cheap.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ProductPickerModal — search icon uses logical end-2.5 for RTL (HIGH-2)', () => {
  const source = readFileSync(
    resolve(__dirname, '../../components/ProductPickerModal.tsx'),
    'utf8',
  );

  it('contains end-2.5 (logical-end positioning, RTL-aware)', () => {
    expect(source).toMatch(/className="[^"]*\bend-2\.5\b[^"]*"/);
  });

  it('does NOT contain right-2.5 (the broken physical-right that breaks in RTL)', () => {
    // Defensive: an inline className with the literal `right-2.5` would
    // re-introduce the HIGH-2 regression. The icon must use `end-2.5`.
    expect(source).not.toMatch(/className="[^"]*\bright-2\.5\b[^"]*"/);
  });

  it('search input keeps its logical padding (ps-3 pe-9) — sanity check', () => {
    // The icon's positioning is paired with the input's right-padding
    // (`pe-9`). If a future edit drops the logical padding, the icon
    // ceases to align — pin both together.
    expect(source).toMatch(/\bps-3\b/);
    expect(source).toMatch(/\bpe-9\b/);
  });
});
