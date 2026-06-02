/**
 * Phase 3 — Shopify Bulk-Operations first-order backfill helper.
 *
 * Unit-tests the PURE NDJSON→first-order resolver (no network): given the
 * Bulk export lines {id, createdAt, customer:{id}}, compute exactly one
 * first-order order_id per customer (MIN createdAt, deterministic id
 * tiebreak) and classify every order. Guest lines (no customer) are
 * unclassifiable (firstOrder = null).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFirstOrdersFromBulkLines,
  type BulkOrderLine,
} from '@/lib/fetchers/shopifyBulkFirstOrder';

describe('resolveFirstOrdersFromBulkLines', () => {
  it('flags the earliest order per customer as first, later orders as not-first', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/3', createdAt: '2026-03-10T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
      { id: 'gid://shopify/Order/1', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
      { id: 'gid://shopify/Order/2', createdAt: '2026-02-05T00:00:00Z', customer: { id: 'gid://shopify/Customer/1' } },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('1')).toBe(true);   // earliest (2026-01-01) → first
    expect(out.get('2')).toBe(false);
    expect(out.get('3')).toBe(false);
  });

  it('deterministic order_id tiebreak when timestamps are equal (smallest id wins)', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/20', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/9' } },
      { id: 'gid://shopify/Order/10', createdAt: '2026-01-01T00:00:00Z', customer: { id: 'gid://shopify/Customer/9' } },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('10')).toBe(true);  // '10' < '20' lexicographically
    expect(out.get('20')).toBe(false);
  });

  it('guest line (no customer) → null (unclassifiable, never false)', () => {
    const lines: BulkOrderLine[] = [
      { id: 'gid://shopify/Order/50', createdAt: '2026-01-01T00:00:00Z', customer: null },
    ];
    const out = resolveFirstOrdersFromBulkLines(lines);
    expect(out.get('50')).toBeNull();
  });

  it('parses raw NDJSON text into BulkOrderLine[] (skips blank lines + malformed JSON)', () => {
    const ndjson =
      '{"id":"gid://shopify/Order/1","createdAt":"2026-01-01T00:00:00Z","customer":{"id":"gid://shopify/Customer/1"}}\n' +
      '\n' +
      'not-json\n' +
      '{"id":"gid://shopify/Order/2","createdAt":"2026-02-01T00:00:00Z","customer":null}\n';
    const lines = parseBulkNdjson(ndjson);
    expect(lines).toHaveLength(2);
    expect(lines[0].id).toBe('gid://shopify/Order/1');
    expect(lines[1].customer).toBeNull();
  });
});

import { parseBulkNdjson } from '@/lib/fetchers/shopifyBulkFirstOrder';
