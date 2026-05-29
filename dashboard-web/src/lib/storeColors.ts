/**
 * Canonical per-store color palette — single source of truth.
 *
 * Stores route through theme-aware CSS vars defined in globals.css
 * (--chart-store-uzoshop / --chart-store-zolplus / --chart-store-usmile).
 * Light defaults pin to bright Tailwind palette hexes; dark overrides
 * land at OKLCH L ~72-78% so lines stay legible against the dark canvas.
 *
 * The three store hues — cyan / hot pink / lime — sit outside every
 * platform color (Meta blue, Google amber, TikTok red, Organic purple,
 * Shopify green) so a chart that overlays per-store lines on top of
 * per-platform lines never reads as one channel echoing another.
 *
 * Fallback palette for unknown stores stays as hex literals — unknown-store
 * lookup is an edge case (only triggers if a 4th store is added) and
 * doesn't justify a dark-mode override path.
 */

export const STORE_COLORS: Record<string, string> = {
  uzoshop:    'var(--chart-store-uzoshop)', // cyan (light) / bright cyan (dark)
  'Zol Plus': 'var(--chart-store-zolplus)', // hot pink (light) / bright pink (dark)
  '360usmile':'var(--chart-store-usmile)',  // lime (light) / bright lime (dark)
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
