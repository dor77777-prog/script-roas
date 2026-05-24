/**
 * Phase 12.5 — CC-02 single-chokepoint repository-grep topology test.
 *
 * Static-topology tests that run `git grep` (read-only) across the source
 * tree and assert that load-bearing call sites are concentrated in ONE
 * canonical module. The audit's ✅ verdicts on cross-cutting boundaries
 * (WhatsApp send chokepoint per HR-05 / CHN-05, Supabase admin singleton,
 * Frankfurter FX call chokepoint) currently rest on human-reading code +
 * a fresh audit. A future contributor adding a second direct
 * `fetch('https://graph.facebook.com/.../messages')` call would silently
 * widen the security boundary; this file would fail in CI before that
 * commit lands.
 *
 * Why a separate `topology.test.ts` (not per-module):
 *   The assertions are repo-wide. They use `execSync('git grep ...')` from
 *   the dashboard-web working directory and rely on the fact that node
 *   tests inherit the cwd set by `npm test` (`dashboard-web/`).
 *
 * Per-test grep allow-lists (when more than one match is legitimate):
 *   - Frankfurter HTTP calls live in 2 files: `lib/fetchers/fx.ts` (the
 *     dated-rate helper, fetched per-day per-store inside cron-daily) +
 *     `app/api/data/route.ts` (today-only convenience helper for the
 *     non-cron, browser-readable dashboard route, separate cache window).
 *     A 3rd call site would mean "yet another FX path the operator must
 *     keep in sync".
 *
 * NOTE on the WhatsApp chokepoint:
 *   The audit (raw-returns/lib_services_whatsapp.json + AUDIT.md CHN-05)
 *   confirmed exactly ONE `graph.facebook.com/.../messages` call lives in
 *   `lib/notifications/whatsapp.ts`. The audit verdict ("airtight
 *   allowlist + symmetric normalization + single chokepoint") is
 *   ANCHORED on this invariant. Any future contributor who adds a second
 *   send path must do so via this module (which enforces the +972524809540
 *   allowlist) — adding a second graph.facebook.com/...messages fetch
 *   directly bypasses every safety check.
 *
 * Refs:
 *   - .planning/AUDIT.md §Cross-cutting findings → CHN-05 single-chokepoint
 *   - .planning/phases/12-codebase-audit-baseline/12-tests-needed.md
 *     §Cross-cutting tooling gaps CC-02
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Run `git grep -l <pattern> -- src/<glob>` from the dashboard-web root and
 * return the matching file paths (relative to dashboard-web, sorted +
 * deduped). `--full-name` makes paths relative to the git root, then we
 * strip the `dashboard-web/` prefix so consumers can assert against
 * dashboard-web-relative paths regardless of where the test was invoked.
 *
 * Throws on git failure. `git grep` exits 1 when there are no matches —
 * we catch that as "empty list" rather than propagating, because asserting
 * "exactly N matches" needs to distinguish missing-pattern (0) from
 * git-broken (throw).
 *
 * Uses execFileSync (not execSync) so the pattern is passed as a literal
 * argv element — no shell quoting / escaping ambiguity. Patterns can
 * contain backslashes, dots, slashes, etc. without manual escape work.
 */
function gitGrepFiles(pattern: string, pathspec: string = ''): string[] {
  // The repo root is 4 levels above this file
  // (src/lib/__tests__/ → src/lib/ → src/ → dashboard-web/ → repo root).
  const repoRoot = path.resolve(__dirname, '../../../..');
  const target = pathspec || 'dashboard-web/src/';
  // -l: list only files. --full-name: print git-root-relative paths.
  // -E: extended regex. -- separator before pathspec.
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-l', '--full-name', '-E', pattern, '--', target],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer | string };
    if (err.status === 1) return []; // no matches
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? '';
    throw new Error(`git grep failed: status=${err.status} stderr=${stderr}`);
  }
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => (p.startsWith('dashboard-web/') ? p.slice('dashboard-web/'.length) : p))
    .sort();
}

describe('topology — single chokepoint enforcement (CC-02)', () => {
  it('graph.facebook.com/.../messages fetch ONLY appears in lib/notifications/whatsapp.ts (HR-05)', () => {
    // The pattern matches `graph.facebook.com/<version>/<phone-id>/messages`.
    // Single fetch chokepoint → the WhatsApp allowlist + sanitisation cannot
    // be silently bypassed. AUDIT.md CHN-05 invariant.
    const matches = gitGrepFiles('graph\\.facebook\\.com/.*/messages');
    expect(matches).toEqual(['src/lib/notifications/whatsapp.ts']);
  });

  it('getSupabaseAdmin function definition ONLY appears in lib/supabaseAdmin.ts (server-only singleton)', () => {
    // The lazy-factory pattern from supabaseAdmin.ts:32 must be the sole
    // owner of the service_role client. A second `export function
    // getSupabaseAdmin` would mean two callers can drift on cache /
    // env-var handling. Callers (Inngest functions, API routes) use the
    // import, never re-declare.
    const matches = gitGrepFiles('export function getSupabaseAdmin');
    expect(matches).toEqual(['src/lib/supabaseAdmin.ts']);
  });

  it('Frankfurter FX HTTP calls ONLY appear in lib/fetchers/fx.ts + app/api/data/route.ts (CR-3 FX chokepoint)', () => {
    // Two legitimate PRODUCTION call sites:
    //   1. lib/fetchers/fx.ts — dated-rate helper (per-day per-store, cron-daily)
    //   2. app/api/data/route.ts — today-only convenience for the browser
    //      dashboard read path (separate cache window, 1h revalidate).
    // A 3rd production call site means another FX code path the operator
    // has to keep in sync. The throw-on-failure semantic + .catch fallback
    // pattern (CRIT-5 / a/WARN-3) was deliberately consolidated here —
    // extending it requires a new helper, not a fresh ad-hoc fetch.
    //
    // Tests are excluded — fx.test.ts legitimately asserts against the
    // URL literal in its mock-fetch setup. The chokepoint invariant only
    // applies to production code paths.
    const matches = gitGrepFiles('api\\.frankfurter\\.dev').filter(
      p => !p.includes('__tests__/'),
    );
    expect(matches).toEqual([
      'src/app/api/data/route.ts',
      'src/lib/fetchers/fx.ts',
    ]);
  });
});
