/**
 * Canonical Shopify order → ad-platform source classifier.
 *
 * Extracted from `src/lib/fetchers/shopify.ts` so dependency-light ingest
 * paths (order webhook, cart beacon) can import the classifier without
 * pulling the full Shopify fetcher graph.
 *
 * NO logic change from the original — this is a verbatim move.
 */

export type ShopifyOrderPayload = {
  id?: number | string;
  total_price?: string | number;           // immutable — used for attribution totalCad (P0-2)
  current_total_price?: string | number;   // mutable (net of refunds) — only read by buildWindowUrl fields list
  financial_status?: string;
  test?: boolean;
  landing_site?: string;
  referring_site?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  source_name?: string;
  line_items?: Array<{
    product_id?: number | string | null;
    quantity?: number | string;
    price?: number | string;
  }>;
  created_at?: string;
  customer?: { id?: number | string | null } | null;
  payment_gateway_names?: string[];        // תשלומים — gateway tenders on the order
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Meta's `_fbc` cookie persists ~90 days after ANY Meta-ad click, so its mere
 * PRESENCE is not a fresh-click signal — counting it would credit Meta for an
 * organic/returning buyer who clicked weeks ago (over-attribution). Per Meta's
 * official spec the cookie is `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>`
 * where creationTime is the UNIX-ms when the click/fbclid was first observed
 * (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc).
 * We treat `_fbc` as a paid-click signal ONLY when that click falls within
 * Meta's DEFAULT 7-day click attribution window relative to the order — i.e.
 * exactly the window Meta itself would attribute the conversion in. The real
 * per-click `fbclid` URL param stays a fresh signal on its own (handled by the
 * caller); this guards the cookie-only path.
 */
export const FBC_CLICK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // Meta default 7-day click

export function fbcIsFreshClick(
  fbc: string | undefined | null,
  orderCreatedAt: string | null | undefined,
): boolean {
  if (!fbc) return false;
  const parts = fbc.split('.'); // fb.<subdomainIndex>.<creationTimeMs>.<fbclid>
  if (parts.length < 4 || parts[0] !== 'fb') return false;
  const clickMs = Number(parts[2]);
  if (!Number.isFinite(clickMs) || clickMs <= 0) return false;
  // Can't verify freshness without the order time → don't over-attribute.
  if (!orderCreatedAt) return false;
  const orderMs = Date.parse(orderCreatedAt);
  if (!Number.isFinite(orderMs)) return false;
  const age = orderMs - clickMs;
  // Click must be at/before the order and within the 7-day click window.
  return age >= 0 && age <= FBC_CLICK_WINDOW_MS;
}

export function classifyOrderAttribution(order: ShopifyOrderPayload): {
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmId: string;
  utmTerm: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referrer: string;
  // Phase 4 — first-click lens. Null/false when no ft_* signal is present
  // ("no first-click signal", NOT 'direct').
  firstTouchSource: string | null;
  firstFbclidPresent: boolean;
  firstGclidPresent: boolean;
  firstTtclidPresent: boolean;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstUtmId: string | null;
  firstUtmTerm: string | null;
  firstSeenAt: string | null;
} {
  const landing = String(order.landing_site ?? '');
  const ref = String(order.referring_site ?? '').toLowerCase();
  const sourceName = String(order.source_name ?? '').toLowerCase();
  const noteAttrs = order.note_attributes ?? [];

  // Parse UTM-like params from landing URL.
  const params: Record<string, string> = Object.create(null);
  const qIdx = landing.indexOf('?');
  if (qIdx >= 0) {
    const qs = landing.slice(qIdx + 1);
    for (const pair of qs.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = safeDecode(pair.slice(0, eq)).toLowerCase();
      const v = safeDecode(pair.slice(eq + 1));
      params[k] = v;
    }
  }
  // Some Shopify integrations stash click IDs in note_attributes (Apps Script
  // line 942-946) — check there too.
  for (const na of noteAttrs) {
    const name = String(na.name ?? '').toLowerCase();
    if (!name) continue;
    if (!params[name]) params[name] = String(na.value ?? '');
  }

  // ---- Phase 4: first-click (ft_*) bag + TRIMMED source chain ----
  // The storefront writes cart attributes as `_ft_*` (single leading
  // underscore = Shopify-private), which surface in note_attributes with
  // the same name. Normalize a leading `_` off `_ft_` so the canonical
  // lookup key is `ft_*`. We read ONLY from `params` (already folded from
  // landing_site + note_attributes) — no extra fetch, no new field.
  const ftBag: Record<string, string> = Object.create(null);
  for (const k of Object.keys(params)) {
    const norm = k.startsWith('_ft_') ? k.slice(1) : k; // _ft_x -> ft_x
    if (norm.startsWith('ft_')) ftBag[norm] = params[k];
  }
  const ftGet = (suffix: string): string => ftBag[`ft_${suffix}`] ?? '';

  const firstFbclid = !!ftGet('fbclid');
  const firstGclid = !!ftGet('gclid');
  const firstTtclid = !!ftGet('ttclid');
  const firstUtmSourceRaw = ftGet('utm_source');
  const firstUtmMediumRaw = ftGet('utm_medium');
  const firstUtmCampaignRaw = ftGet('utm_campaign');
  const firstUtmContentRaw = ftGet('utm_content');
  const firstUtmIdRaw = ftGet('utm_id');
  const firstUtmTermRaw = ftGet('utm_term');
  const firstSeenAtRaw = ftGet('set_at');

  const hasFirstSignal =
    firstFbclid || firstGclid || firstTtclid ||
    !!firstUtmSourceRaw || !!firstUtmCampaignRaw || !!firstUtmContentRaw ||
    !!firstUtmIdRaw || !!firstUtmTermRaw || !!firstSeenAtRaw;

  // TRIMMED chain over ONLY ft_* keys — NO source_name, NO referring_site.
  let firstTouchSource: string | null = null;
  if (hasFirstSignal) {
    if (firstFbclid) firstTouchSource = 'meta-paid';
    else if (firstGclid) firstTouchSource = 'google-paid';
    else if (firstTtclid) firstTouchSource = 'tiktok-paid';
    else if (/cpc|paid|paidsocial|social/i.test(firstUtmMediumRaw)) {
      if (/^(facebook|fb|meta|instagram|ig)$/i.test(firstUtmSourceRaw)) firstTouchSource = 'meta-paid';
      else if (/^(google|youtube)$/i.test(firstUtmSourceRaw)) firstTouchSource = 'google-paid';
      else if (/^tiktok$/i.test(firstUtmSourceRaw)) firstTouchSource = 'tiktok-paid';
      else firstTouchSource = 'other-paid';
    } else if (/^(email|newsletter|klaviyo|mailchimp)$/i.test(firstUtmSourceRaw)) {
      firstTouchSource = 'email';
    } else if (/^tiktok$/i.test(firstUtmSourceRaw)) {
      firstTouchSource = 'tiktok-paid';
    } else if (firstUtmSourceRaw) {
      firstTouchSource = 'other-paid';
    } else {
      // Has a ft_* signal (e.g. only ft_set_at / only a clid we didn't map)
      // but no classifiable source — leave as null so it reads as
      // "no first-click signal" rather than a fabricated bucket.
      firstTouchSource = null;
    }
  }

  const utmSource = params['utm_source'] ?? '';
  const utmMedium = params['utm_medium'] ?? '';
  const utmCampaign = params['utm_campaign'] ?? '';
  const utmContent = params['utm_content'] ?? '';
  const utmId = params['utm_id'] ?? '';
  const utmTerm = params['utm_term'] ?? '';
  // The real per-click `fbclid` URL param is a fresh paid signal on its own.
  // The `_fbc` COOKIE only counts when its click is within Meta's 7-day click
  // window vs the order (see fbcIsFreshClick) — its 90-day persistence would
  // otherwise over-attribute returning/organic buyers to Meta.
  const fbclid = !!params['fbclid'] || fbcIsFreshClick(params['_fbc'], order.created_at);
  const gclid = !!params['gclid'];
  // Phase 05.7.5: TikTok click ID. Same pattern as fbclid/gclid — TikTok's
  // ad SDK appends `ttclid` to landing URLs when the click came from a
  // TikTok ad. Promoted to its own variable for symmetry with the other
  // two paid platforms.
  const ttclid = !!params['ttclid'];

  // Source priority chain. Apps Script Shopify.gs:963-984 + two prepended
  // branches:
  //   1. source_name overrides (fb/google/tiktok) — Shopify's checkout SDK
  //      writes source_name when the order arrives via the platform's
  //      channel app. More reliable than landing_site UTMs (which can be
  //      stripped by a redirect chain).
  //   2. Click-ID overrides (fbclid / gclid / ttclid) — the platform's
  //      JavaScript SDK tags the landing URL. Trumps UTM tags because the
  //      click-ID is canonical (platform-signed) whereas UTMs can be hand-
  //      typed / spoofed.
  let source: string;
  if (sourceName === 'fb' || sourceName === 'facebook') {
    source = 'meta-paid';
  } else if (sourceName === 'google') {
    source = 'google-paid';
  } else if (sourceName === 'tiktok') {
    source = 'tiktok-paid';
  } else if (fbclid) {
    source = 'meta-paid';
  } else if (gclid) {
    source = 'google-paid';
  } else if (ttclid) {
    source = 'tiktok-paid';
  } else if (/cpc|paid|paidsocial|social/i.test(utmMedium)) {
    if (/^(facebook|fb|meta|instagram|ig)$/i.test(utmSource)) source = 'meta-paid';
    else if (/^(google|youtube)$/i.test(utmSource)) source = 'google-paid';
    else if (/^tiktok$/i.test(utmSource)) source = 'tiktok-paid';
    else source = 'other-paid';
  } else if (/^(email|newsletter|klaviyo|mailchimp)$/i.test(utmSource)) {
    source = 'email';
  } else if (/^tiktok$/i.test(utmSource)) {
    // Tagged as TikTok but utm_medium isn't cpc/paid (e.g. organic share
    // from a TikTok creator). Still a TikTok-paid attribution under our
    // model because the click came from a paid placement — TikTok organic
    // doesn't generate utm_source=tiktok tagging in practice; only paid
    // creative does.
    source = 'tiktok-paid';
  } else if (utmSource) {
    // Tagged but unrecognised (influencer / partner / etc.)
    source = 'other-paid';
  } else if (/(facebook|fb|instagram|ig)\.com/.test(ref)) {
    source = 'meta-organic';
  } else if (/(google|youtube)\.com/.test(ref)) {
    source = 'google-organic';
  } else if (/tiktok\.com/.test(ref)) {
    // Organic TikTok referrer (someone shared the product link on TikTok
    // and a viewer clicked through). Treated as other-referral rather
    // than tiktok-paid — we keep tiktok-paid for ad-attributed traffic
    // only (ttclid / utm_source=tiktok). Future Phase D may split this
    // into 'tiktok-organic' if useful; for now 'other-referral' keeps
    // the source taxonomy clean.
    source = 'other-referral';
  } else if (ref) {
    source = 'other-referral';
  } else {
    source = 'direct';
  }

  // Keep referring site short for storage. Matches Apps Script line 987.
  const refTrimmed = ref.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 120);

  return {
    source,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmId,
    utmTerm,
    fbclidPresent: fbclid,
    gclidPresent: gclid,
    referrer: refTrimmed,
    firstTouchSource,
    firstFbclidPresent: firstFbclid,
    firstGclidPresent: firstGclid,
    firstTtclidPresent: firstTtclid,
    firstUtmSource: firstUtmSourceRaw || null,
    firstUtmMedium: firstUtmMediumRaw || null,
    firstUtmCampaign: firstUtmCampaignRaw || null,
    firstUtmContent: firstUtmContentRaw || null,
    firstUtmId: firstUtmIdRaw || null,
    firstUtmTerm: firstUtmTermRaw || null,
    firstSeenAt: firstSeenAtRaw || null,
  };
}

/**
 * Thin source-only wrapper for ingest paths (webhook sale + cart beacon) that
 * only need the resolved `source` label, not the full attribution object. Reuses
 * the SAME classifier the orders pipeline uses → the feed badge matches the
 * canonical dashboard attribution exactly.
 */
export function classifyOrderSource(input: {
  landing_site?: string | null;
  referring_site?: string | null;
  note_attributes?: Array<{ name?: string; value?: string }> | null;
  source_name?: string | null;
}): string {
  return classifyOrderAttribution({
    landing_site: input.landing_site ?? undefined,
    referring_site: input.referring_site ?? undefined,
    note_attributes: input.note_attributes ?? undefined,
    source_name: input.source_name ?? undefined,
  }).source;
}
