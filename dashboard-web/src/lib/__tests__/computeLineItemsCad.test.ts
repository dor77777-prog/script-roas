import { describe, it, expect } from 'vitest';
import { computeLineItemsCad } from '@/lib/lineItems';

/**
 * Tests for the pure-TS mirror of `Shopify.gs:computeLineItemsCad_`. The
 * proportional-split contract: Σ revenueCad ≈ orderTotal within rounding.
 *
 * Plan: 05.2.1.1-03 TEST-06 (pins AUDIT-P3-06).
 *
 * The .gs writer rounds each split to 2 decimal places, so the round-trip
 * tolerance is bounded by `0.01 × line_item_count` (worst case: every line
 * rounds away from zero in the same direction).
 */
describe('computeLineItemsCad', () => {
  it('Σ split ≈ orderTotal within 1 cent for evenly-priced items', () => {
    const total = 200;
    const split = computeLineItemsCad(total, [
      { productId: 'p-1', price: 50, quantity: 2 },   // gross 100
      { productId: 'p-2', price: 25, quantity: 4 },   // gross 100
    ]);
    expect(split).toHaveLength(2);
    const sum = split.reduce((s, li) => s + li.revenueCad, 0);
    // 50/50 split → 100 + 100 = 200, exactly.
    expect(sum).toBeCloseTo(total, 2);
    expect(split[0].revenueCad).toBeCloseTo(100, 2);
    expect(split[1].revenueCad).toBeCloseTo(100, 2);
  });

  it('Σ split ≈ orderTotal within rounding tolerance for unequal items', () => {
    const total = 123.45;
    const split = computeLineItemsCad(total, [
      { productId: 'p-1', price: 33.33, quantity: 1 },   // gross 33.33
      { productId: 'p-2', price: 11.11, quantity: 3 },   // gross 33.33
      { productId: 'p-3', price: 22.22, quantity: 2 },   // gross 44.44
    ]);
    expect(split).toHaveLength(3);
    const sum = split.reduce((s, li) => s + li.revenueCad, 0);
    // Each split rounded to 2dp → worst case ±0.01 × 3 = ±0.03.
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(0.03);
  });

  it('item that dominates gross receives ~the matching share of total', () => {
    const total = 1000;
    const split = computeLineItemsCad(total, [
      { productId: 'p-big',   price: 900, quantity: 1 },   // gross 900 (90%)
      { productId: 'p-small', price: 100, quantity: 1 },   // gross 100 (10%)
    ]);
    expect(split).toHaveLength(2);
    expect(split[0].revenueCad).toBeCloseTo(900, 2);
    expect(split[1].revenueCad).toBeCloseTo(100, 2);
    const sum = split.reduce((s, li) => s + li.revenueCad, 0);
    expect(sum).toBeCloseTo(total, 2);
  });

  it('order with 0 total → every line item gets 0', () => {
    const split = computeLineItemsCad(0, [
      { productId: 'p-1', price: 50, quantity: 1 },
      { productId: 'p-2', price: 30, quantity: 2 },
    ]);
    expect(split).toHaveLength(2);
    expect(split[0].revenueCad).toBe(0);
    expect(split[1].revenueCad).toBe(0);
  });

  it('flat-spread fallback when subtotal is 0 (free-gift / 100%-discount order)', () => {
    // All items have price=0 (e.g. free-gift bundle) → subtotal=0.
    // Apps Script logs and spreads totalCad equally across items.
    const total = 10;
    const split = computeLineItemsCad(total, [
      { productId: 'p-1', price: 0, quantity: 1 },
      { productId: 'p-2', price: 0, quantity: 1 },
    ]);
    expect(split).toHaveLength(2);
    expect(split[0].revenueCad).toBeCloseTo(5, 2);
    expect(split[1].revenueCad).toBeCloseTo(5, 2);
  });

  it('skips line items with empty productId (matches Shopify.gs:672-673)', () => {
    // Custom items / deleted products have empty product_id.
    const total = 100;
    const split = computeLineItemsCad(total, [
      { productId: 'p-1', price: 50, quantity: 1 },
      { productId: '',    price: 50, quantity: 1 },
    ]);
    expect(split).toHaveLength(1);
    expect(split[0].productId).toBe('p-1');
    // All revenue routes to the one valid item (subtotal recomputed
    // over filtered items: only p-1 → gross 50 → share = 50/50 = 100%).
    expect(split[0].revenueCad).toBeCloseTo(total, 2);
  });

  it('empty line_items array → empty split', () => {
    expect(computeLineItemsCad(100, [])).toEqual([]);
  });
});
