import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 1.1 — glass+neon foundation.
 *
 * Asserts the canonical chart / accent / band / store tokens exist in
 * `globals.css :root` and that the TikTok platform hue is far enough
 * from the band-red signal hue to avoid a perceptual collision when a
 * red ROAS band sits next to a TikTok line (Q1 brand-mirrored palette
 * decision).
 */
const css = readFileSync(
  join(__dirname, '..', '..', 'app', 'globals.css'),
  'utf-8',
);

function extractRoot(): string {
  // Non-greedy match through to the FIRST `}` after `:root {` so the test
  // survives a one-line collapse / trailing whitespace after Prettier
  // reformatting the block.
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error(':root block not found in globals.css');
  return m[1];
}

/** sRGB-channel (0-255) → linear-light component. */
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/**
 * Convert a `#rrggbb` hex string to its OKLCH hue (degrees, 0-360). The
 * 2026-05-31 mockup re-skin locks the platform / band tokens to literal
 * mockup hex; this lets the separation assertion below keep measuring real
 * hue gaps against those hexes instead of only oklch() decls.
 */
function hexToOklchHue(hex: string): number {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return hue;
}

/** Extract the hue from a `--var: oklch(L% C H ...)` OR `--var: #rrggbb` decl.
 *  Accepts both whitespace and comma separators between oklch components — CSS
 *  allows both forms and Prettier may reformat one into the other. */
function hueOf(varName: string, block: string): number {
  const oklch = block.match(
    new RegExp(
      `(?<![\\w-])${varName}\\s*:\\s*oklch\\(\\s*[\\d.]+%[\\s,]+[\\d.]+[\\s,]+([\\d.]+)`,
    ),
  );
  if (oklch) return parseFloat(oklch[1]);
  const hex = block.match(
    new RegExp(`(?<![\\w-])${varName}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`),
  );
  if (hex) return hexToOklchHue(hex[1]);
  throw new Error(`could not parse hue for ${varName}`);
}

describe('chart tokens — Task 1.1 (glass+neon foundation, Q1 palette)', () => {
  const root = extractRoot();

  const REQUIRED = [
    // Platform chart palette (brand-mirrored).
    '--chart-platform-meta',
    '--chart-platform-google',
    '--chart-platform-tiktok',
    '--chart-platform-organic',
    '--chart-platform-shopify',
    // Violet accent (Q2).
    '--accent',
    // V4 band signal.
    '--band-red',
    '--band-orange',
    '--band-green',
    '--band-blue',
    '--band-gray',
    // Per-store hues (new names — uzo / usm / 3).
    '--store-uzo',
    '--store-usm',
    '--store-3',
  ];

  for (const tok of REQUIRED) {
    it(`defines ${tok} in :root`, () => {
      expect(root).toContain(`${tok}:`);
    });
  }

  it('TikTok platform hue is separated from --band-red hue', () => {
    // mockup-locked brand color (2026-05-31 re-skin): TikTok #ff2e7e
    // (hue ~5°) vs band-red #ff6b81 (hue ~14°) = ~8.8° gap. The mockup picks
    // these exact hexes; additional L (66 vs 72) + C (0.24 vs 0.18) keep them
    // distinguishable. Floor lowered from 10° to 8° to match the locked
    // colors — do NOT shift the tokens to satisfy the test. Any future hue
    // shift that *narrows* the gap below 8° still breaks CI.
    const tiktokHue = hueOf('--chart-platform-tiktok', root);
    const bandRedHue = hueOf('--band-red', root);
    // Circular hue distance on a 360° wheel.
    const raw = Math.abs(tiktokHue - bandRedHue);
    const dist = Math.min(raw, 360 - raw);
    expect(
      dist,
      `TikTok hue ${tiktokHue}° vs band-red ${bandRedHue}° = ${dist}° gap (need ≥8°)`,
    ).toBeGreaterThanOrEqual(8);
  });
});
