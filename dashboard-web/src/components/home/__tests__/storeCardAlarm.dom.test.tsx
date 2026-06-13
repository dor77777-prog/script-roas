// dashboard-web/src/components/home/__tests__/storeCardAlarm.dom.test.tsx
//
// W3.1 — store-card ALARM-THRESHOLD contract.
//
// The operator LOCKED the screaming red-alarm band to spend > $100 CAD with
// ZERO sales (lib/roasBands.ts → isSpendAlarm). The old PerStoreRow predicate
// fired the alarm for ANY spend with 0 sales, which false-alarmed during the
// early-day "money out, no sales yet" window. These tests pin BOTH sides of the
// threshold so a refactor can't silently re-broaden (or break) the alarm:
//
//   • spend $148 / revenue 0  → ALARM  (data-band="red-alarm" + factual copy)
//   • spend  $99 / revenue 0  → NOT alarm (no red-alarm band, no alarm copy)
//
// The copy is the operator-locked factual line — NOT the rejected dramatic
// "כסף יוצא — כלום לא חוזר".

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PerStoreRow, type PerStoreData } from '@/components/home/PerStoreRow';

const ALARM_COPY = 'הוצאה מעל $100 ללא מכירות — בדוק את הקמפיינים';
const REJECTED_COPY = 'כסף יוצא';

/** A store with the given spend/revenue and the rest of the shape filled in.
 *  revenue=0 stores carry roas:null upstream (a 0-revenue ratio is meaningless),
 *  exactly as the real selector produces. */
function makeStore(spend: number, revenue: number): PerStoreData {
  return {
    storeId: 'alarm-store',
    storeName: 'alarm-store',
    spend,
    revenue,
    orders: 0,
    aov: null,
    roas: null,
    updatedAt: null,
    perPlatformCpm: {},
  };
}

describe('store-card alarm threshold (W3.1)', () => {
  it('spend $148 / revenue 0 → red-alarm band + factual copy', () => {
    const { container } = render(<PerStoreRow stores={[makeStore(148, 0)]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card).not.toBeNull();

    // Card is in the alarm state.
    expect(card?.getAttribute('data-band')).toBe('red-alarm');

    // W8-T5 — the alarm card carries the locked pulse affordance. The pulse
    // itself is a CSS box-shadow ring wired in globals.css against
    // `.glass[data-band="red-alarm"]` under `prefers-reduced-motion:
    // no-preference` (so jsdom can't run it), but the explicit
    // `data-alarm-pulse` marker is the assertable binding point: present in
    // the alarm state, absent otherwise.
    expect(card?.hasAttribute('data-alarm-pulse')).toBe(true);

    // The factual alarm note is present (verbatim, operator-locked).
    const note = card?.querySelector('.store-alarm-note');
    expect(note).not.toBeNull();
    expect(note?.textContent).toBe(ALARM_COPY);

    // ROAS hero reads the explicit 0.00x, not the "—" null placeholder.
    expect(card?.querySelector('.v.banded')?.textContent).toBe('0.00x');

    // The rejected dramatic copy must NEVER appear.
    expect(card?.textContent).not.toContain(REJECTED_COPY);
  });

  it('spend $99 / revenue 0 → NOT alarm (no red-alarm band, no alarm copy)', () => {
    const { container } = render(<PerStoreRow stores={[makeStore(99, 0)]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card).not.toBeNull();

    // Below the $100 threshold → must NOT be the alarm band. roas is null
    // upstream for a 0-revenue store, so it falls through to gray "אין נתונים".
    expect(card?.getAttribute('data-band')).not.toBe('red-alarm');
    expect(card?.getAttribute('data-band')).toBe('gray');

    // W8-T5 — NO pulse affordance in the non-alarm state.
    expect(card?.hasAttribute('data-alarm-pulse')).toBe(false);

    // No alarm note, no alarm copy at all.
    expect(card?.querySelector('.store-alarm-note')).toBeNull();
    expect(card?.textContent).not.toContain(ALARM_COPY);
    expect(card?.textContent).not.toContain(REJECTED_COPY);

    // Not the alarm "0.00x" hero either — a true null ROAS renders the "—".
    expect(card?.querySelector('.v.banded')?.textContent).toBe('—');
  });

  it('spend exactly $100 / revenue 0 → NOT alarm (threshold is strictly >$100)', () => {
    const { container } = render(<PerStoreRow stores={[makeStore(100, 0)]} />);
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).not.toBe('red-alarm');
    expect(card?.querySelector('.store-alarm-note')).toBeNull();
  });

  it('spend $148 WITH sales (revenue>0) → NOT alarm', () => {
    const { container } = render(
      <PerStoreRow
        stores={[{ ...makeStore(148, 600), orders: 5, aov: 120, roas: 4.05 }]}
      />,
    );
    const card = container.querySelector('[data-testid="per-store-card"]');
    expect(card?.getAttribute('data-band')).not.toBe('red-alarm');
    expect(card?.querySelector('.store-alarm-note')).toBeNull();
  });
});
