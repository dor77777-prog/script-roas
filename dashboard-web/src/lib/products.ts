import { google } from 'googleapis';
import { type DateRange, isInRange } from './dateRange';
import { isDate } from './dateValidation';

const PRODUCTS_TAB = 'products-daily';

export type ProductRow = {
  date: string;        // YYYY-MM-DD
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  units: number;
  revenue: number;     // gross CAD (before discounts and refunds)
  /** Distinct orders that contained this product. 0 for historical rows
   *  written before the Orders column was added. */
  orders: number;
  /** Net revenue: gross − discounts − refunds.
   *  null when the row was written before the Net Revenue column existed
   *  (so the dashboard can distinguish "no data" from "0 net"). */
  netRevenue: number | null;
};

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars.');
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKeyRaw.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
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

// AUDIT STA-46 (2026-05-24, Phase 12.2.3): all date format branches now
// run through `isDate` round-trip calendar validation. Pre-fix the DMY
// branch produced silent corruption — `31/02/2026` → `2026-02-31`,
// which then passed downstream lexicographic comparison and persisted
// to consumers. Same bug class WR-04 already fixed for the operator
// routes via lib/dateValidation.isDate; this brings the Sheets reader
// to parity. ISO + numeric branches also gated to defend in depth.
// Evidence: raw-returns/lib_state_products.json (STA-46).
function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString().slice(0, 10);
    return isDate(iso) ? iso : null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const sliced = s.slice(0, 10);
    return isDate(sliced) ? sliced : null;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isDate(iso) ? iso : null;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const iso = d.toISOString().slice(0, 10);
    return isDate(iso) ? iso : null;
  }
  return null;
}

export async function fetchProductsData(opts?: { range?: DateRange }): Promise<ProductRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${PRODUCTS_TAB}!A2:I100000`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
  } catch (err) {
    // Tab might not exist yet — return empty rather than 500.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unable to parse range') || msg.toLowerCase().includes('not found')) {
      return [];
    }
    throw err;
  }

  const values = res.data.values ?? [];
  const out: ProductRow[] = [];
  for (const row of values) {
    const dateStr = parseDate(row[0]);
    if (!dateStr) continue;
    if (opts?.range && !isInRange(dateStr, opts.range)) continue;
    const storeId = String(row[1] ?? '').trim();
    const storeName = String(row[2] ?? '').trim();
    if (!storeId || !storeName) continue;
    const productId = String(row[3] ?? '').trim();
    const productTitle = String(row[4] ?? '').trim() || '—';
    const units = parseNumber(row[5]);
    const revenue = parseNumber(row[6]);
    const orders = parseNumber(row[7]); // 0 for rows written before this column existed
    const netRaw = row[8];
    const netRevenue =
      netRaw === undefined || netRaw === null || netRaw === ''
        ? null
        : parseNumber(netRaw);
    // AUDIT STA-47 (2026-05-24, Phase 12.2.3): align filter with
    // postgresReaders.fetchProductsFromPostgres line 529 — keep rows
    // with any non-zero revenue surface (units, gross, or net). Pre-fix
    // the `if (units <= 0 && revenue <= 0) continue;` dropped refund-
    // correction rows (units=0, revenue=0, netRevenue>0) that the
    // Postgres reader retains. Sheets reader was silently shedding
    // signal vs Postgres reader — asymmetry across the cut-over.
    // Evidence: raw-returns/lib_state_products.json (STA-47).
    if (units <= 0 && revenue <= 0 && (netRevenue ?? 0) <= 0) continue;

    out.push({
      date: dateStr,
      storeId,
      storeName,
      productId,
      productTitle,
      units,
      revenue,
      orders,
      netRevenue,
    });
  }
  return out;
}
