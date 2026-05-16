import { google } from 'googleapis';

const PRODUCTS_TAB = 'products-daily';

export type ProductRow = {
  date: string;        // YYYY-MM-DD
  storeId: string;
  storeName: string;
  productId: string;
  productTitle: string;
  units: number;
  revenue: number;     // gross CAD
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

function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'number') {
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

export async function fetchProductsData(): Promise<ProductRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${PRODUCTS_TAB}!A2:G100000`,
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
    const storeId = String(row[1] ?? '').trim();
    const storeName = String(row[2] ?? '').trim();
    if (!storeId || !storeName) continue;
    const productId = String(row[3] ?? '').trim();
    const productTitle = String(row[4] ?? '').trim() || '—';
    const units = parseNumber(row[5]);
    const revenue = parseNumber(row[6]);
    if (units <= 0 && revenue <= 0) continue;

    out.push({ date: dateStr, storeId, storeName, productId, productTitle, units, revenue });
  }
  return out;
}
