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

/** Extract the hue (3rd OKLCH component) from a `--var: oklch(L% C H ...)` decl. */
function hueOf(varName: string, block: string): number {
  const re = new RegExp(
    `(?<![\\w-])${varName}\\s*:\\s*oklch\\(\\s*[\\d.]+%[\\s,]+[\\d.]+[\\s,]+([\\d.]+)`,
  );
  const m = block.match(re);
  if (!m) throw new Error(`could not parse hue for ${varName}`);
  return parseFloat(m[1]);
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
    minDelta: 10,
  },
  {
    label: 'Google platform line vs --status-warning amber chip',
    a: '--chart-platform-google',
    b: '--status-warning',
  },
  {
    label: 'Shopify chart token vs --band-green ROAS glow',
    a: '--chart-platform-shopify',
    b: '--band-green',
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
