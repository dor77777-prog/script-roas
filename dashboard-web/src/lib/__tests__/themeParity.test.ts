/**
 * Theme Parity Guard — Task 0.2 (RED until light tokens land).
 *
 * Architecture decision (locked 2026-05-31):
 *   • `:root` stays the dark token set — unchanged.
 *   • A new `[data-theme="light"] { … }` block will be added in a later
 *     phase, re-declaring every token with light values.
 *
 * This test enforces that every CSS custom property declared in `:root`
 * ALSO has a declaration inside `[data-theme="light"]`, so no dark token
 * is accidentally left without a light counterpart after the re-skin lands.
 *
 * The test is intentionally RED until that `[data-theme="light"]` block
 * is added to globals.css.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Load + strip comments so selector strings that appear inside /* … */
// blocks (e.g. the comment on line 8 mentions `:root,` and line 9 mentions
// `[data-theme="dark"]`) do not fool the block-finder below.
// ---------------------------------------------------------------------------
const rawCss = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

/** Remove all CSS block comments (/* … *\/). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

const css = stripComments(rawCss);

// ---------------------------------------------------------------------------
// Block extractor — finds the first rule block whose selector matches the
// given regex, then walks brace depth to return the full block content
// (everything between the outermost `{` and `}`).
// ---------------------------------------------------------------------------
function blockFor(selectorRe: RegExp): string {
  const match = selectorRe.exec(css);
  if (!match) return '';
  // Jump to the opening `{` of the rule.
  const start = css.indexOf('{', match.index);
  if (start < 0) return '';
  // Walk brace depth to find the matching closing `}`.
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, j + 1);
    }
  }
  return '';
}

/** Collect every `--token` name declared in a CSS block string. */
function tokensIn(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

// ---------------------------------------------------------------------------
// Parse the two blocks we care about.
// Strip comments on each extracted block before tokenising so that a future
// comment like `/* --foo: see above */` inside :root or [data-theme="light"]
// is not miscounted as a real token declaration.
// ---------------------------------------------------------------------------
const rootBlock  = blockFor(/:root\s*\{/);
const lightBlock = blockFor(/\[data-theme="light"\]\s*\{/);

const rootTokens  = tokensIn(stripComments(rootBlock));
const lightTokens = tokensIn(stripComments(lightBlock));

// ---------------------------------------------------------------------------
// Suite 1 — sanity: the parser found a real, non-trivial :root block.
// If blockFor ever returns '' (e.g. globals.css is restructured), this
// assertion catches it so the parity test can't vacuously pass on an empty set.
// ---------------------------------------------------------------------------
describe('theme parity — parser sanity', () => {
  it(':root block contains more than 50 custom properties', () => {
    // :root currently has ~89 tokens; >50 catches a structural accident that
    // zeroes-out the block without being brittle to additions/removals.
    expect(
      rootTokens.size,
      `:root token count is ${rootTokens.size} — blockFor likely matched the wrong thing or globals.css was restructured`,
    ).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — parity: every :root token must appear in [data-theme="light"].
// This test is INTENTIONALLY RED until the light-mode block is added.
// ---------------------------------------------------------------------------
describe('theme token parity', () => {
  it('every :root token has a light-mode value in [data-theme="light"]', () => {
    const missing = [...rootTokens].filter((t) => !lightTokens.has(t));
    expect(
      missing,
      `[data-theme="light"] is missing ${missing.length} token(s): ${missing.join(', ')}`,
    ).toHaveLength(0);
  });
});
