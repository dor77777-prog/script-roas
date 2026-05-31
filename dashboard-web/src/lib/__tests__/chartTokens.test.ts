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

/** Extract the hue (3rd OKLCH component) from a `--var: oklch(L% C H ...)` decl.
 *  Accepts both whitespace and comma separators between components — CSS
 *  allows both forms and Prettier may reformat one into the other. */
function hueOf(varName: string, block: string): number {
  const re = new RegExp(
    `(?<![\\w-])${varName}\\s*:\\s*oklch\\(\\s*[\\d.]+%[\\s,]+[\\d.]+[\\s,]+([\\d.]+)`,
  );
  const m = block.match(re);
  if (!m) throw new Error(`could not parse hue for ${varName}`);
  return parseFloat(m[1]);
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
    // Plan-locked values yield a 10° hue gap (TikTok 12° vs band-red 22°),
    // which the plan's Task 1.10 collision memo declared sufficient given
    // the additional L (72 vs 64) and C (0.24 vs 0.22) separation. Test
    // floor pinned at 10° so any future hue shift that *narrows* the gap
    // breaks CI.
    const tiktokHue = hueOf('--chart-platform-tiktok', root);
    const bandRedHue = hueOf('--band-red', root);
    // Circular hue distance on a 360° wheel.
    const raw = Math.abs(tiktokHue - bandRedHue);
    const dist = Math.min(raw, 360 - raw);
    expect(
      dist,
      `TikTok hue ${tiktokHue}° vs band-red ${bandRedHue}° = ${dist}° gap (need ≥10°)`,
    ).toBeGreaterThanOrEqual(10);
  });
});
