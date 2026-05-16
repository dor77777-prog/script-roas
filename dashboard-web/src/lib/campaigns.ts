import { google } from 'googleapis';

/**
 * One row per (date, store, ad_set). Schema mirrors Apps Script
 * writeCampaignRowsForDay in SheetBuilder.gs:
 *   A: Date  B: Platform  C: CampaignID  D: CampaignName
 *   E: AdSetID  F: AdSetName  G: Spend(CAD)  H: Impressions
 *   I: Clicks  J: Conversions  K: ConversionValue(CAD)  L: ROAS (formula)
 */
export type CampaignRow = {
  date: string;
  storeId: string;
  storeName: string;
  platform: 'Meta' | 'Google' | string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  spend: number;            // CAD
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;  // CAD — revenue attributed by the platform
};

/** Must match the IDs in Apps Script Config.gs STORES. */
const STORE_TAB_CONFIG = [
  { id: 'uzoshop',   name: 'uzoshop' },
  { id: 'zolplus',   name: 'Zol Plus' },
  { id: 'usmile360', name: '360usmile' },
];

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

/**
 * Pulls campaign rows from all three store tabs in a single batchGet, so the
 * Sheets API quota cost is one request not three. Missing tabs are tolerated
 * (e.g. a store with no campaigns yet returns no rows instead of failing).
 */
export async function fetchCampaignsData(): Promise<CampaignRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-campaigns!A2:L100000`);

  let res;
  try {
    res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
  } catch (err) {
    // If any tab is missing, batchGet may 400. Fall back to returning empty.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unable to parse range') || msg.toLowerCase().includes('not found')) {
      return [];
    }
    throw err;
  }

  const out: CampaignRow[] = [];
  const valueRanges = res.data.valueRanges ?? [];
  for (let i = 0; i < STORE_TAB_CONFIG.length; i++) {
    const store = STORE_TAB_CONFIG[i];
    const values = valueRanges[i]?.values ?? [];
    for (const row of values) {
      const dateStr = parseDate(row[0]);
      if (!dateStr) continue;

      const platform = String(row[1] ?? '').trim() || 'Meta';
      const campaignId = String(row[2] ?? '').trim();
      const campaignName = String(row[3] ?? '').trim() || '—';
      const adSetId = String(row[4] ?? '').trim();
      const adSetName = String(row[5] ?? '').trim() || '—';
      const spend = parseNumber(row[6]);
      const impressions = parseNumber(row[7]);
      const clicks = parseNumber(row[8]);
      const conversions = parseNumber(row[9]);
      const conversionValue = parseNumber(row[10]);

      // Drop totally-empty rows (no spend AND no impressions). Keeps the
      // dashboard from showing dormant ad sets that contribute nothing.
      if (spend === 0 && impressions === 0 && conversions === 0) continue;

      out.push({
        date: dateStr,
        storeId: store.id,
        storeName: store.name,
        platform,
        campaignId,
        campaignName,
        adSetId,
        adSetName,
        spend,
        impressions,
        clicks,
        conversions,
        conversionValue,
      });
    }
  }
  return out;
}
