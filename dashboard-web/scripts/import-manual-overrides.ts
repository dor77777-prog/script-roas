/**
 * One-off importer: 38 historical `manual_spend` rows from Google Sheets →
 * Supabase `manual_overrides` (Phase 05.6 plan 20, D-F1 / D-F2 / D-F3).
 *
 * Run via (operator's local shell, ONCE post-Wave-9 deploy):
 *
 *   cd dashboard-web
 *   npx --yes tsx scripts/import-manual-overrides.ts
 *
 * The script EXPECTS the following env vars to be set in the shell that
 * invokes it (either via `dotenv -e .env.local --` or by sourcing
 * `.env.local` first):
 *
 *   - SPREADSHEET_ID
 *   - GOOGLE_CLIENT_EMAIL
 *   - GOOGLE_PRIVATE_KEY
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * As a convenience for the `npx tsx scripts/...` invocation from the
 * `dashboard-web` directory, the script ALSO calls `dotenv/config` (transitive
 * dep via @sentry/nextjs) which will load `dashboard-web/.env.local` when
 * present, so the operator can run the script without an explicit dotenv-cli
 * prefix.
 *
 * Idempotency contract — RE-RUNNING IS SAFE.
 *
 *   - The Sheets `manual-spend` tab is the read source.
 *   - The Supabase `manual_overrides` table has a UNIQUE (date, store_id, platform)
 *     constraint (Phase 05.5 WR-fix migration `20260521075741`).
 *   - We upsert with `onConflict: 'date,store_id,platform'` and
 *     `ignoreDuplicates: true` — supabase-js translates this to
 *     `ON CONFLICT (date, store_id, platform) DO NOTHING`.
 *   - First run reports: `Imported 38, skipped 0, errored 0`.
 *   - Second run reports: `Imported 0, skipped 38, errored 0`.
 *
 * Case normalisation — REQUIRED.
 *
 *   - The Sheets tab stores capitalised `'Meta'` / `'Google'` (per
 *     `ManualOverrides.gs:48` data-validation list).
 *   - Supabase `manual_overrides.platform` has a CHECK constraint requiring
 *     `'meta'` or `'google'` (lowercase) — see migration
 *     `20260521075741_add_constraints_and_grants.sql:63-65`.
 *   - This script lowercases the platform before upserting (Pitfall 7 in
 *     RESEARCH.md). Without this, the first run would report `errored 38`
 *     with `manual_overrides_platform_check` violations.
 *
 * Scope — what this script does NOT do.
 *
 *   - It does NOT modify any Apps Script `.gs` files (out of scope per
 *     Phase 05.6 `<specifics>`).
 *   - It does NOT touch any Sheets tab other than reading `manual-spend`.
 *   - It does NOT depend on or touch any local server / localhost. The Sheets
 *     API and Supabase REST are both remote endpoints (operator memory rule
 *     `feedback_no_localhost_checks.md` satisfied).
 *
 * Production read targets per RESEARCH §Assumption A10: the operator should
 * `wc -l` the `manual-spend` tab beforehand. The load-bearing baseline is 38
 * rows (uzoshop May 1-8 backfill + miscellaneous historical entries). If the
 * tab has been edited since 2026-05-08, the actual count may differ — the
 * script reports whatever it finds and the operator documents the actual
 * number in the resume signal.
 */

import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Best-effort `.env.local` loader. dotenv is a transitive dep via
 * @sentry/nextjs (verified in package-lock) but if a future dep tree drops
 * it, the dynamic import simply no-ops and the operator falls back to
 * exporting env vars manually — surfaced via the "Missing X env var" errors
 * thrown by `getAuth` / `getSupabaseAdmin`.
 *
 * Only runs when the file is invoked as a CLI entry point (not when imported
 * by the test suite — the test mocks the consumers anyway).
 */
async function tryLoadDotenv(): Promise<void> {
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '.env.local' });
    dotenv.config(); // fallback to default `.env`
  } catch {
    // dotenv unavailable — operator-sourced env vars must already be set.
  }
}

export const MANUAL_SPEND_TAB = 'manual-spend';

/**
 * One row to insert into Supabase `manual_overrides`. Matches the column
 * shape declared in `supabase/migrations/20260521063112_initial_schema.sql:27-37`
 * (modulo the BIGSERIAL `id` + DEFAULT-populated `created_at`).
 */
export type RowToInsert = {
  date: string;
  store_id: string;
  platform: 'meta' | 'google';
  spend: number;
  currency: string;
  notes: string | null;
};

/**
 * Parse a single Sheets `manual-spend` row (raw `unknown[]`) into a
 * normalised `RowToInsert`, OR return `null` if the row is missing required
 * fields / has a bad date / has a platform outside {Meta, Google}.
 *
 * Exported so the unit test can drive it with synthetic Sheets rows without
 * mocking `googleapis`. Mirrors the column order set by Apps Script in
 * `ManualOverrides.gs:17` (Date | Store ID | Platform | Spend | Currency | Notes).
 *
 * Defensive about Sheets' two date encodings:
 *   - When `valueRenderOption='UNFORMATTED_VALUE'`+`dateTimeRenderOption='FORMATTED_STRING'`
 *     we expect ISO strings like `'2026-05-01'`, but the API has been observed
 *     to also return raw Date objects in some library versions — handle both.
 */
export function parseManualSpendRow(row: readonly unknown[]): RowToInsert | null {
  const date = parseDate(row[0]);
  if (!date) return null;

  const store_id = String(row[1] ?? '').trim();
  const platformRaw = String(row[2] ?? '').trim();
  if (!store_id || !platformRaw) return null;

  const platformLower = platformRaw.toLowerCase();
  // Pitfall 7 (RESEARCH.md:1442-1450): the Sheets tab stores 'Meta' / 'Google'
  // (capitalised). The Supabase CHECK constraint requires 'meta' / 'google'.
  const platform: 'meta' | 'google' | null =
    platformLower === 'meta' ? 'meta'
    : platformLower === 'google' ? 'google'
    : null;
  if (!platform) return null;

  const spendRaw = row[3];
  // Per ManualOverrides.gs:106-108: empty cell means "don't override". A
  // literal 0 is a valid value (operator says: "this day had zero spend").
  if (spendRaw === '' || spendRaw === null || spendRaw === undefined) return null;
  const spend = typeof spendRaw === 'number'
    ? spendRaw
    : parseFloat(String(spendRaw).replace(/,/g, ''));
  if (!Number.isFinite(spend)) return null;

  // Use `||` (not `??`) so blank-string falls back to 'ILS' — matches
  // ManualOverrides.gs:102 `String(row[4] || 'ILS')`. Apps Script's UI
  // requires currency via data-validation, but defensive default keeps the
  // import resilient to historically-mis-entered rows.
  const currencyRaw = row[4];
  const currency = (typeof currencyRaw === 'string' ? currencyRaw.trim() : String(currencyRaw ?? '').trim()) || 'ILS';
  const currencyNorm = currency.toUpperCase();

  // Notes column is optional and free-text — keep as string, or null when blank.
  const notesRaw = row[5];
  const notes =
    notesRaw === undefined || notesRaw === null || notesRaw === ''
      ? null
      : String(notesRaw);

  return { date, store_id, platform, spend, currency: currencyNorm, notes };
}

/**
 * Parse every row from the `manual-spend` Sheets tab, dropping ones that fail
 * `parseManualSpendRow`'s validation. Returns the upsert-ready array.
 *
 * Pure function (no I/O) so the test suite can drive it with hand-rolled
 * input matrices.
 */
export function parseManualSpendRows(values: readonly (readonly unknown[])[]): RowToInsert[] {
  const out: RowToInsert[] = [];
  for (const row of values) {
    const parsed = parseManualSpendRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Accept ISO date strings (`'2026-05-01'` or `'2026-05-01T00:00:00.000Z'`),
 * raw Date objects, or `DD/MM/YYYY` strings as produced by the Sheets UI in
 * the operator's locale. Returns `null` if nothing usable was found —
 * `parseManualSpendRow` drops such rows.
 */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Sheets serial-number date (days since 1899-12-30). Same arithmetic as
    // `sheets.ts:87-93`. Defensive — the script normally requests
    // FORMATTED_STRING so this branch is rarely hit, but cheap to support.
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export type ImportResult = {
  imported: number;
  skipped: number;
  errored: number;
};

/**
 * Read the `manual-spend` Sheets tab, parse to rows, and UPSERT into Supabase
 * `manual_overrides`. Returns `{ imported, skipped, errored }` so callers
 * (tests + CLI driver) can render the summary.
 *
 * Idempotent: a re-run on the same Sheets input returns `imported=0`,
 * `skipped=<total>`, `errored=0`.
 */
export async function runImport(): Promise<ImportResult> {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('Missing SPREADSHEET_ID env var');

  const auth = getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  console.log(`Reading from Sheets: ${MANUAL_SPEND_TAB} tab`);
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `${MANUAL_SPEND_TAB}!A2:F1000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const values = (res.data.values ?? []) as unknown[][];
  const rows = parseManualSpendRows(values);
  console.log(`Parsed ${rows.length} rows from Sheets`);

  if (rows.length === 0) {
    console.log('Imported 0 rows, skipped 0 (already present), errored 0');
    return { imported: 0, skipped: 0, errored: 0 };
  }

  const { data, error } = await getSupabaseAdmin()
    .from('manual_overrides')
    .upsert(rows, { onConflict: 'date,store_id,platform', ignoreDuplicates: true })
    .select();

  if (error) {
    console.error('Upsert failed:', error.message);
    // The whole batch failed — count every row as errored. This is the
    // common case for a CHECK-constraint violation (e.g. someone forgot to
    // lowercase platform). On success-with-partial-skips, supabase-js
    // returns `error=null` and the skipped rows are simply absent from `data`.
    return { imported: 0, skipped: 0, errored: rows.length };
  }

  const imported = data?.length ?? 0;
  const skipped = rows.length - imported;
  const errored = 0;
  console.log(
    `Imported ${imported} rows, skipped ${skipped} (already present), errored ${errored}`,
  );
  return { imported, skipped, errored };
}

/**
 * Detect whether this module is being executed directly (`tsx scripts/...`)
 * vs imported by a test file. When invoked as a CLI, `process.argv[1]`
 * points at this file; when imported via vitest it points at the test runner.
 *
 * Keeps the test suite from triggering an actual network round-trip to
 * Sheets / Supabase on import.
 */
function isCliEntryPoint(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('import-manual-overrides.ts') ||
         entry.endsWith('import-manual-overrides.js');
}

if (isCliEntryPoint()) {
  tryLoadDotenv()
    .then(() => runImport())
    .then((result) => {
      // `runImport` already logged the summary line; exit code reflects the
      // batch outcome: any errored rows = non-zero exit so the shell sees it.
      process.exit(result.errored > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
