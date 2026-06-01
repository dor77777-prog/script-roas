import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hermetic CONTRAST guard (Readability Hardening, Wave A;
 * deepened-bands re-base 2026-06-01).
 *
 * DEEPENED-BANDS NOTE (2026-06-01): the colored ROAS-band cards now paint a
 * DEEPENED vibrant gradient and carry ALL-WHITE text. The text therefore sits on
 * the deepened card SURFACE (`--card-band-*` = the gradient's LIGHTEST stop, the
 * AA bottleneck for white in the number region) — NOT on the bright `--band-*`
 * token, which is now only the 4px ::before top-bar glow. So this guard measures
 * `--on-band-*` (white) against `--card-band-*` (the real deep surface), in BOTH
 * themes. The `--card-band-*` stops are theme-independent (same deep card in
 * light + dark by design). Tune `--on-band-*` / re-derive `--card-band-*` one
 * notch deeper if any white lands <4.5 — never lower the threshold.
 *
 * Why a static check (not axe): the band is a GRADIENT; axe only reads solid
 * backgrounds. We measure the readable region against the card's lightest stop
 * hex parsed straight from globals.css.
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
  // Accept a #rrggbb literal OR `oklch(100% 0 0)` (pure white, used by the
  // deepened-bands all-white `--on-band-*` tokens) → normalise white to #ffffff.
  const decl = blk.match(new RegExp(`(?<![\\w-])${varName}\\s*:\\s*([^;]+);`));
  if (decl) {
    const val = decl[1].trim();
    const hexM = val.match(/^(#[0-9a-fA-F]{6})\b/);
    if (hexM) return hexM[1];
    // Pure-white oklch: L=100% with any (zero) chroma/hue → white.
    if (/^oklch\(\s*100%\s+0\s+0\s*\)$/.test(val)) return '#ffffff';
  }
  throw new Error(`token ${varName} not a #rrggbb / oklch(100% 0 0) literal in block`);
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

// `red-alarm` (2026-06-01) — the operator-locked "spent money, ZERO sales"
// state paints a DEEPER/MORE-SATURATED crimson card (`--card-band-red-alarm`)
// with the same all-WHITE on-band text as the other bands, so it's guarded
// here exactly like the rest: white ≥4.5:1 + `-muted` ≥3:1 on the deep surface.
const BANDS = ['red', 'red-alarm', 'orange', 'green', 'blue', 'gray'] as const;
const THEMES = [
  { name: 'dark', blk: block('root') },
  { name: 'light', blk: block('light') },
] as const;

describe('contrast guard — --on-band-* (white) clears WCAG-AA on the DEEP card surface (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --on-band-${band} on --card-band-${band} ≥ 4.5:1`, () => {
        const fg = hexOf(`--on-band-${band}`, theme.blk);
        const bg = hexOf(`--card-band-${band}`, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--on-band-${band} ${fg} on --card-band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * Mobile B1 (2026-06-01) — the per-store ROAS sparkline is drawn DIRECTLY on the
 * vivid band slab with `--spark-band-ink` (over a `--spark-band-casing` halo, which
 * only helps). We hold the ink to the 4.5:1 TEXT bar (not the 3:1 graphical floor)
 * to match the `--on-band-*` precedent — the band line should read as crisply as the
 * band numbers. The ink is an opaque `rgba(255,255,255,1)`, so we composite (a=1 →
 * pure white) and assert it on every `--card-band-*` surface in BOTH themes.
 */
describe('contrast guard — --spark-band-ink clears WCAG-AA on the DEEP card surface (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --spark-band-ink on --card-band-${band} ≥ 4.5:1`, () => {
        const ink = effectiveSolid(rgbaOf('--spark-band-ink', theme.blk), '#000000');
        const bg = hexOf(`--card-band-${band}`, theme.blk);
        const ratio = wcagRatio(ink, bg);
        expect(
          ratio,
          `--spark-band-ink ${ink} on --card-band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * Wave B2 → deepened-bands (2026-06-01). The `--band-scrim` / `--band-scrim-ink`
 * tokens are now UNUSED by the band cards: deepened-bands moved chips / CPM tiles
 * / the freshness pill onto a WHITE-ALPHA sub-surface + WHITE text (literals in
 * globals.css). The scrim tokens still EXIST (kept for any future neutral
 * sub-surface need), so this composited-contrast assertion is retained as a
 * regression guard on those token values — it does not gate the live band cards
 * anymore (no consumer references `var(--band-scrim*)`). The scrim is an `rgba()`
 * (alpha), so we alpha-composite it over the theme's base canvas to a
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
 * The `--on-band-*-muted` near-white secondary labels (e.g. `.sl` captions,
 * `.roas-cap`, `.cpm-row-label`) sit directly on the deepened card SURFACE
 * (`--card-band-*`, not the scrim), so they're held to the AA-large / non-text
 * 3:1 floor rather than the 4.5:1 body-text bar.
 */
describe('contrast guard — --on-band-*-muted clears 3:1 on the DEEP card surface (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --on-band-${band}-muted on --card-band-${band} ≥ 3:1`, () => {
        const fg = hexOf(`--on-band-${band}-muted`, theme.blk);
        const bg = hexOf(`--card-band-${band}`, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--on-band-${band}-muted ${fg} on --card-band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥3.0)`,
        ).toBeGreaterThanOrEqual(3.0);
      });
    }
  }
});

/**
 * A11y re-base (2026-06-01) — SYSTEMATIC muted-ink tiers.
 *
 * `--text-muted` / `--text-subtle` back the Tailwind `text-ink-muted` /
 * `text-ink-subtle` aliases used as small body text across the WHOLE app
 * (axis labels, metadata, captions, timestamps). An axe color-contrast scan
 * on prod surfaced ≫100 instances failing WCAG-AA in BOTH themes. A first
 * deepening pass targeted WHITE (light) / `--glass-3` (dark) as the worst
 * surface — but the axe re-scan showed these inks ALSO sit on slightly-TINTED
 * surfaces (glass-2/glass-3/status-bgs/chart-tooltip), where they landed
 * 4.0–4.3:1 — just under AA. This guard now locks the tokens against the REAL
 * empirically-darkest surface each ink renders on (per the axe prod scan), so
 * they cannot silently regress against the tinted worst case:
 *   • DARK  — `#16323a` is the chart-tooltip bg, the darkest-contrast dark
 *             surface these inks render on. STRICTER than `--glass-3` (#20243a),
 *             so it is the binding worst case (hardcoded literal below).
 *   • LIGHT — `#edf0f8` is glass-3, the darkest light card surface. STRICTER
 *             than white (#ffffff) / status-greenBg (#effaf5, ~4.91), so it is
 *             the binding worst case (hardcoded literal below).
 * Both literals are HARDCODED (not read from tokens) because they are the
 * empirically-observed worst surfaces from the axe prod scan — being honest
 * about the real worst case matters more than tracking a token value.
 * `--text` / `--text-2` already clear AA comfortably; included for completeness.
 */
const INK_TIERS = ['--text', '--text-2', '--text-muted', '--text-subtle'] as const;
// Empirically-darkest surfaces these inks render on, per the axe prod scan:
//   dark  = #16323a (chart-tooltip bg) — stricter than --glass-3 (#20243a)
//   light = #edf0f8 (glass-3)          — stricter than white / status-greenBg
const INK_WORST_SURFACE = { dark: '#16323a', light: '#edf0f8' } as const;

describe('contrast guard — muted ink tiers clear WCAG-AA on their worst-case surface (both themes)', () => {
  for (const theme of THEMES) {
    const surface = INK_WORST_SURFACE[theme.name];
    for (const tier of INK_TIERS) {
      it(`${theme.name}: ${tier} on ${surface} ≥ 4.5:1`, () => {
        const fg = hexOf(tier, theme.blk);
        const ratio = wcagRatio(fg, surface);
        expect(
          ratio,
          `${tier} ${fg} on ${surface} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * A11y re-base (2026-06-01) — accent BUTTON background.
 *
 * The primary `<Button variant="primary">` renders white (`--accent-fg`) on
 * an accent surface. On the brand `--accent` (violet #7c6cff dark / teal
 * #0ea5b7 light) white is only 3.86 / 2.96:1 → FAIL. The button now paints a
 * deepened on-hue `--accent-btn` (with `--accent-btn-hover` for the hover
 * state). The brand `--accent` is intentionally NOT changed (rings/glows/links
 * use it for non-text). This locks white ≥4.5:1 on both the rest + hover bg.
 */
describe('contrast guard — accent BUTTON bg carries white at WCAG-AA (both themes)', () => {
  for (const theme of THEMES) {
    for (const btnVar of ['--accent-btn', '--accent-btn-hover'] as const) {
      it(`${theme.name}: --accent-fg (white) on ${btnVar} ≥ 4.5:1`, () => {
        const fg = hexOf('--accent-fg', theme.blk); // oklch(100% 0 0) → #ffffff
        const bg = hexOf(btnVar, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--accent-fg ${fg} on ${btnVar} ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * A11y FINAL pass (2026-06-01) — STATUS-as-text uses the tuned `-fg` token.
 *
 * An axe prod scan flagged the RAW `--status-*` hues used as small TEXT
 * (`text-status-green` = #0fb37a on white = 2.70, etc.). The fix swapped those
 * call sites to `text-status-Xfg`, which pairs the tuned `-fg` token. For the
 * swap to be honest, every LIGHT `-fg` text token must clear WCAG-AA ≥4.5:1 on
 * BOTH white (raw-hue-on-white sites) AND its own pale `-bg` tint (colored-text
 * on tinted-chip sites). The axe scan showed green-fg #0a8a5e (4.09 on its own
 * #effaf5 bg) and red-fg #d22c3c (4.35 on #ffe9ec) BELOW AA — both were
 * deepened (hue preserved). The DARK `-fg` tokens are light-on-dark and clear
 * AA comfortably on their composited bgs (7.5–10.7:1), so only the LIGHT theme
 * is gated here. `gray` is a neutral, not a status hue; included for parity.
 */
const STATUS_FG = ['red', 'orange', 'green', 'blue', 'gray', 'warning'] as const;
const LIGHT_BLK = block('light');

describe('contrast guard — LIGHT status `-fg` text clears WCAG-AA on white AND its own `-bg`', () => {
  for (const s of STATUS_FG) {
    it(`light: --status-${s}-fg on #ffffff ≥ 4.5:1`, () => {
      const fg = hexOf(`--status-${s}-fg`, LIGHT_BLK);
      const ratio = wcagRatio(fg, '#ffffff');
      expect(
        ratio,
        `--status-${s}-fg ${fg} on #ffffff = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
    it(`light: --status-${s}-fg on --status-${s}-bg ≥ 4.5:1`, () => {
      const fg = hexOf(`--status-${s}-fg`, LIGHT_BLK);
      const bg = hexOf(`--status-${s}-bg`, LIGHT_BLK); // light -bg are #rrggbb tints
      const ratio = wcagRatio(fg, bg);
      expect(
        ratio,
        `--status-${s}-fg ${fg} on --status-${s}-bg ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * A11y FINAL pass (2026-06-01) — STATUS/ACCENT BUTTON bg carries white at AA.
 *
 * Solid status buttons / grade chips render WHITE (`--accent-fg`) on a status
 * fill. The raw `--status-*` hues fail under white (green 2.70 / red 3.56 /
 * blue 3.67 / orange 2.14). The text-bearing buttons now point at deepened
 * on-hue `-btn` tokens (hue preserved, lightness deepened). These are
 * theme-independent (white is white in both themes) but declared in both
 * blocks; assert in both for completeness. Non-text status fills (dots, bars,
 * glows) keep the original `--status-*` hue and are intentionally NOT gated.
 */
const STATUS_BTN = ['blue', 'green', 'red', 'orange'] as const;

describe('contrast guard — status BUTTON bg carries white at WCAG-AA (both themes)', () => {
  for (const theme of THEMES) {
    for (const s of STATUS_BTN) {
      it(`${theme.name}: white on --status-${s}-btn ≥ 4.5:1`, () => {
        const bg = hexOf(`--status-${s}-btn`, theme.blk);
        const ratio = wcagRatio('#ffffff', bg);
        expect(
          ratio,
          `white on --status-${s}-btn ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

/**
 * Phase 3 — real-time activity feed (2026-06-01). The feed's three event tones
 * use the status palette: sale=green, refund=red, add_to_cart=blue. Each row
 * carries (a) a TYPE LABEL (e.g. "מכירה") and (b) a lucide GLYPH, both painted in
 * the matching `--status-X-fg` token. The glyph sits in a `--status-X-bg` tint
 * box, but that box sits on the feed Card surface (`.glass` = a `--glass-2`→
 * `--glass-1` gradient), so the BINDING worst case for both the label text and
 * the glyph ink is the `--status-X-fg` token measured against `--glass-2` (the
 * lighter gradient stop in dark — the lower-contrast surface for light-on-dark
 * text; the darker stop in light — the lower-contrast surface for dark-on-light
 * text). Hold the label to the 4.5:1 TEXT bar and the glyph to the 3:1
 * GRAPHICAL floor, in BOTH themes. (`--glass-2` is the SAME selector key in
 * both blocks; we read it per-theme.)
 */
const FEED_TONES = ['green', 'red', 'blue'] as const;

describe('contrast guard — feed glyph tones (sale/refund/cart) on the Card surface (both themes)', () => {
  for (const theme of THEMES) {
    const surface = hexOf('--glass-2', theme.blk); // feed Card's lower-contrast gradient stop
    for (const tone of FEED_TONES) {
      it(`${theme.name}: --status-${tone}-fg type LABEL on --glass-2 ≥ 4.5:1`, () => {
        const fg = hexOf(`--status-${tone}-fg`, theme.blk);
        const ratio = wcagRatio(fg, surface);
        expect(
          ratio,
          `--status-${tone}-fg ${fg} on --glass-2 ${surface} = ${ratio.toFixed(2)}:1 (need ≥4.5 for the label)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
      it(`${theme.name}: --status-${tone}-fg GLYPH on --glass-2 ≥ 3:1`, () => {
        const fg = hexOf(`--status-${tone}-fg`, theme.blk);
        const ratio = wcagRatio(fg, surface);
        expect(
          ratio,
          `--status-${tone}-fg ${fg} on --glass-2 ${surface} = ${ratio.toFixed(2)}:1 (need ≥3 for the glyph)`,
        ).toBeGreaterThanOrEqual(3.0);
      });
    }
  }
});
