/**
 * Canonical per-store color palette — single source of truth.
 *
 * Task 1.11 (UI/UX overhaul 2026-05-30): consolidated from 4 previous sources
 * (storeColors.STORE_COLORS, format.STORE_HUES, format.STORE_HEX_LIGHT,
 * format.storeColor/storeBg). All store-color routing now flows through this
 * module. Tokens live in app/globals.css as --store-uzo / --store-usm /
 * --store-3 (defined per Task 1.1), with dark-mode overrides hoisted by the
 * same token block so charts stay legible against the dark canvas.
 *
 * The three store hues sit outside every platform color (Meta blue, Google
 * amber, TikTok red, Organic purple, Shopify green) so a chart that overlays
 * per-store lines on top of per-platform lines never reads as one channel
 * echoing another.
 *
 * Fallback palette for unknown stores stays as hex literals — unknown-store
 * lookup is an edge case (only triggers if a 4th store is added) and doesn't
 * justify a dark-mode override path.
 */

/**
 * Display-name → CSS-var map. Keys are the values that flow through
 * DailyRow.storeName / StoreAgg.store (display names, NOT internal store IDs).
 *
 * Internal storeId → display name:
 *   uzoshop    → 'uzoshop'    → var(--store-uzo)
 *   zolplus    → 'Zol Plus'   → var(--store-3)
 *   usmile360  → '360usmile'  → var(--store-usm)
 */
export const STORE_COLORS: Record<string, string> = {
  uzoshop:    'var(--store-uzo)', // cyan (light) / bright cyan (dark)
  'Zol Plus': 'var(--store-3)',   // lime — "store 3" slot
  '360usmile':'var(--store-usm)', // magenta (light) / bright magenta (dark)
};

const FALLBACK_PALETTE = [
  '#a855f7', // violet
  '#dc2626', // red
  '#16a34a', // green
  '#0ea5e9', // sky
  '#f59e0b', // yellow
];

/**
 * Return the canonical color for a store.
 *
 * Resolution order (Self-serve stores Phase 6a):
 *   1. `brandColor` — the operator-chosen `stores.brand_color` token, when
 *      present + non-empty. A self-serve (4th+) store renders in ITS chosen
 *      color instead of an arbitrary FALLBACK_PALETTE slot.
 *   2. `STORE_COLORS[name]` — the name-keyed canonical token for the known 3.
 *   3. `FALLBACK_PALETTE[idx]` — deterministic per-index hex for an unknown
 *      store that has no brandColor (never crashes).
 *
 * ZERO-REGRESSION: Phase 1 backfilled `stores.brand_color` for the 3 existing
 * stores to EXACTLY their `STORE_COLORS[name]` token (uzoshop→var(--store-uzo),
 * Zol Plus→var(--store-3), 360usmile→var(--store-usm); see migration
 * 20260606170000 + getStores HARDCODED). So preferring brandColor for the 3 is
 * byte-identical to the name-keyed path — their rendered colors do not change.
 *
 * brandColor is a CSS-var token (theme-aware, dark-mode-overridable), NOT a raw
 * hex — so the dark-mode override cascade + chart-ink legibility handling all
 * still apply. (The operator UI restricts the picker to the `--store-*` token
 * palette; this resolver passes whatever token the row carries straight
 * through.)
 *
 * @param name        Store name as it appears in DailyRow.storeName
 * @param idx         Optional ordinal index of the store in the list (fallback)
 * @param brandColor  Optional `stores.brand_color` token — wins when non-empty
 */
export function storeColor(
  name: string,
  idx = 0,
  brandColor?: string | null,
): string {
  if (typeof brandColor === 'string' && brandColor.trim() !== '') {
    return brandColor;
  }
  return STORE_COLORS[name] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
}

/**
 * Build a `key → brandColor` lookup from the store list, keyed by BOTH the
 * internal storeId AND the display storeName, so a render site holding either
 * identifier can resolve the operator-chosen `stores.brand_color` token
 * (Self-serve stores Phase 6a). Empty/whitespace brand colors are skipped so a
 * lookup miss falls cleanly through to the name-keyed palette.
 *
 * Typed loosely (`{ storeId; storeName; brandColor }`) so callers can pass the
 * full `StoreInfo[]` without this module importing the type (keeps storeColors
 * dependency-free / unit-testable in isolation).
 */
export function buildStoreBrandColorMap(
  stores: ReadonlyArray<{ storeId: string; storeName: string; brandColor: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of stores) {
    if (typeof s.brandColor === 'string' && s.brandColor.trim() !== '') {
      map[s.storeId] = s.brandColor;
      map[s.storeName] = s.brandColor;
    }
  }
  return map;
}

/**
 * Return badge styles (background + foreground) for a store chip.
 *
 * Both layers are derived from the same `--store-*` token: the foreground
 * uses the raw token, the background uses `color-mix()` to tint the canvas
 * at 16% opacity — same CSS-var feeds both so dark-mode overrides cascade
 * automatically without a second lookup.
 *
 * Returns ready-to-use inline-style values (not Tailwind classes) so
 * consumers can spread the result into `style={...}` without needing to
 * thread a className-driven token through.
 *
 * `brandColor` (optional) takes precedence over the name-keyed token — same
 * resolution as `storeColor()` (Self-serve stores Phase 6a).
 */
export function storeBadge(
  name: string,
  idx = 0,
  brandColor?: string | null,
): { bg: string; fg: string } {
  // Same brandColor → name-key → fallback resolution as storeColor(); the bg is
  // always a color-mix of whichever fg won, so the badge tint stays in sync with
  // the chosen color in both modes (Self-serve stores Phase 6a).
  const fg = storeColor(name, idx, brandColor);
  // color-mix keeps the badge bg in sync with the same token in both modes.
  // For unknown-store hex fallbacks, color-mix still works (hex is a valid
  // input to color-mix in srgb space).
  const bg = `color-mix(in oklch, ${fg} 16%, transparent)`;
  return { bg, fg };
}
