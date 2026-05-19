import { google } from 'googleapis';
import { type DateRange, isInRange } from './dateRange';

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
  /** Platform campaign ID from utm_id={{campaign.id}} in Meta's URL
   *  Parameters. When present, used as the PRIMARY match key — beats
   *  utm_campaign-by-name because IDs are immutable. */
  utmId: string;
  /** Platform ad-set ID from utm_term={{adset.id}}. Enables per-adset
   *  matching when the URL Parameters are configured. */
  utmTerm: string;
  /** Per-line-item breakdown from Shopify's `line_items` (added Phase 1).
   *  Empty array on rows from days before the col-N migration was
   *  deployed — downstream analyzers must treat `[]` as "no signal",
   *  not "zero sales". */
  lineItems: OrderLineItem[];
};

/**
 * One physical line item inside a Shopify order. Captured by Apps Script
 * from `order.line_items[]` and proportionally allocated against the
 * order's `current_total_price` so the sum of `revenueCad` across an
 * order's items equals (within rounding) `totalCad`. Items with a null /
 * empty `product_id` (custom items, deleted products) are filtered out
 * at write time — they can never match any campaign's mapped products.
 */
export type OrderLineItem = {
  /** Shopify numeric product ID as string. Guaranteed non-empty (the
   *  Apps Script writer skips items without a product_id). */
  productId: string;
  /** Units sold for this line. */
  units: number;
  /** Proportional CAD share of the order's `totalCad`
   *  ( = (price × qty / order_subtotal) × current_total_price ). */
  revenueCad: number;
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

/**
 * Source kinds the Apps Script `classifyOrderAttribution_` is known to
 * emit at the time of writing. Kept as a documented contract — the type
 * union in OrderSource doubles as the canonical list. When Apps Script
 * adds a new bucket (e.g. 'tiktok-paid'), it'll pass through this parser
 * via the type-cast fallback below (rather than being silently coerced
 * to '' as the previous whitelist did). Downstream code that pattern-
 * matches on specific values won't recognise the new kind, but the data
 * survives — the dashboard stops going blind on new categories. (IN5-06)
 */
function parseSource(v: unknown): OrderSource {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s as OrderSource;
}

/**
 * Permissive JSON parser for col-N (`Line Items (JSON)`). Mirrors the
 * `parseSource` design (line 109 above): be tolerant — a malformed cell
 * on one row should NEVER take down the whole tab. Returns `[]` for:
 *   - missing cell (`undefined` / `null` / `''` — old pre-migration rows)
 *   - non-JSON strings
 *   - JSON that decodes to a non-array
 *   - non-object array elements
 *   - elements with empty productId or non-finite units / revenueCad
 *
 * Phase 1 (added 2026-05-18). Defaults to `[]` rather than `null` so
 * consumer code can always iterate without a null-guard — matches the
 * "Claude's Discretion" call in RESEARCH.md.
 */
export function parseLineItems(v: unknown): OrderLineItem[] {
  if (v === null || v === undefined || v === '') return [];
  const raw = typeof v === 'string' ? v : String(v);
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      // Require it.p to be a non-empty string (WR-08). Without this,
      // String(it.p ?? '') would happily accept e.g. {p: [1,2,3]} and
      // emit productId="1,2,3" — a synthetic ID that never appears in
      // the catalog. Phase 1's writer guarantees p is a string per-row,
      // but a malformed sheet edit could slip in a non-string and the
      // dashboard would silently consume it.
      .filter((it): it is { p: string; u: unknown; r: unknown } =>
        it !== null && typeof it === 'object' &&
        typeof (it as { p?: unknown }).p === 'string' &&
        (it as { p: string }).p.length > 0,
      )
      .map(it => ({
        productId: it.p,
        units: Number(it.u ?? 0),
        revenueCad: Number(it.r ?? 0),
      }))
      .filter(li =>
        Number.isFinite(li.units) &&
        Number.isFinite(li.revenueCad),
      );
  } catch {
    return [];
  }
}

/**
 * Reads every <storeId>-orders-attribution tab and merges. Tolerates
 * missing tabs (first-deploy case): returns empty array if the batch
 * fails on a 'not found' / 'unable to parse range' error.
 * When `opts.range` is provided, rows outside [from, to] are filtered out
 * server-side (Phase 5 pagination).
 *
 * @param opts.includeLineItems - When true, includes the heavy `lineItems`
 *   JSON column (col N) in the response. Default false: callers that only
 *   need order-level fields (CampaignsTable for the trust chip) get a
 *   smaller, faster payload. CampaignDrawer's productChannelBreakdown is
 *   the only caller that needs the line-items breakdown — it explicitly opts
 *   in. Performance: requesting only A:M instead of A:N saves ~30-50% of
 *   the Sheets API bandwidth and dramatically reduces JSON parsing cost in
 *   the dashboard. With 330k rows projected at scale, this is the single
 *   biggest payload optimization in the phase.
 */
export async function fetchOrdersAttribution(opts?: {
  range?: DateRange;
  /**
   * When true, includes the heavy `lineItems` JSON column (col N) in the
   * response. Default false: callers that only need order-level fields
   * (CampaignsTable for the trust chip) get a smaller, faster payload.
   * CampaignDrawer's productChannelBreakdown is the only caller that
   * needs the line-items breakdown — it explicitly opts in.
   *
   * Performance: requesting only A:M instead of A:N saves ~30-50% of
   * the Sheets API bandwidth and dramatically reduces JSON parsing
   * cost in the dashboard. With 330k rows projected at scale, this is
   * the single biggest payload optimization in the phase.
   */
  includeLineItems?: boolean;
}): Promise<OrderAttributionRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // When includeLineItems=true: read A:N (includes heavy line-items JSON col).
  // When includeLineItems=false (default): read A:M only — skips col N entirely,
  // saving ~30-50% Sheets API bandwidth. lineItems field is always present on
  // each row but set to [] for backwards-compat (consumers can forEach safely).
  const includeLI = opts?.includeLineItems === true;
  const lastCol = includeLI ? 'N' : 'M';
  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-orders-attribution!A2:${lastCol}100000`);
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
      if (opts?.range && !isInRange(date, opts.range)) continue;
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
        utmId: String(row[11] ?? '').trim(),
        utmTerm: String(row[12] ?? '').trim(),
        // Empty array when includeLineItems=false — preserves backwards-compat
        // for consumers that iterate .lineItems without a null-guard.
        lineItems: includeLI ? parseLineItems(row[13]) : [],
      });
    }
  }
  return out;
}
