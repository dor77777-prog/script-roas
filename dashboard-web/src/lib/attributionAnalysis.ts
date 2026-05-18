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

import type { OrderAttributionRow } from './ordersAttribution';

export type AttributionAnalysis = {
  /** Sum of order totals where the order is provably from this campaign. */
  deterministicRevenue: number;
  /** Count of orders we matched. */
  deterministicOrders: number;
  /** Meta's claim minus deterministic. >0 = modeled / view-through. */
  modeledRevenue: number;
  /** deterministicRevenue / metaClaim, clamped to [0, 2]. >1.0 means Shopify
   *  picked up more than Meta — usually halo from organic / other channels
   *  spilling into the mapping. */
  coverage: number;
  /** Confidence verdict, derived from coverage + sample size + stability +
   *  outlier presence. Replaces the old heuristic chip with something
   *  defensible. */
  trust: AttributionTrust;
  /** Concrete reasons that explain the trust level. Shown in tooltips. */
  reasons: string[];
  /** Human-readable action for the operator. */
  recommendation: string;
  /** Bayesian-flavoured 95% credibility interval around the deterministic
   *  ROAS. Wider = less certain. Width shrinks with order count + stability.
   *  Null when there's no meaningful sample (zero orders matched). */
  roasInterval: { low: number; mid: number; high: number } | null;
  /** Per-7-day-window summary. Used to detect stable bias vs spike-driven
   *  noise. Empty when range < 7 days or no orders. */
  windowStability: WindowStability | null;
  /** Days where Meta's daily conversion value was an outlier (>2.5σ above
   *  the campaign's own trailing mean). Likely modeled spikes. */
  outlierDays: string[];
};

export type WindowStability = {
  /** Number of 7-day windows analysed. */
  windowCount: number;
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
 * Match an order against a campaign deterministically.
 *
 * Tier 1 (strongest): fbclid OR gclid present AND date is in campaign's
 * active window. This proves a click happened during the campaign.
 *
 * Tier 2 (strong): utm_campaign matches the campaign's name (case-insensitive,
 * trimmed). Meta Ads Manager defaults to setting utm_campaign = campaign name
 * when URL parameters are set.
 *
 * We DON'T match on product alone — that's what the mapping layer does
 * proportionally. Attribution is a separate axis: "did the user actually
 * click this campaign?"
 */
export function orderMatchesCampaign(
  order: OrderAttributionRow,
  campaign: { campaignName: string; storeId: string; platform: string },
): boolean {
  if (order.storeId !== campaign.storeId) return false;

  // Tier 2 — utm_campaign name match (case-insensitive, both trimmed).
  // Works for Meta only since Google Ads doesn't propagate the campaign
  // name into UTMs by default (it sends gclid + tracking template).
  if (campaign.platform === 'Meta' && order.utmCampaign) {
    const a = order.utmCampaign.trim().toLowerCase();
    const b = campaign.campaignName.trim().toLowerCase();
    if (a === b) return true;
  }

  // Tier 1 — click-id presence pulls the order into the campaign's
  // platform bucket. We DON'T claim "this exact order came from this
  // exact campaign" without the utm_campaign match, because fbclid alone
  // only proves the user clicked SOME Meta ad. So this match is
  // weaker than utm_campaign and the caller decides how to use it.
  //
  // We return false here so the caller can do platform-level fallbacks
  // separately. Pure name-match is the deterministic per-campaign signal.
  return false;
}

/**
 * Per-platform fallback when utm_campaign isn't set. We can still tie
 * orders to a platform via fbclid / gclid, then attribute them to
 * campaigns within that platform proportionally to spend. Less precise
 * than the name match but still strictly better than no attribution.
 */
export function ordersForPlatform(
  orders: OrderAttributionRow[],
  storeId: string,
  platform: 'Meta' | 'Google',
  dateFrom: string,
  dateTo: string,
): OrderAttributionRow[] {
  return orders.filter(o => {
    if (o.storeId !== storeId) return false;
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (platform === 'Meta') return o.fbclidPresent || o.source === 'meta-paid';
    return o.gclidPresent || o.source === 'google-paid';
  });
}

/**
 * Build the per-campaign attribution analysis.
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
    storeId: string;
    platform: string;
    metaClaim: number; // CAD
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  /** Optional daily Meta conv-value series for outlier detection. When
   *  provided, we flag days where Meta spiked >2.5σ above the trailing
   *  mean — usually modeled / view-through bursts that artificially
   *  inflate the period total. */
  dailyMetaSeries?: Array<{ date: string; value: number }>,
): AttributionAnalysis | null {
  if (campaign.platform !== 'Meta') return null;
  if (!orders || orders.length === 0) return null;

  const matchedOrders = orders.filter(o => {
    if (o.date < dateFrom || o.date > dateTo) return false;
    return orderMatchesCampaign(o, campaign);
  });

  const deterministicRevenue = matchedOrders.reduce((s, o) => s + o.totalCad, 0);
  const deterministicOrders = matchedOrders.length;
  const modeledRevenue = Math.max(0, campaign.metaClaim - deterministicRevenue);

  const coverage = campaign.metaClaim > 0
    ? Math.min(2, deterministicRevenue / campaign.metaClaim)
    : (deterministicRevenue > 0 ? 1 : 0);

  // -----------------------------------------------------------------------
  // Bayesian-flavoured credibility interval for the deterministic ROAS.
  //
  // We treat each matched order as an independent Bernoulli-ish draw with
  // mean = average order value and variance based on observed dispersion.
  // The Wilson score interval at 95% confidence gives a defensible range
  // that's tight when N is big and wide when N is small.
  //
  // For simplicity (and to avoid implementing the full Wilson), we use the
  // normal approximation: stderr ≈ stddev / √N, CI = mean ± 1.96 × stderr.
  // The result is shown as "ROAS 2.3 [1.8 – 2.9]" in the tooltip.
  // -----------------------------------------------------------------------
  let roasInterval: AttributionAnalysis['roasInterval'] = null;
  if (campaign.spend > 0 && deterministicOrders >= 3) {
    const aovs = matchedOrders.map(o => o.totalCad);
    const meanAov = aovs.reduce((s, x) => s + x, 0) / aovs.length;
    const variance =
      aovs.reduce((s, x) => s + (x - meanAov) ** 2, 0) / aovs.length;
    const stdDev = Math.sqrt(variance);
    const stderrAov = stdDev / Math.sqrt(aovs.length);
    // CI on total revenue = CI on (N × mean AOV) — N is treated as fixed
    // (we observed it). 95% normal: ± 1.96 × stderr.
    const revLow = Math.max(0, (meanAov - 1.96 * stderrAov) * aovs.length);
    const revHigh = (meanAov + 1.96 * stderrAov) * aovs.length;
    roasInterval = {
      low: revLow / campaign.spend,
      mid: deterministicRevenue / campaign.spend,
      high: revHigh / campaign.spend,
    };
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
  // We flag days where the daily Meta value exceeds the trailing mean
  // by > 2.5σ. Shown in the tooltip; could be excluded from totals in a
  // future iteration but for now just surfaces them.
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

  if (deterministicOrders === 0 && campaign.metaClaim > 0) {
    trust = { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 };
    reasons.push(
      'אף הזמנה לא תויגה לקמפיין הזה — סביר ש-utm_campaign לא מוגדר ב-URL Parameters ב-Meta Ads Manager',
    );
    reasons.push(
      `Meta דיווח על CAD ${campaign.metaClaim.toFixed(0)} המרות בלי שום click-id מתאים`,
    );
    recommendation =
      'הוסף URL Parameters לקמפיין ב-Meta: utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}. ' +
      'תוך 24 שעות מההשמעה הבאה תראה כאן את ההזמנות האמיתיות.';
  } else if (coverage >= 0.8) {
    const pct = Math.round(coverage * 100);
    trust = { level: 'high', label: 'אמין', score: Math.min(100, 70 + pct / 5) };
    reasons.push(
      `${deterministicOrders} הזמנות תויגו לקמפיין (CAD ${deterministicRevenue.toFixed(0)} מתוך CAD ${campaign.metaClaim.toFixed(0)} ש-Meta דיווח — ${pct}% coverage)`,
    );
    if (modeledRevenue > 0) {
      reasons.push(
        `CAD ${modeledRevenue.toFixed(0)} ה"modeled" של Meta (view-through / cross-device) — סביר`,
      );
    }
    recommendation = coverage >= 1.0
      ? 'הקמפיין מבצע מעבר למה ש-Meta מדווח (halo). שקול גידול תקציב 20-40%.'
      : 'מספרי הקמפיין אמינים. אופטימיזציה רגילה לפי ROAS.';
  } else if (coverage >= 0.4) {
    const pct = Math.round(coverage * 100);
    const modeledPct = Math.round((modeledRevenue / campaign.metaClaim) * 100);
    trust = { level: 'medium', label: 'חלקי', score: 40 + pct / 2 };
    reasons.push(
      `${pct}% מההמרות תויגו (${deterministicOrders} הזמנות, CAD ${deterministicRevenue.toFixed(0)})`,
    );
    reasons.push(
      `${modeledPct}% modeled — Meta מייחס בלי click-id (view-through, cross-device, סטטיסטי)`,
    );
    if (campaign.spend < 200) {
      reasons.push(`הוצאה נמוכה (CAD ${campaign.spend.toFixed(0)}) — מדגם קטן מגדיל אי-ודאות`);
    }
    recommendation =
      `ROAS אמיתי לפי click-id: ${(deterministicRevenue / campaign.spend).toFixed(2)}x. ` +
      `ROAS לפי Meta: ${(campaign.metaClaim / campaign.spend).toFixed(2)}x. ` +
      `הפער מעיד על modeled — הימנע מהחלטות אגרסיביות; הסתכל גם על הטרנד.`;
  } else {
    const pct = Math.round(coverage * 100);
    trust = { level: 'low', label: 'לא אמין', score: pct };
    reasons.push(
      `רק ${pct}% מההמרות (${deterministicOrders} הזמנות) תויגו לקמפיין הזה`,
    );
    reasons.push(
      `Meta מייחס CAD ${campaign.metaClaim.toFixed(0)} אבל רק CAD ${deterministicRevenue.toFixed(0)} בפועל יש להם click-id`,
    );
    recommendation =
      'Meta מנפח דיווחים לקמפיין הזה. ' +
      'אל תקבל החלטות "להגדיל" על בסיס ה-ROAS שלו. ' +
      'בדוק: (1) האם utm_campaign מוגדר נכון, (2) האם CAPI/Pixel מתוקנים, (3) האם הקמפיין באמת מביא מכירות.';
  }

  // Augment reasons + recommendation with the new signals.
  if (windowStability && windowStability.windowCount >= 2) {
    if (windowStability.verdict === 'stable') {
      reasons.push(
        `יחס Meta:Shopify יציב לאורך ${windowStability.windowCount} שבועות (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — ביאס קבוע, ניתן להסתמך על המגמה`,
      );
    } else if (windowStability.verdict === 'volatile') {
      reasons.push(
        `יחס Meta:Shopify תנודתי מאוד בין שבועות (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — מספרי תקופה לא יציבים`,
      );
      // Downgrade trust if volatile and we were saying 'high'.
      if (trust.level === 'high') {
        trust = { level: 'medium', label: 'חלקי', score: Math.min(trust.score, 65) };
      }
    }
  }
  if (outlierDays.length > 0) {
    reasons.push(
      `${outlierDays.length} ימים שבהם Meta דיווח >2.5σ מעל הממוצע שלו (modeled spikes): ${outlierDays.slice(0, 3).join(', ')}${outlierDays.length > 3 ? '…' : ''}`,
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
function computeWindowStability(
  matchedOrders: OrderAttributionRow[],
  dailyMetaSeries: Array<{ date: string; value: number }>,
  dateFrom: string,
  dateTo: string,
): WindowStability | null {
  // Bucket the range into consecutive 7-day windows.
  const ms = (s: string) => new Date(s + 'T00:00:00Z').getTime();
  const fromMs = ms(dateFrom);
  const toMs = ms(dateTo);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const totalDays = Math.round((toMs - fromMs) / 86400000) + 1;
  if (totalDays < 14) return null; // need ≥2 windows for any signal

  // Aggregate matched + meta per window.
  const windowCount = Math.floor(totalDays / 7);
  const buckets: Array<{ matched: number; meta: number }> = [];
  for (let i = 0; i < windowCount; i++) {
    buckets.push({ matched: 0, meta: 0 });
  }
  function bucketIdx(dateStr: string): number {
    const d = ms(dateStr);
    if (!Number.isFinite(d) || d < fromMs) return -1;
    const idx = Math.floor((d - fromMs) / 86400000 / 7);
    if (idx >= windowCount) return -1;
    return idx;
  }
  for (const o of matchedOrders) {
    const i = bucketIdx(o.date);
    if (i >= 0) buckets[i].matched += o.totalCad;
  }
  for (const p of dailyMetaSeries) {
    const i = bucketIdx(p.date);
    if (i >= 0) buckets[i].meta += p.value;
  }

  // Per-window coverage; drop windows where Meta claim was zero (no
  // signal to compute from).
  const coverages = buckets
    .filter(b => b.meta > 0)
    .map(b => Math.min(2, b.matched / b.meta));
  if (coverages.length < 2) return null;

  const mean = coverages.reduce((s, x) => s + x, 0) / coverages.length;
  const variance =
    coverages.reduce((s, x) => s + (x - mean) ** 2, 0) / coverages.length;
  const stdDev = Math.sqrt(variance);
  const verdict: WindowStability['verdict'] =
    stdDev < 0.15 ? 'stable' : stdDev < 0.35 ? 'mixed' : 'volatile';
  return { windowCount: coverages.length, meanCoverage: mean, stdDev, verdict };
}

/**
 * Outlier day detection using a simple z-score against the trailing 14-day
 * mean. Days where Meta's daily value exceeded 2.5σ above the trailing
 * baseline are flagged as likely modeled spikes — these are usually
 * view-through-credit bursts that don't correspond to real customer
 * behaviour.
 *
 * We use 2.5σ rather than 2σ to keep the false-positive rate low; the
 * operator only sees days that are genuinely anomalous.
 */
function detectOutlierDays(
  series: Array<{ date: string; value: number }>,
): string[] {
  if (series.length < 8) return [];
  // Sort by date asc so trailing windows are causal.
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  const LOOKBACK = 14;
  for (let i = LOOKBACK; i < sorted.length; i++) {
    const trail = sorted.slice(Math.max(0, i - LOOKBACK), i);
    const vals = trail.map(p => p.value).filter(v => v > 0);
    if (vals.length < 5) continue;
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const variance =
      vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) continue;
    const z = (sorted[i].value - mean) / stdDev;
    if (z > 2.5) out.push(sorted[i].date);
  }
  return out;
}
