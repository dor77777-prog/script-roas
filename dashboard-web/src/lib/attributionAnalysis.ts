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
 * THIS campaign. The platform-level fallback is handled by
 * `ordersForPlatform` separately.
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
  if (campaign.platform !== 'Meta') return false;

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
      // (we observed it). 95% normal: ± 1.96 × stderr.
      const revLow = Math.max(0, (meanAov - 1.96 * stderrAov) * aovs.length);
      const revHigh = (meanAov + 1.96 * stderrAov) * aovs.length;
      roasInterval = {
        low: revLow / campaign.spend,
        mid: deterministicRevenue / campaign.spend,
        high: revHigh / campaign.spend,
      };
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

  if (campaign.metaClaim === 0 && deterministicOrders === 0) {
    // No conversions on either side — common for brand-awareness / reach
    // campaigns, paused campaigns with no activity in the range, or genuinely
    // non-converting campaigns. "Meta מנפח" makes zero sense here; surface
    // honestly as "nothing to analyse" so the operator doesn't see a false
    // 0/100 "untrusted" badge on every zero-conversion campaign.
    trust = { level: 'unknown', label: 'אין המרות', score: 0 };
    if (campaign.spend > 0) {
      reasons.push(`הוצאה CAD ${campaign.spend.toFixed(0)} ללא המרות מ-Meta או מ-Shopify`);
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
export function computeWindowStability(
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

  // Aggregate matched + meta per window. Include a partial trailing bucket
  // only when it covers ≥3 days — below that the tail is too noisy to
  // contribute usefully to σ and can artificially spike the variance.
  // (Previously the tail was silently truncated; IN5-03.)
  const fullWindows = Math.floor(totalDays / 7);
  const tailDays = totalDays - fullWindows * 7;
  const windowCount = fullWindows + (tailDays >= 3 ? 1 : 0);
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
export function detectOutlierDays(
  series: Array<{ date: string; value: number }>,
): string[] {
  if (series.length < 8) return [];
  // Sort by date asc so trailing windows are causal.
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  // Relax LOOKBACK on short ranges so 14-day "last 14 days" views (the
  // dashboard's default) actually produce signal instead of silently
  // returning []. With sorted.length=14 and LOOKBACK=14, i starts at 14
  // which terminates the loop immediately — the docstring promised
  // outliers but none were ever computed. Adaptive sizing trades some
  // statistical strength for actually-fires-at-all behaviour. (IN5-02)
  const LOOKBACK = Math.min(14, Math.max(5, Math.floor(sorted.length / 2)));
  for (let i = LOOKBACK; i < sorted.length; i++) {
    const trail = sorted.slice(Math.max(0, i - LOOKBACK), i);
    const vals = trail.map(p => p.value).filter(v => Number.isFinite(v) && v > 0);
    if (vals.length < 5) continue;
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const variance =
      vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) continue;
    if (!Number.isFinite(sorted[i].value)) continue;
    const z = (sorted[i].value - mean) / stdDev;
    if (z > 2.5) out.push(sorted[i].date);
  }
  return out;
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
 * Per-ad-set attribution. Matches orders where `utm_term === adSetId`.
 * Falls back to inheriting the campaign-level analysis if utm_term is
 * unconfigured (in which case all of the campaign's tagged orders are
 * shared across ad-sets — less precise but still strictly better than
 * trusting Meta's per-ad-set conversion_value).
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
  if (adSet.platform !== 'Meta') return null;
  if (!orders || orders.length === 0) return null;
  if (!adSet.adSetId) return null;

  const matchedOrders = orders.filter(o => {
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (o.storeId !== adSet.storeId) return false;
    return o.utmTerm && o.utmTerm.trim() === adSet.adSetId.trim();
  });

  return buildAnalysis({
    label: 'ad-set',
    name: adSet.adSetName,
    metaClaim: adSet.metaClaim,
    spend: adSet.spend,
    matchedOrders,
    dailyMeta: dailyMeta ?? [],
    dateFrom,
    dateTo,
    advice: {
      misconfigured:
        'אף הזמנה לא תויגה ל-ad-set הזה — סביר ש-utm_term לא מוגדר ב-URL Parameters (צריך {{adset.id}}).',
      goodHalo: 'ה-ad-set מבצע מעבר למה ש-Meta דיווח — שקול גידול תקציב או פתיחת ad-set דומה.',
      goodSteady: 'מספרי ה-ad-set אמינים, אופטימיזציה רגילה לפי ROAS.',
      partial: 'modeled portion גדול ב-ad-set הזה — בדוק אם הוא באמת מביא מכירות או רק חשיפות שמיוחסות לו.',
      bad: 'Meta מנפח דיווחים ל-ad-set הזה. שקול לכבות אותו ולחלק את התקציב ל-ad-sets שיש להם click-id אמיתי.',
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
  if (ad.platform !== 'Meta') return null;
  if (!orders || orders.length === 0) return null;
  if (!ad.adId) return null;

  const matchedOrders = orders.filter(o => {
    if (o.date < dateFrom || o.date > dateTo) return false;
    if (o.storeId !== ad.storeId) return false;
    return o.utmContent && o.utmContent.trim() === ad.adId.trim();
  });

  return buildAnalysis({
    label: 'ad',
    name: ad.adName,
    metaClaim: ad.metaClaim,
    spend: ad.spend,
    matchedOrders,
    dailyMeta: dailyMeta ?? [],
    dateFrom,
    dateTo,
    advice: {
      misconfigured:
        'אף הזמנה לא תויגה למודעה הזאת — סביר ש-utm_content לא מוגדר ב-URL Parameters (צריך {{ad.id}}).',
      goodHalo: 'המודעה מבצעת מעבר למה ש-Meta דיווח — שקול הרחבת ה-creative הזה ל-ad-sets נוספים.',
      goodSteady: 'מספרי המודעה אמינים. אם זה ה-top-performer ב-ad-set, שקול לבודד אותו ל-ad-set משלו.',
      partial: 'modeled portion גדול במודעה הזאת — ייתכן שהקריאייטיב מקבל view-through אבל לא קליקים.',
      bad: 'Meta מנפח דיווחים למודעה הזאת בלי click-id מתאים. שקול לכבות אותה.',
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
  const { metaClaim, spend, matchedOrders, dailyMeta, dateFrom, dateTo, advice } = opts;

  const deterministicRevenue = matchedOrders.reduce((s, o) => s + o.totalCad, 0);
  const deterministicOrders = matchedOrders.length;
  const modeledRevenue = Math.max(0, metaClaim - deterministicRevenue);
  const coverage = metaClaim > 0
    ? Math.min(2, deterministicRevenue / metaClaim)
    : (deterministicRevenue > 0 ? 1 : 0);

  // Bayesian CI (same as campaign-level).
  let roasInterval: AttributionAnalysis['roasInterval'] = null;
  if (spend > 0 && deterministicOrders >= 3) {
    const aovs = matchedOrders.map(o => o.totalCad);
    const meanAov = aovs.reduce((s, x) => s + x, 0) / aovs.length;
    const variance = aovs.reduce((s, x) => s + (x - meanAov) ** 2, 0) / aovs.length;
    if (variance === 0) {
      // Mirror analyzeAttribution: homogeneous sample → degenerate interval
      // would mislead. Treat as "not enough info" so the tooltip doesn't
      // render a falsely-precise CI.
      roasInterval = null;
    } else {
      const stdDev = Math.sqrt(variance);
      const stderrAov = stdDev / Math.sqrt(aovs.length);
      const revLow = Math.max(0, (meanAov - 1.96 * stderrAov) * aovs.length);
      const revHigh = (meanAov + 1.96 * stderrAov) * aovs.length;
      roasInterval = {
        low: revLow / spend,
        mid: deterministicRevenue / spend,
        high: revHigh / spend,
      };
    }
  }

  const windowStability = computeWindowStability(matchedOrders, dailyMeta, dateFrom, dateTo);
  const outlierDays = detectOutlierDays(dailyMeta);

  // Trust ladder + level-specific advice.
  let trust: AttributionTrust;
  const reasons: string[] = [];
  let recommendation = '';
  if (metaClaim === 0 && deterministicOrders === 0) {
    // Mirrors the campaign-level guard in analyzeAttribution(). When neither
    // Meta nor Shopify saw a conversion, there's nothing to assess — don't
    // brand the row as "untrusted" with a 0/100 score.
    trust = { level: 'unknown', label: 'אין המרות', score: 0 };
    if (spend > 0) {
      reasons.push(`הוצאה CAD ${spend.toFixed(0)} ללא המרות מ-Meta או מ-Shopify`);
      recommendation = `אין המרות לניתוח. אם זה brand/reach — סבבה. אחרת בדוק שה-${opts.label === 'ad' ? 'מודעה' : opts.label === 'ad-set' ? 'ad-set' : 'קמפיין'} מכוון להמרות וה-Pixel/CAPI עובדים.`;
    } else {
      reasons.push('אין הוצאה ואין המרות בטווח הזה');
      recommendation = `ה-${opts.label === 'ad' ? 'מודעה' : opts.label === 'ad-set' ? 'ad-set' : 'קמפיין'} לא רץ בטווח הזה — אין מה לנתח.`;
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
    recommendation =
      `ROAS אמיתי: ${(deterministicRevenue / spend).toFixed(2)}x  |  ROAS לפי Meta: ${(metaClaim / spend).toFixed(2)}x. ` +
      advice.partial;
  } else {
    const pct = Math.round(coverage * 100);
    trust = { level: 'low', label: 'לא אמין', score: pct };
    reasons.push(`רק ${pct}% מההמרות (${deterministicOrders} הזמנות) תויגו`);
    recommendation = advice.bad;
  }

  // Stability augmentations (downgrade if volatile).
  if (windowStability && windowStability.windowCount >= 2) {
    if (windowStability.verdict === 'stable') {
      reasons.push(`יחס יציב על ${windowStability.windowCount} שבועות — ביאס קבוע`);
    } else if (windowStability.verdict === 'volatile') {
      reasons.push(`יחס תנודתי (σ=${(windowStability.stdDev * 100).toFixed(0)}%) — אל תסמוך על מספרי תקופה`);
      if (trust.level === 'high') {
        trust = { level: 'medium', label: 'חלקי', score: Math.min(trust.score, 65) };
      }
    }
  }
  if (outlierDays.length > 0) {
    reasons.push(`${outlierDays.length} ימי spike מ-Meta (modeled)`);
  }
  if (roasInterval) {
    reasons.push(`טווח 95%: ${roasInterval.low.toFixed(2)} – ${roasInterval.high.toFixed(2)}`);
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
  /** Orders qualifying as "Facebook" by the locked CONTEXT predicate:
   *  source ∈ {meta-paid, meta-organic} OR fbclidPresent === true. */
  facebookOrders: number;
  facebookRevenue: number;
  /** facebookOrders / totalOrders. 0 when totalOrders === 0 — never NaN
   *  (RESEARCH.md Pitfall 3). The caller is still responsible for the
   *  ≥3 orders gate before rendering. */
  facebookShare: number;
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
  };
  if (!productIds || productIds.length === 0) return empty;
  if (!orders || orders.length === 0) return empty;

  const wantedIds = new Set(productIds);

  let totalOrders = 0;
  let totalRevenue = 0;
  let facebookOrders = 0;
  let facebookRevenue = 0;
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
  }

  return {
    totalOrders,
    totalRevenue,
    bySource,
    facebookOrders,
    facebookRevenue,
    // Guard divide-by-zero (RESEARCH.md Pitfall 3) — zero, never NaN.
    facebookShare: totalOrders > 0 ? facebookOrders / totalOrders : 0,
  };
}
