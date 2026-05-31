import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 1.1 — glass+neon foundation.
 *
 * Asserts the glass surface tokens, deep blue-violet canvas tokens, and
 * blur filter tokens all exist in `globals.css :root`. These are the
 * substrate for every Wave 2 primitive treatment (Card / Sheet / Stat
 * etc. all read these vars).
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

describe('glass + canvas + blur tokens — Task 1.1', () => {
  const root = extractRoot();

  const REQUIRED = [
    // 3-layer glass + 2 edge variants.
    '--glass-1',
    '--glass-2',
    '--glass-3',
    '--glass-edge',
    '--glass-edge-hot',
    // Deep blue-violet canvas (linear-gradient endpoints).
    '--canvas-1',
    '--canvas-2',
    // Blur filter stacks.
    '--blur-glass',
    '--blur-sheet',
  ];

  for (const tok of REQUIRED) {
    it(`defines ${tok} in :root`, () => {
      expect(root).toContain(`${tok}:`);
    });
  }
});

describe('body background animation layer — Task 1.1', () => {
  // Lock in the visual signature so a future engineer cannot silently
  // delete the conic-gradient bg layer (body::before) or the global
  // prefers-reduced-motion guard that pauses it on accessibility-sensitive
  // sessions. Pure text-level assertions to keep the test JSDOM-free.
  it('renders a body::before pseudo-element for the conic-gradient bg layer', () => {
    expect(css).toContain('body::before');
  });

  it('respects prefers-reduced-motion somewhere in globals.css', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});

/**
 * Task 1.6 — foreground stack as `text-ink-*` Tailwind aliases.
 *
 * The Phase-1 v2 plan relaxed the original 3-variable LCH theme for surfaces
 * (those now layer via translucent glass stops in :root), but kept the LCH-
 * style benefit for the 4-stop foreground stack — a single OKLCH hue ramp
 * (h ≈ 80→250, L 98→48) for `--text`, `--text-2`, `--text-muted`,
 * `--text-subtle`. These four vars MUST be present in :root and MUST be
 * surfaced as Tailwind colour aliases under `colors.ink.*` so consumer code
 * never reaches past the token boundary.
 *
 * Two assertions:
 *   1. Each `--text*` var is defined inside :root.
 *   2. tailwind.config.ts contains an `ink:` block with the 4 required keys,
 *      each binding to the corresponding `--text*` var. Compile-time class
 *      resolution (`npx tailwindcss -i …`) is harder to wire into vitest, so
 *      this text-level grep on tailwind.config.ts is the proxy.
 */
describe('foreground stack `text-ink-*` aliases — Task 1.6', () => {
  const root = extractRoot();

  const TEXT_VARS = ['--text', '--text-2', '--text-muted', '--text-subtle'];

  for (const tok of TEXT_VARS) {
    it(`defines ${tok} in :root`, () => {
      expect(root).toContain(`${tok}:`);
    });
  }

  const tailwindConfig = readFileSync(
    join(__dirname, '..', '..', '..', 'tailwind.config.ts'),
    'utf-8',
  );

  // Extract the `ink: { … }` block out of tailwind.config.ts so the
  // alias-key assertions cannot accidentally pass against a stray
  // mention elsewhere in the file (e.g. a comment referencing `ink`).
  function extractInkBlock(): string {
    const m = tailwindConfig.match(/ink:\s*\{([\s\S]*?)\}/);
    if (!m) throw new Error('`ink:` block not found in tailwind.config.ts');
    return m[1];
  }

  const inkBlock = extractInkBlock();

  // `key: 'var(--cssvar)'` — the value may use single or double quotes
  // and any amount of whitespace.
  const INK_ALIASES: { key: string; cssVar: string }[] = [
    { key: 'DEFAULT',   cssVar: '--text' },
    { key: 'secondary', cssVar: '--text-2' },
    { key: 'muted',     cssVar: '--text-muted' },
    { key: 'subtle',    cssVar: '--text-subtle' },
  ];

  for (const { key, cssVar } of INK_ALIASES) {
    it(`tailwind.config.ts \`ink.${key}\` binds to var(${cssVar})`, () => {
      const regex = new RegExp(
        `\\b${key}\\s*:\\s*['"\`]var\\(${cssVar.replace(/-/g, '\\-')}\\)['"\`]`,
      );
      expect(inkBlock).toMatch(regex);
    });
  }
});
