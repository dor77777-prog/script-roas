import { describe, expect, it } from 'vitest';
import { tickIdForNow } from '@/lib/registries/snapshots';

describe('tickIdForNow()', () => {
  it('floors to the 10-min bucket — 14:37:42 → "...T14:30"', () => {
    const at = new Date('2026-05-29T14:37:42.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:30');
  });

  it('exact bucket boundary stays on the bucket — 14:30:00.000 → "...T14:30"', () => {
    const at = new Date('2026-05-29T14:30:00.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:30');
  });

  it('handles hour rollover — 14:59:59 → "...T14:50"', () => {
    const at = new Date('2026-05-29T14:59:59.000Z').getTime();
    expect(tickIdForNow(at)).toBe('2026-05-29T14:50');
  });

  it('a retry 90 sec later in the same bucket → same tick_id (idempotency)', () => {
    const first = new Date('2026-05-29T14:30:05.000Z').getTime();
    const retry = new Date('2026-05-29T14:31:35.000Z').getTime();
    expect(tickIdForNow(first)).toBe(tickIdForNow(retry));
  });
});
