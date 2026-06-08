/**
 * sourceLabels.ts — classify-v2 single source of truth for the Hebrew
 * vocabulary that describes an order/event `source` (and `first_touch_source`).
 *
 * Two consumers share this module so the badge in the activity feed and the
 * "תנועה לפי מקור" table in the AI report can never drift to a different set of
 * Hebrew words:
 *
 *   1. `SOURCE_LABEL` — the FLAT report-facing label map. `aiReport.ts` renders
 *      each table cell via this map (T2). Kept verbatim so the report reads the
 *      same as before; pinned by `aiReportSourceLabels.test.ts`.
 *   2. `describeSource()` — STRUCTURED platform + paid/organic decomposition the
 *      <SourceBadge> uses to render "ממומן · מטא" / "אורגני · מטא" etc. with a
 *      paid-vs-organic VISUAL distinction. Its label is composed from the SAME
 *      atoms (`PLATFORM_HE`, `KIND_HE`) the report's vocabulary uses, so the two
 *      surfaces agree by construction (one vocabulary, two presentations).
 *
 * DISPLAY-only. None of these labels feeds any ROAS / paid-spend math — the
 * paid/organic split here mirrors the classifier's label, it does not assert
 * spend.
 */

import type { OrderSource } from '@/lib/ordersAttribution';

/** Ad-platform Hebrew names (the atom shared by badge + report). */
export const PLATFORM_HE = {
  meta: 'מטא',
  google: 'גוגל',
  tiktok: 'טיקטוק',
} as const;

export type SourcePlatform = keyof typeof PLATFORM_HE;

/** Paid / organic qualifier Hebrew words (the textual carrier of the split). */
export const KIND_HE = {
  paid: 'ממומן',
  organic: 'אורגני',
} as const;

export type SourceKind = keyof typeof KIND_HE;

/**
 * FLAT report-facing label map (T2). The keys cover every `OrderSource` value
 * the classifier emits. `aiReport.ts` reads this; the labels are pinned by
 * aiReportSourceLabels.test.ts and intentionally preserve the report's existing
 * wording ('Meta (paid)' etc.) so the report does not visually churn.
 */
export const SOURCE_LABEL: Record<Exclude<OrderSource, ''>, string> = {
  'meta-paid': 'Meta (paid)',
  'google-paid': 'Google (paid)',
  'tiktok-paid': 'TikTok (paid)',
  'meta-organic': 'Meta (organic)',
  'google-organic': 'Google (organic)',
  'tiktok-organic': 'טיקטוק אורגני',
  'search-organic': 'חיפוש אורגני',
  'app-referral': 'הפניה מאפליקציה',
  email: 'אימייל',
  'other-paid': 'אחר (paid)',
  'other-referral': 'הפניה (לא מסווגת)',
  direct: 'ישיר (no UTM)',
};

/**
 * Structured description of a `source` for the badge:
 *  - `platform`  — the ad platform when the source is platform-attributed.
 *  - `kind`      — 'paid' | 'organic' when the source carries that split.
 *  - `label`     — the COMPACT badge label. Platform sources compose to
 *                  "ממומן · מטא" / "אורגני · גוגל" (qualifier · platform); the
 *                  non-platform sources get a distinct standalone Hebrew chip
 *                  ("אימייל" / "הפניה" / "חיפוש אורגני" / "הפניה מאפליקציה" /
 *                  "ממומן · אחר" / "ישיר"). Returns `null` for null/'' so the
 *                  caller renders nothing (refunds / unknown).
 *  - `tone`      — render hint: 'platform' (use the brand chip) or 'neutral' /
 *                  'muted' for the non-platform / direct chips.
 */
export interface SourceDescription {
  platform: SourcePlatform | null;
  kind: SourceKind | null;
  label: string;
  tone: 'platform' | 'neutral' | 'muted';
}

const PLATFORM_PREFIX: Record<SourcePlatform, string> = {
  meta: 'meta',
  google: 'google',
  tiktok: 'tiktok',
};

/** Find the platform prefix of a source ('meta-paid' → 'meta'), else null. */
function platformOf(source: string): SourcePlatform | null {
  for (const p of Object.keys(PLATFORM_PREFIX) as SourcePlatform[]) {
    if (source.startsWith(`${p}-`)) return p;
  }
  return null;
}

/**
 * Describe a `source` for the badge. One vocabulary: platform sources compose
 * "{ממומן|אורגני} · {platform}" from PLATFORM_HE + KIND_HE; standalone sources
 * map to their distinct Hebrew chip. Null/'' → null (caller renders nothing).
 */
export function describeSource(source: string | null | undefined): SourceDescription | null {
  if (!source) return null;

  const platform = platformOf(source);
  if (platform) {
    const kind: SourceKind = source.endsWith('-organic') ? 'organic' : 'paid';
    return {
      platform,
      kind,
      label: `${KIND_HE[kind]} · ${PLATFORM_HE[platform]}`,
      tone: 'platform',
    };
  }

  switch (source) {
    case 'email':
      return { platform: null, kind: null, label: 'אימייל', tone: 'neutral' };
    case 'other-paid':
      return { platform: null, kind: 'paid', label: `${KIND_HE.paid} · אחר`, tone: 'neutral' };
    case 'other-referral':
      return { platform: null, kind: null, label: 'הפניה', tone: 'neutral' };
    case 'search-organic':
      return { platform: null, kind: 'organic', label: 'חיפוש אורגני', tone: 'neutral' };
    case 'app-referral':
      return { platform: null, kind: null, label: 'הפניה מאפליקציה', tone: 'neutral' };
    case 'direct':
      return { platform: null, kind: null, label: 'ישיר', tone: 'muted' };
    default:
      // Unknown / future label — survive rather than disappear (mirrors the
      // permissive parseSource philosophy). Show the raw string in a muted chip.
      return { platform: null, kind: null, label: source, tone: 'muted' };
  }
}

/**
 * Platform/channel BUCKET — the coarse grouping the activity-stats donuts +
 * per-product table use (one source of truth so every surface buckets a
 * `source` identically). Mapping:
 *   meta-paid    | meta-organic                       → 'meta'
 *   google-paid  | google-organic                     → 'google'
 *   tiktok-paid  | tiktok-organic                     → 'tiktok'
 *   email                                             → 'email'
 *   other-referral | app-referral | search-organic    → 'referral'
 *   other-paid                                        → 'other-paid'
 *   direct | ''  | anything unrecognised              → 'direct'
 *
 * EXHAUSTIVE by construction: every input maps to exactly one bucket, so the
 * per-bucket counts always sum to the row total (no order silently dropped).
 */
export type SourceBucket =
  | 'meta'
  | 'google'
  | 'tiktok'
  | 'email'
  | 'referral'
  | 'other-paid'
  | 'direct';

/** Stable bucket order for distribution rendering (donut legend). */
export const SOURCE_BUCKETS = [
  'meta',
  'google',
  'tiktok',
  'email',
  'referral',
  'other-paid',
  'direct',
] as const satisfies readonly SourceBucket[];

/** Hebrew label for each bucket (matches the activity-stats mockup legend). */
export const SOURCE_BUCKET_LABEL: Record<SourceBucket, string> = {
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
  email: 'אימייל',
  referral: 'הפניות',
  'other-paid': 'ממומן אחר',
  direct: 'ישיר',
};

/**
 * Map any `source` value to its coarse platform/channel bucket. Single source
 * of truth shared by the activity-stats donuts + per-product table. Unknown /
 * '' / null collapse into 'direct' so the mapping is total (sum == row total).
 */
export function sourceToBucket(source: string | null | undefined): SourceBucket {
  const s = String(source ?? '').trim();
  if (s.startsWith('meta-')) return 'meta';
  if (s.startsWith('google-')) return 'google';
  if (s.startsWith('tiktok-')) return 'tiktok';
  if (s === 'email') return 'email';
  if (s === 'other-referral' || s === 'app-referral' || s === 'search-organic') return 'referral';
  if (s === 'other-paid') return 'other-paid';
  // 'direct', '', and any unrecognised future label → the catch-all bucket.
  return 'direct';
}

/**
 * Paid vs organic split used by the activity-stats donut. PAID = any source
 * whose label ends in '-paid' (meta/google/tiktok/other-paid). ORGANIC =
 * everything else (direct / email / referral / *-organic / unknown). Mirrors
 * the classifier's label — DISPLAY only, asserts no spend.
 */
export function sourceIsPaid(source: string | null | undefined): boolean {
  return String(source ?? '').trim().endsWith('-paid');
}

/**
 * Whether a last-touch `source` is WEAK enough that the first-click lens is
 * worth showing alongside it: direct / other-referral / other-paid. A confident
 * platform/organic attribution does not need the lens (it would be redundant).
 */
export function isWeakSource(source: string | null | undefined): boolean {
  return source === 'direct' || source === 'other-referral' || source === 'other-paid';
}

/**
 * First-click lens label for a `firstTouchSource` that carries a platform value:
 * "מטא" / "גוגל" / "טיקטוק". Returns null when the first-touch source has no
 * platform (so the lens is suppressed — it only adds signal when first-click is
 * a real platform).
 */
export function firstClickPlatformLabel(
  firstTouchSource: string | null | undefined,
): string | null {
  if (!firstTouchSource) return null;
  const platform = platformOf(firstTouchSource);
  return platform ? PLATFORM_HE[platform] : null;
}
