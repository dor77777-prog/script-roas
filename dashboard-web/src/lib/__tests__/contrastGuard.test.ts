import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hermetic CONTRAST guard (Readability Hardening, Wave A).
 *
 * Every band surface ships a paired `--on-band-*` foreground token that MUST
 * clear WCAG-AA 4.5:1 against that band, in BOTH themes. The mesh look is
 * mockup-locked, so the FOREGROUND token is what we tune until it passes —
 * never the band hex.
 *
 * Why a static check (not axe): the band is a GRADIENT; axe only reads solid
 * backgrounds. We measure the readable region against the band's representative
 * stop hex parsed straight from globals.css.
 */
const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf-8');

function block(selector: 'root' | 'light'): string {
  const re = selector === 'root'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/;
  const m = css.match(re);
  if (!m) throw new Error(`${selector} block not found in globals.css`);
  return m[1];
}

function hexOf(varName: string, blk: string): string {
  const m = blk.match(new RegExp(`(?<![\\w-])${varName}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`token ${varName} not a #rrggbb literal in block`);
  return m[1];
}

/**
 * Parse an `rgba(r, g, b, a)` token value into its 4 channels.
 * Used for `--band-scrim`, which is an alpha colour (not a #rrggbb), so it
 * can't go through `hexOf`. The scrim composites over a base, so we read its
 * channels here and blend in `effectiveSolid` below.
 */
function rgbaOf(varName: string, blk: string): { r: number; g: number; b: number; a: number } {
  const m = blk.match(
    new RegExp(`(?<![\\w-])${varName}\\s*:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([0-9.]+)\\s*\\)`),
  );
  if (!m) throw new Error(`token ${varName} not an rgba(...) literal in block`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
}

/** Alpha-composite a #rrggbb hex base UNDER an rgba foreground → effective #rrggbb. */
function effectiveSolid(fg: { r: number; g: number; b: number; a: number }, baseHex: string): string {
  const h = baseHex.replace('#', '');
  const br = parseInt(h.slice(0, 2), 16);
  const bg = parseInt(h.slice(2, 4), 16);
  const bb = parseInt(h.slice(4, 6), 16);
  // eff = fg*alpha + base*(1-alpha), per channel.
  const blend = (f: number, b: number) => Math.round(f * fg.a + b * (1 - fg.a));
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(blend(fg.r, br))}${to2(blend(fg.g, bg))}${to2(blend(fg.b, bb))}`;
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function relLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function wcagRatio(fg: string, bg: string): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const BANDS = ['red', 'orange', 'green', 'blue', 'gray'] as const;
const THEMES = [
  { name: 'dark', blk: block('root') },
  { name: 'light', blk: block('light') },
] as const;

describe('contrast guard — --on-band-* clears WCAG-AA on its band (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --on-band-${band} on --band-${band} ≥ 4.5:1`, () => {
        const fg = hexOf(`--on-band-${band}`, theme.blk);
        const bg = hexOf(`--band-${band}`, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--on-band-${band} ${fg} on --band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * Wave B2 — chips / CPM tiles / freshness pill now sit on the neutral
 * `--band-scrim` sub-surface and read with `--band-scrim-ink`. The scrim is an
 * `rgba()` (alpha), so we alpha-composite it over the theme's base canvas to a
 * representative SOLID, then assert the ink clears WCAG-AA 4.5:1 against it.
 * Composite: eff = fg*alpha + base*(1-alpha) per channel.
 */
const CANVAS_BASE = { dark: '#0d0f1e', light: '#ffffff' } as const;

describe('contrast guard — --band-scrim-ink clears WCAG-AA on the composited scrim (both themes)', () => {
  for (const theme of THEMES) {
    it(`${theme.name}: --band-scrim-ink on composited --band-scrim ≥ 4.5:1`, () => {
      const ink = hexOf('--band-scrim-ink', theme.blk);
      const scrim = rgbaOf('--band-scrim', theme.blk);
      const eff = effectiveSolid(scrim, CANVAS_BASE[theme.name]);
      const ratio = wcagRatio(ink, eff);
      expect(
        ratio,
        `--band-scrim-ink ${ink} on effective --band-scrim ${eff} (over ${CANVAS_BASE[theme.name]}) = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * Wave B2 — the `--on-band-*-muted` secondary labels (e.g. `.sl` captions) sit
 * directly on the band TINT (not the scrim), so they're held to the AA-large /
 * non-text 3:1 floor rather than the 4.5:1 body-text bar.
 */
describe('contrast guard — --on-band-*-muted clears 3:1 on its band (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --on-band-${band}-muted on --band-${band} ≥ 3:1`, () => {
        const fg = hexOf(`--on-band-${band}-muted`, theme.blk);
        const bg = hexOf(`--band-${band}`, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--on-band-${band}-muted ${fg} on --band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥3.0)`,
        ).toBeGreaterThanOrEqual(3.0);
      });
    }
  }
});
