/**
 * Token-sweep regression guard (Wave-1 Task 1.2).
 *
 * Scans dashboard-web/src/ for the legacy Tailwind classes that the Wave-1
 * design-system reset deleted from tailwind.config.ts. Any hit is a
 * regression — the legacy `colors:` block is gone, so these classes now
 * resolve to *nothing* (silently invisible borders / unstyled text).
 *
 * Two regex families:
 *   1. Original Phase-13 hex palette: bg-background / bg-surface{Muted,Subtle,Sunken} /
 *      bg-primary* / text-primary-N / bg-roas-* / text-roas-* / bg-border* /
 *      text-text-* / bg-text-*.
 *   2. Task-1.1 interim aliases the Wave-1 reset deleted on its way to the
 *      final canvas/glass/band/chart/store/accent/status/ink palette:
 *      bg-elevated* / bg-overlay / border-line* / divide-line* / ring-line* /
 *      text-ink-primary.
 *
 * Allowlist:
 *   - `__tests__/` directories — tests can reference legacy strings.
 *   - This file itself (`tokenSweep.test.ts`) — the regex strings would
 *     self-match otherwise. Both guards combine via filename.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..', '..');
const SELF_BASENAME = 'tokenSweep.test.ts';

// Patterns are built from runtime-concatenated fragments so the file itself
// never contains the literal class strings — that lets the test scan its own
// directory's siblings without self-matching when a future contributor moves
// it. The fragments are joined at import time; the resulting RegExp is the
// canonical guard the test enforces.
const F = {
  bgEl: 'bg-' + 'elevated2?',
  bgOv: 'bg-' + 'overlay',
  brLn: 'border-' + 'line(?:-(?:subtle|strong))?',
  dvLn: 'divide-' + 'line(?:-(?:subtle|strong))?',
  rgLn: 'ring-' + 'line(?:-(?:subtle|strong))?',
  txIp: 'text-' + 'ink-' + 'primary',
  bgBg: 'bg-' + 'background',
  bgSf: 'bg-' + 'surface(?:Muted|Subtle|Sunken)?',
  bgPr: 'bg-' + 'primary(?:-\\w+)?',
  txPr: 'text-' + 'primary-\\d+',
  bgRo: 'bg-' + 'roas-\\w+',
  txRo: 'text-' + 'roas-\\w+',
  bgBd: 'bg-' + 'border\\w*',
  txTx: 'text-' + 'text-\\w+',
  bgTx: 'bg-' + 'text-\\w+',
};

const LEGACY_PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: 'Phase-13 hex palette (background/surface/primary/roas/border/text/bg-text)',
    regex: new RegExp(
      `\\b(${F.bgBg}|${F.bgSf}|${F.bgPr}|${F.txPr}|${F.bgRo}|${F.txRo}|${F.bgBd}|${F.txTx}|${F.bgTx})\\b`,
    ),
  },
  {
    name: 'Task-1.1 interim aliases (bg-elevated*/bg-overlay/border-line*/divide-line*/ring-line*/text-ink-primary)',
    regex: new RegExp(
      `\\b(${F.bgEl}|${F.bgOv}|${F.brLn}|${F.dvLn}|${F.rgLn}|${F.txIp})\\b`,
    ),
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip __tests__ — tests can reference legacy strings.
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    if (path.basename(full) === SELF_BASENAME) continue;
    out.push(full);
  }
  return out;
}

describe('legacy token sweep (Wave-1 Task 1.2)', () => {
  const files = walk(SRC_DIR);

  it('produces a non-empty inventory (sanity check)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { name, regex } of LEGACY_PATTERNS) {
    it(`finds zero hits for ${name}`, () => {
      const hits: string[] = [];
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            hits.push(`${path.relative(SRC_DIR, f)}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }
      if (hits.length > 0) {
        throw new Error(
          `Legacy token regressions (${hits.length}):\n  ${hits.slice(0, 40).join('\n  ')}${
            hits.length > 40 ? `\n  ... +${hits.length - 40} more` : ''
          }`,
        );
      }
    });
  }
});
