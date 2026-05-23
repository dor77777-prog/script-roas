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
 *   - profitability:        40%   ROAS × trust modulation
 *   - volume:               15%   spend tier (sample-size weighting)
 *   - trajectory:           25%   CPM↔ROAS momentum (heavy: forward-looking)
 *   - attribution clarity:  20%   deterministic % of revenue
 *
 * Plus a separate ±adjustment applied after the weighted sum:
 *   - optimized=true:  +15  (operator vouches for it; small boost)
 *   - isCurrentlyOff:  −30  (historical numbers only; not forward-looking)
 *
 * Insufficient-data short-circuit: campaigns with spend < $30 OR
 * (spend < $100 AND conversions === 0) are flagged `insufficient` and the
 * UI renders them as ⏳ Early rather than F so the operator knows to wait
 * rather than pause prematurely.
 */

import type { Aggregated } from '@/lib/campaignsAggregator';
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { CpmRoasAnalysis } from '@/lib/cpmRoasAnalysis';

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F' | 'unknown';

export type HealthScoreComponents = {
  /** ROAS × trust modulation, 0..100. The dominant signal (45% weight). */
  profitability: number;
  /** Spend-tier score, 0..100. Small spend = small sample = lower score. */
  volume: number;
  /** CPM↔ROAS momentum, 0..100. 60 = neutral when insufficient data. */
  trajectory: number;
  /** Click-ID coverage / deterministic %, 0..100. 50 = unknown (e.g. Google). */
  attributionClarity: number;
  /** Net operator adjustment applied after the weighted sum: +15 if
   *  optimized, −30 if currently off (can stack). NOT a 0..100 score. */
  operatorAdjustment: number;
  /** Phase 05.7.x (2026-05-23) — Net cohort adjustment applied AFTER
   *  the operator adjustment by `applyCohortHealthAdjustment`. Default
   *  0 when no cohort exists or the campaign is solo on its products.
   *  Negative when the campaign is the weakest in a saturated cohort
   *  OR when a shared product shows cannibalization signals; small
   *  positive when the campaign is the dominant leader in its cohort. */
  cohortAdjustment: number;
};

export type CampaignHealth = {
  /** Final 0..100 score after weighted sum + operator adjustment + clamp. */
  score: number;
  /** Letter grade derived from `score` — easier to scan in a column. */
  grade: HealthGrade;
  /** Per-component breakdown for the drilldown popover. */
  components: HealthScoreComponents;
  /** One Hebrew sentence per component explaining WHY it scored that way.
   *  Order: profitability, volume, trajectory, attribution, operator.
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
  optimized: boolean;
  isCurrentlyOff: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Weights — sum to 1.0. Operator adjustment is applied separately.
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

  if (info && info.deterministicRevenue > 0) {
    baseRoas = info.deterministicRevenue / spend;
    trustModulator =
      info.attribution && info.attribution.trust.level !== 'unknown'
        ? info.attribution.trust.score / 100
        : 0.7;
    sourceLabel = 'Shopify דטרמיניסטי';
  } else if (info && info.trueRevenue > 0) {
    baseRoas = info.trueRevenue / spend;
    trustModulator =
      info.confidence.level === 'high'
        ? 1.0
        : info.confidence.level === 'medium'
          ? 0.7
          : 0.4;
    sourceLabel = 'Shopify משולב (מיפוי + פרופורציונלי)';
  } else {
    baseRoas = aggregated.conversionValue / spend;
    // Audit fix 2026-05-23 (HR-01): per-platform fallback trust mod
    // replaces the previous fixed 0.5 — Google's platform-claimed
    // ROAS is more reliable than Meta's, so penalizing both identically
    // was a systematic anti-Google bias (~16 points on the weighted final).
    trustModulator =
      PLATFORM_FALLBACK_TRUST[aggregated.platform] ?? DEFAULT_FALLBACK_TRUST;
    sourceLabel = `הצהרת פלטפורמה (${aggregated.platform}, לא מאומת)`;
  }

  // Audit fix 2026-05-23 (HR-02): per-platform ROAS pivot. The previous
  // single pivot at ROAS 3.0 unfairly penalized platforms with naturally
  // lower baseline (e.g., TikTok prospecting at ROAS 2.0 used to score 50;
  // now scores 100 against its own platform's "great" threshold).
  const pivot =
    PLATFORM_ROAS_PIVOT[aggregated.platform] ?? DEFAULT_ROAS_PIVOT;
  // Formula: linearly scale [1.0, pivot] → [0, 100]; clamp outside.
  const rawRoasScore = Math.max(
    0,
    Math.min(100, ((baseRoas - 1.0) / (pivot - 1.0)) * 100),
  );
  const modulated = rawRoasScore * trustModulator;
  return {
    score: Math.round(modulated),
    reason:
      `ROAS ${baseRoas.toFixed(2)} (${sourceLabel}, יעד ${pivot.toFixed(1)}) × אמינות ${Math.round(trustModulator * 100)}% ` +
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
  if (!info) {
    return {
      score: 50,
      reason: 'אין נתוני attribution (כנראה Google או שלא נסרק) — ציון נייטרלי',
    };
  }
  if (!info.attribution) {
    return {
      score: 50,
      reason: 'אין click-ID coverage (Google או pipeline לא רץ) — ציון נייטרלי',
    };
  }
  const trust = info.attribution.trust;
  if (trust.level === 'unknown') {
    return {
      score: 30,
      reason: `${trust.label} — utm_campaign כנראה לא מוגדר ב-URL Parameters`,
    };
  }
  return {
    score: Math.round(trust.score),
    reason: `${trust.label} (${trust.score.toFixed(0)}/100 click-ID coverage)`,
  };
}

function applyOperatorAdjustment(
  optimized: boolean,
  isCurrentlyOff: boolean,
): { delta: number; reasons: string[] } {
  let delta = 0;
  const reasons: string[] = [];
  if (optimized) {
    delta += 15;
    reasons.push('+15 — מסומן כאופטימיזציה פעילה (האופרטור ערב לקמפיין)');
  }
  if (isCurrentlyOff) {
    delta -= 30;
    reasons.push('−30 — קמפיין כבוי כעת (הנתונים היסטוריים בלבד)');
  }
  return { delta, reasons };
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
  const { aggregated, trueRevenueInfo, cpmRoasAnalysis, optimized, isCurrentlyOff } = inputs;

  if (isInsufficient(aggregated)) {
    return {
      score: 0,
      grade: 'unknown',
      components: {
        profitability: 0,
        volume: 0,
        trajectory: 0,
        attributionClarity: 0,
        operatorAdjustment: 0,
        cohortAdjustment: 0,
      },
      reasons: [
        `הוצאה $${aggregated.spend.toFixed(0)} CAD ${
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

  // Audit fix 2026-05-23 (HR-03 health-and-conclusions): renormalize
  // weights when trajectory has no data.
  //
  // Pre-fix: `scoreTrajectory` returned 60 (neutral) when < 5 active days,
  // and the weighted formula multiplied by WEIGHTS.trajectory = 0.25,
  // contributing +15 points to the final from a non-signal. A just-launched
  // campaign with ROAS 3 + trust 90 + 4 days of data graded A (~84) on
  // strength of week-1 ROAS alone — exactly what the trajectory component
  // was supposed to prevent.
  //
  // Post-fix: when trajectory is "no data" (hasData=false), drop its
  // contribution AND renormalize the other 3 weights so they still sum to
  // 1.0. The unknown signal contributes 0 (truly neutral) instead of +15.
  const hasTrajectoryData = !!(cpmRoasAnalysis && cpmRoasAnalysis.hasData);
  let weightedSubtotal: number;
  if (hasTrajectoryData) {
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability +
      volume.score * WEIGHTS.volume +
      trajectory.score * WEIGHTS.trajectory +
      attribution.score * WEIGHTS.attributionClarity;
  } else {
    // Renormalize the 3 known components over their own subtotal weight.
    const knownWeightSum =
      WEIGHTS.profitability + WEIGHTS.volume + WEIGHTS.attributionClarity;
    const scaleFactor = 1.0 / knownWeightSum;
    weightedSubtotal =
      profitability.score * WEIGHTS.profitability * scaleFactor +
      volume.score * WEIGHTS.volume * scaleFactor +
      attribution.score * WEIGHTS.attributionClarity * scaleFactor;
  }

  const op = applyOperatorAdjustment(optimized, isCurrentlyOff);
  const finalScore = Math.round(Math.max(0, Math.min(100, weightedSubtotal + op.delta)));

  return {
    score: finalScore,
    grade: gradeFor(finalScore),
    components: {
      profitability: profitability.score,
      volume: volume.score,
      trajectory: trajectory.score,
      attributionClarity: attribution.score,
      operatorAdjustment: op.delta,
      cohortAdjustment: 0,
    },
    reasons: [profitability.reason, volume.reason, trajectory.reason, attribution.reason, ...op.reasons],
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
  /** Highest cannibalization risk across this campaign's shared products. */
  cannibalizationRisk: 'none' | 'low' | 'medium' | 'high' | 'insufficient';
};

export function applyCohortHealthAdjustment(
  base: CampaignHealth,
  inputs: CohortAdjustmentInputs,
): CampaignHealth {
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
