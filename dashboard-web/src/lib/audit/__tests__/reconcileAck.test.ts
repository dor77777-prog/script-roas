import { describe, it, expect } from 'vitest';
import {
  parseFinding,
  reconcileAckKey,
  findingMagnitude,
  isFindingAcked,
  filterAckedFindings,
  ACK_WORSEN_REL,
  ACK_WORSEN_ABS,
  type ReconcileAcks,
} from '@/lib/audit/reconcileAck';
import type { Violation } from '@/lib/audit/reconcile';

const ackOf = (v: Violation, at = '2026-06-22T10:00:00Z'): ReconcileAcks => ({
  [reconcileAckKey(v)]: { value: findingMagnitude(v), ackedAt: at },
});

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

describe('isFindingAcked — ack holds while ~unchanged, re-pops on material worsening', () => {
  const base: Violation = {
    label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop',
    detail: 'data_daily 3219 vs orders_attribution 3869', // gap 650
  };

  it('un-acked finding is NOT acked', () => {
    expect(isFindingAcked(base, {})).toBe(false);
  });

  it('an exact (unchanged) finding IS acked (hidden)', () => {
    expect(isFindingAcked(base, ackOf(base))).toBe(true);
  });

  it('a finding whose gap GREW within the threshold stays acked', () => {
    // 650 → 700 is +7.7%, under the 20% relative threshold → still hidden.
    const grew: Violation = { label: base.label, detail: 'data_daily 3219 vs orders_attribution 3919' };
    expect(findingMagnitude(grew)).toBe(700);
    expect(isFindingAcked(grew, ackOf(base))).toBe(true);
  });

  it('a finding whose gap WORSENED past the relative threshold RE-SHOWS despite the ack', () => {
    // 650 → 900 is +38% (> 20%) and +250 (> abs floor) → re-pop.
    const worse: Violation = { label: base.label, detail: 'data_daily 3219 vs orders_attribution 4119' };
    expect(findingMagnitude(worse)).toBe(900);
    expect(isFindingAcked(worse, ackOf(base))).toBe(false);
  });

  it('a tiny absolute growth below the absolute floor stays acked even if relatively large', () => {
    // ack a near-zero gap; a small absolute bump must NOT churn the ack.
    const tiny: Violation = { label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 100 vs campaigns_daily 102' }; // gap 2
    const tinyAck = ackOf(tiny);
    const bumped: Violation = { label: tiny.label, detail: 'data_daily 100 vs campaigns_daily 105' }; // gap 5 (+150% rel, but +3 abs)
    expect(ACK_WORSEN_ABS).toBeGreaterThanOrEqual(5);
    expect(isFindingAcked(bumped, tinyAck)).toBe(true);
  });

  it('an ack on DATE-A does NOT cover the same check on DATE-B', () => {
    const dayA: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'data_daily 3219 vs orders_attribution 3869' };
    const dayB: Violation = { label: 'INV-10 orders vs data revenue 2026-06-23/uzoshop', detail: 'data_daily 3219 vs orders_attribution 3869' };
    expect(isFindingAcked(dayB, ackOf(dayA))).toBe(false);
  });

  it('exposes sensible default thresholds', () => {
    expect(ACK_WORSEN_REL).toBeCloseTo(0.2);
    expect(ACK_WORSEN_ABS).toBeGreaterThan(0);
  });
});

describe('filterAckedFindings — hide acked, keep siblings + un-acked', () => {
  const findingA: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'data_daily 3219 vs orders_attribution 3869' };
  const siblingDiffStore: Violation = { label: 'INV-10 orders vs data revenue 2026-06-22/zolplus', detail: 'data_daily 1000 vs orders_attribution 1200' };
  const siblingDiffCheck: Violation = { label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 500 vs campaigns_daily 600' };

  it('acking ONE finding hides exactly that one, not its siblings', () => {
    const all = [findingA, siblingDiffStore, siblingDiffCheck];
    const visible = filterAckedFindings(all, ackOf(findingA));
    expect(visible).toContain(siblingDiffStore);
    expect(visible).toContain(siblingDiffCheck);
    expect(visible).not.toContain(findingA);
    expect(visible).toHaveLength(2);
  });

  it('with no acks, every finding is visible', () => {
    const all = [findingA, siblingDiffStore];
    expect(filterAckedFindings(all, {})).toEqual(all);
  });
});
