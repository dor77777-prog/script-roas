/**
 * migrationUniqueness.guard.test.ts — migration-layer hardening (Item 3 / #30).
 *
 * `supabase db push` keys applied migrations by their leading numeric VERSION
 * prefix (the `<TS>_` at the start of each filename). Two migration files that
 * share a version prefix are an operational hazard: `--include-all` fails on a
 * duplicate-key when pushing, and the move-files-aside workaround has to be
 * performed by hand every time. This guard catches any NEW duplicate prefix the
 * moment it's introduced, so a future migration can't silently collide.
 *
 * There is exactly ONE known, accepted duplicate today — version
 * `20260530300000`, shared by:
 *   - 20260530300000_recompute_data_daily_derived.sql
 *   - 20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql
 * BOTH are already applied in prod's `schema_migrations`. Renaming either to a
 * fresh version would make `db push` see a "new" unapplied migration and try to
 * re-run it (a re-DELETE / re-recompute against prod) — riskier than leaving the
 * dup in place. So it is left AS-IS and allowlisted here (see ARCHITECTURE.md
 * "Known duplicate migration version 20260530300000").
 *
 * The guard passes GREEN now (the only dup is the allowlisted one) and FAILS if
 * any other version prefix appears more than once. The Item-1 migration
 * (`20260611140000_agg_data_daily_insert_skeleton.sql`) is included in the scan,
 * so its uniqueness is confirmed here too.
 *
 * Pure node fs read (mirrors utcDateRatchet / silentSuccessRatchet style).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// __dirname → dashboard-web/src/lib/__tests__ ; repo root is 4 levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

// The single accepted duplicate version (two files; both applied in prod).
const ALLOWLISTED_DUP_VERSION = '20260530300000';
const ALLOWLISTED_DUP_COUNT = 2;

/** Leading numeric version prefix of a migration filename, or null if none. */
function versionOf(filename: string): string | null {
  const m = /^(\d+)_/.exec(filename);
  return m ? m[1] : null;
}

describe('migration version-prefix uniqueness (#30) — supabase/migrations', () => {
  it('every migration filename starts with a numeric version prefix', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    expect(sqlFiles.length, 'no .sql migrations found — wrong path?').toBeGreaterThan(0);

    const malformed = sqlFiles.filter(f => versionOf(f) === null);
    expect(
      malformed,
      `Migration filenames must start with a numeric version prefix (\`<TS>_name.sql\`):\n` +
        malformed.map(f => `  ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('no duplicate version prefixes except the documented allowlisted pair', () => {
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

    const byVersion = new Map<string, string[]>();
    for (const f of sqlFiles) {
      const v = versionOf(f);
      if (v === null) continue; // covered by the previous test
      const list = byVersion.get(v) ?? [];
      list.push(f);
      byVersion.set(v, list);
    }

    // Collect every version that appears more than once, excluding the single
    // documented allowlisted pair (which must appear exactly its known count).
    const unexpectedDups: { version: string; files: string[] }[] = [];
    for (const [version, files] of byVersion) {
      if (files.length <= 1) continue;
      if (version === ALLOWLISTED_DUP_VERSION && files.length === ALLOWLISTED_DUP_COUNT) continue;
      unexpectedDups.push({ version, files: files.sort() });
    }

    expect(
      unexpectedDups,
      'Duplicate migration version prefix(es) found. `supabase db push` keys ' +
        'migrations by version, so a duplicate breaks --include-all and risks a ' +
        're-run against prod. Give the new migration a UNIQUE timestamp strictly ' +
        'greater than every existing one (do NOT rename an already-applied file):\n' +
        unexpectedDups
          .map(d => `  ${d.version}:\n${d.files.map(f => `    ${f}`).join('\n')}`)
          .join('\n'),
    ).toEqual([]);
  });

  it('the allowlisted duplicate (20260530300000) still exists exactly as documented', () => {
    // Keeps the allowlist honest: if those files are renamed/removed (e.g. the
    // dup is genuinely resolved), this fails so the exception can be dropped
    // rather than silently masking a different future collision on that version.
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const dupFiles = sqlFiles.filter(f => versionOf(f) === ALLOWLISTED_DUP_VERSION);
    expect(
      dupFiles.length,
      `Expected exactly ${ALLOWLISTED_DUP_COUNT} files at version ${ALLOWLISTED_DUP_VERSION} ` +
        `(the known applied-in-prod pair). Found ${dupFiles.length}: ${dupFiles.join(', ')}. ` +
        'If the duplicate was resolved, remove the allowlist entry in this guard.',
    ).toBe(ALLOWLISTED_DUP_COUNT);
  });
});
