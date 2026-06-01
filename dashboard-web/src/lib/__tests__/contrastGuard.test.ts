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
