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

/**
 * Is this a RATIO-valued check (magnitude is a dimensionless ratio, not dollars)?
 * Only INV-3 (`agree([roas, revenue/totalSpend])`) is ratio-valued: its gap is a
 * single-digit ROAS difference. Every other live check (INV-7 spend, INV-9/10
 * revenue, INV-6 platform-sum, INV-14 non-finite) is dollar-valued, where the
 * fixed $25 floor is the right scale. We key on the check phrase rather than the
 * magnitude so a genuinely-small DOLLAR gap (a $2 INV-7 wobble) keeps the dollar
 * floor and does not get treated as a ratio.
 */
export function isRatioFinding(v: Violation): boolean {
  return /\bINV-3\b/.test(parseFinding(v).check);
}

/** One stored acknowledgement: the gap magnitude at ack time + when it was acked. */
export interface ReconcileAck {
  /** The finding's gap magnitude when the operator marked it reviewed. */
  value: number;
  /** ISO timestamp of the ack — for the "show acked (N)" review/undo affordance. */
  ackedAt: string;
}

/** fingerprint → ack. The 'reconcile-acks' dashboard_state shape. */
export type ReconcileAcks = Record<string, ReconcileAck>;

/**
 * An ack RE-POPS when the finding's gap has worsened MATERIALLY vs the acked
 * value. "Material" = grew by more than ACK_WORSEN_REL (relative) AND by more
 * than the absolute floor (so tiny gaps don't churn the ack on a few-dollar
 * wobble). A finding hidden today must NOT silently re-show on a trivial bump,
 * but a genuine deterioration SHOULD surface again.
 */
export const ACK_WORSEN_REL = 0.2; // +20% over the acked gap

/**
 * Absolute worsening floor, in the metric's own units. The DOLLAR-denominated
 * findings (INV-7 spend, INV-9/10 revenue, INV-6 platform-sum) carry gap
 * magnitudes in the hundreds-to-thousands, so a $25 floor cheaply filters out a
 * few-dollar wobble. But INV-3 (`agree([roas, revenue/totalSpend])`) is a RATIO
 * check: its magnitude is a single-digit ROAS gap, so a fixed $25 dollar floor
 * could NEVER be crossed — an acked INV-3 finding whose gap balloons (e.g.
 * 0.05 → 7.5, a 150× deterioration) would stay hidden forever, silently breaking
 * the "re-pops if it worsens" guarantee for the whole ratio-check class.
 *
 * Fix: make the floor UNIT-AWARE per check class (see ackWorsenAbsFloor).
 */
export const ACK_WORSEN_ABS = 25; // dollar-scale floor (dominates for $-valued checks)
/** Ratio-valued checks (INV-3 ROAS): a much smaller floor in ratio units, so a
 *  large RELATIVE jump drives the re-pop instead of an unreachable dollar floor. */
export const ACK_WORSEN_ABS_RATIO = 0.25;

/**
 * The effective, UNIT-AWARE absolute worsening floor for a finding. Dollar-valued
 * checks use the $25 floor; the lone ratio-valued check (INV-3 ROAS) uses a small
 * ratio-units floor so the relative threshold governs its re-pop. Keyed on the
 * check CLASS (isRatioFinding), not the raw magnitude, so a genuinely-small
 * DOLLAR gap (a $2 INV-7 wobble) still gets the dollar floor and stays put.
 */
export function ackWorsenAbsFloor(v: Violation): number {
  return isRatioFinding(v) ? ACK_WORSEN_ABS_RATIO : ACK_WORSEN_ABS;
}

/**
 * Is this finding currently covered by an ack (→ hide it)?
 *
 *   false → no ack for this fingerprint (un-acked / new / new-date) — SHOW.
 *   false → acked, but the gap WORSENED past BOTH thresholds — RE-POP (SHOW).
 *   false → acked with a real (>0) gap but the CURRENT magnitude no longer
 *           parses (returns 0) — a detail-string format drift could otherwise
 *           silently suppress a worsened finding forever, so prefer to SHOW.
 *   true  → acked AND the gap is ~unchanged / improved / grew sub-threshold — HIDE.
 */
export function isFindingAcked(v: Violation, acks: ReconcileAcks): boolean {
  const ack = acks[reconcileAckKey(v)];
  if (!ack) return false;
  const current = findingMagnitude(v);
  const ackedVal = Number.isFinite(ack.value) ? ack.value : 0;
  // Conservative guard: the finding was acked WITH a comparable gap (>0) but the
  // current magnitude is unparseable (0). Today every live detail/values format
  // yields two parseable numbers (locked by detailContract.test.ts), so this is
  // not reachable — but if a future format change ever breaks the parse, SHOW
  // rather than hide a possibly-worsened finding under a stale ack.
  if (ackedVal > 0 && current === 0) return false;
  const growth = current - ackedVal;
  if (growth <= 0) return true; // unchanged or improved → stays acked
  const worsenedRel = current > ackedVal * (1 + ACK_WORSEN_REL);
  // Unit-aware absolute floor: $25 for dollar gaps, a small ratio floor for INV-3
  // ROAS so a 150× ratio deterioration is no longer immune to re-popping.
  const worsenedAbs = growth > ackWorsenAbsFloor(v);
  // Re-pop only when it crossed BOTH the relative AND the absolute floor.
  return !(worsenedRel && worsenedAbs);
}

/** Keep only findings that are NOT currently acked (the operator-visible list). */
export function filterAckedFindings(
  findings: Violation[],
  acks: ReconcileAcks,
): Violation[] {
  return findings.filter((v) => !isFindingAcked(v, acks));
}
