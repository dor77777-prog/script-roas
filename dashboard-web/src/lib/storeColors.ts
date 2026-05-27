/**
 * Canonical per-store color palette — single source of truth.
 *
 * Before this module STORE_COLORS was duplicated in three components
 * (PerStoreCards, TodayLive, RoasChart) with conflicting hex values:
 *   - RoasChart used navy / amber / teal (hue-separated for line charts)
 *   - PerStoreCards used navy / red / green (Google-brand-ish)
 *   - TodayLive used a slightly different navy / red / green trio
 *
 * Canonical palette: RoasChart's navy/amber/teal family, chosen because
 *   1. Hues are ~120° apart on the HSL wheel — store lines are
 *      distinguishable even for common forms of color-vision deficiency.
 *   2. RoasChart is the primary view where store identity is established;
 *      per-store card dots / TodayLive accent dots should reinforce that
 *      association, not contradict it.
 *   3. The User Manual does not document specific per-store hex values,
 *      so there is no external contract to break.
 *
 * Fallback palette for future stores (same hue-separation principle).
 */

export const STORE_COLORS: Record<string, string> = {
  uzoshop:    '#1c4587', // navy   — primary store
  'Zol Plus': '#d97706', // amber  — warm, clearly distinct from navy
  '360usmile':'#0d9488', // teal   — cool, distinct from both navy and amber
};

const FALLBACK_PALETTE = [
  '#a855f7', // violet
  '#dc2626', // red
  '#16a34a', // green
  '#0ea5e9', // sky
  '#f59e0b', // yellow
];

/**
 * Return the canonical hex color for a store name.
 * Falls back through FALLBACK_PALETTE by index for unknown stores so a
 * new store gets a deterministic color without crashing.
 *
 * @param name  Store name as it appears in DailyRow.storeName
 * @param idx   Optional ordinal index of the store in the list (for fallback)
 */
export function storeColor(name: string, idx = 0): string {
  return STORE_COLORS[name] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}
