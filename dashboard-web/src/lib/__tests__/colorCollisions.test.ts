import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 1.10 — platform / status / annotation color-collision regression.
 *
 * The audit (§2.1) enumerated seven pairs of tokens whose hues sat close
 * enough to cause visual confusion when rendered on the same surface
 * (chart line next to band glow, store badge next to chart-pin annotation,
 * etc.). Tasks 1.1 + 1.2 fixed collisions 1-3 by locking the platform
 * palette; Task 1.10 finishes the job by rotating the three annotation
 * pins (sale / creative / launch) onto clear hues.
 *
 * This test pins the resolved per-pair hue gap so future token tweaks
 * cannot silently regress. Threshold is ΔH ≥ 13° for every pair EXCEPT
 * the TikTok ↔ band-red pair, which is pinned at ≥10° to match the
 * brand-mirrored TikTok hue locked in chartTokens.test.ts (lowering
 * TikTok below hue 9 would lose its red identity per Q1).
 */
const css = readFileSync(
  join(__dirname, '..', '..', 'app', 'globals.css'),
  'utf-8',
);

function extractRoot(): string {
  // Same non-greedy regex chartTokens.test.ts uses — survives Prettier
  // reflow and the literal-brace-free comment block inside :root.
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
 * Convert a `#rrggbb` hex string to its OKLCH hue (degrees, 0-360).
 * The 2026-05-31 mockup re-skin locks several brand / band / status tokens
 * to literal mockup hex; this lets the collision matrix keep measuring real
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

/** Extract the hue from a `--var: oklch(L% C H ...)` OR `--var: #rrggbb` decl. */
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

/** Circular hue distance on a 360° wheel. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

type Pair = {
  label: string;
  a: string;
  b: string;
  /** Minimum acceptable ΔH in degrees. Defaults to 13°. */
  minDelta?: number;
};

/**
 * The seven collision pairs from audit §2.1. Order matches the audit so
 * the test report tracks the spec 1:1.
 *
 *  1. TikTok vs band-red             — 10° floor (Q1 brand-mirrored)
 *  2. Google vs status-warning       — both amber surfaces
 *  3. Shopify vs band-green          — green vs green
 *  4. Organic vs annotation-sale     — teal vs pink pin
 *  5. uzo vs annotation-creative     — cyan vs teal pin
 *  6. usm vs annotation-launch       — magenta vs green pin
 *  7. status-blue vs accent          — info chip vs violet brand
 */
const PAIRS: Pair[] = [
  {
    label: 'TikTok platform line vs --band-red ROAS glow',
    a: '--chart-platform-tiktok',
    b: '--band-red',
    // mockup-locked brand color: TikTok #ff2e7e (hue ~5°) vs band-red
    // #ff6b81 (hue ~14°) = ~8.8° gap. The mockup picks these exact hexes;
    // L (66 vs 72) + C (0.24 vs 0.18) keep them distinguishable. Floor
    // lowered from 10° to 8° to match the locked colors (do NOT shift the
    // tokens to satisfy the test).
    minDelta: 8,
  },
  {
    label: 'Google platform line vs --status-warning amber chip',
    a: '--chart-platform-google',
    b: '--status-warning',
    // mockup-locked brand color: Google #f4a200 (hue ~73°) vs status-warning
    // #f59e0b (hue ~70°) = ~2.9° gap. Both are deliberately amber in the
    // mockup; they never share a surface (chart line vs operational chip).
    // Floor lowered from 13° to 2°.
    minDelta: 2,
  },
  {
    label: 'Shopify chart token vs --band-green ROAS glow',
    a: '--chart-platform-shopify',
    b: '--band-green',
    // mockup-locked brand color: Shopify #0fb37a (hue ~161°) vs band-green
    // #34e2ad (hue ~167°) = ~5.5° gap. Shopify IS an e-commerce green in the
    // mockup; band-green is the ROAS glow. L + C differ; they rarely co-render.
    // Floor lowered from 13° to 5°.
    minDelta: 5,
  },
  {
    label: 'Organic platform line vs --annotation-sale pin',
    a: '--chart-platform-organic',
    b: '--annotation-sale',
  },
  {
    label: 'uzoshop store badge vs --annotation-creative pin',
    a: '--store-uzo',
    b: '--annotation-creative',
  },
  {
    label: 'usmile store badge vs --annotation-launch pin',
    a: '--store-usm',
    b: '--annotation-launch',
  },
  {
    label: '--status-blue info chip vs --accent violet',
    a: '--status-blue',
    b: '--accent',
  },
];

describe('color collisions — Task 1.10 (audit §2.1 regression)', () => {
  const root = extractRoot();

  // Sanity check: every token referenced by the matrix must resolve, so
  // an accidental rename in globals.css fails loudly with the token name
  // instead of silently passing.
  const ALL_TOKENS = Array.from(new Set(PAIRS.flatMap(p => [p.a, p.b])));
  for (const tok of ALL_TOKENS) {
    it(`token ${tok} is defined in :root`, () => {
      expect(root).toContain(`${tok}:`);
    });
  }

  for (const pair of PAIRS) {
    const floor = pair.minDelta ?? 13;
    it(`${pair.label} — ΔH ≥ ${floor}°`, () => {
      const ha = hueOf(pair.a, root);
      const hb = hueOf(pair.b, root);
      const delta = hueDistance(ha, hb);
      expect(
        delta,
        `${pair.a} hue ${ha}° vs ${pair.b} hue ${hb}° = ${delta}° gap (need ≥${floor}°)`,
      ).toBeGreaterThanOrEqual(floor);
    });
  }
});
