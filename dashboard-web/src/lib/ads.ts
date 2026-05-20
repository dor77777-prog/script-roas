import { google } from 'googleapis';
import { isInRange, parseDate, type DateRange } from './dateRange';

/**
 * One row per (date, store, campaign, adset, ad). Mirrors the
 * <storeId>-ads tab written by writeAdsRowsForDay in SheetBuilder.gs:
 *   A: Date           B: Platform
 *   C: CampaignID     D: CampaignName
 *   E: AdSetID        F: AdSetName
 *   G: AdID           H: AdName
 *   I: Spend(CAD)     J: Impressions
 *   K: Clicks         L: Conversions
 *   M: ConvValue(CAD) N: ROAS (formula)
 */
export type AdRow = {
  date: string;
  storeId: string;
  storeName: string;
  platform: 'Meta' | 'Google' | string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number;            // CAD
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;  // CAD
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
/**
 * Reads every <storeId>-ads tab and merges into one array. When any tab is
 * missing (e.g. Apps Script hasn't been re-run with the new ads pipeline
 * yet), batchGet returns valueRanges with no data for that range — we
 * tolerate it instead of failing the whole route. Drops totally-empty rows
 * (no spend AND no impressions AND no conversions).
 */
export async function fetchAdsData(opts?: { range?: DateRange }): Promise<AdRow[]> {
  const { range } = opts ?? {};
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-ads!A2:N100000`);
  let res;
  try {
    res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unable to parse range') || msg.toLowerCase().includes('not found')) {
      return [];
    }
    throw err;
  }

  const out: AdRow[] = [];
  const valueRanges = res.data.valueRanges ?? [];
  for (let i = 0; i < STORE_TAB_CONFIG.length; i++) {
    const store = STORE_TAB_CONFIG[i];
    const values = valueRanges[i]?.values ?? [];
    for (const row of values) {
      const dateStr = parseDate(row[0]);
      if (!dateStr) continue;
      // IN-05 (5.2.2.1): mirror campaigns.ts:113 — apply range filter at
      // parse time via isInRange so we never allocate AdRows we're just
      // going to drop. Replaces the post-loop `out.filter(...)` at the
      // tail of this function and aligns the two libs on a single
      // filter helper from dateRange.ts.
      if (range && !isInRange(dateStr, range)) continue;
      const platform = String(row[1] ?? '').trim() || 'Meta';
      const campaignId = String(row[2] ?? '').trim();
      const campaignName = String(row[3] ?? '').trim() || '—';
      const adSetId = String(row[4] ?? '').trim();
      const adSetName = String(row[5] ?? '').trim() || '—';
      const adId = String(row[6] ?? '').trim();
      const adName = String(row[7] ?? '').trim() || '—';
      const spend = parseNumber(row[8]);
      const impressions = parseNumber(row[9]);
      const clicks = parseNumber(row[10]);
      const conversions = parseNumber(row[11]);
      const conversionValue = parseNumber(row[12]);
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
        adId,
        adName,
        spend,
        impressions,
        clicks,
        conversions,
        conversionValue,
      });
    }
  }
  // IN-05 (5.2.2.1): post-loop filter removed; range is applied in the
  // parse loop above via isInRange (mirrors campaigns.ts).
  return out;
}
