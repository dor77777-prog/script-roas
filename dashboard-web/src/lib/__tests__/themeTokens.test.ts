import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lock-in: globals.css MUST define both :root (light) and [data-theme="dark"]
 * blocks for the same token list. Any later plan that adds a surface or
 * status token must add it to both blocks — this test catches drift.
 */
describe('OKLCH theme tokens — light + dark parity', () => {
  const css = readFileSync(
    join(__dirname, '../../app/globals.css'),
    'utf-8',
  );

  const REQUIRED_TOKENS = [
    // Surfaces
    '--surface-canvas',
    '--surface-elevated-1',
    '--surface-elevated-2',
    '--surface-overlay',
    // Text
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--text-subtle',
    // Borders
    '--border-default',
    '--border-subtle',
    '--border-strong',
    // Accent
    '--accent',
    '--accent-fg',
    // ROAS status (4 tones, 3 variants each)
    '--status-red',     '--status-red-bg',     '--status-red-fg',
    '--status-orange',  '--status-orange-bg',  '--status-orange-fg',
    '--status-green',   '--status-green-bg',   '--status-green-fg',
    '--status-blue',    '--status-blue-bg',    '--status-blue-fg',
    // Gray for ROAS "no data"
    '--status-gray',    '--status-gray-bg',    '--status-gray-fg',
  ];

  function extractBlock(selector: string): string {
    const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`Selector ${selector} not found in globals.css`);
    return m[1];
  }

  it('defines every required token in :root (light)', () => {
    const block = extractBlock(':root');
    for (const tok of REQUIRED_TOKENS) {
      expect(block, `:root missing ${tok}`).toContain(tok);
    }
  });

  it('defines every required token in [data-theme="dark"]', () => {
    const block = extractBlock('\\[data-theme="dark"\\]');
    for (const tok of REQUIRED_TOKENS) {
      expect(block, `dark block missing ${tok}`).toContain(tok);
    }
  });

  it('uses oklch() syntax for every token value (not hsl/rgb/hex)', () => {
    const blocks = [
      extractBlock(':root'),
      extractBlock('\\[data-theme="dark"\\]'),
    ];
    for (const block of blocks) {
      for (const tok of REQUIRED_TOKENS) {
        const re = new RegExp(`${tok}\\s*:\\s*([^;]+);`);
        const m = block.match(re);
        expect(m, `value missing for ${tok}`).not.toBeNull();
        expect(m![1], `${tok} should use oklch()`).toMatch(/oklch\s*\(/);
      }
    }
  });
});
