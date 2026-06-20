/**
 * utcDateRatchet.guard.test.ts — audit systemic theme #19 / #32 (timezone class).
 *
 * Deriving a BUSINESS DATE ("today" / "yesterday" that selects which day's data
 * to fetch, upsert, or display) from the raw clock is the cross-midnight bug the
 * #19/#32 audit found: `new Date().toISOString().slice(0,10)` returns the UTC
 * date, and the local-clock getters (`getHours()/getDate()/…` on a no-arg
 * `new Date()`) return the SERVER's local date — both diverge from the
 * dashboard's Asia/Jerusalem business day for the 00:00–03:00 IL window. The
 * canonical helper is `getTodayInIsraelTz` in `lib/dateRange.ts`; every
 * data-selecting "today" MUST route through it.
 *
 * This guard bans the two dangerous CURRENT-CLOCK forms in `src/lib/**` source:
 *   1. `new Date().toISOString().slice(0, 10)`  (UTC date from the wall clock)
 *   2. `new Date().getHours()/getDate()/getMonth()/getDay()/getFullYear()`
 *      (server-local date component from the wall clock)
 *
 * It is deliberately NARROW. It only flags the NO-ARG `new Date()` (the live
 * clock). Forms that operate on an EXPLICIT date — `new Date(ms)`,
 * `new Date(Date.UTC(...))`, `new Date(year, month, 0)` — are legitimate
 * (formatting a date you already hold, not inventing "today"), so they are NOT
 * matched. Tests/fixtures are excluded.
 *
 * Three current call-sites use the no-arg UTC-slice form for a NON-business-date
 * purpose (a report-creation stamp, a Date.now()-based 120-day cutoff, and a
 * GAQL error-log label). They are NOT cross-midnight bugs, so they are listed in
 * ALLOWLIST with the reason. Anything new — or any of these repurposed into a
 * data-selecting date — must go through getTodayInIsraelTz, not the allowlist.
 *
 * Pure node fs reads (mirrors gatewayTokenGuard / designColorGuard). The guard
 * passes GREEN against the current codebase.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..'); // → dashboard-web/src
const LIB = join(SRC, 'lib');

// ── Dangerous current-clock patterns ──────────────────────────────────────
// 1. UTC date sliced off the live wall clock.
const UTC_SLICE = /new Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/g;
// 2. Local date components read off the live wall clock.
const LOCAL_GETTER = /new Date\(\)\.(getHours|getDate|getMonth|getDay|getFullYear)\(\)/g;

// ── Allowlist: current non-business-date uses of the no-arg UTC slice ──────
// Keyed by "<relPathFromSrc>:<exactTrimmedLine>" so a move/edit re-arms the
// guard. Each entry is a NON-data-selecting use (timestamp / cutoff / log label),
// not a cross-midnight bug.
const ALLOWLIST = new Map<string, string>([
  [
    'lib/aiReport.ts',
    // Report "created on" metadata stamp — display only, never selects data.
    'out.push(`**יוצר**: ${new Date().toISOString().slice(0, 10)}`);',
  ],
  [
    'lib/fetchers/googleAccountConfig.ts',
    // Passed to runGaqlQuery purely as an ERROR-LOG label (the GAQL query is
    // pre-built by the caller); the value never selects which day's data returns.
    'const today = new Date().toISOString().slice(0, 10);',
  ],
]);
// (postgresReaders.ts:1140 uses `new Date(Date.now() - …)` — an EXPLICIT arg, so
//  the no-arg pattern doesn't match it and no allowlist entry is needed.)

/** Recursively collect *.ts / *.tsx source files, skipping test + fixture dirs. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
      out.push(...collectSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

type Hit = { rel: string; line: number; text: string };

function scan(pattern: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of collectSources(LIB)) {
    const rel = file.slice(SRC.length + 1);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      pattern.lastIndex = 0;
      if (!pattern.test(raw)) return;
      const text = raw.trim();
      // Allowlisted non-business-date use?
      if (ALLOWLIST.get(rel) === text) return;
      hits.push({ rel, line: i + 1, text });
    });
  }
  return hits;
}

describe('UTC/local-clock business-date ratchet (#19/#32) — src/lib/**', () => {
  it('no `new Date().toISOString().slice(0, 10)` outside the allowlist', () => {
    const hits = scan(UTC_SLICE);
    expect(
      hits,
      'Found UTC date derived from the live clock — this is the cross-midnight ' +
        '(00:00–03:00 IL) bug. Use getTodayInIsraelTz() from lib/dateRange for any ' +
        'data-selecting "today"; if the use is genuinely non-business-date, add it ' +
        `to ALLOWLIST with a reason:\n${hits.map(h => `  ${h.rel}:${h.line}  ${h.text}`).join('\n')}`,
    ).toEqual([]);
  });

  it('no local date components (getHours/getDate/getMonth/getDay/getFullYear) off the live clock', () => {
    const hits = scan(LOCAL_GETTER);
    expect(
      hits,
      'Found a server-local date component read off the live clock — same ' +
        'cross-midnight class. Use getTodayInIsraelTz() / explicit-date math ' +
        `instead:\n${hits.map(h => `  ${h.rel}:${h.line}  ${h.text}`).join('\n')}`,
    ).toEqual([]);
  });

  it('allowlist stays minimal (every entry still present in source)', () => {
    // Keeps the allowlist honest: a removed/edited line drops its entry so the
    // guard can never carry a stale exception that masks a real new instance.
    for (const [rel, expected] of ALLOWLIST) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      const present = text
        .split(/\r?\n/)
        .some(l => l.trim() === expected);
      expect(present, `allowlist entry for ${rel} no longer matches source — re-verify it: ${expected}`).toBe(true);
    }
  });
});
