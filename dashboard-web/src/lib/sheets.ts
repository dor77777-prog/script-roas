import { google } from 'googleapis';
import type { DailyRow } from './types';

const DATA_TAB = 'data-daily';

function getAuth() {
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

  return new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
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

    const cogsRaw = row[9];
    const hasCogs = cogsRaw !== null && cogsRaw !== undefined && cogsRaw !== '';
    const cogs = hasCogs ? parseNumber(cogsRaw) : 0;
    const netProfit = revenue - totalSpend - cogs;

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
