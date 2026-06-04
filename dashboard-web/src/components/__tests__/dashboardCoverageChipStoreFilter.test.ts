// dashboard-web/src/components/__tests__/dashboardCoverageChipStoreFilter.test.ts
//
// P2 wiring guard (2026-06-04 — hero attribution-coverage chip respects the
// store filter).
//
// BUG: the hero `coverageChip` useMemo computed coverage over the FULL
// orders-attribution row set, while its sibling derivations (`ordersByStore`,
// `heroNewCustomer`) filtered those rows by `filters.store`. So selecting a
// single store left the coverage chip reflecting ALL stores.
//
// FIX: filter the rows by the active store before computeCoverage, and add
// `filters.store` to the useMemo dependency array (so the chip recomputes when
// the operator switches stores).
//
// Mirrors the existing source-file wiring guards (dashboardGoalWiring.test.ts,
// dashboardSalariesWiring.test.ts): a fast fs.readFileSync + regex assertion,
// no React render / SWR mock / jsdom needed. It asserts that the coverageChip
// memo (1) filters rows by `filters.store` before computing coverage and
// (2) lists `filters.store` in its dependency array.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_SRC = resolve(__dirname, '..', 'Dashboard.tsx');

describe('Dashboard coverageChip store-filter wiring (P2)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');

  // Isolate the coverageChip useMemo block: from its declaration to the closing
  // `);` of the useMemo call (which carries the dependency array).
  const block = (() => {
    const start = src.indexOf('const coverageChip');
    expect(start, 'coverageChip declaration must exist in Dashboard.tsx').toBeGreaterThanOrEqual(0);
    const end = src.indexOf(');', start);
    expect(end, 'coverageChip useMemo must close with );').toBeGreaterThan(start);
    return src.slice(start, end + 2);
  })();

  it('filters orders rows by the active store before computeCoverage', () => {
    // Whitespace-tolerant: rows are filtered with a predicate that lets every
    // row through when 'All' is selected, otherwise keeps only the active store.
    expect(block).toMatch(/\.filter\(/);
    expect(block).toMatch(/filters\.store\s*===\s*'All'/);
    expect(block).toMatch(/r\.storeName\s*===\s*filters\.store/);
  });

  it('lists filters.store in the coverageChip dependency array', () => {
    // Without this dep the chip would not recompute when the operator switches
    // stores. The dep array is the last [...] in the memo block.
    const deps = block.match(/\[[^\]]*\]\s*,?\s*\)\s*;?\s*$/);
    expect(deps, 'coverageChip useMemo must end with a dependency array').not.toBeNull();
    expect(deps![0]).toMatch(/filters\.store/);
  });
});
