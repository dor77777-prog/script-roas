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
  const m = css.match(/:root\s*\{([\s\S]*?)\n\}/);
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
