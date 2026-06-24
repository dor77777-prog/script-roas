import { describe, it, expect } from 'vitest';
import {
  parseFinding,
  reconcileAckKey,
  findingMagnitude,
} from '@/lib/audit/reconcileAck';
import type { Violation } from '@/lib/audit/reconcile';

describe('parseFinding — identity fields out of a Violation', () => {
  it('extracts check / store / platform / date for a cross-source INV-7 finding', () => {
    const v: Violation = {
      label: 'INV-7 Meta spend 2026-06-22/uzoshop',
      detail: 'data_daily 3219 vs campaigns_daily 3869',
    };
    const p = parseFinding(v);
    expect(p.check).toBe('INV-7 Meta spend');
    expect(p.store).toBe('uzoshop');
    expect(p.platform).toBe('Meta');
    expect(p.date).toBe('2026-06-22');
    expect(p.expected).toBe(3219);
    expect(p.actual).toBe(3869);
  });

  it('parses a store DISPLAY name containing a space ("Zol Plus")', () => {
    const v: Violation = {
      label: 'INV-10 orders vs data revenue 2026-06-22/Zol Plus',
      detail: 'data_daily 3219 vs orders_attribution 3869',
    };
    const p = parseFinding(v);
    expect(p.check).toBe('INV-10 orders vs data revenue');
    expect(p.store).toBe('Zol Plus');
    expect(p.platform).toBe(''); // INV-10 names no platform
    expect(p.date).toBe('2026-06-22');
  });
});

describe('reconcileAckKey — a stable fingerprint per finding', () => {
  it('is check + store + platform + date', () => {
    const v: Violation = {
      label: 'INV-7 Meta spend 2026-06-22/uzoshop',
      detail: 'data_daily 3219 vs campaigns_daily 3869',
    };
    expect(reconcileAckKey(v)).toBe('INV-7 Meta spend::uzoshop::Meta::2026-06-22');
  });

  it('the SAME check/store/platform on a DIFFERENT date is a DIFFERENT fingerprint', () => {
    const a: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'data_daily 3219 vs orders_attribution 3869' };
    const b: Violation = { label: 'INV-10 orders vs data revenue 2026-06-23/uzoshop', detail: 'data_daily 3300 vs orders_attribution 3950' };
    expect(reconcileAckKey(a)).not.toBe(reconcileAckKey(b));
  });

  it('different stores → different fingerprints; same finding → identical fingerprint', () => {
    const a: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'x' };
    const b: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/zolplus', detail: 'x' };
    const aAgain: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'different detail text 1 vs 2' };
    expect(reconcileAckKey(a)).not.toBe(reconcileAckKey(b));
    expect(reconcileAckKey(a)).toBe(reconcileAckKey(aAgain));
  });
});

describe('findingMagnitude — the gap captured at ack time', () => {
  it('is |actual − expected| when both parse from detail', () => {
    const v: Violation = {
      label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop',
      detail: 'data_daily 3219 vs orders_attribution 3869',
    };
    expect(findingMagnitude(v)).toBe(650);
  });

  it('falls back to 0 when no two numbers are present (same-source INV-3/6 without a parseable detail)', () => {
    const v: Violation = { label: 'INV-3 ROAS 2026-06-22/uzoshop', detail: 'spread 0.5 only-one-number-here' };
    // single number → not a comparable gap → 0 (always-show, never accidentally suppressed)
    expect(findingMagnitude(v)).toBe(0.5 - 0 === 0.5 ? 0 : 0); // documents intent: <2 numbers ⇒ 0
  });

  it('uses agree()-style `values` (src0/src1) when present instead of detail', () => {
    const v: Violation = {
      label: 'INV-6 platform-sum 2026-06-22/uzoshop',
      detail: 'spread 12 > tol 0.01',
      values: { src0: 100, src1: 112 },
    };
    expect(findingMagnitude(v)).toBe(12);
  });
});
