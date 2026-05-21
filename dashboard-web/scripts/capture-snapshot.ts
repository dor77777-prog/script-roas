/**
 * Phase 05.6-21 — One-shot Sheets baseline capture.
 *
 * Captures the `data-daily` rows for 2026-05-15..2026-05-20 (6 days × 3 stores
 * = up to 18 rows) into a frozen JSON snapshot. The snapshot is the input to
 * `algorithm-parity.test.ts` — the regression guard that fires when the TS
 * port drifts from the Sheets baseline beyond the expected Phase 05.2.3.0
 * refund-correction delta (per D-C4).
 *
 * Why a script, not a test:
 *   - This is a ONE-OFF capture. Re-running it would silently overwrite the
 *     baseline; the test loads the FROZEN file.
 *   - Sheets reads need GOOGLE_PRIVATE_KEY + GOOGLE_CLIENT_EMAIL + SPREADSHEET_ID
 *     env vars (see dashboard-web/.env.local.example). The CI test runner
 *     should NOT touch the Sheets API (see RESEARCH §Pattern 9).
 *
 * Usage:
 *
 *   cd dashboard-web && npx --yes tsx scripts/capture-snapshot.ts
 *
 * Re-capture: if the Sheets baseline shifts (e.g., Apps Script triggers
 * back-fill an older day with a corrected algorithm), delete the snapshot
 * JSON and re-run this script. The git diff will surface the change in
 * review.
 *
 * Per-plan-checker: file lives under `scripts/` rather than `__tests__/`
 * so vitest never tries to execute it (would fail on missing env vars in CI).
 *
 * Decision-ID citations:
 *   - D-C4: algorithm parity required vs frozen Sheets baseline for
 *     2026-05-15..2026-05-20 (modulo Phase 05.2.3.0 refund correction).
 */

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fetchDailyData } from '../src/lib/sheets';

const FROM = '2026-05-15';
const TO = '2026-05-20';
const TARGET_DIR = path.join(
  __dirname,
  '..',
  'src',
  'lib',
  'fetchers',
  '__tests__',
  'snapshots',
);
const TARGET_FILE = path.join(
  TARGET_DIR,
  'sheets-baseline-2026-05-15-to-2026-05-20.json',
);

async function main(): Promise<void> {
  console.log(`Capturing Sheets baseline ${FROM}..${TO} → ${TARGET_FILE}`);
  const rows = await fetchDailyData({ range: { from: FROM, to: TO } });
  mkdirSync(TARGET_DIR, { recursive: true });

  // Sort for deterministic git diffs (Sheets reads are already date-asc per
  // the data-daily tab order, but explicit sort defends against future
  // sheets.ts changes).
  const sortedRows = [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.storeId < b.storeId ? -1 : 1;
  });

  const snapshot = {
    capturedAt: new Date().toISOString(),
    range: { from: FROM, to: TO },
    rowCount: sortedRows.length,
    rows: sortedRows,
  };

  writeFileSync(TARGET_FILE, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Captured ${sortedRows.length} rows.`);
  console.log(`First row: ${JSON.stringify(sortedRows[0] ?? null)}`);
}

main().catch((err) => {
  console.error('capture-snapshot failed:', err);
  process.exit(1);
});
