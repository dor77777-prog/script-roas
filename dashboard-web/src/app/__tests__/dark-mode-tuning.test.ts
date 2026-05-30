import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf-8');
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

describe('Phase E1.6.1 — dark mode tuning', () => {
  it('--text-muted dark lifts to ~70% L (was identical to light)', () => {
    const m = darkBlock.match(/--text-muted:\s*oklch\(\s*([\d.]+)%/);
    expect(m).not.toBeNull();
    const L = parseFloat(m![1]);
    expect(L).toBeGreaterThanOrEqual(68);
    expect(L).toBeLessThanOrEqual(72);
  });

  it('--status-red-bg dark chroma <= 0.16 (was 0.22; Live gradient calmer)', () => {
    const m = darkBlock.match(/--status-red-bg:\s*oklch\(\s*[\d.]+%\s+([\d.]+)/);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeLessThanOrEqual(0.16);
  });

  it('--status-green-bg dark L between 38% and 46% (was 50%)', () => {
    const m = darkBlock.match(/--status-green-bg:\s*oklch\(\s*([\d.]+)%/);
    expect(m).not.toBeNull();
    const L = parseFloat(m![1]);
    expect(L).toBeGreaterThanOrEqual(38);
    expect(L).toBeLessThanOrEqual(46);
  });
});
