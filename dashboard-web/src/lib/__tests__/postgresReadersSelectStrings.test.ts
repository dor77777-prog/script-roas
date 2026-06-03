import { describe, it, expect } from 'vitest';
import { ORDERS_ATTRIBUTION_SELECT, COHORT_MONTHLY_SELECT } from '@/lib/postgresReaders';

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

  // Wave 2 (2026-06-03) — same presence guard for the cohort reader's
  // hand-written SELECT. A dropped column reads back undefined → wrong
  // retention/LTV downstream.
  it('customer_cohort_monthly SELECT lists every consumed column', () => {
    for (const col of [
      'store_id',
      'first_order_month',
      'month_since',
      'active_customers',
      'orders',
      'gross_cad',
      'net_cad',
    ]) {
      expect(COHORT_MONTHLY_SELECT).toContain(col);
    }
  });
});
