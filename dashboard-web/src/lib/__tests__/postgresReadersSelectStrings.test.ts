import { describe, it, expect } from 'vitest';
import { ORDERS_ATTRIBUTION_SELECT } from '@/lib/postgresReaders';

// Phase 0 (2026-06-02) — reader SELECT-string presence guard. The
// orders_attribution reader builds its column list as a hand-written
// string; a typo or a column dropped from the SELECT silently returns
// `undefined` for that field downstream. We pin every consumed column.
// Prereq for P3 (reading customer_id / order_created_at back).
describe('postgresReaders SELECT strings', () => {
  it('orders_attribution SELECT lists every consumed column', () => {
    for (const col of [
      'date',
      'store_id',
      'order_id',
      'total_cad',
      'source',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'fbclid_present',
      'gclid_present',
      'referrer',
      'utm_id',
      'utm_term',
      'line_items',
    ]) {
      expect(ORDERS_ATTRIBUTION_SELECT).toContain(col);
    }
  });
});
