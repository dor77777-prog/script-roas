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
 * Return the canonical color for a store name.
 * Falls back through FALLBACK_PALETTE by index for unknown stores so a
 * new store gets a deterministic color without crashing.
 *
 * @param name  Store name as it appears in DailyRow.storeName
 * @param idx   Optional ordinal index of the store in the list (for fallback)
 */
export function storeColor(name: string, idx = 0): string {
  return STORE_COLORS[name] ?? FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
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
 */
export function storeBadge(name: string, idx = 0): { bg: string; fg: string } {
  const fg = storeColor(name, idx);
  // color-mix keeps the badge bg in sync with the same token in both modes.
  // For unknown-store hex fallbacks, color-mix still works (hex is a valid
  // input to color-mix in srgb space).
  const bg = `color-mix(in oklch, ${fg} 16%, transparent)`;
  return { bg, fg };
}
