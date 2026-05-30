// dashboard-web/src/lib/registries/statusClassification.ts
//
// Phase D (2026-05-30) — Single source of truth for translating registry-
// backed status fields into a UI-ready {label, tone, isOff, isBackfillUnknown}
// triple. Consumed by CampaignsTableRow (chip) and CampaignDrawerStatusSection
// (panel).
//
// Decision precedence:
//   1. regConfiguredStatus === 'BACKFILL_UNKNOWN' → flag for the
//      "טוען מ-Platform — ימולא תוך 10 דק׳" badge (does not affect off/tone).
//   2. regDeliveryStatus !== null and !== 'UNKNOWN' → use it directly
//      (DELIVERING / NOT_DELIVERING / LIMITED / PENDING_REVIEW / LEARNING /
//      REJECTED).
//   3. regEffectiveStatus !== null → classify via platform-specific rules
//      (Meta ACTIVE, Google ENABLED, TikTok TIKTOK_OFF / TIKTOK_ACTIVE_ENOUGH).
//   4. legacyEffectiveStatus → classify via the same Phase-05.7.x rules
//      (kept as fallback for the surgical Task 5 / Task 10 sequencing).
//   5. lastActiveDate heuristic — older than today − OFF_RECENCY_DAYS → off.
//
// The fallback chain (3 → 4) deliberately collapses regEffectiveStatus and
// legacyEffectiveStatus to the same classifier because they're the same
// platform-native enum.

import { TIKTOK_ACTIVE_ENOUGH, TIKTOK_OFF_STATUSES } from '@/lib/registries/tiktokStatusSets';

/** 2-day inactivity threshold for the lastActiveDate heuristic. */
export const OFF_RECENCY_DAYS = 2;

export type DeliveryTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

export type CampaignStatusInputs = {
  regDeliveryStatus: string | null;
  regEffectiveStatus: string | null;
  regConfiguredStatus: string | null;
  legacyEffectiveStatus: string | null;
  platform: string;
  lastActiveDate: string | null;
  today: string;
};

export type CampaignStatusVerdict = {
  /** Hebrew label for the chip / panel row. */
  label: string;
  /** Tone bucket — maps to tailwind via the consumer's `TONE_BG` table. */
  tone: DeliveryTone;
  /** True when the operator should treat this campaign as "currently off". */
  isOff: boolean;
  /**
   * True when configured_status is the backfill sentinel — UI should show
   * a tiny secondary chip ("טוען מ-Platform — ימולא תוך ~10 דק׳") so the
   * operator knows the platform-native value hasn't been observed yet.
   */
  isBackfillUnknown: boolean;
};

function isOffFromLegacyEffectiveStatus(
  effective: string,
  platform: string,
): boolean | null {
  const norm = effective.trim().toUpperCase();
  switch ((platform || '').toLowerCase()) {
    case 'meta':   return norm !== 'ACTIVE';
    case 'google': return norm !== 'ENABLED';
    case 'tiktok':
      if (TIKTOK_OFF_STATUSES.has(norm))    return true;
      if (TIKTOK_ACTIVE_ENOUGH.has(norm))   return false;
      return null;                                            // unknown TT enum → caller falls back
    default: return null;
  }
}

function isOffFromLastActive(lastActiveDate: string | null, today: string): boolean {
  if (!lastActiveDate) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const [yyyy, mm, dd] = today.split('-').map(Number);
  const todayMs = Date.UTC(yyyy, mm - 1, dd);
  const thresholdMs = todayMs - OFF_RECENCY_DAYS * 86_400_000;
  const threshold = new Date(thresholdMs).toISOString().slice(0, 10);
  return lastActiveDate < threshold;
}

export function classifyCampaignStatus(p: CampaignStatusInputs): CampaignStatusVerdict {
  const isBackfillUnknown = p.regConfiguredStatus === 'BACKFILL_UNKNOWN';

  // 2. Use registry delivery_status if it's resolved (i.e. not UNKNOWN/null).
  if (p.regDeliveryStatus && p.regDeliveryStatus !== 'UNKNOWN') {
    switch (p.regDeliveryStatus) {
      case 'DELIVERING':
        return { label: 'מציג',    tone: 'green',  isOff: false, isBackfillUnknown };
      case 'NOT_DELIVERING':
        return { label: 'כבוי',    tone: 'gray',   isOff: true,  isBackfillUnknown };
      case 'LIMITED':
        return { label: 'מוגבל',   tone: 'orange', isOff: false, isBackfillUnknown };
      case 'PENDING_REVIEW':
        return { label: 'בבדיקה',  tone: 'blue',   isOff: false, isBackfillUnknown };
      case 'LEARNING':
        return { label: 'בלמידה',  tone: 'blue',   isOff: false, isBackfillUnknown };
      case 'REJECTED':
        return { label: 'נדחה',    tone: 'red',    isOff: true,  isBackfillUnknown };
    }
  }

  // 3. → 4. Classify via the platform-native enum.
  const native = p.regEffectiveStatus ?? p.legacyEffectiveStatus;
  if (native) {
    const off = isOffFromLegacyEffectiveStatus(native, p.platform);
    if (off === true)  return { label: 'כבוי',  tone: 'gray',  isOff: true,  isBackfillUnknown };
    if (off === false) return { label: 'מציג',  tone: 'green', isOff: false, isBackfillUnknown };
    // off === null: unknown TT enum or unknown platform → fall through.
  }

  // 5. Heuristic.
  const heuristicOff = isOffFromLastActive(p.lastActiveDate, p.today);
  return {
    label: heuristicOff ? 'כבוי' : 'לא ידוע',
    tone:  heuristicOff ? 'gray' : 'gray',
    isOff: heuristicOff,
    isBackfillUnknown,
  };
}
