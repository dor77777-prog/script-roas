/**
 * Unified Campaign Health Score (Phase 05.7.x).
 *
 * Before this module the campaigns table surfaced ~6 independent signals
 * (`info.confidence`, `info.attribution.trust`, CPM-vs-ROAS trajectory,
 * off-day chip, ROAS colour tone, 3 different ROAS values) — none of which
 * cross-referenced each other. An operator looking at a single row had to
 * synthesise them mentally.
 *
 * `computeCampaignHealth` collapses all of that into one 0..100 score (+ a
 * grade letter A/B/C/D/F or `unknown`) plus a breakdown of the four sub-
 * components that drove the score. The drilldown popover shows the reason
 * for each sub-score so operators can argue with the verdict.
 *
 * Scoring axis: **expected profit contribution per future spend dollar,
 * accounting for uncertainty.** A high-ROAS campaign with low click-ID
 * coverage shouldn't grade A — the number is unreliable. A mature campaign
 * with declining momentum shouldn't grade A even if last week's ROAS looks
 * good — the next dollar's expected return is lower than the past dollar's.
 *
 * Weights (tuned so a declining-trajectory mature campaign can't grade A
 * even if profitability + attribution look healthy — momentum matters for
 * the *next* dollar's expected return):
 *   - profitability:        40%   ROAS × trust modulation   (WEIGHTS.profitability = 0.40)
 *   - volume:               15%   spend tier (sample-size weighting)
 *   - trajectory:           25%   CPM↔ROAS momentum (heavy: forward-looking)
 *   - attribution clarity:  20%   deterministic % of revenue
 *
 * Insufficient-data short-circuit: campaigns with spend < $30 OR
 * (spend < $100 AND conversions === 0) are flagged `insufficient` and the
 * UI renders them as ⏳ Early rather than F so the operator knows to wait
 * rather than pause prematurely.
 */

import type { Aggregated } from '@/lib/campaignsAggregator';
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { CpmRoasAnalysis } from '@/lib/cpmRoasAnalysis';
import { fmtMoneyString } from '@/lib/format';

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'unknown';

export type HealthScoreComponents = {
  /** ROAS × trust modulation, 0..100. The dominant signal (40% weight). */
  profitability: number;
  /** Spend-tier score, 0..100. Small spend = small sample = lower score. */
  volume: number;
  /** CPM↔ROAS momentum, 0..100. 60 = neutral when insufficient data. */
  trajectory: number;
  /** Click-ID coverage / deterministic %, 0..100. 50 = unknown (e.g. Google). */
  attributionClarity: number;
  /** Phase 05.7.x (2026-05-23) — Net cohort adjustment applied AFTER
   *  the weighted sum by `applyCohortAdjustmentOnce`. Default
   *  0 when no cohort exists or the campaign is solo on its products.
   *  Negative when the campaign is the weakest in a saturated cohort
   *  OR when a shared product shows cannibalization signals; small
   *  positive when the campaign is the dominant leader in its cohort.
   *
   *  Audit fix 2026-05-24 (U-06): the apply function was renamed from
   *  `applyCohortHealthAdjustment` to `applyCohortAdjustmentOnce` and
   *  now asserts this field is 0 on entry — calling it twice on the
   *  same base throws instead of silently double-applying. */
  cohortAdjustment: number;
};

export type CampaignHealth = {
  /** Final 0..100 score: weighted sum of data-derived components, clamped to [0, 100].
   *  Cohort adjustments are applied separately via `applyCohortAdjustmentOnce` after
   *  this function returns. */
  score: number;
  /** Letter grade derived from `score` — easier to scan in a column. */
  grade: HealthGrade;
  /** Per-component breakdown for the drilldown popover. */
  components: HealthScoreComponents;
  /** One Hebrew sentence per component explaining WHY it scored that way.
   *  Order: profitability, volume, trajectory, attribution.
   *  Use these verbatim in the drilldown — keeps the UI dumb. */
  reasons: string[];
  /** True when the campaign hasn't accumulated enough data to score
   *  reliably (just-launched / tiny spend). UI should render ⏳ Early
   *  instead of the F grade so operators don't pause prematurely. */
  insufficient: boolean;
};

export type HealthScoreInputs = {
  aggregated: Aggregated;
  trueRevenueInfo: TrueRevenueInfo | undefined;
  cpmRoasAnalysis: CpmRoasAnalysis | undefined;
};

// ─────────────────────────────────────────────────────────────────────────
// Weights — sum to 1.0. Cohort adjustment (if any) is applied separately by
// applyCohortAdjustmentOnce after computeCampaignHealth returns.
// ─────────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  profitability: 0.40,
  volume: 0.15,
  trajectory: 0.25,
  attributionClarity: 0.20,
} as const;

// Sanity check at module load (sums to 1.0 ± floating noise).
const _WEIGHT_SUM =
  WEIGHTS.profitability + WEIGHTS.volume + WEIGHTS.trajectory + WEIGHTS.attributionClarity;
if (Math.abs(_WEIGHT_SUM - 1.0) > 1e-9) {
  throw new Error(`Health-score weights must sum to 1.0, got ${_WEIGHT_SUM}`);
}

// Spend tiers for the volume score. Heavier weight on big-spend campaigns
// because small-spend ROAS is noisy and shouldn't drive scaling decisions.
const VOLUME_TIERS: ReadonlyArray<{ min: number; score: number }> = [
  { min: 500, score: 100 },
  { min: 200, score: 70 },
  { min: 50, score: 40 },
  { min: 0, score: 10 },
] as const;

/**
 * Audit fix 2026-05-23 (HR-02 health-and-conclusions): per-platform ROAS
 * pivot for the profitability score.
 *
 * Pre-fix, all platforms used `(roas-1)/2 * 100` — pivot at ROAS 3.0 (= 100).
 * That single global threshold ignored the very real fact that:
 *   - Meta retargeting → typical "great" 3-5x
 *   - Meta prospecting → typical "great" 2-3x (lower bar; cold audience)
 *   - Google Shopping/Search → typical "great" 3-5x (direct intent)
 *   - TikTok prospecting → typical "great" 1.5-2.5x (similar to Meta TOF)
 *
 * Pivot below means a TikTok prospecting campaign at ROAS 2.0 lands at the
 * platform's "great" tier (~95-100) instead of being penalized vs Meta's
 * baseline. Same campaign behavior judged against same-platform peers.
 *
 * Numbers are defaults — operator can tune per-store later if needed.
 * Tracked as a knob in the JSDoc for tuneability.
 */
const PLATFORM_ROAS_PIVOT: Record<string, number> = {
  Meta: 3.0,
  Google: 3.5,
  TikTok: 2.0,
} as const;
const DEFAULT_ROAS_PIVOT = 3.0;

/**
 * Linearly map a ROAS onto a 0..100 profitability score: [1.0, pivot] → [0, 100],
 * clamped outside that band.
 *
 * Audit fix 2026-05-27 (A6 latent ÷0 guard): the denominator is `(pivot - 1.0)`.
 * All configured pivots today are ≥ 2.0 so this can't divide by zero, but a
 * future pivot of exactly 1.0 (break-even threshold) would produce Infinity/NaN.
 * `Math.max(1.01, pivot)` floors the pivot so the denominator is always ≥ 0.01,
 * guaranteeing a finite score regardless of the configured value.
 */
export function roasToScore(baseRoas: number, pivot: number): number {
  const safePivot = Math.max(1.01, pivot);
  return Math.max(0, Math.min(100, ((baseRoas - 1.0) / (safePivot - 1.0)) * 100));
}

/**
 * Audit fix 2026-05-23 (HR-01 health-and-conclusions): per-platform trust
 * modulator for the fallback "no info" path of `scoreProfitability`.
 *
 * Pre-fix, every fallback got a fixed 0.5 trust mod. For Google PMax (which
 * has no per-product attribution wired up so info.attribution is always
 * null), this meant every Google PMax campaign was systematically scored
 * ~16 points LOWER than an equivalent-ROAS Meta campaign — operator would
 * under-scale Google purely as a platform-bias artifact.
 *
 * Google's `conversions_value` from purchase events is generally reliable
 * (gclid-attributed direct intent). The platform-side numbers are closer
 * to truth than Meta's Pixel claims (iOS 14+, view-through, modeled
 * conversions). TikTok is similar to Meta — newer platform, less verified.
 *
 * Numbers are defaults — replace with per-account confidence once we plumb
 * Google PMax distinction (PMax may warrant lower than Search/Shopping).
 */
const PLATFORM_FALLBACK_TRUST: Record<string, number> = {
  Meta: 0.5,    // Pixel claims commonly inflated
  Google: 0.7,  // gclid + purchase event reliable; PMax slightly less so
  TikTok: 0.5,  // similar to Meta
} as const;
const DEFAULT_FALLBACK_TRUST = 0.5;

// Grade ladder. A starts at 75 (not 90) because the weighted formula caps
// out lower than 100 in practice (perfect attribution AND perfect trajectory
// is rare). Tuned so a healthy campaign with ROAS 3 + high trust lands
// solidly in A, marginal campaigns sit in C/D, and clear losers fall to F.
const GRADE_LADDER: ReadonlyArray<{ min: number; grade: Exclude<HealthGrade, 'unknown'> }> = [
  { min: 75, grade: 'A' },
  { min: 60, grade: 'B' },
  { min: 45, grade: 'C' },
  { min: 30, grade: 'D' },
  { min: 0, grade: 'F' },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Sub-component scorers
// ─────────────────────────────────────────────────────────────────────────

/**
 * P1-9c (audit 2026-06-10) — evidence floor for the deterministic branch.
 *
 * ONE tagged $100 order used to flip `scoreProfitability` into the
 * deterministic branch (baseRoas = 100/spend → ~0 → grade F) while an
 * IDENTICAL campaign with zero tagged orders kept the platform prior
 * (grade ~C): the scorer punished PARTIAL evidence below ZERO evidence —
 * a non-monotonic cliff that bites during the Google ValueTrack ramp-up,
 * when campaigns accumulate their first 1-2 tagged orders.
 *
 * The deterministic read is only authoritative once the click-id sample
 * has minimal mass: >= 3 tagged orders OR >= 20% coverage of the platform
 * claim. Below the floor the deterministic dribble is ignored for scoring
 * (profitability falls through to the prior-based branches; attribution
 * clarity floors at the zero-evidence 'unknown' verdict's 30).
 *
 * A null attribution (no analysis ran at all) passes the floor — there is
 * no sample to judge as thin, and pre-fix behaviour is preserved. The same
 * applies to SYNTHETIC/partial attribution shapes that omit the sample-size
 * fields entirely (aiReport.ts builds a minimal `{ trust }` object and casts
 * it in): absent counters are "no counter-evidence", not "zero orders".
 */
function deterministicEvidenceFloorMet(
  att: TrueRevenueInfo['attribution'],
): boolean {
  if (!att) return true;
  const orders = att.deterministicOrders;
  const coverage = att.coverage;
  const hasOrders = typeof orders === 'number' && Number.isFinite(orders);
  const hasCoverage = typeof coverage === 'number' && Number.isFinite(coverage);
  if (!hasOrders && !hasCoverage) return true;
  return (hasOrders && orders >= 3) || (hasCoverage && coverage >= 0.2);
}

/**
 * Profitability: ROAS mapped to 0..100, modulated by trust.
 *
 * Source-of-truth priority (best signal first):
 *   1. Deterministic Shopify revenue (click-ID proven) ÷ spend, modulated
 *      by `attribution.trust.score`.
 *   2. Combined Shopify revenue (deterministic + proportional fallback) ÷
 *      spend, modulated by `confidence.level`.
 *   3. Platform-claimed ROAS (Pixel) ÷ spend, modulated by fixed 0.5 (no
 *      verification possible — neutral penalty).
 *
 * ROAS → raw-score curve:  (roas - 1) ÷ 2 × 100, clamped to [0, 100].
 *   - ROAS 1.0 (break-even) = 0
 *   - ROAS 2.0 (healthy) = 50
 *   - ROAS 3.0 (great) = 100
 *   - ROAS > 3.0 caps at 100 (diminishing returns past 3x; trust matters
 *     more than the extra ROAS at that point)
 */
function scoreProfitability(
  aggregated: Aggregated,
  info: TrueRevenueInfo | undefined,
): { score: number; reason: string } {
  const spend = aggregated.spend;
  if (spend <= 0) {
    return { score: 0, reason: 'אין הוצאה בטווח — אי אפשר לחשב רווחיות' };
  }

  let baseRoas: number;
  let trustModulator: number;
  let sourceLabel: string;
  // The modulator means different things per branch — label it accordingly so
  // it doesn't read as the SAME "אמינות attribution" number the Attribution
  // panel + the attribution-clarity component show (Problem A, 2026-06-09). The
  // platform-prior branch in particular is NOT click-id trust.
  let modulatorLabel: string;

  // P1-9c: the deterministic branch requires the evidence floor (>= 3 tagged
  // orders OR >= 20% coverage). An under-floor dribble (e.g. ONE tagged $100
  // order) falls through: to the combined branch when product mapping adds
  // revenue BEYOND the dribble (a separate evidence channel), else to the
  // platform-prior branch — so partial evidence can never score BELOW zero
  // evidence for the same underlying performance.
  if (
    info &&
    info.deterministicRevenue > 0 &&
    deterministicEvidenceFloorMet(info.attribution)
  ) {
    baseRoas = info.deterministicRevenue / spend;
    trustModulator =
      info.attribution && info.attribution.trust.level !== 'unknown'
        ? info.attribution.trust.score / 100
        : 0.7;
    sourceLabel = 'Shopify דטרמיניסטי';
    modulatorLabel = 'אמינות click-id';
  } else if (info && info.trueRevenue > 0 && info.trueRevenue > info.deterministicRevenue) {
    baseRoas = info.trueRevenue / spend;
    trustModulator =
      info.confidence.level === 'high'
        ? 1.0
        : info.confidence.level === 'medium'
          ? 0.7
          : 0.4;
    sourceLabel = 'Shopify משולב (מיפוי + פרופורציונלי)';
    modulatorLabel = 'אמינות מיפוי';
  } else {
    baseRoas = aggregated.conversionValue / spend;
    // Audit fix 2026-05-23 (HR-01): per-platform fallback trust mod
    // replaces the previous fixed 0.5 — Google's platform-claimed
    // ROAS is more reliable than Meta's, so penalizing both identically
    // was a systematic anti-Google bias (~16 points on the weighted final).
    // This is a PLATFORM-REPORT PRIOR (how much we trust the self-reported
    // number when there's no click-id verification) — distinct from the
    // attribution-clarity / click-id trust the Attribution panel shows. It is
    // deliberately NOT reconciled to the click-id trust to avoid double-
    // penalizing "unverified" (that uncertainty is already captured by the
    // attribution-clarity component). It is labeled separately below.
    trustModulator =
      PLATFORM_FALLBACK_TRUST[aggregated.platform] ?? DEFAULT_FALLBACK_TRUST;
    sourceLabel = `הצהרת פלטפורמה (${aggregated.platform}, לא מאומת)`;
    modulatorLabel = 'מהימנות-דיווח (לא מאומת click-id)';
  }

  // Audit fix 2026-05-23 (HR-02): per-platform ROAS pivot. The previous
  // single pivot at ROAS 3.0 unfairly penalized platforms with naturally
  // lower baseline (e.g., TikTok prospecting at ROAS 2.0 used to score 50;
  // now scores 100 against its own platform's "great" threshold).
  const pivot =
    PLATFORM_ROAS_PIVOT[aggregated.platform] ?? DEFAULT_ROAS_PIVOT;
  // Formula: linearly scale [1.0, pivot] → [0, 100]; clamp outside.
  // `roasToScore` floors the pivot at 1.01 to guard the (pivot - 1.0)
  // denominator from a ÷0 → Infinity/NaN (A6 latent guard).
  const rawRoasScore = roasToScore(baseRoas, pivot);
  const modulated = rawRoasScore * trustModulator;
  return {
    score: Math.round(modulated),
    reason:
      `ROAS ${baseRoas.toFixed(2)} (${sourceLabel}, יעד ${pivot.toFixed(1)}) × ${modulatorLabel} ${Math.round(trustModulator * 100)}% ` +
      `→ ${Math.round(modulated)}/100`,
  };
}

function scoreVolume(spend: number): { score: number; reason: string } {
  for (const tier of VOLUME_TIERS) {
    if (spend >= tier.min) {
      const tag =
        tier.score === 100
          ? 'מדגם מספיק'
          : tier.score === 70
            ? 'מדגם בינוני'
            : tier.score === 40
              ? 'מדגם קטן'
              : 'מדגם זעיר';
      return {
        score: tier.score,
        reason: `הוצאה $${spend.toFixed(0)} CAD — ${tag} → ${tier.score}/100`,
      };
    }
  }
  return { score: 0, reason: `הוצאה $${spend.toFixed(0)} — אין מדגם` };
}

function scoreTrajectory(analysis: CpmRoasAnalysis | undefined): {
  score: number;
  reason: string;
} {
  if (!analysis || !analysis.hasData) {
    return {
      score: 60,
      reason: 'אין מספיק היסטוריה ל-CPM trend (פחות מ-5 ימים) — ציון נייטרלי',
    };
  }
  switch (analysis.tone) {
    case 'positive':
      return { score: 100, reason: `מומנטום חיובי: ${analysis.text}` };
    case 'neutral':
      return { score: 60, reason: `מומנטום נייטרלי: ${analysis.text}` };
    case 'warning':
      return { score: 40, reason: `אזהרה במגמה: ${analysis.text}` };
    case 'negative':
      return { score: 0, reason: `מומנטום שלילי: ${analysis.text}` };
  }
}

function scoreAttributionClarity(info: TrueRevenueInfo | undefined): {
  score: number;
  reason: string;
} {
  // 2026-06-09 (Problem A): when an analyzeAttribution verdict exists, this
  // component MUST equal it — it is the same "attribution certainty" the
  // drawer's Attribution panel shows. The old neutral-50 "כנראה Google או שלא
  // נסרק" fallback fired for every unmapped Google campaign (info undefined)
  // and was both a 50-vs-30 conflict with the panel AND a stale claim (Google
  // IS analyzed at campaign grain since T0 2026-06-02). The verdict now flows
  // in via buildUnmappedAttributionInfo, so the real branches below fire.
  if (!info || !info.attribution) {
    // Genuinely no analysis (non-ad platform / empty orders pipeline) — a true
    // neutral, with no platform blame.
    return {
      score: 50,
      reason: 'attribution לא חושב לקמפיין זה — ציון נייטרלי',
    };
  }
  const trust = info.attribution.trust;
  if (trust.level === 'unknown') {
    // Reconciled with the Attribution panel's verdict — use the verdict's OWN
    // score, not a hardcoded 30, so the panel and the health drilldown agree.
    //
    // 2026-06-11 adversarial review: there are THREE 'unknown' verdicts, not
    // two — 'אין המרות' (score 0), 'לא ניתן לקבוע' (30), 'הפלטפורמה מדווחת 0'
    // (40). The raw passthrough silently re-scored zero-conversion campaigns
    // 30→0 — recreating the exact "false 0/100 untrusted badge on every
    // zero-conversion campaign" the verdict's own design note exists to
    // prevent — so the passthrough floors at the neutral 30. The reason copy
    // is also per-verdict-neutral now: the old 'לא ניתן לאמת דרך click-id'
    // claim was FALSE for the 40-verdict, where click-id IS the verified side
    // (it's the PLATFORM's reporting that's broken). Platform-neutral copy —
    // the actionable tagging hint lives in the panel's recommendation.
    const score = Math.max(30, Math.round(trust.score));
    return {
      score,
      reason: `${trust.label} (${score}/100) — ודאות החלוקה מוגבלת`,
    };
  }
  // P1-9c (audit 2026-06-10): under the evidence floor (< 3 tagged orders AND
  // < 20% coverage) the click-id sample is too thin to JUDGE clarity — a
  // 1-order 7%-coverage 'low' read must not score BELOW the zero-evidence
  // 'unknown' verdict's 30 (partial evidence would otherwise be punished
  // below zero evidence). Floor at 30 with honest "sample too small" copy.
  if (
    trust.level === 'low' &&
    trust.score < 30 &&
    !deterministicEvidenceFloorMet(info.attribution)
  ) {
    return {
      score: 30,
      reason: `מדגם click-id קטן מדי לשפוט (${info.attribution.deterministicOrders} הזמנות, ${Math.round(info.attribution.coverage * 100)}% coverage) — ציון רצפת אי-ודאות`,
    };
  }
  return {
    score: Math.round(trust.score),
    reason: `${trust.label} (${trust.score.toFixed(0)}/100 click-ID coverage)`,
  };
}

function gradeFor(score: number): Exclude<HealthGrade, 'unknown'> {
  for (const tier of GRADE_LADDER) {
    if (score >= tier.min) return tier.grade;
  }
  return 'F';
}

// ─────────────────────────────────────────────────────────────────────────
// Insufficient-data gate
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the campaign hasn't accumulated enough data to be
 * scored reliably — early lifecycle or minimal spend.
 *
 * Rationale: a brand-new campaign with $80 spent and zero conversions
 * would otherwise score F (low ROAS + low volume + low attribution). That
 * grade pushes the operator toward pausing, but the right action is "wait
 * a few more days." The UI surfaces this as ⏳ Early rather than F.
 */
function isInsufficient(aggregated: Aggregated): boolean {
  // Hard floor: very tiny spend always insufficient.
  if (aggregated.spend < 30) return true;
  // Low spend + no conversions = still in learning phase.
  if (aggregated.spend < 100 && aggregated.conversions === 0) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

export function computeCampaignHealth(inputs: HealthScoreInputs): CampaignHealth {
  const { aggregated, trueRevenueInfo, cpmRoasAnalysis } = inputs;

  if (isInsufficient(aggregated)) {
    return {
      score: 0,
      grade: 'unknown',
      components: {
        profitability: 0,
        volume: 0,
        trajectory: 0,
        attributionClarity: 0,
        cohortAdjustment: 0,
      },
      reasons: [
        `הוצאה ${fmtMoneyString(aggregated.spend)} ${
          aggregated.conversions === 0 ? '+ 0 המרות' : ''
        } — מדגם קטן מדי לציון אמין. חכה שיצטברו נתונים.`,
      ],
      insufficient: true,
    };
  }

  const profitability = scoreProfitability(aggregated, trueRevenueInfo);
  const volume = scoreVolume(aggregated.spend);
  const trajectory = scoreTrajectory(cpmRoasAnalysis);
  const attribution = scoreAttributionClarity(trueRevenueInfo);

  // Audit fix 2026-05-23 (HR-03) — renormalize weights when trajectory has
  // no data. Kept as-is.
  const hasTrajectoryData = !!(cpmRoasAnalysis && cpmRoasAnalysis.hasData);
  let weightedSubtotal: number;
  if (hasTrajectoryData) {
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability +
      volume.score * WEIGHTS.volume +
      trajectory.score * WEIGHTS.trajectory +
      attribution.score * WEIGHTS.attributionClarity;
  } else {
    const knownWeightSum =
      WEIGHTS.profitability + WEIGHTS.volume + WEIGHTS.attributionClarity;
    const scaleFactor = 1.0 / knownWeightSum;
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability * scaleFactor +
      volume.score * WEIGHTS.volume * scaleFactor +
      attribution.score * WEIGHTS.attributionClarity * scaleFactor;
  }

  // Phase 14 (2026-05-28) — operator flags (optimized / isCurrentlyOff)
  // no longer affect the score. They survive as row badges. Score = pure
  // weighted sum of data-derived components; cohort adjustment may still
  // apply downstream of this function via applyCohortAdjustmentOnce.
  const finalScore = Math.round(Math.max(0, Math.min(100, weightedSubtotal)));

  return {
    score: finalScore,
    grade: gradeFor(finalScore),
    components: {
      profitability: profitability.score,
      volume: volume.score,
      trajectory: trajectory.score,
      attributionClarity: attribution.score,
      cohortAdjustment: 0,
    },
    reasons: [profitability.reason, volume.reason, trajectory.reason, attribution.reason],
    insufficient: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 05.7.x (2026-05-23) — Cohort-aware adjustment.
//
// Applied AFTER computeCampaignHealth, as a separate function so the
// base scorer stays pure-per-campaign (the existing 39 tests don't
// regress) and the cohort logic is a clean opt-in for callers that
// have computed cohort + cannibalization info.
//
// Adjustments stack additively (capped at the [0, 100] clamp):
//
//   isLeader (rank 1 in cohort AND has highest-tier spend):  +3
//     Slight nudge to "yes, you ARE the natural scale candidate".
//
//   isWeakest (rank N of N, when N >= 3):                    −5
//     Real signal: you're losing the share war. Investigate or pause.
//     N >= 3 floor prevents penalizing the loser of a 2-cohort just
//     because someone had to be lower.
//
//   cannibalizationRisk:
//     high:    −10  (a shared product is showing diminishing returns —
//                    you shouldn't be scaled further; cohort is saturated)
//     medium:  −5
//     low:     −2
//     none / insufficient: 0
//
// Maximum cumulative negative: −15 (weakest + high cannibalization).
// Maximum cumulative positive: +3 (leader, no cannibalization).
// ─────────────────────────────────────────────────────────────────────────

export type CohortAdjustmentInputs = {
  isLeader: boolean;
  isWeakest: boolean;
  cohortSize: number; // total members incl. current; >=2 means cohort exists
  /**
   * Highest cannibalization risk across this campaign's shared products.
   *
   * Audit fix 2026-05-23 (a/WARN-6): `composition_changed` added to the
   * union to match `CannibalizationRisk` in cannibalizationDetection.ts.
   * It's an INFORMATIONAL verdict, not a score penalty: when the cohort's
   * composition shifted inside the visible range (a material member
   * paused/launched mid-range), the half-over-half scale-vs-revenue
   * comparison is unfair, so we abstain from a low/medium/high judgment.
   * The switch in `applyCohortAdjustmentOnce` deliberately lets it
   * fall through `default` → zero delta → no health adjustment fires.
   * The UI surfaces the verdict to the operator separately so they know
   * to investigate before scaling.
   */
  cannibalizationRisk: 'none' | 'low' | 'medium' | 'high' | 'insufficient' | 'composition_changed';
};

/**
 * Apply the cohort-aware adjustment to a base CampaignHealth result.
 *
 * Audit fix 2026-05-24 (U-06): renamed from `applyCohortHealthAdjustment`
 * → `applyCohortAdjustmentOnce` to communicate the once-only contract.
 * The function OVERWRITES `base.components.cohortAdjustment` (it doesn't
 * accumulate), so calling it twice on the same base would silently
 * replace the first delta with the second — a subtle double-apply bug
 * waiting to happen the moment a caller composes two cohort signals.
 *
 * The runtime assert at the top of the function makes the contract
 * loud: if a caller passes a base that ALREADY carries a non-zero
 * cohortAdjustment, we throw instead of silently overwriting it. A
 * caller that genuinely needs to re-derive the adjustment must first
 * reset `base.components.cohortAdjustment = 0`, which makes the intent
 * explicit at the call site.
 *
 * No backward-compat alias is exported: callers that referenced the
 * old name now get a clean ReferenceError at build-time. This is
 * intentional — a silent re-export would let the double-apply bug
 * survive the rename.
 */
export function applyCohortAdjustmentOnce(
  base: CampaignHealth,
  inputs: CohortAdjustmentInputs,
): CampaignHealth {
  // U-06 runtime guard. The function overwrites cohortAdjustment, so
  // calling it twice on the same result would silently drop the first
  // adjustment. Fail loud at the second call instead. (Solo / insufficient
  // short-circuits below run AFTER the assert because a base that
  // shouldn't be touched still shouldn't carry a stale cohort delta.)
  if (base.components.cohortAdjustment !== 0) {
    throw new Error(
      'applyCohortAdjustmentOnce: base already has a non-zero ' +
        `components.cohortAdjustment (${base.components.cohortAdjustment}). ` +
        'Calling the function twice would overwrite the first delta. ' +
        'Reset base.components.cohortAdjustment to 0 if you genuinely ' +
        'need to re-derive (audit U-06, 2026-05-24).',
    );
  }

  // Unknown-grade campaigns aren't touched — they need data, not cohort
  // context. Same for solo campaigns.
  if (base.insufficient) return base;
  if (inputs.cohortSize < 2) return base;

  let delta = 0;
  const reasons: string[] = [];

  if (inputs.isLeader) {
    delta += 3;
    reasons.push(`+3 — אתה הקמפיין החזק בקבוצת המיפוי (${inputs.cohortSize} חברים).`);
  }
  if (inputs.isWeakest && inputs.cohortSize >= 3) {
    delta -= 5;
    reasons.push(`−5 — אתה הקמפיין החלש בקבוצת המיפוי (${inputs.cohortSize} חברים). מומלץ לבחון רענון או הפסקה.`);
  }
  switch (inputs.cannibalizationRisk) {
    case 'high':
      delta -= 10;
      reasons.push('−10 — מוצר משותף מציג קניבליזציה גבוהה (הוצאה גדלה, ההכנסה לא). לא לסקייל.');
      break;
    case 'medium':
      delta -= 5;
      reasons.push('−5 — מוצר משותף מציג סימני קניבליזציה בינוניים.');
      break;
    case 'low':
      delta -= 2;
      reasons.push('−2 — מוצר משותף מציג סימן מוקדם של תשואה הולכת ופוחתת.');
      break;
    default:
      break;
  }

  if (delta === 0) return base;

  const adjustedScore = Math.round(Math.max(0, Math.min(100, base.score + delta)));
  return {
    ...base,
    score: adjustedScore,
    grade: gradeFor(adjustedScore),
    components: {
      ...base.components,
      cohortAdjustment: delta,
    },
    reasons: [...base.reasons, ...reasons],
  };
}
