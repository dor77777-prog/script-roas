import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_PATH = join(__dirname, '..', 'globals.css');

/** Extract everything between `selector { ... }`. Returns the body or null. */
function extractBlock(css: string, selector: string): string | null {
  // Match: <selector>\s*{ ... } at top level. Naive but works for our flat top-level
  // blocks (no nested braces inside :root / [data-theme="dark"]).
  const escapedSelector = selector.replace(/[[\]\\^$.*+?()|{}]/g, '\\$&');
  const re = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = css.match(re);
  return match ? match[1] : null;
}

/** Extract all `--chart-*` custom property names declared in a CSS block. */
function chartVarsIn(block: string): Set<string> {
  const names = new Set<string>();
  const re = /(--chart-[a-zA-Z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) names.add(m[1]);
  return names;
}

describe('globals.css — chart-var theme parity', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const rootBlock = extractBlock(css, ':root');
  const darkBlock = extractBlock(css, '[data-theme="dark"]');

  it('both :root and [data-theme="dark"] blocks exist', () => {
    expect(rootBlock, ':root block').not.toBeNull();
    expect(darkBlock, '[data-theme="dark"] block').not.toBeNull();
  });

  it('every --chart-* in :root also has a [data-theme="dark"] override', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const darkVars = chartVarsIn(darkBlock!);
    const missingInDark = [...rootVars].filter(v => !darkVars.has(v));
    expect(missingInDark, 'vars defined in :root but not in dark').toEqual([]);
  });

  it('every --chart-* in [data-theme="dark"] also has a :root default', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const darkVars = chartVarsIn(darkBlock!);
    const missingInRoot = [...darkVars].filter(v => !rootVars.has(v));
    expect(missingInRoot, 'vars defined in dark but not in :root').toEqual([]);
  });

  it('declares the expected per-platform and per-store chart vars', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const expected = [
      '--chart-platform-meta',
      '--chart-platform-google',
      '--chart-platform-tiktok',
      '--chart-platform-organic',
      '--chart-platform-shopify',
      '--chart-store-uzoshop',
      '--chart-store-zolplus',
      '--chart-store-usmile',
    ];
    for (const name of expected) {
      expect(rootVars.has(name), `:root must declare ${name}`).toBe(true);
    }
  });
});
