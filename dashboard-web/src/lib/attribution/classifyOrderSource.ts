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

/**
 * Standard first-touch credit window (in days). A first-touch older than this
 * relative to the conversion time is ignored — the customer is NOT credited to
 * the paid platform that acquired them long ago. Adjustable here without
 * touching any call-site (all callers pass `conversionAt`; back-compat is
 * preserved for callers that don't).
 */
export const FIRST_TOUCH_WINDOW_DAYS = 30;

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

/**
 * Detect the ad platform from a (messy, real-world) `utm_source` value.
 *
 * Real ad utm_source values are far messier than clean platform names:
 * `Facebook_Mobile_Feed`, `Instagram_Stories`, `meta`, `ig`, `an` (Meta
 * Audience Network), `goog`, Hebrew `פייסבוק`, etc. The original strict
 * exact-match (`^(facebook|fb|meta|instagram|ig)$`) demoted ALL of these to
 * `other-paid` — which the activity feed renders as a neutral "ישיר" chip and
 * which under-attributed real paid traffic everywhere the canonical source is
 * consumed (NC-ROAS, cohorts, reconciliation, product-channel, unknown bucket).
 *
 * "Balanced" ruleset (calibrated from production `orders_attribution`, 2026-06):
 * a substring of a full brand name (incl. Hebrew) OR a known platform
 * token/abbreviation. Separable tokens (fb/ig/meta/goog/...) allow a
 * `_`/`-`/`.`/space suffix (e.g. `fb_retargeting`, `ig-story`); fuzzy/short
 * abbreviations (fa/face/faceb/an/msg/messenger) match ONLY standalone so they
 * can't false-positive ("fashion" ↛ meta, "an-influencer" ↛ Audience Network).
 *
 * Returns 'meta' | 'google' | 'tiktok', or null when the source is not a
 * recognizable ad platform (caller keeps email / other-paid / referral / direct).
 */
export function detectAdPlatform(
  rawUtmSource: string | null | undefined,
): 'meta' | 'google' | 'tiktok' | null {
  const s = String(rawUtmSource ?? '').trim().toLowerCase();
  if (!s) return null;

  // Meta — full brand names as substrings (Facebook_Mobile_Feed, Instagram_Stories, Hebrew).
  if (/facebook|instagram|פייסבוק|אינסטגרם/.test(s)) return 'meta';
  // Meta — separable tokens (fb, ig, meta + optional _/-/./space suffix).
  if (/^(fb|ig|meta)([_\-. ].*)?$/.test(s)) return 'meta';
  // Meta — standalone-only abbreviations & networks (typo-abbrevs, audience network, messenger).
  if (/^(fa|face|faceb|an|msg|messenger)$/.test(s)) return 'meta';

  // Google — full names as substrings, then separable tokens.
  if (/google|youtube|גוגל|יוטיוב/.test(s)) return 'google';
  if (/^(goog|gads|gdn)([_\-. ].*)?$/.test(s)) return 'google';

  // TikTok — full names as substrings, then separable tokens.
  if (/tiktok|bytedance|טיקטוק/.test(s)) return 'tiktok';
  if (/^(tt)([_\-. ].*)?$/.test(s)) return 'tiktok';

  return null;
}

/**
 * Email-channel detection (diag 2026-06). The original strict
 * `^(email|newsletter|klaviyo|mailchimp)$` missed real values like
 * `shopify_email` (utm_source) sent with `utm_medium=email`. Treat as email
 * when EITHER the medium is `email` OR the source contains an email-platform
 * token at a word boundary (so `shopify_email`, `foo_email`, `klaviyo`,
 * `newsletter` all match; `wholesalemail` would NOT — the `_`/start anchor
 * guards against accidental substrings). The original exact values still match.
 */
export function isEmailSignal(
  rawUtmSource: string | null | undefined,
  rawUtmMedium: string | null | undefined,
): boolean {
  if (String(rawUtmMedium ?? '').trim().toLowerCase() === 'email') return true;
  return /(^|_)(email|newsletter|klaviyo|mailchimp)/i.test(String(rawUtmSource ?? ''));
}

/**
 * Extract a normalized host from a URL or a Shopify `landing_site`/`referring_site`
 * string. Lower-cased, `www.` stripped. Returns '' for relative paths (no host)
 * and for app-scheme referrers (`android-app://…`). Tolerant of a missing
 * scheme (`example.com/x`) by probing the first path segment for a dotted host.
 */
function hostOf(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // App schemes (android-app://, ios-app://) are not web hosts.
  if (/^[a-z][a-z0-9+.-]*-app:/i.test(s)) return '';
  let host = '';
  try {
    host = new URL(s).hostname;
  } catch {
    // No scheme — try a protocol-relative / bare-host form.
    const m = s.match(/^(?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#]|$)/i);
    if (m) host = m[1];
  }
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Self-referral: the referrer host equals the store's own landing host (diag
 * 2026-06 — 360usmile.com → 360usmile.com, uzoshop.com → uzoshop.com). These
 * are internal navigations, NOT external referrals. Requires BOTH hosts to be
 * resolvable and equal; a relative `landing_site` (no host) → no match, so the
 * referrer is treated as a normal external referral.
 */
function isSelfReferral(
  rawReferrer: string | null | undefined,
  rawLanding: string | null | undefined,
): boolean {
  const refHost = hostOf(rawReferrer);
  const landHost = hostOf(rawLanding);
  return refHost !== '' && landHost !== '' && refHost === landHost;
}

export function classifyOrderAttribution(
  order: ShopifyOrderPayload,
  opts?: {
    /**
     * ISO-8601 timestamp of the conversion event (order `created_at` or ATC
     * `occurred_at`). When provided together with a parseable `_ft_set_at`, the
     * freshness gate fires: a first-touch older than FIRST_TOUCH_WINDOW_DAYS is
     * dropped and the order is treated as if no first-touch was present.
     *
     * Back-compat: callers that omit this (or pass an unparseable string) always
     * honor the first-touch regardless of age — existing data is unaffected.
     */
    conversionAt?: string;
  },
): {
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

  // ---- First-touch freshness gate ----
  // When BOTH firstSeenAtRaw (_ft_set_at) AND opts.conversionAt are present
  // and parseable, drop the entire first-touch if the click is older than
  // FIRST_TOUCH_WINDOW_DAYS. This prevents a Meta/Google/TikTok first-touch
  // from months ago from crediting a paid platform on a conversion that is
  // effectively direct or last-touch-driven.
  //
  // Back-compat: if either timestamp is missing or unparseable the gate does
  // NOT fire — callers that omit conversionAt behave exactly as before.
  let firstTouchDropped = false;
  if (firstSeenAtRaw && opts?.conversionAt) {
    const seenMs = Date.parse(firstSeenAtRaw);
    const convMs = Date.parse(opts.conversionAt);
    if (Number.isFinite(seenMs) && Number.isFinite(convMs)) {
      const ageMs = convMs - seenMs;
      const windowMs = FIRST_TOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > windowMs) firstTouchDropped = true;
    }
  }

  const hasFirstSignal =
    firstFbclid || firstGclid || firstTtclid ||
    !!firstUtmSourceRaw || !!firstUtmCampaignRaw || !!firstUtmContentRaw ||
    !!firstUtmIdRaw || !!firstUtmTermRaw || !!firstSeenAtRaw;

  // TRIMMED chain over ONLY ft_* keys — NO source_name, NO referring_site.
  // Uses the SAME broadened platform detection as the last-touch chain so a
  // messy first-click utm_source (Instagram_Feed, meta, ...) is recognized too.
  const firstUtmPlatform = detectAdPlatform(firstUtmSourceRaw);
  let firstTouchSource: string | null = null;
  if (hasFirstSignal) {
    if (firstFbclid) firstTouchSource = 'meta-paid';
    else if (firstGclid) firstTouchSource = 'google-paid';
    else if (firstTtclid) firstTouchSource = 'tiktok-paid';
    else if (firstUtmPlatform === 'meta') firstTouchSource = 'meta-paid';
    else if (firstUtmPlatform === 'google') firstTouchSource = 'google-paid';
    else if (firstUtmPlatform === 'tiktok') firstTouchSource = 'tiktok-paid';
    else if (isEmailSignal(firstUtmSourceRaw, firstUtmMediumRaw)) {
      // Symmetric with last-touch email broadening (shopify_email / medium=email).
      firstTouchSource = 'email';
    } else if (firstUtmMediumRaw.toLowerCase() === 'product_sync') {
      // Symmetric with last-touch Google Merchant product-feed sync.
      firstTouchSource = 'google-paid';
    } else if (/cpc|paid|paidsocial|social/i.test(firstUtmMediumRaw)) {
      // Paid medium but utm_source isn't a recognizable platform → paid, unknown.
      firstTouchSource = 'other-paid';
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
  // Broadened platform detection from a (messy) utm_source — see detectAdPlatform.
  // This subsumes the old strict `^(facebook|fb|meta|instagram|ig)$` checks AND
  // the dedicated `utm_source=tiktok` fallback: a platform-named source maps to
  // that platform regardless of utm_medium (matches historical behavior where
  // `facebook` with no/odd medium was still meta-paid).
  const utmPlatform = detectAdPlatform(utmSource);

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
  } else if (utmPlatform === 'meta') {
    source = 'meta-paid';
  } else if (utmPlatform === 'google') {
    source = 'google-paid';
  } else if (utmPlatform === 'tiktok') {
    source = 'tiktok-paid';
  } else if (isEmailSignal(utmSource, utmMedium)) {
    // Email broadening (diag 2026-06): `shopify_email` + `utm_medium=email`
    // were misclassified as other-paid. Match utm_medium=email OR a source
    // that contains an email-platform token (shopify_email, *_email, klaviyo…).
    source = 'email';
  } else if (utmMedium.toLowerCase() === 'product_sync') {
    // Google Merchant Center product-feed sync (diag: utm_source=g,
    // utm_medium=product_sync). The medium is the reliable signal — a bare
    // utm_source=g is too ambiguous to map on its own.
    source = 'google-paid';
  } else if (/cpc|paid|paidsocial|social/i.test(utmMedium)) {
    // Paid medium but utm_source is not a recognizable platform (influencer /
    // partner / etc.) — still paid, unknown platform.
    source = 'other-paid';
  } else if (utmSource) {
    // Tagged but unrecognised (influencer / partner / share link / etc.)
    source = 'other-paid';
  } else if (isSelfReferral(ref, landing)) {
    // Self-referral: the referrer host equals the store's own landing host
    // (diag: 360usmile.com → 360usmile.com, uzoshop.com → uzoshop.com). This
    // is internal navigation, NOT an external referral — fall through to the
    // no-signal `direct` bucket. Runs AFTER the paid/email checks so it never
    // swallows a real paid click on a same-host landing page.
    source = 'direct';
  } else if (/(facebook|fb|instagram|ig)\.com/.test(ref)) {
    source = 'meta-organic';
  } else if (/(google|youtube)\.com/.test(ref)) {
    source = 'google-organic';
  } else if (/tiktok\.com/.test(ref)) {
    // Organic TikTok referrer (someone shared the product link on TikTok and a
    // viewer clicked through). Kept distinct from tiktok-paid (ad-attributed
    // only: ttclid / utm_source=tiktok) — it is a not-paid organic channel.
    source = 'tiktok-organic';
  } else if (/(^|\.)(bing\.com|duckduckgo\.com|ecosia\.org|search\.yahoo\.com)/.test(ref)) {
    // Non-Google search engines → organic search (google.com/youtube.com stay
    // google-organic; facebook/instagram stay meta-organic, both above).
    source = 'search-organic';
  } else if (/^(android-app|ios-app):/.test(ref) || /^[a-z][a-z0-9+.-]*-app:/.test(ref)) {
    // In-app browser referrers (Gmail app, etc.) surface as `android-app://…`
    // / `ios-app://…` — an app entry point, not a web referral.
    source = 'app-referral';
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
    // First-touch fields: zeroed out when the freshness gate fires.
    firstTouchSource:      firstTouchDropped ? null : firstTouchSource,
    firstFbclidPresent:    firstTouchDropped ? false : firstFbclid,
    firstGclidPresent:     firstTouchDropped ? false : firstGclid,
    firstTtclidPresent:    firstTouchDropped ? false : firstTtclid,
    firstUtmSource:        firstTouchDropped ? null : (firstUtmSourceRaw || null),
    firstUtmMedium:        firstTouchDropped ? null : (firstUtmMediumRaw || null),
    firstUtmCampaign:      firstTouchDropped ? null : (firstUtmCampaignRaw || null),
    firstUtmContent:       firstTouchDropped ? null : (firstUtmContentRaw || null),
    firstUtmId:            firstTouchDropped ? null : (firstUtmIdRaw || null),
    firstUtmTerm:          firstTouchDropped ? null : (firstUtmTermRaw || null),
    firstSeenAt:           firstTouchDropped ? null : (firstSeenAtRaw || null),
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
