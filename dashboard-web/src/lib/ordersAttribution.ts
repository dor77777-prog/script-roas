/**
 * Order attribution types + parse utilities.
 *
 * Phase 12.4 cleanup: the Google Sheets reader (`fetchOrdersAttribution`)
 * was deleted as dead-at-runtime code post-Phase-11 (READ_FROM=postgres
 * permanent). The type exports + `parseSource`/`parseLineItems` parsers
 * remain — they're still consumed by tests + by postgresReaders (which
 * has its own internal `parseLineItems` copy used at runtime).
 *
 * Authoritative runtime reader: `lib/postgresReaders.fetchOrdersAttributionFromPostgres`.
 *
 * Phase 12.2's ordersAttribution ALG-01 paging cap fix lived inside the
 * deleted reader; the fix is now permanently moot.
 */

/**
 * Per-order attribution row. One per Shopify order, sourced from
 * orders_attribution table (Postgres tier).
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
  /** Phase 3 — Shopify opaque numeric customer id (string), null on guest
   *  checkout. Privacy: id only — never name/email/phone. */
  customerId: string | null;
  /** Phase 3 — Shopify created_at (ISO-8601 with offset), null when missing. */
  orderCreatedAt: string | null;
  /** Phase 3 — TRUE when this is the customer's first order EVER for the store;
   *  null when unclassifiable (guest checkout or not-yet-flagged). NEVER coerce
   *  null→false — that would silently re-bucket unknowns as "returning". */
  isFirstOrder: boolean | null;
};

/**
 * One physical line item inside a Shopify order. Captured from
 * `order.line_items[]` and proportionally allocated against the
 * order's `current_total_price` so the sum of `revenueCad` across an
 * order's items equals (within rounding) `totalCad`. Items with a null /
 * empty `product_id` (custom items, deleted products) are filtered out
 * at write time — they can never match any campaign's mapped products.
 */
export type OrderLineItem = {
  /** Shopify numeric product ID as string. Guaranteed non-empty (the
   *  writer skips items without a product_id). */
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
  | 'tiktok-paid'      // ttclid OR utm_source=tiktok + cpc OR source_name=tiktok (Phase 05.7.5)
  | 'meta-organic'     // referrer fb/ig, no UTM
  | 'google-organic'   // referrer google, no UTM
  | 'email'            // utm_source = email/newsletter/klaviyo
  | 'other-paid'       // UTM-tagged but unrecognised source
  | 'other-referral'   // referrer set but not classifiable
  | 'direct'           // no UTM, no referrer
  | '';                // unknown / missing

/**
 * Permissive source-string normalizer. A new writer label like
 * 'tiktok-paid' passes through unchanged via the type-cast fallback
 * (rather than being silently coerced to '' as an old whitelist would).
 * Downstream pattern-matching won't recognise the new kind, but the data
 * survives — the dashboard stops going blind on new categories. (IN5-06)
 */
export function parseSource(v: unknown): OrderSource {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s as OrderSource;
}

/**
 * Permissive JSON parser for line_items column. Be tolerant — a malformed
 * cell on one row should NEVER take down the whole batch. Returns `[]` for:
 *   - missing cell (`undefined` / `null` / `''` — old pre-migration rows)
 *   - non-JSON strings
 *   - JSON that decodes to a non-array
 *   - non-object array elements
 *   - elements with empty productId or non-finite units / revenueCad
 *
 * Defaults to `[]` rather than `null` so consumer code can always iterate
 * without a null-guard.
 *
 * Note: `lib/postgresReaders.ts:157` defines its own internal copy used
 * at runtime. This export is retained for test fixtures + the
 * `orderSourceContract.test.ts` parity contract.
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
      // the catalog.
      .filter((it): it is { p: string; u: unknown; r: unknown } =>
        it !== null && typeof it === 'object' &&
        typeof (it as { p?: unknown }).p === 'string' &&
        (it as { p: string }).p.trim().length > 0,
      )
      .map(it => ({
        productId: String(it.p ?? '').trim(),
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
