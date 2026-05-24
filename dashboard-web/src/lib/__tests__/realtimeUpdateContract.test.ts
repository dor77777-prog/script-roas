// dashboard-web/src/lib/__tests__/realtimeUpdateContract.test.ts
//
// Phase 12.5.x audit fixes (2026-05-24) — contract tests for the
// real-time-update wiring. The project's vitest config is node-only (no
// jsdom), so we can't render the React components to verify the actual
// listener behavior. Instead, we read the source file as a string and grep
// for the required `swrMutate(...)` calls inside the matching event
// listener block.
//
// These are brittle by design (a refactor that moves the mutate call to a
// different shape would break them) — but they're the right tool here:
//
//   - Catch a regression where someone accidentally deletes the mutate
//     call when refactoring the listener.
//   - Don't require jsdom / react-test-renderer (would 5x the test budget).
//
// If you ever refactor: keep the patterns updated, OR move the listener
// body into a pure helper in lib/ that can be unit-tested without a render.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('PnLBreakdown — billing useMemo deps (audit fix, real-time bug)', () => {
  it('lists `recurring` and `oneTime` in the billing useMemo deps array', () => {
    const src = read('components/PnLBreakdown.tsx');
    // Find the billing useMemo. The dep array is on the line ending with
    // `]);` directly after the body. We assert both `recurring` and
    // `oneTime` appear in that dep array.
    //
    // Match the useMemo from `const billing = useMemo(...)` up to its
    // closing `]);` so we can isolate the deps from other memos.
    const match = src.match(/const billing = useMemo\([\s\S]*?\}, \[([^\]]+)\]\);/);
    expect(match, 'billing useMemo block must be present').not.toBeNull();
    const deps = match![1];
    expect(deps).toContain('recurring');
    expect(deps).toContain('oneTime');
  });
});

describe('CampaignsTable — mutate on product-map change (audit fix HIGH #2)', () => {
  it('imports useSWRConfig + invalidates /api/products and /api/orders-attribution', () => {
    const src = read('components/CampaignsTable.tsx');
    expect(src).toMatch(/import\s+useSWR,\s*\{\s*useSWRConfig\s*\}\s+from\s+'swr'/);
    // The listener for 'roas-campaign-product-map-changed' must call
    // swrMutate(productsKey) and swrMutate(ordersAttrKeyForMutate). The
    // file is large — locate the listener block first.
    const listenerBlock = src.match(
      /window\.addEventListener\('roas-campaign-product-map-changed'[\s\S]{0,400}?window\.removeEventListener/,
    );
    expect(listenerBlock, 'product-map listener block').not.toBeNull();
    // Spec: the `onChange` handler defined RIGHT BEFORE the addEventListener
    // must invalidate both SWR keys. Search a 1500-char window above the
    // listener attachment for the swrMutate calls.
    const idx = src.indexOf("addEventListener('roas-campaign-product-map-changed'");
    const ctx = src.slice(Math.max(0, idx - 1500), idx);
    expect(ctx).toMatch(/swrMutate\(productsKey\)/);
    expect(ctx).toMatch(/swrMutate\(ordersAttrKeyForMutate\)/);
  });
});

describe('AiReportButton — range-keyed SWR + mutate on product-map (audit fix HIGH #1)', () => {
  it('imports useSWRConfig + uses buildDateRangeKey for /api/products and /api/campaigns', () => {
    const src = read('components/AiReportButton.tsx');
    expect(src).toMatch(/import\s+useSWR,\s*\{\s*useSWRConfig\s*\}\s+from\s+'swr'/);
    // Both endpoints must be range-keyed.
    expect(src).toMatch(/buildDateRangeKey\('\/api\/products'/);
    expect(src).toMatch(/buildDateRangeKey\('\/api\/campaigns'/);
  });

  it('invalidates SWR caches on product-map-changed event', () => {
    const src = read('components/AiReportButton.tsx');
    const idx = src.indexOf("addEventListener('roas-campaign-product-map-changed'");
    expect(idx).toBeGreaterThan(0);
    // The handler defined before this attachment must mutate the two keys.
    const ctx = src.slice(Math.max(0, idx - 800), idx);
    expect(ctx).toMatch(/mutate\(productsKey\)/);
    expect(ctx).toMatch(/mutate\(campaignsKey\)/);
  });
});

describe('Dashboard — mutate /api/data on billing change (audit fix MEDIUM #3)', () => {
  it('imports useSWRConfig + invalidates the data key on roas-billing-changed', () => {
    const src = read('components/Dashboard.tsx');
    expect(src).toMatch(/import\s+useSWR,\s*\{\s*useSWRConfig\s*\}\s+from\s+'swr'/);
    const idx = src.indexOf("addEventListener('roas-billing-changed'");
    expect(idx).toBeGreaterThan(0);
    const ctx = src.slice(Math.max(0, idx - 800), idx);
    expect(ctx).toMatch(/swrMutate\(dataKey\)/);
    expect(ctx).toMatch(/buildDateRangeKey\('\/api\/data'/);
  });
});
