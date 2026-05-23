/**
 * Phase 05.7.x (2026-05-23) — Cannibalization detection for multi-mapped
 * products.
 *
 * "Cannibalization" here means: as the operator scales the cohort of
 * campaigns sharing a product, the product's total revenue isn't keeping
 * up. The marginal dollars are NOT producing marginal revenue — they're
 * either cannibalizing the existing cohort campaigns or hitting audience
 * saturation. Either way the operator should know before scaling
 * further.
 *
 * Algorithm — split-the-window comparison:
 *
 *   1. Split the visible date range into two equal halves (early / late).
 *   2. For each multi-mapped product (>= 2 campaigns map it), compute:
 *      - cohort spend in each half (sum of cohort campaigns' spend)
 *      - product revenue in each half (from products_daily)
 *      - spendGrowthPct  = (lateSpend - earlySpend) / earlySpend
 *      - revenueGrowthPct = (lateRev   - earlyRev)  / earlyRev
 *   3. Classify:
 *      - HIGH   : spendGrowth >= +25%  AND revenueGrowth <  +5%
 *      - MEDIUM : spendGrowth >= +15%  AND revenueGrowth <  spendGrowth/2
 *      - LOW    : spendGrowth >= +10%  AND revenueGrowth <  spendGrowth * 0.75
 *      - NONE   : everything else (incl. shrinking spend = not scaling)
 *
 * Why ratios of growth, not absolute ROAS:
 *   A cohort with 3.0 ROAS that grew spend 50% and revenue 30% looks
 *   "fine" on ROAS terms (2.7 vs 3.0) but the marginal ROAS is just
 *   30/50 = 0.6 — every new dollar is producing 60 cents. That's
 *   cannibalization (or diminishing returns). Looking at ratios catches
 *   this; looking at absolute ROAS doesn't.
 *
 * Floor: requires >= 3 active days in EACH half (otherwise the noise
 * dominates and we return RISK_INSUFFICIENT_DATA without a verdict).
 *
 * Pure function — easy to test. Wired into CohortComparisonPanel as a
 * warning banner above the table.
 */

import type { ProductMap } from './campaignProductMap';

// =============================================================================
// Public types
// =============================================================================

export type CannibalizationRisk = 'none' | 'low' | 'medium' | 'high' | 'insufficient' | 'composition_changed';

export type CannibalizationVerdict = {
  productId: string;
  productTitle: string;
  cohortKeys: string[];
  risk: CannibalizationRisk;
  /** Hebrew operator-readable summary of WHY this verdict fired. */
  reason: string;
  /** Sub-window breakdown for the panel chart / tooltip. */
  metrics: {
    earlyHalfDays: number;
    lateHalfDays: number;
    earlyHalfSpend: number;
    lateHalfSpend: number;
    earlyHalfRevenue: number;
    lateHalfRevenue: number;
    /** (late - early) / early. Positive = scaled up, negative = scaled down. */
    spendGrowthPct: number;
    /** Same for revenue. */
    revenueGrowthPct: number;
    /** Marginal ROAS = (Δrevenue) / (Δspend). Defined only when both
     *  deltas are non-zero AND spend GREW (negative spend delta is a
     *  scale-down, not cannibalization). null otherwise. */
    marginalRoas: number | null;
  };
};

// =============================================================================
// Inputs
// =============================================================================

export type CampaignDailyForCannibalization = {
  date: string;       // YYYY-MM-DD
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;      // CAD in the source row's accounting
};

export type ProductDailyForCannibalization = {
  date: string;       // YYYY-MM-DD
  storeId: string;
  productId: string;
  productTitle: string;
  netRevenue: number; // CAD; allow negative (refund-heavy days)
};

// =============================================================================
// Helpers
// =============================================================================

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Split [from, to] inclusive into two halves by calendar days.
 *  Returns the early window + late window each as { from, to } strings.
 *  When the total span is < 2 days, both halves are returned as null
 *  (caller surfaces "insufficient" verdict). */
export function splitRangeHalves(
  from: string,
  to: string,
): { early: { from: string; to: string }; late: { from: string; to: string } } | null {
  const fromMs = parseDate(from).getTime();
  const toMs = parseDate(to).getTime();
  if (toMs < fromMs) return null;
  const totalDays = Math.floor((toMs - fromMs) / 86_400_000) + 1;
  if (totalDays < 2) return null;
  const midDays = Math.floor(totalDays / 2);
  // early = [from, from + midDays - 1]
  // late  = [from + midDays, to]
  const midMs = fromMs + midDays * 86_400_000;
  const earlyToDate = new Date(midMs - 86_400_000);
  const lateFromDate = new Date(midMs);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    early: { from, to: fmt(earlyToDate) },
    late: { from: fmt(lateFromDate), to },
  };
}

/** Count distinct dates in `rows` (filtered to a window) where `accept`
 *  returns true. Used to enforce "≥ 3 active days per half" before
 *  trusting the verdict. */
function countActiveDays<T extends { date: string }>(
  rows: T[],
  from: string,
  to: string,
  accept: (row: T) => boolean,
): number {
  const days = new Set<string>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (accept(r)) days.add(r.date);
  }
  return days.size;
}

function sumInWindow<T extends { date: string }>(
  rows: T[],
  from: string,
  to: string,
  pick: (row: T) => number,
): number {
  let s = 0;
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    s += pick(r);
  }
  return s;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detect cannibalization across every multi-mapped product in the given
 * range. Returns ONE verdict per qualifying product (those mapped to >=
 * 2 campaigns in the same store).
 *
 * Inputs:
 *   range          — the visible date window.
 *   storeId        — scope to a single store (cohort + products live in
 *                    one store; cross-store mapping doesn't exist).
 *   productMap     — the operator's productId↔campaignKey map (full,
 *                    not pre-filtered to store; the function filters).
 *   campaignsDaily — raw daily rows from /api/campaigns. We aggregate by
 *                    (campaignKey, date) ourselves so the caller can
 *                    pass the unfiltered SWR data.
 *   productsDaily  — raw daily rows from /api/products. We sum
 *                    netRevenue by (productId, date).
 */
export function detectProductCannibalization(args: {
  range: { from: string; to: string };
  storeId: string;
  productMap: ProductMap;
  campaignsDaily: CampaignDailyForCannibalization[];
  productsDaily: ProductDailyForCannibalization[];
}): CannibalizationVerdict[] {
  const { range, storeId, productMap, campaignsDaily, productsDaily } = args;

  // Step 0: split the range into halves. Skip everything if too short.
  const halves = splitRangeHalves(range.from, range.to);
  if (!halves) return [];

  // Step 1: build the reverse index — for each productId, list of
  // campaignKeys in this store that map it. Skip products with < 2
  // campaigns (not "multi-mapped" by definition).
  const storePrefix = `${storeId}::`;
  const cohortByProduct = new Map<string, string[]>();
  for (const [key, pids] of Object.entries(productMap)) {
    if (!key.startsWith(storePrefix)) continue;
    if (!Array.isArray(pids)) continue;
    for (const pid of pids) {
      if (!cohortByProduct.has(pid)) cohortByProduct.set(pid, []);
      cohortByProduct.get(pid)!.push(key);
    }
  }

  // Pre-bucket campaignsDaily by campaignKey for O(1) sum lookups.
  const campaignsDailyByKey = new Map<string, CampaignDailyForCannibalization[]>();
  for (const r of campaignsDaily) {
    if (r.storeId !== storeId) continue;
    const k = `${r.storeId}::${r.platform}::${r.campaignId}`;
    if (!campaignsDailyByKey.has(k)) campaignsDailyByKey.set(k, []);
    campaignsDailyByKey.get(k)!.push(r);
  }

  // Pre-bucket productsDaily by productId.
  const productsDailyByProduct = new Map<string, ProductDailyForCannibalization[]>();
  const productTitles = new Map<string, string>();
  for (const r of productsDaily) {
    if (r.storeId !== storeId) continue;
    if (!productsDailyByProduct.has(r.productId)) productsDailyByProduct.set(r.productId, []);
    productsDailyByProduct.get(r.productId)!.push(r);
    if (r.productTitle && !productTitles.has(r.productId)) {
      productTitles.set(r.productId, r.productTitle);
    }
  }

  const verdicts: CannibalizationVerdict[] = [];

  // Audit fix 2026-05-23 (HIGH-03 multi-mapping): require cohort
  // composition stability before the spend/revenue growth comparison
  // means anything. A "material" member (≥ this share of either
  // half's spend) MUST be active in both halves; otherwise the
  // comparison conflates "we scaled A" with "we launched B" or
  // "we paused B", emitting false HIGH / false NONE.
  const MATERIAL_MEMBER_SPEND_SHARE = 0.2;
  const MIN_ACTIVE_DAYS_PER_HALF = 3;

  for (const [productId, cohortKeys] of cohortByProduct.entries()) {
    if (cohortKeys.length < 2) continue; // not multi-mapped — skip

    // Per-member spend per half (used both for composition guard and
    // the cohort-total computation below).
    const memberStats = new Map<string, {
      earlySpend: number;
      lateSpend: number;
      earlyActiveDays: number;
      lateActiveDays: number;
    }>();
    for (const k of cohortKeys) {
      const rows = campaignsDailyByKey.get(k) ?? [];
      const earlyMemberDays = new Set<string>();
      const lateMemberDays = new Set<string>();
      let earlyMemberSpend = 0;
      let lateMemberSpend = 0;
      for (const r of rows) {
        if (r.date >= halves.early.from && r.date <= halves.early.to) {
          earlyMemberSpend += r.spend;
          if (r.spend > 0) earlyMemberDays.add(r.date);
        } else if (r.date >= halves.late.from && r.date <= halves.late.to) {
          lateMemberSpend += r.spend;
          if (r.spend > 0) lateMemberDays.add(r.date);
        }
      }
      memberStats.set(k, {
        earlySpend: earlyMemberSpend,
        lateSpend: lateMemberSpend,
        earlyActiveDays: earlyMemberDays.size,
        lateActiveDays: lateMemberDays.size,
      });
    }

    // Cohort-total spend per half (derived from member stats).
    let earlySpend = 0;
    let lateSpend = 0;
    for (const s of memberStats.values()) {
      earlySpend += s.earlySpend;
      lateSpend += s.lateSpend;
    }
    // Cohort-level active-days union (preserved for the "insufficient"
    // floor check — a half is "active enough" if ANY cohort member ran
    // ≥3 days).
    const earlyActiveDates = new Set<string>();
    const lateActiveDates = new Set<string>();
    for (const k of cohortKeys) {
      const rows = campaignsDailyByKey.get(k) ?? [];
      for (const r of rows) {
        if (r.spend <= 0) continue;
        if (r.date >= halves.early.from && r.date <= halves.early.to) {
          earlyActiveDates.add(r.date);
        } else if (r.date >= halves.late.from && r.date <= halves.late.to) {
          lateActiveDates.add(r.date);
        }
      }
    }
    const earlyActiveDays = earlyActiveDates.size;
    const lateActiveDays = lateActiveDates.size;

    // Aggregate product net revenue per half.
    const productRows = productsDailyByProduct.get(productId) ?? [];
    const earlyRev = sumInWindow(productRows, halves.early.from, halves.early.to, r => r.netRevenue);
    const lateRev = sumInWindow(productRows, halves.late.from, halves.late.to, r => r.netRevenue);

    const earlyHalfDays = halves.early.from <= halves.early.to
      ? Math.floor((parseDate(halves.early.to).getTime() - parseDate(halves.early.from).getTime()) / 86_400_000) + 1
      : 0;
    const lateHalfDays = halves.late.from <= halves.late.to
      ? Math.floor((parseDate(halves.late.to).getTime() - parseDate(halves.late.from).getTime()) / 86_400_000) + 1
      : 0;

    // Insufficient signal: need at least 3 active days in EACH half.
    // Also need positive spend in early half (so the % growth is meaningful).
    if (earlyActiveDays < 3 || lateActiveDays < 3 || earlySpend <= 0) {
      verdicts.push({
        productId,
        productTitle: productTitles.get(productId) ?? productId,
        cohortKeys,
        risk: 'insufficient',
        reason:
          earlyActiveDays < 3 || lateActiveDays < 3
            ? `אין מספיק ימים פעילים בכל חצי (early=${earlyActiveDays}d, late=${lateActiveDays}d; דרוש ≥3 בכל אחד)`
            : 'אין הוצאה בחצי הראשון של הטווח — אי-אפשר לחשב Δ.',
        metrics: {
          earlyHalfDays,
          lateHalfDays,
          earlyHalfSpend: earlySpend,
          lateHalfSpend: lateSpend,
          earlyHalfRevenue: earlyRev,
          lateHalfRevenue: lateRev,
          spendGrowthPct: 0,
          revenueGrowthPct: 0,
          marginalRoas: null,
        },
      });
      continue;
    }

    // Audit fix 2026-05-23 (HIGH-03 multi-mapping): composition-stability
    // guard. The half-over-half split assumes the same set of campaigns
    // ran in both halves. When a "material" member (≥ 20% of either half's
    // spend) is missing from one half — paused mid-range OR launched
    // mid-range — the spend-growth comparison conflates that change with
    // genuine scaling and emits false HIGH / false NONE verdicts.
    //
    // Operator's natural flow ("I paused the weak one and scaled the
    // strong one") used to silently emit NONE; launching a fresh
    // experiment on a multi-mapped product used to trip HIGH. Both
    // verdicts mislead. Surface the composition change explicitly.
    //
    // Audit fix 2026-05-23 (b/HI-04 rebalanced mid-range): the original
    // guard only caught missing-half patterns (member paused/launched
    // entirely). It missed the "rebalanced inside both halves" case —
    // c1 dropped from 93% → 79%, c2 grew from 7% → 21%. Both active in
    // both halves so the days-check never fires, and neither half hits
    // the 20% material threshold alone. But the spend MIX shifted
    // enough to invalidate the half-over-half comparison: the operator
    // didn't "scale the cohort", they reallocated INSIDE it. Now the
    // shareRatioFlipped check catches any member whose share ≥ doubled
    // or halved between halves (when the smaller of the two shares is
    // still above the 5% noise floor).
    const composChangedMembers: Array<{ key: string; reason: string }> = [];
    for (const k of cohortKeys) {
      const s = memberStats.get(k);
      if (!s) continue;
      const earlyShare =
        earlySpend > 0 ? s.earlySpend / earlySpend : 0;
      const lateShare =
        lateSpend > 0 ? s.lateSpend / lateSpend : 0;
      const material =
        earlyShare >= MATERIAL_MEMBER_SPEND_SHARE ||
        lateShare >= MATERIAL_MEMBER_SPEND_SHARE;
      // Audit fix 2026-05-23 (b/HI-04): share-ratio flip detection.
      // A member that doubled (or halved) its share-of-cohort between
      // halves changed the cohort's internal allocation enough to
      // invalidate the simple "did we scale → did revenue follow?"
      // comparison — even when neither half alone hits the 20%
      // material threshold and even when the member ran in both halves.
      // The 5% noise floor on the smaller side prevents firing on
      // legitimate fluctuations between, e.g., 3% and 6%.
      const shareRatioFlipped =
        (earlyShare > 0.05 && lateShare / earlyShare >= 2) ||
        (lateShare > 0.05 && earlyShare / lateShare >= 2);
      if (!material && !shareRatioFlipped) continue;
      if (s.earlyActiveDays < MIN_ACTIVE_DAYS_PER_HALF) {
        composChangedMembers.push({
          key: k,
          reason: `הושק/קיבל תקציב מהותי במחצית השנייה (${s.lateActiveDays}d פעיל) אחרי מחצית ראשונה כמעט-ריקה (${s.earlyActiveDays}d).`,
        });
      } else if (s.lateActiveDays < MIN_ACTIVE_DAYS_PER_HALF) {
        composChangedMembers.push({
          key: k,
          reason: `הופסק/הופחת תקציב מהותי במחצית השנייה (${s.lateActiveDays}d פעיל) אחרי מחצית ראשונה פעילה (${s.earlyActiveDays}d).`,
        });
      } else if (shareRatioFlipped) {
        // Member active in both halves but share allocation shifted
        // dramatically — the cohort was REBALANCED, not scaled. The
        // half-over-half growth comparison treats reallocation as
        // scaling, so we surface this so the operator knows to look
        // at the per-member breakdown before judging cannibalization.
        const earlyPctTxt = (earlyShare * 100).toFixed(0);
        const latePctTxt = (lateShare * 100).toFixed(0);
        composChangedMembers.push({
          key: k,
          reason: `חלק יחסי בתוך הקבוצה השתנה דרמטית: ${earlyPctTxt}% → ${latePctTxt}% (הקצאה מחדש בתוך הקבוצה, לא סקייל אמיתי).`,
        });
      }
    }
    if (composChangedMembers.length > 0) {
      const summary = composChangedMembers
        .map(m => `• ${m.key.split('::').slice(-1)[0]}: ${m.reason}`)
        .join(' ');
      verdicts.push({
        productId,
        productTitle: productTitles.get(productId) ?? productId,
        cohortKeys,
        risk: 'composition_changed',
        reason:
          `הרכב הקבוצה השתנה בתוך הטווח — לא ניתן להשוות חצי-לחצי באופן הוגן: ${summary} ` +
          `ההשוואה הקלאסית של "סקיילנו → צמחה ההכנסה?" דורשת שאותם קמפיינים יהיו פעילים בשני החצאים.`,
        metrics: {
          earlyHalfDays,
          lateHalfDays,
          earlyHalfSpend: earlySpend,
          lateHalfSpend: lateSpend,
          earlyHalfRevenue: earlyRev,
          lateHalfRevenue: lateRev,
          spendGrowthPct: earlySpend > 0 ? (lateSpend - earlySpend) / earlySpend : 0,
          revenueGrowthPct:
            earlyRev !== 0
              ? (lateRev - earlyRev) / Math.abs(earlyRev)
              : lateRev > 0 ? Infinity : 0,
          marginalRoas: null,
        },
      });
      continue;
    }

    const spendGrowthPct = (lateSpend - earlySpend) / earlySpend;
    const revenueGrowthPct =
      earlyRev !== 0
        ? (lateRev - earlyRev) / Math.abs(earlyRev)
        : lateRev > 0
          ? Infinity // grew from 0 → some — undefined growth %, but not cannibalization
          : 0;
    const deltaSpend = lateSpend - earlySpend;
    const deltaRev = lateRev - earlyRev;
    const marginalRoas = deltaSpend > 0 ? deltaRev / deltaSpend : null;

    // Classify. Only flag when spend GREW (>= 10%) — shrinking spend
    // doesn't cause cannibalization in any direction.
    let risk: CannibalizationRisk = 'none';
    let reason: string;
    if (spendGrowthPct < 0.1) {
      risk = 'none';
      reason = `ההוצאה גדלה רק ${(spendGrowthPct * 100).toFixed(0)}% (סף 10%) — אין הסקייל המספק כדי לזהות קניבליזציה.`;
    } else if (spendGrowthPct >= 0.25 && revenueGrowthPct < 0.05) {
      risk = 'high';
      reason = `הוצאת הקבוצה גדלה ${(spendGrowthPct * 100).toFixed(0)}% אבל ההכנסה של המוצר גדלה רק ${(revenueGrowthPct * 100).toFixed(0)}%. סקייל לא הניב כמעט כלום — קניבליזציה גבוהה או רוויה. שווה לעצור את הקמפיין החלש בקבוצה במקום לסקייל עוד.`;
    } else if (spendGrowthPct >= 0.15 && revenueGrowthPct < spendGrowthPct / 2) {
      risk = 'medium';
      reason = `הוצאה +${(spendGrowthPct * 100).toFixed(0)}% מול הכנסה +${(revenueGrowthPct * 100).toFixed(0)}%. הסקייל גורר תשואה הולכת ופוחתת — חלק מהדולרים החדשים כנראה גונבים מקמפיינים אחרים בקבוצה.`;
    } else if (
      // Audit fix 2026-05-23 (HIGH-04 multi-mapping): LOW threshold
      // raised from +10% spend → +20% spend (and add an absolute delta
      // floor of $50 CAD). The previous +10% / `rev < spend*0.75` rule
      // triggered on day-of-week composition shifts in 13-day / 7-day
      // windows split into halves with different weekend mix — false-
      // positive noise that eroded trust in the cannibalization banner.
      // The MEDIUM and HIGH thresholds (above) are unchanged because
      // they're already above DOW-noise levels.
      spendGrowthPct >= 0.20 &&
      revenueGrowthPct < spendGrowthPct * 0.75 &&
      (lateSpend - earlySpend) >= 50
    ) {
      risk = 'low';
      reason = `סימן מוקדם: הוצאה +${(spendGrowthPct * 100).toFixed(0)}% מול הכנסה +${(revenueGrowthPct * 100).toFixed(0)}%. תשואה הולכת ופוחתת אבל עדיין חיובית — שווה לעקוב בסקייל הבא.`;
    } else {
      risk = 'none';
      reason = `הוצאה +${(spendGrowthPct * 100).toFixed(0)}% והכנסה +${(revenueGrowthPct * 100).toFixed(0)}% — צמיחה פרופורציונלית או טובה יותר. אין סימני קניבליזציה.`;
    }

    verdicts.push({
      productId,
      productTitle: productTitles.get(productId) ?? productId,
      cohortKeys,
      risk,
      reason,
      metrics: {
        earlyHalfDays,
        lateHalfDays,
        earlyHalfSpend: earlySpend,
        lateHalfSpend: lateSpend,
        earlyHalfRevenue: earlyRev,
        lateHalfRevenue: lateRev,
        spendGrowthPct,
        revenueGrowthPct,
        marginalRoas,
      },
    });
  }

  return verdicts;
}
