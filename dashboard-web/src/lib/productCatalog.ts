import { google } from 'googleapis';

/**
 * Full Shopify product catalog per store. Sourced from the
 * <storeId>-products-catalog sheet that's refreshed daily by Apps Script.
 *
 * Why this exists in addition to /api/products:
 *   - /api/products reads products-daily, which only contains products that
 *     SOLD at least one unit. Brand new products that haven't been ordered
 *     yet are invisible there.
 *   - The ProductPickerModal needs the *full* catalog so the operator can
 *     tag a campaign to a fresh product before any sales have rolled in.
 */

export type CatalogProduct = {
  productId: string;
  storeId: string;
  storeName: string;
  title: string;
  handle: string;
  status: string;        // 'active' typically
  priceCad: number;
  imageUrl: string;
  productType: string;
  vendor: string;
};

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

export async function fetchProductCatalog(): Promise<CatalogProduct[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-products-catalog!A2:I10000`);
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
    // Catalog tabs may not exist yet (first deployment) → empty array, the
    // picker falls back to products-daily-derived list.
    if (msg.includes('Unable to parse range') || msg.toLowerCase().includes('not found')) {
      return [];
    }
    throw err;
  }

  const out: CatalogProduct[] = [];
  const valueRanges = res.data.valueRanges ?? [];
  for (let i = 0; i < STORE_TAB_CONFIG.length; i++) {
    const store = STORE_TAB_CONFIG[i];
    const values = valueRanges[i]?.values ?? [];
    for (const row of values) {
      const productId = String(row[0] ?? '').trim();
      if (!productId) continue;
      out.push({
        productId,
        storeId: store.id,
        storeName: store.name,
        title: String(row[1] ?? '').trim() || '(ללא שם)',
        handle: String(row[2] ?? '').trim(),
        status: String(row[3] ?? '').trim(),
        priceCad: parseNumber(row[4]),
        imageUrl: String(row[5] ?? '').trim(),
        productType: String(row[6] ?? '').trim(),
        vendor: String(row[7] ?? '').trim(),
      });
    }
  }
  return out;
}
