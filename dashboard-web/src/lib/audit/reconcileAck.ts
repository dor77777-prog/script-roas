/**
 * reconcileAck — "mark reviewed / acknowledge" for data-source reconciliation
 * findings (DQ-1). Findings are RE-COMPUTED on every load (stateless), so an
 * explained discrepancy nags forever. Acking records that the operator has
 * reviewed a specific finding; the ack HOLDS while the finding is ~unchanged
 * and RE-POPS if the finding worsens materially or recurs on a NEW date.
 *
 * This module is the PURE core (no DOM / storage / cloud-sync). The storage +
 * cloud-sync setters live in reconcileAckStore.ts; the operator/banner UI
 * applies these helpers client-side (consistent with how campaignProductMap is
 * a synced cloud key the client applies to fetched data).
 *
 * Fingerprint = check + store + platform + date. A finding on a NEW date is a
 * DIFFERENT fingerprint, so an old ack does not cover it → it shows again
 * (delivers "recurs later → pops"). Re-pop on worsening is handled by
 * `isFindingAcked` comparing the finding's CURRENT magnitude against the
 * magnitude captured at ack time.
 */

import type { Violation } from './reconcile';

/** The leading check phrase carries a platform name only for INV-7 spend checks. */
const PLATFORM_RE = /\b(Meta|Google|TikTok)\b/;

/** Trailing " YYYY-MM-DD/store" (store may contain spaces, e.g. "Zol Plus"). */
const TAG_RE = /\s(\d{4}-\d{2}-\d{2})\/(.+?)\s*$/;

/** Grabs numbers out of `detail` ("data_daily 3219 vs orders_attribution 3869"). */
const NUM_RE = /-?\d+(?:[.,]\d+)?/g;

export interface ParsedFinding {
  /** "INV-7 Meta spend" — the leading check phrase, date/store stripped. */
  check: string;
  /** "uzoshop" / "Zol Plus" — the store display name. '' when unparseable. */
  store: string;
  /** "Meta" | "Google" | "TikTok" — only for INV-7 checks; else ''. */
  platform: string;
  /** ISO 'YYYY-MM-DD'. '' when the label carries no trailing date tag. */
  date: string;
  /** First number in `detail` (or first agree() value) — the "expected" side. */
  expected: number | null;
  /** Second number — the "actual" side. */
  actual: number | null;
}

/** Parse the identity + magnitude inputs out of a Violation. Defensive: an
 *  unparseable label still returns a finding (check = raw label, '' fields). */
export function parseFinding(v: Violation): ParsedFinding {
  const label = v.label ?? '';
  let date = '';
  let store = '';
  let check = label;

  const m = label.match(TAG_RE);
  if (m && m.index !== undefined) {
    date = m[1];
    store = m[2].trim();
    check = label.slice(0, m.index).trim();
  }

  const platMatch = check.match(PLATFORM_RE);
  const platform = platMatch ? platMatch[1] : '';

  // expected / actual:
  //   1. agree() violations carry a `values` map (src0, src1, …) — first two.
  //   2. cross-source (INV-7/9/10) put two numbers in `detail` ("X vs Y").
  let expected: number | null = null;
  let actual: number | null = null;
  if (v.values) {
    const nums = Object.values(v.values).filter((n) => Number.isFinite(n));
    if (nums.length >= 1) expected = nums[0];
    if (nums.length >= 2) actual = nums[1];
  }
  if (expected == null || actual == null) {
    const found = (v.detail ?? '').match(NUM_RE);
    if (found && found.length >= 2) {
      const a = Number(found[0].replace(/,/g, ''));
      const b = Number(found[1].replace(/,/g, ''));
      if (expected == null && Number.isFinite(a)) expected = a;
      if (actual == null && Number.isFinite(b)) actual = b;
    }
  }

  return { check: check || label, store, platform, date, expected, actual };
}

/**
 * Stable fingerprint identifying ONE finding = check + store + platform + date.
 * A finding on a new DATE → a new fingerprint → not covered by an old ack →
 * it shows again ("recurs later → pops"). The same check on the same cell
 * always maps to the identical key regardless of the gap magnitude in `detail`.
 */
export function reconcileAckKey(v: Violation): string {
  const { check, store, platform, date } = parseFinding(v);
  return `${check}::${store}::${platform}::${date}`;
}

/**
 * The finding's gap magnitude = |actual − expected| when both numbers parse;
 * else 0. Captured at ack time as the baseline; compared against the CURRENT
 * magnitude to decide whether the finding worsened materially. 0 means "no
 * comparable gap" — such a finding is never accidentally suppressed by a
 * worsening test (its ack relies purely on the fingerprint match).
 */
export function findingMagnitude(v: Violation): number {
  const { expected, actual } = parseFinding(v);
  if (expected == null || actual == null) return 0;
  const g = Math.abs(actual - expected);
  return Number.isFinite(g) ? g : 0;
}
