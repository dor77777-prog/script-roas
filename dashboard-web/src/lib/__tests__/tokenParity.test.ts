import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf-8');

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

function extractTokens(block: string): string[] {
  const matches = block.matchAll(/(--[a-z0-9-]+):/gi);
  return Array.from(matches, (m) => m[1]);
}

describe('CSS token light/dark parity', () => {
  it('every :root --token has a corresponding [data-theme="dark"] override', () => {
    const rootTokens = new Set(extractTokens(rootBlock));
    const darkTokens = new Set(extractTokens(darkBlock));
    const missing = [...rootTokens].filter((t) => !darkTokens.has(t));
    expect(missing, `Missing dark-mode overrides: ${missing.join(', ')}`).toEqual([]);
  });
});
