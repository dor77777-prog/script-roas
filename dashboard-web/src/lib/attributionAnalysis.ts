/**
 * Attribution analysis layer. Combines two signals:
 *  1. Meta's claimed conversion_value (the heuristic)
 *  2. Shopify orders with deterministic click-IDs / matching utm_campaign
 *     (the ground truth, for the click-attributed portion)
 *
 * The output is a per-campaign analysis the dashboard can render directly:
 *  - deterministicRevenue: CAD of orders we can prove came from this
 *    campaign via fbclid + (optionally) utm_campaign match
 *  - modeledRevenue: Meta's claim minus the deterministic portion. If
 *    positive, this is Meta's "view-through / modeled" attribution that
 *    has no client-side proof.
 *  - coverage: deterministicRevenue / metaClaim. 1.0 means every conversion
 *    Meta claimed has a Shopify order with a click-ID — extremely high
 *    trust. 0.0 means Meta is hallucinating (or our mapping is wrong).
 *
 * The previous heuristic confidence chip is replaced by a much more
 * defensible quantitative breakdown.
 */

import type { OrderAttributionRow, OrderSource } from './ordersAttribution';

// ============================================================================
// Tunable constants (IN-05 — hoisted from inline literals).
// ============================================================================
//
// These are the algorithm's tunable parameters. Hoisting them gives an analyst
// ONE place to tune behaviour without grep'ing the file, and makes the magic
// numbers searchable / lintable. Update here and the change ripples through
// every consumer.

/** Two-tailed 95% normal quantile. Used by the AOV-based ROAS CI. */
const NORMAL_QUANTILE_95 = 1.96;
/** Window size for stability bucketing. Each window represents a "weekly"
 *  coverage slice. */
const WINDOW_DAYS = 7;
/** Minimum days in the trailing window-stability tail before it counts as a
 *  bucket of its own. Below this the partial window is too noisy to add to σ. */
const TAIL_DAYS_MIN_FOR_PARTIAL_BUCKET = 3;
/** Minimum total range (in days) before window-stability is computed. Below
 *  this we can't form even 2 windows so the verdict is meaningless. */
const MIN_RANGE_DAYS_FOR_STABILITY = 2 * WINDOW_DAYS;
/** Stability verdict: σ < this → 'stable' (consistent bias). */
const STABLE_THRESHOLD = 0.15;
/** Stability verdict: σ < this (but >= STABLE) → 'mixed'; >= → 'volatile'. */
const VOLATILE_THRESHOLD = 0.35;
/** Outlier detection: trailing-window lookback length. */
const OUTLIER_LOOKBACK_DAYS = 7;
/** Outlier detection: minimum non-NaN values in the lookback window before
 *  we'll evaluate this day for a spike. */
const OUTLIER_MIN_BASELINE_SAMPLES = 5;
/** Outlier detection: multiple of MAD that constitutes a spike. */
const MAD_OUTLIER_MULTIPLIER = 3;
/** Outlier detection: when MAD == 0 (constant baseline), fall back to this
 *  fraction of |median| as the threshold so we don't divide by zero. */
const MAD_FALLBACK_FRACTION = 0.05;
/** Coverage warning threshold. Coverage = deterministicRevenue / metaClaim;
 *  > 1.0 is normal halo (Shopify saw more orders than Meta's pixel matched).
 *  > 2.0 is suspicious — usually a broken/missing pixel, ad-blocker storm,
 *  or attribution-window drift; the operator must be alerted.
 *
 *  Prior to 2026-05-24 (AUDIT U-05) this constant was used as a HARD CLAMP
 *  inside computeCoverage — extreme halo was silently capped at 2× and the
 *  operator never saw the true value. The clamp is now removed for the
 *  displayed coverage (computeCoverage) but kept inside the
 *  window-stability variance calculation (computeWindowStability) to
 *  prevent one freak day from polluting the stdDev verdict.
 *
 *  The threshold's new role: when `coverage > COVERAGE_WARNING_THRESHOLD`,
 *  the AttributionAnalysis.coverageExceedsClamp flag fires, and the UI
 *  surfaces a "halo exceeded — check the pixel" chip. */
const COVERAGE_WARNING_THRESHOLD = 2;

export type AttributionAnalysis = {
  /** Sum of order totals where the order is provably from this campaign. */
  deterministicRevenue: number;
  /** Count of orders we matched. */
  deterministicOrders: number;
  /** Meta's claim minus deterministic. >0 = modeled / view-through. */
  modeledRevenue: number;
  /** deterministicRevenue / metaClaim. >1.0 means Shopify picked up more
   *  than Meta — usually halo from organic / other channels spilling into
   *  the mapping. Prior to 2026-05-24 (AUDIT U-05) this was clamped to
   *  [0, 2]; the clamp was removed so extreme halo (e.g. 5×, 10×) is
   *  visible to the operator — those are usually a sign of a broken pixel
   *  that the operator must know about. When coverage > 2 the
   *  `coverageExceedsClamp` flag fires so the UI can surface a warning
   *  without the operator having to read the raw number. */
  coverage: number;
  /** True when coverage > COVERAGE_WARNING_THRESHOLD (2.0). The UI shows
   *  a "halo exceeded — check the pixel" chip when this fires. */
  coverageExceedsClamp: boolean;
  /** Confidence verdict, derived from coverage + sample size + stability +
   *  outlier presence. Replaces the old heuristic chip with something
   *  defensible. */
  trust: AttributionTrust;
  /** Concrete reasons that explain the trust level. Shown in tooltips. */
  reasons: string[];
  /** Human-readable action for the operator. */
  recommendation: string;
  /** Approximate 95% CI around deterministic ROAS based on observed AOV
   *  dispersion. Models AOV variability only, not conversion-count
   *  uncertainty. Null when there is no meaningful sample. */
  roasInterval: { low: number; mid: number; high: number } | null;
  /** Per-7-day-window summary. Used to detect stable bias vs spike-driven
   *  noise. Empty when range < 7 days or no orders. */
  windowStability: WindowStability | null;
  /** Days where Meta's daily conversion value was a robust trailing-window
   *  outlier by median + MAD. Likely modeled spikes. */
  outlierDays: string[];
};

export type WindowStability = {
  /** Number of 7-day windows that had meta data (`meta > 0`) and therefore
   *  contributed a coverage point to the stdDev computation. Windows where
   *  Meta claim was zero are filtered out — they produce no signal. This
   *  is NOT the total bucket count (which equals
   *  `floor(totalDays/7) + (tailDays >= 3 ? 1 : 0)`); for that, see the
   *  inline `totalWindows` local in computeWindowStability. (IN-01) */
  windowCountWithData: number;
  /** Mean of per-window coverages. */
  meanCoverage: number;
  /** Standard deviation of per-window coverages — low = stable bias,
   *  high = noisy / unreliable. */
  stdDev: number;
  /** Verbal categorisation: 'stable' (σ < 0.15), 'mixed' (σ 0.15-0.35),
   *  'volatile' (σ > 0.35). */
  verdict: 'stable' | 'mixed' | 'volatile';
};

export type AttributionTrust = {
  level: 'high' | 'medium' | 'low' | 'unknown';
  label: string;
  /** 0..100 — useful as a confidence score for any downstream system. */
  score: number;
};

/**
 * Coverage = deterministic-revenue / metaClaim, with signed-input
 * guards (TEST-03). Extracted helper so the formula has ONE source
 * of truth instead of two near-identical copies in analyzeAttribution
 * and buildAnalysis (IN-04). Update here to ripple uniformly.
 *
 * Semantics:
 *   - metaClaim > 0:   ratio = det / claim, clamped to [-∞, 2].
 *                      Upper clamp prevents halo (det >> claim) from
 *                      blowing the trust ladder; lower bound preserved
 *                      because negative values carry real semantic
 *                      information ("refunds exceeded sales", WR-03).
 *   - metaClaim === 0: fallback to {1 if det>0, else 0}. Legacy
 *                      semantic — "Meta claimed nothing but Shopify
 *                      saw orders" presents as perfect coverage.
 *   - metaClaim < 0:   coverage undefined → 0. Negative claim is
 *                      malformed input (Meta never emits negative
 *                      conversion_value); without this guard the
 *                      legacy fallback silently emits coverage = 1
 *                      ("perfect") for any positive det — a
 *                      false-positive trust signal that previously
 *                      had no test until TEST-03 (signed-revenue).
 *
 * Pure function - no side effects, no IO. Safe to memoize on inputs.
 */
export function computeCoverage(deterministicRevenue: number, metaClaim: number): number {
  return metaClaim > 0
    ? deterministicRevenue / metaClaim
    : metaClaim < 0
      ? 0
      : (deterministicRevenue > 0 ? 1 : 0);
}

/**
 * Pearson correlation coefficient. Returns null when the correlation is not
 * mathematically meaningful: too few finite pairs or zero variance in either
 * input. Output is clamped to [-1, 1].
 *
 * Pure function - no side effects, no IO. Safe to memoize on inputs.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const pairs: Array<[number, number]> = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pairs.push([x, y]);
  }
  if (pairs.length < 2) return null;

  const sx = pairs.reduce((sum, [x]) => sum + x, 0);
  const sy = pairs.reduce((sum, [, y]) => sum + y, 0);
  const mx = sx / pairs.length;
  const my = sy / pairs.length;
  let cov = 0, vx = 0, vy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  const denom = Math.sqrt(vx * vy);
  if (!Number.isFinite(denom) || denom === 0) return null;
  const r = cov / denom;
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null;
}

/**
 * Pearson correlation with a lag applied to the second series. Positive lag =
 * `ys` shifted forward (compare xs[i] with ys[i + lag]).
 *
 * Pure function - no side effects, no IO. Safe to memoize on inputs.
 */
export function pearsonWithLag(xs: number[], ys: number[], lag: number): number | null {
  if (lag === 0) return pearson(xs, ys);
  const xsShift: number[] = [];
  const ysShift: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= ys.length) continue;
    xsShift.push(xs[i]);
    ysShift.push(ys[j]);
  }
  return pearson(xsShift, ysShift);
}

/**
 * Match an order against a campaign deterministically.
 *
 * Match tiers, strongest first:
 *
 * Tier 1 — utm_id matches campaignId. Meta's URL Parameters can include
 *   `utm_id={{campaign.id}}`. When present, this is an ID-to-ID match
 *   that's immune to renames + URL encoding edge cases. Strictly better
 *   than the name match.
 *
 * Tier 2 — utm_campaign matches campaignName (case-insensitive, trimmed).
 *   Fallback when utm_id isn't configured. Works as long as the operator
 *   doesn't rename the campaign in Meta.
 *
 * We don't fall back to "fbclid present + same date range" at this layer
 * because fbclid alone only proves the user clicked SOME Meta ad — not
 * THIS campaign. There is no platform-level fallback in this analyzer.
 */
export function orderMatchesCampaign(
  order: OrderAttributionRow,
  campaign: {
    campaignName: string;
    storeId: string;
    platform: string;
    /** Campaign ID from the campaigns row (Meta's campaign.id). Optional
     *  for back-compat with older callers; without it, name match is the
     *  only path. */
    campaignId?: string;
  },
): boolean {
  if (order.storeId !== campaign.storeId) return false;
  // Phase 05.7.9c — extended to TikTok per operator request. The matching
  // logic below works for any platform whose URL Parameters pass utm_id /
  // utm_campaign onto the landing URL (Meta + TikTok both support this).
  // Google Ads still excluded — Google's GAQL flow exposes campaign
  // structure but the click → utm mapping is unreliable for PMax/Shopping.
  if (campaign.platform !== 'Meta' && campaign.platform !== 'TikTok') return false;

  // Tier 1 — utm_id is authoritative when present on the order.
  // If campaignId is configured AND the IDs match, accept.
  // If campaignId mismatches or campaign.campaignId is undefined,
  // DO NOT fall through — utm_id is the trusted signal on this order,
  // and falling back to name would mis-attribute to namesake campaigns
  // (e.g. duplicated campaigns "Summer Sale" vs "Summer Sale - Retargeting"
  // sharing a name across stores/accounts).
  if (order.utmId) {
    return !!campaign.campaignId
      && order.utmId.trim() === campaign.campaignId.trim();
  }

  // Tier 2 — utm_id absent → fall back to utm_campaign name match.
  if (order.utmCampaign) {
    return order.utmCampaign.trim().toLowerCase()
         === campaign.campaignName.trim().toLowerCase();
  }

  return false;
}

/**
 * Build the per-campaign attribution analysis.
 *
 * Strict: matches orders to a single campaign via `orderMatchesCampaign`.
 * There is NO platform-level fallback — the old platform fallback helper
 * was never wired up and was removed in 5.2.2.1 (FIX-17).
 *
 * Strategy:
 *   1. Find orders that name-match this campaign (utm_campaign equality).
 *      Sum their totals → "deterministically attributed to THIS campaign".
 *   2. If a campaign has *zero* name-matched orders AND the platform has
 *      orders with click-IDs in the same window, we don't claim those
 *      directly here — they get attributed at the platform level, which
 *      the dashboard surfaces separately. The per-campaign analysis stays
 *      strict about what it claims.
 *   3. modeled = max(0, metaClaim - deterministic). Negative means
 *      Shopify saw more than Meta claimed (halo effect or wrong mapping —
 *      still useful signal).
 *
 * Returns AttributionAnalysis | null when input is unusable (Google
 * campaign, no orders data, etc.).
 */
export function analyzeAttribution(
  campaign: {
    campaignName: string;
    campaignId?: string;       // primary match key when utm_id is configured
    storeId: string;
    platform: string;
    metaClaim: number; // CAD
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  /** Optional daily Meta conv-value series for outlier detection. When
   *  provided, we flag days where Meta is a robust trailing-window outlier
   *  by median + MAD — usually modeled / view-through bursts that
   *  artificially inflate the period total. */
  dailyMetaSeries?: Array<{ date: string; value: number }>,
): AttributionAnalysis | null {
  // Phase 05.7.9c — extended to TikTok. Returns null for Google (PMax
  // utm-tracking unreliable) and any other platform. `metaClaim` is named
  // historically but semantically holds the PLATFORM's claimed
  // conversionValue for whichever platform we accept here.
  if (campaign.platform !== 'Meta' && campaign.platform !== 'TikTok') return null;
  if (!orders || orders.length === 0) return null;

  // Filter out non-finite totalCad at the matched-order boundary so a single
  // malformed order (NaN from an Apps Script cell write or downstream parser
  // glitch) doesn't poison the entire reduce — NaN propagates through
  // deterministicRevenue → coverage → trust ladder unpredictably (WR-02).
  // computeWindowStability already guards this way at its matched-orders
  // loop (the `Number.isFinite(o.totalCad)` filter); analyzeAttribution
  // matches that contract here. (IN-03: removed stale line-number reference.)
  const matchedOrders = orders.filter(o => {
    if (o.storeId !== campaign.storeId) return false;   // FIX-09 (5.2.2.1): defense-in-depth boundary guard; mirrors ad-set/ad analyzers.
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (!Number.isFinite(o.totalCad)) return false;
    return orderMatchesCampaign(o, campaign);
  });

  // Signed sum: negative totalCad rows (refunds — Phase 5.2 added the
  // signed-row contract) subtract from deterministicRevenue. This is the
  // intended behavior so a refund of an attributed order doesn't leave
  // the deterministic side artificially high. (TEST-03)
  const deterministicRevenue = matchedOrders.reduce((s, o) => s + o.totalCad, 0);
  const deterministicOrders = matchedOrders.length;
  const modeledRevenue = Math.max(0, campaign.metaClaim - deterministicRevenue);

  // IN-04: delegate to the shared computeCoverage helper so the
  // signed-input guard contract has a single source of truth.
  const coverage = computeCoverage(deterministicRevenue, campaign.metaClaim);

  // -----------------------------------------------------------------------
  // Approximate 95% CI for the deterministic ROAS.
  //
  // Approximate 95% CI based on observed AOV dispersion. Models only AOV
  // variability — does NOT model conversion-count uncertainty. Use as a
  // directional guide, not a strict statistical claim.
  // -----------------------------------------------------------------------
  let roasInterval: AttributionAnalysis['roasInterval'] = null;
  if (campaign.spend > 0 && deterministicOrders > 0) {
    const aovs = matchedOrders.map(o => o.totalCad);
    const n = aovs.length;
    if (n < 2) {
      roasInterval = null;
    } else {
      const meanAov = aovs.reduce((s, x) => s + x, 0) / aovs.length;
      const variance =
        // Bessel correction: sample variance uses N - 1.
        aovs.reduce((s, x) => s + (x - meanAov) ** 2, 0) / (n - 1);
      if (variance === 0) {
        // Homogeneous sample (e.g. single-SKU subscription store: every order
        // is the same AOV). With zero observed variance the normal-approx CI
        // collapses to a degenerate point, which renders as
        // "טווח 95%: 2.30 – 2.30" — a falsely-precise signal from a tiny
        // sample. Treat as "not enough info" instead.
        roasInterval = null;
      } else {
        const stdDev = Math.sqrt(variance);
        const stderrAov = stdDev / Math.sqrt(aovs.length);
        // CI on total revenue = CI on (N × mean AOV) — N is treated as fixed
        // (we observed it). 95% normal: ± NORMAL_QUANTILE_95 × stderr.
        const revLow = Math.max(0, (meanAov - NORMAL_QUANTILE_95 * stderrAov) * aovs.length);
        const revHigh = (meanAov + NORMAL_QUANTILE_95 * stderrAov) * aovs.length;
        roasInterval = {
          low: revLow / campaign.spend,
          mid: deterministicRevenue / campaign.spend,
          high: revHigh / campaign.spend,
        };
      }
    }
  }

  // -----------------------------------------------------------------------
  // Multi-window stability. Split the date range into 7-day buckets, compute
  // coverage per window, then look at the spread. Low spread = consistent
  // bias (trustworthy). High spread = noisy → don't trust period totals.
  // -----------------------------------------------------------------------
  const windowStability = computeWindowStability(
    matchedOrders,
    dailyMetaSeries ?? [],
    dateFrom,
    dateTo,
  );

  // -----------------------------------------------------------------------
  // Outlier day detection. Meta's modeled conversions often appear as
  // single-day spikes that don't show up in the underlying click data.
  // We flag robust trailing-window outliers by median + MAD. Shown in
  // the tooltip; could be excluded from totals in a future iteration but
  // for now just surfaces them.
  // -----------------------------------------------------------------------
  const outlierDays = detectOutlierDays(dailyMetaSeries ?? []);

  // Confidence ladder:
  //   coverage >= 0.8 → HIGH (most of what Meta claimed has click-ID proof)
  //   coverage 0.4-0.8 → MEDIUM (sizeable modeled portion but base is real)
  //   coverage < 0.4 → LOW (Meta mostly hallucinating, or utm_campaign not
  //                          configured to pass campaign name)
  //   No orders matched AND metaClaim > 0 → UNKNOWN (probably means
  //     utm_campaign isn't being passed — surface as 'unknown' so the
  //     operator knows to fix tracking, not as 'low' which would imply
  //     Meta is wrong)
  let trust: AttributionTrust;
  const reasons: string[] = [];
  let recommendation = '';

  // AUDIT attributionAnalysis ALG-01 (2026-05-24, Phase 12.2.2): platform-
  // agnostic operator copy. Pre-fix 10+ operator-facing strings hardcoded
  // 'Meta' literal, mismatching TikTok-platform campaigns after Phase
  // 05.7.9c widening. The operator would read 'Meta מייחס בלי click-id'
  // for a TikTok campaign and troubleshoot the wrong platform / wrong
  // Ads Manager. Single-source `platformLabel` makes the substitution
  // grep-friendly and easy to extend (e.g. when Google PMax is added).
  // Evidence: raw-returns/lib_algorithm_attributionAnalysis.json (ALG-01).
  const platformLabel = campaign.platform;

  if (campaign.metaClaim === 0 && deterministicOrders === 0) {
    // No conversions on either side — common for brand-awareness / reach
    // campaigns, paused campaigns with no activity in the range, or genuinely
    // non-converting campaigns. "Meta מנפח" makes zero sense here; surface
    // honestly as "nothing to analyse" so the operator doesn't see a false
    // 0/100 "untrusted" badge on every zero-conversion campaign.
    trust = { level: 'unknown', label: 'אין המרות', score: 0 };
    if (campaign.spend > 0) {
      reasons.push(`הוצאה CAD ${campaign.spend.toFixed(0)} ללא המרות מ-${platformLabel} או מ-Shopify`);
      recommendation =
        'אין המרות לניתוח. אם זה קמפיין brand-awareness/reach — סבבה. ' +
        'אחרת בדוק שה-Pixel/CAPI עובדים והקמפיין מכוון להמרות.';
    } else {
      reasons.push('אין הוצאה ואין המרות בטווח הזה');
      recommendation = 'הקמפיין לא רץ בטווח הזה — אין מה לנתח.';
    }
  } else if (deterministicOrders === 0 && campaign.metaClaim > 0) {
    trust = { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 };
    reasons.push(
      `אף הזמנה לא תויגה לקמפיין הזה — סביר ש-utm_campaign לא מוגדר ב-URL Parameters ב-${platformLabel} Ads Manager`,
    );
    reasons.push(
      `${platformLabel} דיווח על CAD ${campaign.metaClaim.toFixed(0)} המרות בלי שום click-id מתאים`,
    );
    recommendation =
      `הוסף URL Parameters לקמפיין ב-${platformLabel}: utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}. ` +
      'תוך 24 שעות מההשמעה הבאה תראה כאן את ההזמנות האמיתיות.';
  } else if (coverage >= 0.8) {
    const pct = Math.round(coverage * 100);
    trust = { level: 'high', label: 'אמין', score: Math.min(100, 70 + pct / 5) };
    reasons.push(
      `${deterministicOrders} הזמנות תויגו לקמפיין (CAD ${deterministicRevenue.toFixed(0)} מתוך CAD ${campaign.metaClaim.toFixed(0)} ש-${platformLabel} דיווח — ${pct}% coverage)`,
    );
    if (modeledRevenue > 0) {
      reasons.push(
        `CAD ${modeledRevenue.toFixed(0)} ה"modeled" של ${platformLabel} (view-through / cross-device) — סביר`,
      );
    }
    recommendation = coverage >= 1.0
      ? `הקמפיין מבצע מעבר למה ש-${platformLabel} מדווח (halo). שקול גידול תקציב 20-40%.`
      : 'מספרי הקמפיין אמינים. אופטימיזציה רגילה לפי ROAS.';
  } else if (coverage >= 0.4) {
    const pct = Math.round(coverage * 100);
    const modeledPct = Math.round((modeledRevenue / campaign.metaClaim) * 100);
    trust = { level: 'medium', label: 'חלקי', score: 40 + pct / 2 };
    reasons.push(
      `${pct}% מההמרות תויגו (${deterministicOrders} הזמנות, CAD ${deterministicRevenue.toFixed(0)})`,
    );
    reasons.push(
      `${modeledPct}% modeled — ${platformLabel} מייחס בלי click-id (view-through, cross-device, סטטיסטי)`,
    );
    if (campaign.spend < 200) {
      reasons.push(`הוצאה נמוכה (CAD ${campaign.spend.toFixed(0)}) — מדגם קטן מגדיל אי-ודאות`);
    }
    // Guard divide-by-zero: when spend === 0 (operator-backfilled or
    // attribution-only campaigns), the ratio is Infinity and toFixed(2)
    // yields the literal string "Infinity", which renders as
    // "ROAS אמיתי: Infinityx" in tooltips — a user-visible defect (CR-03).
    if (campaign.spend > 0) {
      recommendation =
        `ROAS אמיתי לפי click-id: ${(deterministicRevenue / campaign.spend).toFixed(2)}x. ` +
        `ROAS לפי ${platformLabel}: ${(campaign.metaClaim / campaign.spend).toFixed(2)}x. ` +
        `הפער מעיד על modeled — הימנע מהחלטות אגרסיביות; הסתכל גם על הטרנד.`;
    } else {
      recommendation =
        `${pct}% מההמרות תויגו אבל אין הוצאה לחשב ROAS. הפער מעיד על modeled — הימנע מהחלטות אגרסיביות.`;
    }
  } else {
    const pct = Math.round(coverage * 100);
    // WR-03: clamp the visible score to [0, 100]. coverage can be negative
    // when refunds exceed sales (TEST-03 signed-revenue path) — without the
    // clamp, trust.score would render as e.g. -200, breaking the
    // documented [0, 100] contract (line 75) and any downstream comparator
    // (Math.max, range checks, color thresholds).
    const safePct = Math.max(0, pct);
    trust = { level: 'low', label: 'לא אמין', score: safePct };
    if (pct < 0) {
      // Refund-heavy day: phrase the reason in terms of net loss, not
      // a meaningless "רק -200% מההמרות תויגו" string.
      reasons.push(
        `החזרים גדולים מההזמנות (${deterministicOrders} פעולות, CAD ${deterministicRevenue.toFixed(0)} נטו)`,
      );
    } else {
      reasons.push(
        `רק ${pct}% מההמרות (${deterministicOrders} הזמנות) תויגו לקמפיין הזה`,
      );
    }
    reasons.push(
      `${platformLabel} מייחס CAD ${campaign.metaClaim.toFixed(0)} אבל רק CAD ${deterministicRevenue.toFixed(0)} בפועל יש להם click-id`,
    );
    recommendation =
      `${platformLabel} מנפח דיווחים לקמפיין הזה. ` +
      'אל תקבל החלטות "להגדיל" על בסיס ה-ROAS שלו. ' +
      'בדוק: (1) האם utm_campaign מוגדר נכון, (2) האם CAPI/Pixel מתוקנים, (3) האם הקמפיין באמת מביא מכירות.';
  }

  // Augment reasons + recommendation with the new signals.
  //
  // Audit fix 2026-05-24 (U-04): the 'mixed' verdict was previously
  // never surfaced to the operator — only 'stable' and 'volatile'
  // emitted tooltip text. The 'mixed' bucket (σ in 0.15-0.35) was
  // therefore silently swallowed: an operator looking at a Meta:Shopify
  // ratio that drifted moderately week-to-week saw no warning at all
  // and would default to trusting the trend. The fix adds a 'mixed'
  // branch that emits honest copy ("תנודתיות בינונית בחלון") without
  // applying the volatile trust-downgrade (the bucket is intermediate;
  // the σ isn't extreme enough to force the high→medium drop).
  if (windowStability && windowStability.windowCountWithData >= 2) {
    if (windowStability.verdict === 'stable') {
      reasons.push(
        `יחס ${platformLabel}:Shopify יציב לאורך ${windowStability.windowCountWithData} שבועות (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — ביאס קבוע, ניתן להסתמך על המגמה`,
      );
    } else if (windowStability.verdict === 'volatile') {
      reasons.push(
        `יחס ${platformLabel}:Shopify תנודתי מאוד בין שבועות (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — מספרי תקופה לא יציבים`,
      );
      // Downgrade trust if volatile and we were saying 'high'.
      if (trust.level === 'high') {
        trust = { level: 'medium', label: 'חלקי', score: Math.min(trust.score, 65) };
      }
    } else if (windowStability.verdict === 'mixed') {
      // AUDIT U-04 (2026-05-24): intermediate σ (0.15 ≤ σ < 0.35) gets
      // its own honest tooltip line. We do NOT downgrade trust here —
      // 'mixed' is not extreme enough to flip a high read to medium,
      // but the operator deserves to know the ratio is drifting.
      reasons.push(
        `יחס ${platformLabel}:Shopify מציג תנודתיות בינונית בחלון של ${windowStability.windowCountWithData} שבועות (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — בייאס משתנה לאט; אפשר להסתמך על המגמה הכללית אבל לא על המספר היחיד`,
      );
    }
  }
  if (outlierDays.length > 0) {
    reasons.push(
      // Audit fix 2026-05-23 (b/HI-01): honest label. The detector uses
      // robust median + MAD with multiplier MAD_OUTLIER_MULTIPLIER (=3), not
      // a Gaussian 2.5σ. The previous "2.5σ" string lied to the operator
      // about both the metric (MAD vs σ) and the multiplier (3 vs 2.5).
      `${outlierDays.length} ימים שבהם ${campaign.platform} דיווח מעל ${MAD_OUTLIER_MULTIPLIER}× MAD מעל החציון שלו (modeled spikes): ${outlierDays.slice(0, 3).join(', ')}${outlierDays.length > 3 ? '…' : ''}`,
    );
  }
  if (roasInterval) {
    reasons.push(
      `טווח אמינות 95% ל-ROAS אמיתי: ${roasInterval.low.toFixed(2)}x – ${roasInterval.high.toFixed(2)}x`,
    );
  }

  return {
    deterministicRevenue,
    deterministicOrders,
    modeledRevenue,
    coverage,
    coverageExceedsClamp: coverage > COVERAGE_WARNING_THRESHOLD,
    trust,
    reasons,
    recommendation,
    roasInterval,
    windowStability,
    outlierDays,
  };
}

/**
 * Per-7-day-window coverage analysis. Returns the spread of
 * (matched-revenue / claimed) ratios across consecutive windows. A low
 * spread means Meta is consistently off by the same amount — that's a
 * known bias the operator can mentally correct for. A high spread means
 * the gap is unstable and shouldn't be used to make decisions on period
 * totals.
 */
export function computeWindowStability(
  matchedOrders: OrderAttributionRow[],
  dailyMetaSeries: Array<{ date: string; value: number }>,
  dateFrom: string,
  dateTo: string,
): WindowStability | null {
  // Bucket the range into consecutive WINDOW_DAYS windows.
  const ms = (s: string) => new Date(s + 'T00:00:00Z').getTime();
  const fromMs = ms(dateFrom);
  const toMs = ms(dateTo);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const totalDays = Math.round((toMs - fromMs) / 86400000) + 1;
  if (totalDays < MIN_RANGE_DAYS_FOR_STABILITY) return null; // need ≥2 windows for any signal

  // Aggregate matched + meta per window. Include a partial trailing bucket
  // only when it covers ≥ TAIL_DAYS_MIN_FOR_PARTIAL_BUCKET days — below that
  // the tail is too noisy to contribute usefully to σ and can artificially
  // spike the variance. (Previously the tail was silently truncated; IN5-03.)
  const fullWindows = Math.floor(totalDays / WINDOW_DAYS);
  const tailDays = totalDays - fullWindows * WINDOW_DAYS;
  // `totalWindows` is the bucket count BEFORE filtering for meta>0. The
  // returned WindowStability.windowCountWithData is the post-filter count —
  // two distinct concepts that share the same arithmetic root. (IN-01)
  const totalWindows = fullWindows + (tailDays >= TAIL_DAYS_MIN_FOR_PARTIAL_BUCKET ? 1 : 0);
  const buckets: Array<{ matched: number; meta: number }> = [];
  for (let i = 0; i < totalWindows; i++) {
    buckets.push({ matched: 0, meta: 0 });
  }
  function bucketIdx(dateStr: string): number {
    const d = ms(dateStr);
    if (!Number.isFinite(d) || d < fromMs) return -1;
    const idx = Math.floor((d - fromMs) / 86400000 / WINDOW_DAYS);
    if (idx >= totalWindows) return -1;
    return idx;
  }
  for (const o of matchedOrders) {
    if (!Number.isFinite(o.totalCad)) continue;
    const i = bucketIdx(o.date);
    if (i >= 0) buckets[i].matched += o.totalCad;
  }
  for (const p of dailyMetaSeries) {
    // Reject non-finite values explicitly so an upstream NaN (e.g. a
    // divide-by-zero in a derived metric) doesn't silently invalidate the
    // whole window's stability signal — was being filtered out implicitly
    // by `b.meta > 0` later, which is too easy to misread.
    if (!Number.isFinite(p.value)) continue;
    const i = bucketIdx(p.date);
    if (i >= 0) buckets[i].meta += p.value;
  }

  // Per-window coverage; drop windows where Meta claim was zero (no
  // signal to compute from). The cap at COVERAGE_WARNING_THRESHOLD is
  // INTENTIONALLY kept here even though it was removed from the displayed
  // `computeCoverage` (AUDIT U-05, 2026-05-24). Reason: stdDev is not
  // robust to outliers — one window with 10× coverage (pixel outage)
  // would push every campaign into 'volatile' even when 19 of 20 windows
  // are at 1.3×. The displayed coverage on the trust panel shows the
  // raw value with a warning chip; the variance-driven stability verdict
  // uses the bounded value to stay representative of typical behavior.
  const coverages = buckets
    .filter(b => b.meta > 0)
    .map(b => Math.min(COVERAGE_WARNING_THRESHOLD, b.matched / b.meta));
  if (coverages.length < 2) return null;

  const mean = coverages.reduce((s, x) => s + x, 0) / coverages.length;
  const variance =
    coverages.reduce((s, x) => s + (x - mean) ** 2, 0) / coverages.length;
  const stdDev = Math.sqrt(variance);
  const verdict: WindowStability['verdict'] =
    stdDev < STABLE_THRESHOLD ? 'stable'
    : stdDev < VOLATILE_THRESHOLD ? 'mixed'
    : 'volatile';
  return { windowCountWithData: coverages.length, meanCoverage: mean, stdDev, verdict };
}

/**
 * Outlier day detection using median + MAD against the trailing
 * OUTLIER_LOOKBACK_DAYS baseline. The robust baseline prevents one
 * outlier from inflating the next day's threshold and hiding a
 * cascading spike.
 */
export function detectOutlierDays(
  series: Array<{ date: string; value: number }>,
): string[] {
  if (series.length < OUTLIER_LOOKBACK_DAYS + 1) return [];
  // Sort by date asc so trailing windows are causal.
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  for (let i = OUTLIER_LOOKBACK_DAYS; i < sorted.length; i++) {
    const trail = sorted.slice(Math.max(0, i - OUTLIER_LOOKBACK_DAYS), i);
    // Keep zero-valued baseline days. Filtering `v > 0` (the previous
    // behaviour) masked the most operationally important signal: a
    // low-activity campaign with $0 conversions for days 1-13 then a
    // $500 spike on day 14 would have empty vals and exit before the
    // spike was evaluated. (WR-07)
    const vals = trail.map(p => p.value).filter(v => Number.isFinite(v));
    if (vals.length < OUTLIER_MIN_BASELINE_SAMPLES) continue;
    if (!Number.isFinite(sorted[i].value)) continue;
    const med = median(vals);
    const deviation = mad(vals, med);
    const diff = Math.abs(sorted[i].value - med);
    const threshold = deviation > 0
      ? MAD_OUTLIER_MULTIPLIER * deviation
      : Math.max(1e-9, Math.abs(med) * MAD_FALLBACK_FRACTION);
    if (diff > threshold) out.push(sorted[i].date);
  }
  return out;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = sorted.length;
  return m % 2 === 0
    ? (sorted[m / 2 - 1] + sorted[m / 2]) / 2
    : sorted[Math.floor(m / 2)];
}

function mad(arr: number[], med: number): number {
  if (arr.length === 0) return 0;
  return median(arr.map(x => Math.abs(x - med)));
}

// ============================================================================
// Granular variants: ad-set level + ad level
// ============================================================================
//
// Same algorithm as analyzeAttribution() at the campaign level, but the
// matcher uses utm_term (ad-set ID) or utm_content (ad ID) instead of
// utm_id / utm_campaign. The product mapping is INHERITED from the parent
// campaign — there's no per-ad-set product picker — but the order-level
// attribution data lets us tell which ad-set actually drove clicks.
//
// Why split into separate functions instead of one big `level: 'campaign'|...`?
// The recommendations and reason wording are level-specific ("scale this
// ad-set" reads differently from "scale this campaign"), and the API
// signature stays cleaner when the caller doesn't have to think about which
// fields to populate based on level.

/**
 * Per-ad-set attribution analysis. Matches orders to an ad set via
 * exact `utm_term === adSet.adSetId` comparison.
 *
 * REQUIRES UTMs to be configured at the AD SET level (`utm_term={{adset.id}}`
 * in Meta Ads Manager URL parameters). If only `utm_id` is configured
 * (campaign level), this function will report zero matched orders — that
 * is correct behavior, NOT a bug. Use the `analyzeAttribution`
 * campaign-level analyzer for stores that only configure campaign-level UTMs.
 *
 * Returns the same shape as analyzeAttribution but scoped to a single ad set.
 */
export function analyzeAttributionForAdSet(
  adSet: {
    adSetId: string;
    adSetName: string;
    storeId: string;
    platform: string;
    metaClaim: number;       // CAD — Meta's conversion_value for this ad-set
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  dailyMeta?: Array<{ date: string; value: number }>,
): AttributionAnalysis | null {
  // Wave 2 deferred fix (2026-05-23): widen the platform gate to match
  // the campaign-level analyzer + Wave 1's useCampaignAttribution hook
  // fix. TikTok ad-sets also support utm_term={{adgroup_id}}; only Google
  // remains excluded because Google's GAQL flow exposes ad-group
  // structure but the click → utm mapping is unreliable for PMax/Shopping.
  if (adSet.platform !== 'Meta' && adSet.platform !== 'TikTok') return null;
  if (!orders || orders.length === 0) return null;
  if (!adSet.adSetId) return null;

  const matchedOrders = orders.filter(o => {
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (o.storeId !== adSet.storeId) return false;
    if (!Number.isFinite(o.totalCad)) return false; // WR-02 — guard NaN propagation
    return o.utmTerm && o.utmTerm.trim() === adSet.adSetId.trim();
  });

  // AUDIT attributionAnalysis ALG-01 (2026-05-24, Phase 12.2.2): thread
  // platform label into advice strings so TikTok ad-sets read 'TikTok
  // מנפח' instead of 'Meta מנפח'. Evidence: raw-returns/
  // lib_algorithm_attributionAnalysis.json (ALG-01).
  const platformLabel = adSet.platform;
  return buildAnalysis({
    label: 'ad-set',
    name: adSet.adSetName,
    platform: platformLabel,
    metaClaim: adSet.metaClaim,
    spend: adSet.spend,
    matchedOrders,
    dailyMeta: dailyMeta ?? [],
    dateFrom,
    dateTo,
    advice: {
      misconfigured:
        'אף הזמנה לא תויגה ל-ad-set הזה — סביר ש-utm_term לא מוגדר ב-URL Parameters (צריך {{adset.id}}).',
      goodHalo: `ה-ad-set מבצע מעבר למה ש-${platformLabel} דיווח — שקול גידול תקציב או פתיחת ad-set דומה.`,
      goodSteady: 'מספרי ה-ad-set אמינים, אופטימיזציה רגילה לפי ROAS.',
      partial: 'modeled portion גדול ב-ad-set הזה — בדוק אם הוא באמת מביא מכירות או רק חשיפות שמיוחסות לו.',
      bad: `${platformLabel} מנפח דיווחים ל-ad-set הזה. שקול לכבות אותו ולחלק את התקציב ל-ad-sets שיש להם click-id אמיתי.`,
    },
  });
}

/**
 * Per-ad attribution. Matches orders where `utm_content === adId`. Same
 * structure as the ad-set version. Useful for finding which creative is
 * actually doing the work inside an ad-set.
 */
export function analyzeAttributionForAd(
  ad: {
    adId: string;
    adName: string;
    storeId: string;
    platform: string;
    metaClaim: number;
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  dailyMeta?: Array<{ date: string; value: number }>,
): AttributionAnalysis | null {
  // Wave 2 deferred fix (2026-05-23): widen the platform gate to match the
  // ad-set + campaign-level analyzers. TikTok ads support
  // utm_content={{ad.id}} just like Meta. Google still excluded (PMax
  // utm-tracking unreliable).
  if (ad.platform !== 'Meta' && ad.platform !== 'TikTok') return null;
  if (!orders || orders.length === 0) return null;
  if (!ad.adId) return null;

  const matchedOrders = orders.filter(o => {
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (o.storeId !== ad.storeId) return false;
    if (!Number.isFinite(o.totalCad)) return false; // WR-02 — guard NaN propagation
    return o.utmContent && o.utmContent.trim() === ad.adId.trim();
  });

  // AUDIT attributionAnalysis ALG-01 (2026-05-24, Phase 12.2.2): thread
  // platform label into advice strings so TikTok ads read 'TikTok מנפח'
  // instead of 'Meta מנפח'.
  const platformLabel = ad.platform;
  return buildAnalysis({
    label: 'ad',
    name: ad.adName,
    platform: platformLabel,
    metaClaim: ad.metaClaim,
    spend: ad.spend,
    matchedOrders,
    dailyMeta: dailyMeta ?? [],
    dateFrom,
    dateTo,
    advice: {
      misconfigured:
        'אף הזמנה לא תויגה למודעה הזאת — סביר ש-utm_content לא מוגדר ב-URL Parameters (צריך {{ad.id}}).',
      goodHalo: `המודעה מבצעת מעבר למה ש-${platformLabel} דיווח — שקול הרחבת ה-creative הזה ל-ad-sets נוספים.`,
      goodSteady: 'מספרי המודעה אמינים. אם זה ה-top-performer ב-ad-set, שקול לבודד אותו ל-ad-set משלו.',
      partial: 'modeled portion גדול במודעה הזאת — ייתכן שהקריאייטיב מקבל view-through אבל לא קליקים.',
      bad: `${platformLabel} מנפח דיווחים למודעה הזאת בלי click-id מתאים. שקול לכבות אותה.`,
    },
  });
}

/**
 * Shared engine. Pulled out so the level-specific functions stay short
 * and the algorithm changes (Bayesian, outlier, etc.) ripple uniformly
 * across campaign / ad-set / ad attribution.
 */
function buildAnalysis(opts: {
  label: 'campaign' | 'ad-set' | 'ad';
  name: string;
  /**
   * AUDIT attributionAnalysis ALG-01 (2026-05-24, Phase 12.2.2): the
   * source-platform label ('Meta' / 'TikTok' / 'Google'). Threaded from
   * the per-level callers (analyzeAttributionForAdSet,
   * analyzeAttributionForAd) and used in the dynamic copy strings that
   * the audit found hardcoded to 'Meta'. Optional with a 'Meta' default
   * for back-compat with any future caller that pre-dates the threading.
   * Evidence: raw-returns/lib_algorithm_attributionAnalysis.json (ALG-01).
   */
  platform?: string;
  metaClaim: number;
  spend: number;
  matchedOrders: OrderAttributionRow[];
  dailyMeta: Array<{ date: string; value: number }>;
  dateFrom: string;
  dateTo: string;
  advice: {
    misconfigured: string;
    goodHalo: string;
    goodSteady: string;
    partial: string;
    bad: string;
  };
}): AttributionAnalysis {
  const { metaClaim, spend, matchedOrders: rawMatched, dailyMeta, dateFrom, dateTo, advice } = opts;
  const platformLabel = opts.platform ?? 'Meta';

  // Defensive guard: even though analyzeAttributionForAdSet / *ForAd filter
  // non-finite totalCad upstream, a future caller of buildAnalysis might not.
  // Strip NaN rows here too so a single bad cell can't poison the reduce
  // → coverage → trust ladder. Mirrors the matched-orders Number.isFinite
  // filter inside computeWindowStability and the campaign-level filter in
  // analyzeAttribution. (WR-02; IN-03: removed stale line-number reference.)
  const matchedOrders = rawMatched.filter(o => Number.isFinite(o.totalCad));

  const deterministicRevenue = matchedOrders.reduce((s, o) => s + o.totalCad, 0);
  const deterministicOrders = matchedOrders.length;
  const modeledRevenue = Math.max(0, metaClaim - deterministicRevenue);
  // IN-04: delegate to the shared computeCoverage helper. Same
  // signed-input guard contract as the campaign-level analyzer.
  const coverage = computeCoverage(deterministicRevenue, metaClaim);

  // Approximate CI (same as campaign-level).
  let roasInterval: AttributionAnalysis['roasInterval'] = null;
  if (spend > 0 && deterministicOrders > 0) {
    const aovs = matchedOrders.map(o => o.totalCad);
    const n = aovs.length;
    if (n < 2) {
      roasInterval = null;
    } else {
      const meanAov = aovs.reduce((s, x) => s + x, 0) / aovs.length;
      const variance =
        // Bessel correction: sample variance uses N - 1.
        aovs.reduce((s, x) => s + (x - meanAov) ** 2, 0) / (n - 1);
      if (variance === 0) {
        // Mirror analyzeAttribution: homogeneous sample → degenerate interval
        // would mislead. Treat as "not enough info" so the tooltip doesn't
        // render a falsely-precise CI.
        roasInterval = null;
      } else {
        const stdDev = Math.sqrt(variance);
        const stderrAov = stdDev / Math.sqrt(aovs.length);
        // ± NORMAL_QUANTILE_95 × stderr — mirrors campaign-level analyzer.
        const revLow = Math.max(0, (meanAov - NORMAL_QUANTILE_95 * stderrAov) * aovs.length);
        const revHigh = (meanAov + NORMAL_QUANTILE_95 * stderrAov) * aovs.length;
        roasInterval = {
          low: revLow / spend,
          mid: deterministicRevenue / spend,
          high: revHigh / spend,
        };
      }
    }
  }

  const windowStability = computeWindowStability(matchedOrders, dailyMeta, dateFrom, dateTo);
  const outlierDays = detectOutlierDays(dailyMeta);

  // Trust ladder + level-specific advice.
  // Hoisted Hebrew label so the no-conversions branch doesn't drift if a
  // fourth level is ever added — single source of truth instead of two
  // adjacent ternaries. (IN-05)
  const hebLabel =
    opts.label === 'ad' ? 'מודעה' : opts.label === 'ad-set' ? 'ad-set' : 'קמפיין';
  let trust: AttributionTrust;
  const reasons: string[] = [];
  let recommendation = '';
  if (metaClaim === 0 && deterministicOrders === 0) {
    // Mirrors the campaign-level guard in analyzeAttribution(). When neither
    // Meta nor Shopify saw a conversion, there's nothing to assess — don't
    // brand the row as "untrusted" with a 0/100 score.
    trust = { level: 'unknown', label: 'אין המרות', score: 0 };
    if (spend > 0) {
      reasons.push(`הוצאה CAD ${spend.toFixed(0)} ללא המרות מ-${platformLabel} או מ-Shopify`);
      recommendation = `אין המרות לניתוח. אם זה brand/reach — סבבה. אחרת בדוק שה-${hebLabel} מכוון להמרות וה-Pixel/CAPI עובדים.`;
    } else {
      reasons.push('אין הוצאה ואין המרות בטווח הזה');
      recommendation = `ה-${hebLabel} לא רץ בטווח הזה — אין מה לנתח.`;
    }
  } else if (deterministicOrders === 0 && metaClaim > 0) {
    trust = { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 };
    reasons.push('אף הזמנה לא תויגה — סביר שחסר utm parameter רלוונטי');
    recommendation = advice.misconfigured;
  } else if (coverage >= 0.8) {
    const pct = Math.round(coverage * 100);
    trust = { level: 'high', label: 'אמין', score: Math.min(100, 70 + pct / 5) };
    reasons.push(`${deterministicOrders} הזמנות תויגו (${pct}% coverage, CAD ${deterministicRevenue.toFixed(0)})`);
    if (modeledRevenue > 0) reasons.push(`CAD ${modeledRevenue.toFixed(0)} modeled (view-through / cross-device)`);
    recommendation = coverage >= 1.0 ? advice.goodHalo : advice.goodSteady;
  } else if (coverage >= 0.4) {
    const pct = Math.round(coverage * 100);
    trust = { level: 'medium', label: 'חלקי', score: 40 + pct / 2 };
    reasons.push(`${pct}% תויגו (${deterministicOrders} הזמנות)`);
    reasons.push(`${Math.round((modeledRevenue / metaClaim) * 100)}% modeled`);
    // Guard divide-by-zero — see CR-03 in 02-foundations/02-REVIEW.md. Without
    // this, spend === 0 produces "ROAS אמיתי: Infinityx" tooltips.
    if (spend > 0) {
      recommendation =
        `ROAS אמיתי: ${(deterministicRevenue / spend).toFixed(2)}x  |  ROAS לפי ${platformLabel}: ${(metaClaim / spend).toFixed(2)}x. ` +
        advice.partial;
    } else {
      recommendation =
        `${pct}% מההמרות תויגו אבל אין הוצאה לחשב ROAS. ` + advice.partial;
    }
  } else {
    const pct = Math.round(coverage * 100);
    // WR-03: clamp the visible score to [0, 100]. Coverage can go
    // negative for refund-heavy windows (TEST-03 signed-revenue path),
    // which would otherwise emit a negative score and a "רק -X%
    // תויגו" string. Mirror analyzeAttribution.
    const safePct = Math.max(0, pct);
    trust = { level: 'low', label: 'לא אמין', score: safePct };
    if (pct < 0) {
      reasons.push(`החזרים גדולים מההזמנות (${deterministicOrders} פעולות, CAD ${deterministicRevenue.toFixed(0)} נטו)`);
    } else {
      reasons.push(`רק ${pct}% מההמרות (${deterministicOrders} הזמנות) תויגו`);
    }
    recommendation = advice.bad;
  }

  // Stability augmentations (downgrade if volatile).
  if (windowStability && windowStability.windowCountWithData >= 2) {
    if (windowStability.verdict === 'stable') {
      reasons.push(`יחס יציב על ${windowStability.windowCountWithData} שבועות — ביאס קבוע`);
    } else if (windowStability.verdict === 'volatile') {
      reasons.push(`יחס תנודתי (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — אל תסמוך על מספרי תקופה`);
      if (trust.level === 'high') {
        trust = { level: 'medium', label: 'חלקי', score: Math.min(trust.score, 65) };
      }
    }
  }
  if (outlierDays.length > 0) {
    reasons.push(`${outlierDays.length} ימי spike מ-${platformLabel} (modeled)`);
  }
  if (roasInterval) {
    reasons.push(`טווח 95%: ${roasInterval.low.toFixed(2)} – ${roasInterval.high.toFixed(2)}`);
  }

  return {
    deterministicRevenue,
    deterministicOrders,
    modeledRevenue,
    coverage,
    coverageExceedsClamp: coverage > COVERAGE_WARNING_THRESHOLD,
    trust,
    reasons,
    recommendation,
    roasInterval,
    windowStability,
    outlierDays,
  };
}

// ============================================================================
// Channel-level product attribution (Phase 1, added 2026-05-18)
// ============================================================================
//
// Third sibling alongside analyzeAttributionForAdSet / analyzeAttributionForAd
// but with a deliberately different shape — see CONTEXT/PATTERNS.md §4d:
// this analyzer is PURE source-grouping (orders bucketed by source label),
// it does NOT compute coverage / trust / Bayesian. Those concepts apply to
// click-id-vs-Meta-claim reconciliation, which is not what we're measuring
// here.
//
// The question this analyzer answers: "of the orders containing this
// campaign's mapped products in the period, what fraction came from a
// Facebook surface (paid OR organic OR any fbclid)?" — independent of
// utm_id matching. The signal complements the existing per-campaign trust
// chip; both render side-by-side in CampaignDrawer.

export type ProductChannelBreakdown = {
  /** Orders containing AT LEAST ONE of the mapped products in the period.
   *  Each order is counted ONCE even if it contains multiple mapped
   *  products. */
  totalOrders: number;
  /** Sum of mapped-product revenueCad across all matched orders. An order
   *  with two mapped products contributes both their proportional shares. */
  totalRevenue: number;
  /** Per-OrderSource breakdown. Empty-string source is lumped into
   *  'direct' (RESEARCH.md Open Question 1) so the bucket count is bounded
   *  by the OrderSource union plus 'direct'. Missing keys mean zero — the
   *  caller should default-coalesce when reading. */
  bySource: Partial<Record<OrderSource | 'direct', { orders: number; revenue: number; units: number }>>;
  /**
   * Orders qualifying as "Facebook" by the BROAD OR predicate:
   *   source ∈ {meta-paid, meta-organic} OR fbclidPresent === true.
   *
   * Audit fix 2026-05-23 (CRIT-2 / O2-CR-01): this count is NON-EXCLUSIVE
   * with `bySource` buckets — a `google-paid` order with a stale `fbclid`
   * cookie hits both this counter AND the `google-paid` bucket. Do NOT
   * subtract this from `totalOrders` in segment-width math: it inflates
   * Facebook + Google jointly past 100% and clamps the residual "other"
   * (email / affiliate / unknown) to 0.
   *
   * Use as a SECONDARY directional signal only ("how many orders had any
   * Facebook surface touchpoint?"). For mutually-exclusive segment math
   * the renderer computes Meta from `bySource['meta-paid'] +
   * bySource['meta-organic']` directly.
   */
  facebookOrders: number;
  facebookRevenue: number;
  /**
   * facebookOrders / totalOrders. 0 when totalOrders === 0 — never NaN
   * (RESEARCH.md Pitfall 3). The caller is still responsible for the
   * ≥3 orders gate before rendering.
   *
   * Audit fix 2026-05-23 (CRIT-2): like `facebookOrders`, this share is
   * inflated by fbclid-tagged Google/email orders. Renderers that compose
   * exclusive segment widths or chip-recommendation thresholds must
   * derive their own share from the `bySource` buckets — NOT from this
   * field — so the residual "other" bucket is not silently clamped.
   */
  facebookShare: number;
  /** Phase 05.7.9 — TikTok bucket. Counts orders with source === 'tiktok-paid'
   *  (set when ttclid is in the landing URL or source_name === 'tiktok').
   *  Mirrors facebookOrders/Revenue/Share so the UI can render TikTok as a
   *  first-class platform alongside Meta + Google. */
  tiktokOrders: number;
  tiktokRevenue: number;
  tiktokShare: number;
};

/**
 * Per-product channel breakdown. For the given productIds (a campaign's
 * mapped products), find every order in the date+store window that
 * contains AT LEAST one of those products, then group those orders by
 * source. Returns an explicit-zero `ProductChannelBreakdown` (NOT null)
 * when input is unusable — empty productIds or empty orders — so the
 * caller's threshold gate (≥3 orders) can read `breakdown.totalOrders`
 * without a null-check.
 *
 * Pure function — no side effects, no IO. Safe to memoize on inputs.
 */
export function analyzeProductChannel(opts: {
  productIds: string[];
  orders: OrderAttributionRow[];
  storeId: string;
  dateFrom: string;
  dateTo: string;
}): ProductChannelBreakdown {
  const { productIds, orders, storeId, dateFrom, dateTo } = opts;
  const empty: ProductChannelBreakdown = {
    totalOrders: 0,
    totalRevenue: 0,
    bySource: {},
    facebookOrders: 0,
    facebookRevenue: 0,
    facebookShare: 0,
    tiktokOrders: 0,
    tiktokRevenue: 0,
    tiktokShare: 0,
  };
  if (!productIds || productIds.length === 0) return empty;
  if (!orders || orders.length === 0) return empty;

  const wantedIds = new Set(productIds);

  let totalOrders = 0;
  let totalRevenue = 0;
  let facebookOrders = 0;
  let facebookRevenue = 0;
  let tiktokOrders = 0;
  let tiktokRevenue = 0;
  const bySource: ProductChannelBreakdown['bySource'] = {};

  for (const o of orders) {
    // Date + store window (mirrors analyzeAttributionForAdSet:542-546).
    if (o.date < dateFrom || o.date > dateTo) continue;
    if (o.storeId !== storeId) continue;
    if (!o.lineItems || o.lineItems.length === 0) continue;

    // Aggregate the order's mapped-product contribution. An order with
    // two mapped products counts ONCE but sums both their revenues.
    let orderMappedRevenue = 0;
    let orderMappedUnits = 0;
    let hitMapped = false;
    for (const li of o.lineItems) {
      if (!wantedIds.has(li.productId)) continue;
      hitMapped = true;
      orderMappedRevenue += li.revenueCad;
      orderMappedUnits += li.units;
    }
    if (!hitMapped) continue;

    totalOrders++;
    totalRevenue += orderMappedRevenue;

    // Bucket by raw source label, lumping empty-string source into
    // 'direct' so the UI can render a clean 4-segment Facebook/Google/
    // Direct/Other bar without an extra "unknown" segment.
    const sourceKey: OrderSource | 'direct' = (o.source || 'direct') as OrderSource | 'direct';
    const bucket = bySource[sourceKey] ?? { orders: 0, revenue: 0, units: 0 };
    bucket.orders++;
    bucket.revenue += orderMappedRevenue;
    bucket.units += orderMappedUnits;
    bySource[sourceKey] = bucket;

    // Facebook (broad) per CONTEXT locked criteria — do NOT extend.
    const isFacebook =
      o.source === 'meta-paid' ||
      o.source === 'meta-organic' ||
      o.fbclidPresent === true;
    if (isFacebook) {
      facebookOrders++;
      facebookRevenue += orderMappedRevenue;
    }

    // Phase 05.7.9 — TikTok bucket. Mirrors the Facebook predicate but
    // narrower: only paid (no ttclidPresent on the row + no organic
    // bucket because tiktok-paid is the only TikTok classification today,
    // see shopify.ts:classifyOrderAttribution priority chain).
    if (o.source === 'tiktok-paid') {
      tiktokOrders++;
      tiktokRevenue += orderMappedRevenue;
    }
  }

  return {
    totalOrders,
    totalRevenue,
    bySource,
    facebookOrders,
    facebookRevenue,
    // Guard divide-by-zero (RESEARCH.md Pitfall 3) — zero, never NaN.
    facebookShare: totalOrders > 0 ? facebookOrders / totalOrders : 0,
    tiktokOrders,
    tiktokRevenue,
    tiktokShare: totalOrders > 0 ? tiktokOrders / totalOrders : 0,
  };
}
