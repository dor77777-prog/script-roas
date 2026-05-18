import { google } from 'googleapis';

/**
 * Per-order attribution row. One per Shopify order, sourced from the
 * <storeId>-orders-attribution tab that Apps Script writes daily.
 *
 * The big deal: `source` is *deterministic* for paid clicks (fbclid /
 * gclid). Meta can't fake this — fbclid is generated client-side when
 * the user clicks a Meta ad, then propagated through landing_site. If
 * we see fbclid in the order, the customer definitely clicked Meta. If
 * we don't see fbclid but Meta claims the conversion, it's a *modeled*
 * conversion (view-through, statistical fill, cross-device).
 *
 * `utmCampaign` is the Meta campaign name (when the advertiser sets it
 * as the URL parameter, which is the default). This lets us tie an
 * order back to a specific campaign deterministically.
 */
export type OrderAttributionRow = {
  date: string;
  storeId: string;
  storeName: string;
  orderId: string;
  totalCad: number;
  source: OrderSource;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referringSite: string;
};

export type OrderSource =
  | 'meta-paid'        // fbclid OR utm_source=facebook + cpc
  | 'google-paid'      // gclid OR utm_source=google + cpc
  | 'meta-organic'     // referrer fb/ig, no UTM
  | 'google-organic'   // referrer google, no UTM
  | 'email'            // utm_source = email/newsletter/klaviyo
  | 'other-paid'       // UTM-tagged but unrecognised source
  | 'other-referral'   // referrer set but not classifiable
  | 'direct'           // no UTM, no referrer
  | '';                // unknown / missing

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
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseSource(v: unknown): OrderSource {
  const s = String(v ?? '').trim();
  const valid: OrderSource[] = [
    'meta-paid', 'google-paid', 'meta-organic', 'google-organic',
    'email', 'other-paid', 'other-referral', 'direct',
  ];
  return valid.includes(s as OrderSource) ? (s as OrderSource) : '';
}

/**
 * Reads every <storeId>-orders-attribution tab and merges. Tolerates
 * missing tabs (first-deploy case): returns empty array if the batch
 * fails on a 'not found' / 'unable to parse range' error.
 */
export async function fetchOrdersAttribution(): Promise<OrderAttributionRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-orders-attribution!A2:K100000`);
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

  const out: OrderAttributionRow[] = [];
  const valueRanges = res.data.valueRanges ?? [];
  for (let i = 0; i < STORE_TAB_CONFIG.length; i++) {
    const store = STORE_TAB_CONFIG[i];
    const values = valueRanges[i]?.values ?? [];
    for (const row of values) {
      const date = parseDate(row[0]);
      if (!date) continue;
      const orderId = String(row[1] ?? '').trim();
      if (!orderId) continue;
      out.push({
        date,
        storeId: store.id,
        storeName: store.name,
        orderId,
        totalCad: parseNumber(row[2]),
        source: parseSource(row[3]),
        utmSource: String(row[4] ?? '').trim(),
        utmMedium: String(row[5] ?? '').trim(),
        utmCampaign: String(row[6] ?? '').trim(),
        utmContent: String(row[7] ?? '').trim(),
        fbclidPresent: row[8] === true || String(row[8] ?? '').toUpperCase() === 'TRUE',
        gclidPresent: row[9] === true || String(row[9] ?? '').toUpperCase() === 'TRUE',
        referringSite: String(row[10] ?? '').trim(),
      });
    }
  }
  return out;
}
