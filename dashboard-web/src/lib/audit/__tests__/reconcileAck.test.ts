import { describe, it, expect } from 'vitest';
import {
  parseFinding,
  reconcileAckKey,
  findingMagnitude,
  isFindingAcked,
  isRatioFinding,
  ackWorsenAbsFloor,
  filterAckedFindings,
  ACK_WORSEN_REL,
  ACK_WORSEN_ABS,
  ACK_WORSEN_ABS_RATIO,
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

  it('falls back to 0 when fewer than two numbers are present (same-source INV-3/6 without a parseable two-number detail)', () => {
    // A single number in the detail is not a comparable gap → magnitude 0
    // (such a finding is always shown, never accidentally suppressed by the
    // worsening test — its ack relies purely on the fingerprint match).
    const v: Violation = { label: 'INV-3 ROAS 2026-06-22/uzoshop', detail: 'spread only-one-number 5' };
    expect(findingMagnitude(v)).toBe(0);
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
    expect(ACK_WORSEN_ABS_RATIO).toBeGreaterThan(0);
    expect(ACK_WORSEN_ABS_RATIO).toBeLessThan(ACK_WORSEN_ABS);
  });
});

describe('unit-aware worsening floor — ratio-valued INV-3 ROAS re-pops on a large jump', () => {
  // INV-3 (`agree([roas, revenue/totalSpend])`) carries a `values` map whose
  // magnitude is a ROAS RATIO (single digits), not dollars. The fixed $25
  // dollar floor could never be crossed by a ratio gap, so an acked-then-
  // ballooned INV-3 finding used to stay hidden forever.
  const inv3 = (roas: number, expected: number): Violation => ({
    label: 'INV-3 ROAS 2026-06-22/uzoshop',
    detail: `spread ${Math.abs(roas - expected).toFixed(4)} > tol 0.0100`,
    values: { src0: roas, src1: expected },
  });

  it('classifies INV-3 as a ratio finding and INV-7/9/10 as dollar findings', () => {
    expect(isRatioFinding(inv3(3.0, 3.05))).toBe(true);
    expect(isRatioFinding({ label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 1 vs campaigns_daily 2' })).toBe(false);
    expect(isRatioFinding({ label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop', detail: 'x' })).toBe(false);
    expect(isRatioFinding({ label: 'INV-6 platform-sum 2026-06-22/uzoshop', detail: 'spread 12 > tol 0.01', values: { src0: 100, src1: 112 } })).toBe(false);
  });

  it('uses a small ratio-units floor for INV-3 and the $25 dollar floor otherwise', () => {
    expect(ackWorsenAbsFloor(inv3(3.0, 3.05))).toBe(ACK_WORSEN_ABS_RATIO);
    expect(ackWorsenAbsFloor({ label: 'INV-7 Meta spend 2026-06-22/uzoshop', detail: 'data_daily 1 vs campaigns_daily 2' })).toBe(ACK_WORSEN_ABS);
  });

  it('an acked INV-3 ROAS finding whose ratio gap BALLOONS (0.05 → 7.5, ~150×) RE-POPS', () => {
    const acked = inv3(3.0, 3.05); // gap 0.05
    const ack: ReconcileAcks = { [reconcileAckKey(acked)]: { value: findingMagnitude(acked), ackedAt: '2026-06-22T10:00:00Z' } };
    expect(findingMagnitude(acked)).toBeCloseTo(0.05, 4);
    expect(isFindingAcked(acked, ack)).toBe(true); // unchanged → hidden

    const ballooned = inv3(3.0, 10.5); // gap 7.5 — a 150× deterioration
    expect(findingMagnitude(ballooned)).toBeCloseTo(7.5, 4);
    expect(isFindingAcked(ballooned, ack)).toBe(false); // RE-POPS (regression guard)
  });

  it('an acked INV-3 finding with a trivial ratio wobble stays acked (no churn)', () => {
    const acked = inv3(3.0, 3.2); // gap 0.2
    const ack: ReconcileAcks = { [reconcileAckKey(acked)]: { value: findingMagnitude(acked), ackedAt: '2026-06-22T10:00:00Z' } };
    const wobble = inv3(3.0, 3.25); // gap 0.25 (+25% rel but only +0.05 abs < 0.25 floor)
    expect(isFindingAcked(wobble, ack)).toBe(true);
  });
});

describe('conservative SHOW when the current magnitude no longer parses', () => {
  it('an ack with a real (>0) gap re-pops if the current finding magnitude is 0 (format drift)', () => {
    const acked: Violation = {
      label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop',
      detail: 'data_daily 3219 vs orders_attribution 3869', // gap 650
    };
    const ack: ReconcileAcks = { [reconcileAckKey(acked)]: { value: findingMagnitude(acked), ackedAt: '2026-06-22T10:00:00Z' } };
    // Same fingerprint, but a detail string the NUM_RE can no longer pull two
    // numbers from → findingMagnitude === 0. Prefer SHOW over silent suppression.
    const drifted: Violation = { label: acked.label, detail: 'orders and data diverged (no numerics)' };
    expect(findingMagnitude(drifted)).toBe(0);
    expect(isFindingAcked(drifted, ack)).toBe(false);
  });

  it('an ack whose own baseline gap was 0 still holds when the current gap is 0 (fingerprint-only ack)', () => {
    // A finding acked with magnitude 0 (no comparable gap — fewer than two
    // parseable numbers) relies purely on the fingerprint; a still-0 current
    // magnitude must NOT churn it (only a >0 baseline guards toward SHOW).
    const v: Violation = { label: 'INV-X custom check 2026-06-22/uzoshop', detail: 'no numerics here at all' };
    expect(findingMagnitude(v)).toBe(0);
    const ack: ReconcileAcks = { [reconcileAckKey(v)]: { value: 0, ackedAt: '2026-06-22T10:00:00Z' } };
    expect(isFindingAcked(v, ack)).toBe(true);
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
