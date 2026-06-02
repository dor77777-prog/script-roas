/**
 * Money-primitive GREEN-RATCHET guard (Wave C5).
 *
 * Wave C built the overflow-safe `<Money>` primitive
 * (`src/components/ui/Money.tsx`, wrapping `formatMetricValue`). Every VISIBLE
 * money cell must render through `<Money>` (or an approved formatter helper) so
 * a too-wide value compacts to a bounded `$X.XM` token instead of overflowing
 * its reserved-width cell — and so the EXACT amount is always recoverable via
 * the primitive's title + sr-only span.
 *
 * This guard scans every component under `src/components/**` (excluding test /
 * stories files) for RAW, hand-built money construction that should have gone
 * through the primitive, and ratchets it down. It targets two smells:
 *
 *   1. `.toLocaleString(`            — a number formatted inline. The dashboard
 *                                      standard is to format money through a
 *                                      helper, never this raw call in a cell.
 *   2. hand-built currency template  — a `$` immediately before `${…}` (e.g.
 *                                      `` `…$${n}` ``) or a literal `CAD ` before
 *                                      an interpolation (`` `…CAD ${n}` ``). These
 *                                      are currency strings assembled by hand.
 *
 * EXPLICITLY NOT flagged (the approved-helper CALLS — a separate, looser policy
 * governs them; this guard only stops NEW raw inline construction):
 *   • <Money …>            — the primitive itself
 *   • formatMetricValue(…) — its single-source formatter
 *   • formatCurrency(…)    — the canonical money formatter
 *   • fmtMoney(…) / fmtMoneyString(…) / fmtMoneyCompact(…) — approved variants
 *
 * NOTE the detector is intentionally simple, so it also catches `.toLocaleString`
 * on DATES and COUNTS (units / order counts), and `C$${…}` chart-axis tick
 * formatters that wrap an approved helper. Those are NOT money-cell regressions;
 * they live on the allowlist with a one-line reason. The detector errs toward
 * over-matching and lets the curated allowlist record the legitimate exceptions —
 * exactly mirroring designColorGuard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RATCHET MECHANICS  (identical to designColorGuard)
 *
 * `MIGRATION_ALLOWLIST` holds the component paths (relative to src/components/)
 * that currently carry a legitimate raw-money/`.toLocaleString` line. The test
 * fails when:
 *
 *   (a) a file NOT on the allowlist has ≥1 hit            → regression guard:
 *       new raw money must go through <Money>/an approved helper.
 *   (b) a file ON the allowlist has 0 hits                → stale entry; the line
 *       was removed/converted, so the entry MUST be deleted (ratchet shrinks).
 *
 * So the list can never silently grow, and a cleaned file can never silently
 * stay on it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(__dirname, '..', '..', 'components');

// ---------------------------------------------------------------------------
// MIGRATION ALLOWLIST — paths relative to src/components/.
// Files here carry a raw-money / `.toLocaleString` line that is LEGITIMATE
// (a tooltip/aria/content STRING, a chart-axis tick formatter, or a non-money
// date/count value — none of which can be a `<Money>` JSX element). Each entry
// has a one-line reason. As soon as a line is removed or converted, delete the
// entry here — a now-clean file left on the list FAILS the ratchet test.
// ---------------------------------------------------------------------------
const MIGRATION_ALLOWLIST: string[] = [
  'CampaignsTable.tsx', // chart Y-axis tickFormatter `C$${Number(v).toFixed(2)}` — axis tick, not a cell
  'home/CommandCenterHero.tsx', // fmtMoneyCompact string helper feeds the delta-caption `text=` string (can't be JSX <Money>); fmtCount is a COUNT, not money
  'home/StoreDetailModal.tsx', // `data.newCustomer.ncOrders.toLocaleString('en-US')` — a new-customer ORDER COUNT (הזמנות חדשות), not money
  'CommandPalette.tsx', // `p.units.toLocaleString('he-IL')` — a UNITS count (יחידות), not money
  'Dashboard.tsx', // `new Date(lastUpdated).toLocaleString('he-IL', …)` — a footer DATE, not money
  'FreshnessChip.tsx', // `new Date(dataLastWriteAt).toLocaleString(…)` built into the HelpTooltip content STRING — date inside a tooltip string
  'MetaShopifyReconciliation.tsx', // chart Y-axis tickFormatter `C$${formatCurrency(n, …)}` — axis tick wrapping an approved helper
  'RoasChart.tsx', // refund value rendered inside a <ChartTooltip> body — chart tooltip, not a table cell
  'campaign-drawer/CampaignDrawerDaily.tsx', // two chart Y-axis tickFormatters `C$${formatCurrency(Number(v))}` / `C$${Number(v).toFixed(2)}` — axis ticks
];

// ---------------------------------------------------------------------------
// Raw-money detector.
//
// Patterns are assembled from runtime-concatenated fragments so THIS test file
// never contains a literal forbidden token string (cosmetic — it lives outside
// the scanned dir anyway — but keeps the intent copy-paste-safe, mirroring
// designColorGuard's style).
// ---------------------------------------------------------------------------

// 1 — `.toLocaleString(` : a number (or date) formatted inline. The strongest
//     signal for hand-built money in a component.
const TO_LOCALE = new RegExp('\\.' + 'toLocaleString' + '\\s*\\(');

// 2 — hand-built currency template: a `$` immediately before `${…}` interpolation
//     (e.g. `$${n}`, `C$${n}`) OR a literal `CAD ` before an interpolation.
const DOLLAR_TEMPLATE = new RegExp('\\$' + '\\$\\{');
const CAD_TEMPLATE = new RegExp('CAD ' + '\\$\\{');

interface Detector {
  name: string;
  test: (line: string) => boolean;
}

const DETECTORS: Detector[] = [
  { name: 'inline .toLocaleString', test: (l) => TO_LOCALE.test(l) },
  { name: 'hand-built $ currency template', test: (l) => DOLLAR_TEMPLATE.test(l) },
  { name: 'hand-built CAD currency template', test: (l) => CAD_TEMPLATE.test(l) },
];

// ---------------------------------------------------------------------------
// File walk — every *.tsx under components/, excluding *.test.tsx / *.stories.tsx
// and the __tests__ dir.
// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (entry.name.endsWith('.test.tsx') || entry.name.endsWith('.stories.tsx')) continue;
    out.push(full);
  }
  return out;
}

interface Violation {
  rel: string; // path relative to src/components/
  line: number;
  detector: string;
  snippet: string;
}

/** Scan one file and return every raw-money hit (line + detector + snippet). */
function scanFile(absPath: string): Violation[] {
  const rel = path.relative(COMPONENTS_DIR, absPath);
  const text = fs.readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const d of DETECTORS) {
      if (d.test(line)) {
        violations.push({
          rel,
          line: i + 1,
          detector: d.name,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Run the scan ONCE; index hits by relative path.
// ---------------------------------------------------------------------------
const files = walk(COMPONENTS_DIR);
const violationsByFile = new Map<string, Violation[]>();
for (const abs of files) {
  const v = scanFile(abs);
  if (v.length > 0) {
    violationsByFile.set(path.relative(COMPONENTS_DIR, abs), v);
  }
}
const allowSet = new Set(MIGRATION_ALLOWLIST);

// ---------------------------------------------------------------------------
// Suite 1 — parser sanity. A structural accident that zeroes-out the scan
// (wrong dir, glob breaks) must not let the guard pass vacuously.
// ---------------------------------------------------------------------------
describe('money-primitive guard — parser sanity', () => {
  it('scans a non-trivial component inventory', () => {
    expect(
      files.length,
      `only ${files.length} component .tsx files found — walk() likely pointed at the wrong dir`,
    ).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — REGRESSION guard. Any file NOT on the allowlist with ≥1 hit fails.
// New code (and converted files) can never introduce raw inline money again.
// ---------------------------------------------------------------------------
describe('money-primitive guard — regression (off-allowlist files must be clean)', () => {
  it('no off-allowlist component builds money inline', () => {
    const offenders: string[] = [];
    for (const [rel, vs] of violationsByFile) {
      if (allowSet.has(rel)) continue;
      for (const v of vs) {
        offenders.push(`${v.rel}:${v.line} [${v.detector}]  ${v.snippet}`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} raw inline-money usage(s) in NON-allowlisted component(s).\n` +
          `Render money through <Money> (or an approved helper) — or, only if it is a\n` +
          `tooltip/aria/content STRING, chart-axis tick, or non-money date/count, add the\n` +
          `file to MIGRATION_ALLOWLIST with a one-line reason:\n  ${offenders
            .slice(0, 60)
            .join('\n  ')}${offenders.length > 60 ? `\n  … +${offenders.length - 60} more` : ''}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — RATCHET. Every allowlisted file must STILL be dirty. A clean file
// on the list means its line was removed/converted and the entry is stale —
// remove it. And every entry must point at a real file.
// ---------------------------------------------------------------------------
describe('money-primitive guard — ratchet (allowlist may only shrink)', () => {
  it('every MIGRATION_ALLOWLIST entry still has ≥1 hit', () => {
    const stale = MIGRATION_ALLOWLIST.filter((rel) => !violationsByFile.has(rel));
    expect(
      stale,
      `These files are on MIGRATION_ALLOWLIST but now have ZERO hits — ` +
        `remove them so the ratchet shrinks:\n  ${stale.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('every MIGRATION_ALLOWLIST entry points at a real component file', () => {
    const missing = MIGRATION_ALLOWLIST.filter(
      (rel) => !fs.existsSync(path.join(COMPONENTS_DIR, rel)),
    );
    expect(
      missing,
      `MIGRATION_ALLOWLIST references nonexistent file(s):\n  ${missing.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
