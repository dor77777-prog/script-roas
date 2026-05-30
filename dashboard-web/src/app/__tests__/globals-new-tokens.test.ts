import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf-8');

describe('Phase E1.6.1 UI overhaul — new tokens in globals.css', () => {
  for (const tok of [
    '--status-warning',
    '--status-warning-bg',
    '--status-warning-fg',
    '--chart-axis',
    '--chart-cpm-prev',
    '--gradient-hero-from',
    '--gradient-hero-via',
    '--gradient-hero-to',
    '--store-uzoshop-bg',
    '--store-uzoshop-fg',
    '--store-zolplus-bg',
    '--store-zolplus-fg',
    '--store-usmile-bg',
    '--store-usmile-fg',
  ]) {
    it(`defines ${tok} in :root`, () => {
      const rootBlock = css.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
      expect(rootBlock).toContain(tok);
    });
    it(`defines ${tok} in [data-theme="dark"]`, () => {
      const darkBlock = css.match(/\[data-theme="dark"\]\s*\{[\s\S]*?\}/)?.[0] ?? '';
      expect(darkBlock).toContain(tok);
    });
  }
});
