import { google } from 'googleapis';
import type { DailyRow } from './types';
import { COGS_RATE_OF_REVENUE } from './analytics';

const DATA_TAB = 'data-daily';
const STORE_META_TAB = 'store-meta';
const STATE_TAB = 'dashboard-state';

function getAuth(write = false) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      'Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars. ' +
        'See dashboard-web/README.md for setup.',
    );
  }

  // Vercel-style private keys escape newlines as \n strings; normalize.
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  // Most reads stay on readonly; only the dashboard-state writer needs the
  // full spreadsheets scope. Keeping reads scoped lower is a small safety net.
  const scope = write
    ? 'https://www.googleapis.com/auth/spreadsheets'
    : 'https://www.googleapis.com/auth/spreadsheets.readonly';

  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: [scope],
  });
}

function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Missing SPREADSHEET_ID env var.');
  return id;
}

function parseNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  // Google Sheets API returns formatted strings when valueRenderOption='FORMATTED_VALUE'
  // We'll request 'UNFORMATTED_VALUE' so dates come as serial numbers OR ISO strings.
  if (typeof v === 'number') {
    // Excel/Sheets date serial — days since 1899-12-30
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Reads the data-daily tab and returns one normalized row per (date, store).
 */
export async function fetchDailyData(): Promise<DailyRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${DATA_TAB}!A2:K10000`, // skip header row; K = Net Profit
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const values = res.data.values ?? [];
  const rows: DailyRow[] = [];

  for (const row of values) {
    const dateStr = parseDate(row[0]);
    if (!dateStr) continue;
    const storeId = String(row[1] ?? '').trim();
    const storeName = String(row[2] ?? '').trim();
    if (!storeId || !storeName) continue;

    const fbSpend = parseNumber(row[3]);
    const gaSpend = parseNumber(row[4]);
    const totalSpend = parseNumber(row[5]) || fbSpend + gaSpend;
    const revenue = parseNumber(row[6]);
    const roas = totalSpend > 0 ? revenue / totalSpend : 0;
    const grossProfit = revenue - totalSpend;

    // COGS = 25% מההכנסה (מחושב אצלנו, מתעלם מהעמודה ב-sheet כדי לקבל ערך
    // עקבי גם בתאריכים ישנים שעוד לא נכתבו עם הכלל החדש).
    const cogs = revenue * COGS_RATE_OF_REVENUE;
    const netProfit = revenue - totalSpend - cogs;
    const hasCogs = true;

    rows.push({
      date: dateStr,
      storeId,
      storeName,
      fbSpend,
      gaSpend,
      totalSpend,
      revenue,
      roas,
      grossProfit,
      cogs,
      netProfit,
      hasCogs,
    });
  }

  return rows;
}

export type StoreMetaRow = {
  storeId: string;
  storeName: string;
  planDisplayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  updatedAt: string | null;
  /** When Apps Script's GraphQL call failed (missing scope, expired token,
   *  GraphQL errors), refreshAllStoreMeta writes the error message to column G
   *  of the store-meta tab so the dashboard can show the real reason
   *  auto-detect isn't working. Empty string / null means the last refresh
   *  succeeded. */
  lastError: string | null;
};

/**
 * Reads the `store-meta` tab populated by `refreshAllStoreMeta()` in Apps
 * Script. Returns one row per store with the auto-detected Shopify plan name.
 * The dashboard uses this to suggest the default monthly cost in BillingSettings.
 * Returns [] if the tab doesn't exist yet (e.g. Apps Script hasn't been
 * deployed) so the dashboard degrades gracefully.
 */
export async function fetchStoreMeta(): Promise<StoreMetaRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    // Read through column G (Last Error) so the dashboard can surface
    // GraphQL / scope failures. Older deployments without column G will simply
    // return undefined for row[6] which we coerce to null.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${STORE_META_TAB}!A2:G1000`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const values = res.data.values ?? [];
    const out: StoreMetaRow[] = [];
    for (const row of values) {
      const storeId = String(row[0] ?? '').trim();
      const storeName = String(row[1] ?? '').trim();
      if (!storeId) continue;
      const lastErrorRaw = row[6];
      const lastError =
        lastErrorRaw === undefined || lastErrorRaw === null || lastErrorRaw === ''
          ? null
          : String(lastErrorRaw);
      out.push({
        storeId,
        storeName,
        planDisplayName: String(row[2] ?? '').trim(),
        shopifyPlus: row[3] === true || row[3] === 'TRUE' || row[3] === 'true',
        partnerDevelopment: row[4] === true || row[4] === 'TRUE' || row[4] === 'true',
        updatedAt: row[5] ? String(row[5]) : null,
        lastError,
      });
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tab missing → return empty rather than 500ing the whole route. The UI
    // shows the bills-CSV importer as the fallback in that case.
    if (/Unable to parse range|not found/i.test(msg)) return [];
    throw err;
  }
}

// ============================================================================
// dashboard-state — shared key-value store for billing / annotations / goal /
// insight-states. Stored as one row per key: [key, value(JSON), updatedAt].
// Replaces localStorage so multiple devices and partners stay in sync.
// ============================================================================

/**
 * Allowlist of valid dashboard-state keys. Mirrors the localStorage keys in
 * `cloudSync.ts:STATE_KEYS` with the `roas-dashboard:` prefix stripped (this
 * is the wire format used in the POST body and the sheet's column A).
 *
 * Used by the POST route to reject arbitrary keys at the API boundary.
 * Without this allowlist, a client could write a row with key="__proto__"
 * or "constructor"; on the next fetchDashboardState, the line
 * `kv[key] = parsed` would set Object.prototype properties — affecting
 * every object in the Node.js process until restart.
 *
 * fetchDashboardState additionally uses Object.create(null) so even keys
 * that bypass this check (e.g. a row written directly in the sheet UI by
 * ops) cannot pollute the prototype. Belt + suspenders.
 *
 * Keep this list in sync with cloudSync.ts:STATE_KEYS. The two cannot be
 * the same array because cloudSync runs in browser code and pulls window
 * globals; importing it from this server-only module would bundle in
 * client-only references.
 */
export const ALLOWED_STATE_KEYS = [
  'billing-recurring',
  'billing-onetime',
  'annotations',
  'monthly-revenue-goal',
  'insight-states',
] as const;
export type AllowedStateKey = (typeof ALLOWED_STATE_KEYS)[number];

export function isAllowedStateKey(k: unknown): k is AllowedStateKey {
  return typeof k === 'string' && (ALLOWED_STATE_KEYS as readonly string[]).includes(k);
}

export type DashboardStateMap = Record<string, unknown>;

/**
 * Reads the whole `dashboard-state` tab and returns a key→value map. Values
 * are parsed back from JSON; if a row's JSON is malformed, we skip it and
 * log. If the tab doesn't exist yet, returns an empty map (the first write
 * will create it).
 */
export async function fetchDashboardState(): Promise<{
  kv: DashboardStateMap;
  updatedAtByKey: Record<string, string>;
}> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${STATE_TAB}!A2:C10000`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const values = res.data.values ?? [];
    // Object.create(null) hardens against prototype pollution: even if a row
    // with key="__proto__" or "constructor" slipped past API validation, it
    // can only set an own-property on this object, never Object.prototype.
    const kv: DashboardStateMap = Object.create(null) as DashboardStateMap;
    const updatedAtByKey: Record<string, string> = Object.create(null);
    for (const row of values) {
      const key = String(row[0] ?? '').trim();
      if (!key) continue;
      const rawValue = row[1];
      let parsed: unknown = rawValue;
      if (typeof rawValue === 'string') {
        try {
          parsed = JSON.parse(rawValue);
        } catch {
          // Bare strings/numbers are stored as-is. Keep the string.
          parsed = rawValue;
        }
      }
      const updatedAt = row[2] ? String(row[2]) : '';
      // Dedupe duplicate rows for the same key. Duplicates can arise from a
      // same-key concurrent-append race in `upsertDashboardStateKey` (CR2-01):
      // two POSTs for the same missing key both observe existingIdx=-1 and
      // both append. We keep the row with the newest updatedAt so reads are
      // deterministic AND align with the row that `upsertDashboardStateKey`
      // will target on the next write (which also picks the newest row).
      // ISO-8601 timestamps compare lexicographically, so string `<` is the
      // right operator here.
      const prevAt = updatedAtByKey[key];
      if (prevAt !== undefined && updatedAt < prevAt) continue;
      kv[key] = parsed;
      updatedAtByKey[key] = updatedAt;
    }
    return { kv, updatedAtByKey };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Unable to parse range|not found/i.test(msg)) {
      return { kv: {}, updatedAtByKey: {} };
    }
    throw err;
  }
}

/**
 * Upsert a single key→value row in `dashboard-state`. Idempotent. Creates the
 * tab if missing.
 *
 * Last-write-wins semantics for SAME key: the body must be JSON-serializable.
 * Concurrent edits from two partners on the same key will collide; for
 * billing/annotations that's acceptable because edits are infrequent.
 *
 * Concurrent writes to DIFFERENT missing keys: handled atomically by routing
 * new keys through `spreadsheets.values.append` instead of computing a row
 * number from a previous read. The Sheets API allocates rows server-side for
 * `append`, so two concurrent appends for different keys land on distinct
 * rows and neither is lost.
 *
 * Concurrent writes to the SAME missing key (CR2-01 regression of CR-01): the
 * append branch alone is NOT sufficient. Two simultaneous POSTs for the same
 * new key both observe existingIdx=-1 and both append, producing duplicate
 * rows. Without further handling, future `update`s pick the FIRST duplicate
 * via `findIndex` while `fetchDashboardState`'s last-write-wins iteration
 * returns the LAST duplicate — user updates become silently invisible to
 * reads. Two-part mitigation:
 *
 *   1. On read: `fetchDashboardState` dedupes by key keeping the row with
 *      the newest updatedAt (see that function).
 *   2. On write: when the key already exists, we (a) target the row with the
 *      newest updatedAt — same row reads return — and (b) clear any older
 *      duplicate rows by blanking their content (RAW writes of "" into A:C).
 *      "Blanking" rather than `deleteDimension` keeps the row index stable
 *      for any in-flight read that already captured the range, and the
 *      empty-key check at sheets.ts:228 already skips blank rows.
 *
 * After the next write following a same-key race, duplicates collapse and
 * the system is self-healing. The window of inconsistency is bounded by the
 * time until the user's next edit (or the next 30s poll triggering hydrate
 * which itself does not write, but reads correctly thanks to dedupe).
 */
export async function upsertDashboardStateKey(key: string, value: unknown): Promise<void> {
  const auth = getAuth(true);
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  await ensureStateTab_(sheets, spreadsheetId);

  // Read BOTH the key column and the updatedAt column so we can pick the
  // newest duplicate (if any) and discover stale duplicates to clear.
  const colAC = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${STATE_TAB}!A2:C10000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = colAC.data.values ?? [];

  // Find ALL row indices matching `key`, then pick the one with the newest
  // updatedAt (ISO-8601 strings compare lexicographically). Other matches
  // are duplicates left over from a prior same-key concurrent-append race
  // and must be cleared so future reads (which already dedupe by newest)
  // and future writes (which use this same logic) stay consistent.
  let bestIdx = -1;
  let bestAt = '';
  const duplicateIdxs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowKey = String(rows[i][0] ?? '');
    if (rowKey !== key) continue;
    const at = String(rows[i][2] ?? '');
    if (bestIdx === -1 || at >= bestAt) {
      if (bestIdx !== -1) duplicateIdxs.push(bestIdx);
      bestAt = at;
      bestIdx = i;
    } else {
      duplicateIdxs.push(i);
    }
  }

  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();

  if (bestIdx >= 0) {
    // Key already has a row — overwrite the newest one in place. This is
    // the row that `fetchDashboardState` will return on reads, so writes
    // and reads now agree.
    const targetRow = bestIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${STATE_TAB}!A${targetRow}:C${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, json, updatedAt]] },
    });

    // Best-effort: clear out any duplicate rows for this key (legacy
    // pre-fix or fresh same-key races). Blanking is idempotent and safe
    // even if another writer is racing — they'll just observe an empty
    // row and treat it as "not present" via the empty-key skip in
    // fetchDashboardState. We do NOT batch this with the primary update
    // to keep the primary write atomic and short. If clearing fails,
    // duplicates just persist until the next write — read-side dedupe
    // keeps the user-visible state correct.
    if (duplicateIdxs.length > 0) {
      try {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: duplicateIdxs.map(idx => ({
              range: `${STATE_TAB}!A${idx + 2}:C${idx + 2}`,
              values: [['', '', '']],
            })),
          },
        });
      } catch {
        /* swallow — duplicates remain but read-side dedupe keeps state correct */
      }
    }
    return;
  }

  // New key: atomic server-side append. Two concurrent calls for two
  // different new keys land on distinct rows; neither overwrites the other.
  // Two concurrent calls for the SAME new key still produce duplicates here,
  // but the next write for that key (above branch) will pick the newer one
  // AND clear the older one — and reads dedupe in the meantime.
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${STATE_TAB}!A:C`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[key, json, updatedAt]] },
  });
}

async function ensureStateTab_(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<void> {
  // Try a tiny read; if the tab is missing we'll get an error and create it.
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${STATE_TAB}!A1:C1`,
    });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Unable to parse range|not found/i.test(msg)) throw err;
  }

  // Create the sheet + write header row.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: STATE_TAB, hidden: true } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${STATE_TAB}!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['key', 'value', 'updatedAt']] },
  });
}
