# External Integrations

**Analysis Date:** 2026-05-24

> Post-Phase-11 state. All external calls originate from Next.js server / Inngest functions (`dashboard-web/src/lib/fetchers/*.ts` and `dashboard-web/src/lib/notifications/*.ts`). Apps Script + Google Sheets tier is gone.

The dashboard integrates with **6 external HTTP APIs** plus **Supabase Postgres** as the only data store and **Inngest Cloud** as the only scheduler. All third-party calls go through 5 typed fetcher modules; all writes go through Inngest functions that UPSERT into Supabase via the service-role client.

## APIs & External Services

### Meta Marketing (Facebook Ads)

- **Purpose:** ad-set + ad-level insights, store-level spend, campaign + ad-set budgets + effective_status
- **Fetcher:** `dashboard-web/src/lib/fetchers/meta.ts`
- **API version:** `META_API_VERSION = 'v25.0'` (`meta.ts:51`). Bumped from v23.0 → v25.0 on 2026-05-22 ahead of the 2026-06-09 deprecation of every version <v24.0
- **Base URL:** `https://graph.facebook.com/v25.0`
- **Endpoints called:**
  - `GET /act_{adAccountId}/insights?level=adset` — paginated, 500/page, 50-page cap (`meta.ts:328-336`)
  - `GET /act_{adAccountId}/insights?level=ad` — `fetchMetaAdInsights` (`meta.ts:495`)
  - `GET /act_{adAccountId}/insights?level=account` — `fetchMetaSpendForDayLight` (cron-live cheap path, `meta.ts:433`)
  - `GET /act_{adAccountId}?fields=currency` — currency probe (`meta.ts:670-674`)
  - `GET /act_{adAccountId}/campaigns?fields=id,name,daily_budget,lifetime_budget,bid_strategy,status,effective_status` (`meta.ts:704-707`)
  - `GET /act_{adAccountId}/adsets?fields=id,name,campaign_id,daily_budget,lifetime_budget,status,effective_status` (`meta.ts:749-752`)
- **Auth:** access token as `?access_token=…` query-string param (Meta does NOT accept Bearer header for Marketing API). Token resolved by `getMetaToken()` at `meta.ts:233`
- **Env vars (per store):** `${STORE_UPPER}_META_ACCESS_TOKEN` (SECRET) + `${STORE_UPPER}_META_AD_ACCOUNT_ID` (CONFIG). Global fallback: `META_GLOBAL_TOKEN` (`meta.ts:236-238`)
- **Purchase priority chain:** `omni_purchase` → `purchase` → `offsite_conversion.fb_pixel_purchase` (`meta.ts:283`) — algorithm-parity gate
- **Pagination cap:** 50 pages = 25,000 ad-sets/day max; emits `console.warn` if hit

### Google Ads

- **Purpose:** ad-group + ad-level insights, customer-level spend, ad-group statuses for the dashboard "כבוי" chip
- **Fetcher:** `dashboard-web/src/lib/fetchers/googleAds.ts`
- **API version:** `GOOGLE_ADS_API_VERSION = 'v24'` (`googleAds.ts:60`). Path uses `v24` (major); release identifier is "v24.1"
- **Base URL:** `https://googleads.googleapis.com/v24`
- **OAuth URL:** `https://oauth2.googleapis.com/token` (refresh-token grant, `googleAds.ts:216`)
- **Endpoints called:**
  - `POST /v24/customers/{customerId}/googleAds:search` — GAQL query, paginated via `nextPageToken`, 50-page cap (`googleAds.ts:302-304`)
- **GAQL queries:**
  - `SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, customer.currency_code FROM ad_group WHERE segments.date = '{D}'` (`googleAds.ts:419-424`)
  - Same shape `FROM campaign` (Shopping/PMax fallback when ad-group totals are 0, `googleAds.ts:434-438`)
  - `SELECT … FROM ad_group_ad WHERE segments.date = '{D}' AND ad_group_ad.status = 'ENABLED'` (`googleAds.ts:599-606`)
  - `SELECT metrics.cost_micros, customer.currency_code FROM customer WHERE segments.date = '{D}'` (`googleAds.ts:367-370`)
  - `SELECT … FROM ad_group WHERE ad_group.status IN ('ENABLED', 'PAUSED')` — no date filter, status snapshot (`googleAds.ts:717-720`)
- **Auth:** OAuth2 refresh-token grant → 1h access token (cached in-process by storeId in `tokenCache` Map at `googleAds.ts:91`; 60s safety margin)
- **Headers:** `Authorization: Bearer {accessToken}` + `developer-token: {GOOGLEADS_DEVELOPER_TOKEN}` + optional `login-customer-id` (`googleAds.ts:253-275`)
- **Env vars:**
  - Global (SECRET): `GOOGLEADS_CLIENT_ID`, `GOOGLEADS_CLIENT_SECRET`, `GOOGLEADS_DEVELOPER_TOKEN`, `GOOGLEADS_REFRESH_TOKEN`
  - Global (CONFIG): `GOOGLEADS_LOGIN_CUSTOMER_ID`
  - Per store: `${STORE_UPPER}_GOOGLEADS_CUSTOMER_ID` (CONFIG) + optional `${STORE_UPPER}_GOOGLEADS_REFRESH_TOKEN` (per-store override)
- **Scope:** only `uzoshop` runs Google Ads (`STORES_WITH_GOOGLE_ADS = new Set(['uzoshop'])` at `googleAds.ts:73`). Other 2 stores short-circuit to spend=0 without calling the API
- **Pagination cap:** `GAQL_PAGE_CAP = 50` (`googleAds.ts:293`)

### TikTok Marketing (Business API)

- **Purpose:** ad-level insights + ad-group statuses + store-level spend + advertiser info
- **Fetcher:** `dashboard-web/src/lib/fetchers/tiktok.ts`
- **API version:** `TIKTOK_API_VERSION = 'v1.3'` (`tiktok.ts:54`)
- **Base URL:** `https://business-api.tiktok.com/open_api/v1.3` (`tiktok.ts:55`)
- **Endpoints called:**
  - `GET /open_api/v1.3/advertiser/info/` — currency + timezone probe, cached process-lifetime (`tiktok.ts:226`)
  - `GET /open_api/v1.3/report/integrated/get/` with `data_level=AUCTION_ADVERTISER` (single row store total, `tiktok.ts:282`)
  - `GET /open_api/v1.3/report/integrated/get/` with `data_level=AUCTION_AD` (per-ad rows, paginated 200/page, 50-page cap, `tiktok.ts:483`)
  - `GET /open_api/v1.3/adgroup/get/` — secondary_status + operation_status snapshot (`tiktok.ts:384`)
- **Auth:** `Access-Token: {token}` header (custom name, NOT Bearer — `tiktok.ts:152`)
- **Env vars (per store):** `${STORE_UPPER}_TIKTOK_ADVERTISER_ID` + `${STORE_UPPER}_TIKTOK_ACCESS_TOKEN` (`tiktok.ts:117-118`)
- **OAuth callback endpoint:** `dashboard-web/src/app/api/oauth/tiktok/callback/route.ts` — one-time `auth_code` capture, manual cURL exchange (bilingual EN/HE rendering for TikTok App reviewers)
- **Wire envelope:** every response `{ code, message, data, request_id }`; non-zero code → error (`tiktok.ts:166-171`)
- **Response shape quirks:** `advertiser_ids` MUST be JSON-quoted-string array; numeric IDs ≥ 2^53 corrupt without quoting (`tiktok.ts:230-238`)
- **Scope:** only `uzoshop` runs TikTok (`STORES_WITH_TIKTOK = new Set(['uzoshop'])` at `cronDaily.ts:86`)
- **Metric mapping:** `complete_payment` (count) + `value_per_complete_payment` (avg) → synthesized `conversionValue` (`tiktok.ts:526-532`)

### Shopify Admin REST

- **Purpose:** orders + refunds (revenue net-of-refunds algorithm), product catalog, per-order attribution
- **Fetcher:** `dashboard-web/src/lib/fetchers/shopify.ts`
- **Auth helper:** `dashboard-web/src/lib/fetchers/shopifyAuth.ts` (OAuth client-credentials grant, in-process token cache)
- **API version:** `SHOPIFY_API_VERSION = '2026-04'` (`shopify.ts:88`)
- **Base URL:** `https://{domain}/admin/api/2026-04`
- **OAuth URL:** `https://{domain}/admin/oauth/access_token` — grant_type=client_credentials (`shopifyAuth.ts:77-82`)
- **Endpoints called:**
  - `GET /admin/api/2026-04/orders.json?status=any&limit=250&created_at_min&created_at_max&fields=…` — Window A (same-day, `shopify.ts:410-417`)
  - `GET /admin/api/2026-04/orders.json?status=any&limit=250&updated_at_min&updated_at_max&fields=…` — Window B (cross-day refunds, open-ended upper bound, `shopify.ts:419-424`)
  - `GET /admin/api/2026-04/products.json?status=active&limit=250&fields=id,title,status,handle,image,variants,product_type,vendor,updated_at` (`shopify.ts:682-683`)
  - `GET /admin/api/2026-04/orders.json?status=any&financial_status=any&limit=250` — attribution variant (`shopify.ts:1022-1026`)
- **Auth:** `X-Shopify-Access-Token: {token}` header on every Admin REST call (`shopify.ts:474`)
- **Env vars (per store):**
  - `${STORE_UPPER}_SHOPIFY_DOMAIN` (CONFIG, e.g. `uzo-d-s-2.myshopify.com`)
  - `${STORE_UPPER}_SHOPIFY_CLIENT_ID` (CONFIG)
  - `${STORE_UPPER}_SHOPIFY_CLIENT_SECRET` (SECRET)
- **Stores:** all 3 stores use Shopify (uzoshop / zolplus / usmile360); see `STORE_NAMES` at `shopify.ts:114-118`
- **Token cache:** in-process Map keyed by storeId, 24h TTL (Dev Dashboard token lifetime), 60s pre-expiry refresh (`shopifyAuth.ts:42-58`)
- **Pagination:** `Link: <…>; rel="next"` header (cursor-based), 50-page cap = 12,500 orders/day max (`shopify.ts:104`)
- **Time zone:** `Asia/Jerusalem` for all day-window boundaries (`SHOPIFY_TZ` at `shopify.ts:94`); DST-aware `isoLocalMidnight()` helper resolves the offset by iteration

### Frankfurter (FX rates)

- **Purpose:** convert Meta + Google + TikTok + manual_overrides spend from source currency (ILS / USD / etc.) → CAD
- **Fetcher:** `dashboard-web/src/lib/fetchers/fx.ts`
- **Base URL:** `https://api.frankfurter.dev/v1`
- **Endpoint:** `GET /v1/{dateStr}?base={from}&symbols={to}` (`fx.ts:52`)
- **Auth:** none — Frankfurter is unauthenticated, no API key, no rate limit
- **Behavior:** weekend/holiday dates auto-shift to prior business day; code does NOT validate `body.date === dateStr` (intentional, see `fx.ts:19-26`)
- **Same-currency short-circuit:** returns 1 without HTTP call when `from === to`
- **No caching** (premature optimization for ~3 stores × 1 conversion/day load; Inngest step-level idempotency handles same-tick re-runs)

### WhatsApp Cloud API (Meta)

- **Purpose:** 3 daily ROAS summaries (12:00 / 18:00 / 00:30 Asia/Jerusalem) + token-failure alerts
- **Sender:** `dashboard-web/src/lib/notifications/whatsapp.ts`
- **Token-failure notifier:** `dashboard-web/src/lib/notifications/tokenFailures.ts`
- **API version:** `META_API_VERSION = 'v25.0'` (`whatsapp.ts:26`). Bumped 2026-05-22 ahead of 2026-06-09 cliff
- **Endpoint:** `POST https://graph.facebook.com/v25.0/{phoneNumberId}/messages` (`whatsapp.ts:131`)
- **Auth:** `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}` (`whatsapp.ts:154`)
- **Templates:**
  - `roas_daily_summary` (Hebrew, 5 placeholders) — daily summary; template name + lang stored in Supabase `notification_config`
  - `token_failure_alert` (English, 4 placeholders) — token-failure alerts (pending Meta approval per project memory)
- **Env vars (SECRET + CONFIG):** `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` + `NOTIFICATION_RECIPIENT_ALLOWLIST` (comma-separated phone digits, optional defensive allowlist gate at `whatsapp.ts:93-108`)
- **Recipients:**
  - Daily summary: `notification_config.phone1` + `phone2` (operator-editable via `/operator` UI; Supabase-backed)
  - Token-failure alerts: HARD-CODED to `+972524809540` (`tokenFailures.ts:85`) per operator instruction
- **Throttle:** `ALERT_THROTTLE_MS = 6 hours` per (provider, store_id, operation) key for token-failure alerts (`tokenFailures.ts:90`)
- **No Twilio:** `notification_config` row for twilio is `active=FALSE`; the TS port does not support Twilio (`whatsapp.ts:1-7`)

## Data Storage

**Databases:**
- **Supabase Postgres (hosted, free tier)**
  - Single project (`SUPABASE_URL` env var)
  - **Client factories:**
    - `getSupabase()` → anon key, read-only (`dashboard-web/src/lib/supabase.ts:30`)
    - `getSupabaseAdmin()` → service_role, used by every Inngest writer + operator API routes (`dashboard-web/src/lib/supabaseAdmin.ts:32`)
  - **Tables (13 migrations under `supabase/migrations/`):**
    - `stores` — seed: uzoshop / zolplus / usmile360 with `has_google_ads` flag
    - `data_daily` — per (date, store) revenue + spend + ROAS + COGS + net profit + TikTok spend + gross/refund/updated_at columns
    - `products_daily` — per-product per-day net + gross + units + orders
    - `campaigns_daily` — per (date, store, platform, campaign, ad_set) spend + value + status (with `effective_status`)
    - `ads_daily` — per-ad granularity rows (Meta + Google + TikTok)
    - `orders_attribution` — per-order attribution rows with line_items JSONB
    - `product_catalog` — current snapshot of active Shopify products
    - `manual_overrides` — operator-typed spend rows that REPLACE fetched spend per (date, store, platform)
    - `notification_config` — WhatsApp template name/lang + dashboard_url + phone1/phone2
    - `dashboard_state` — k/v store for billing/preferences/cloud-sync (read+write)
    - `token_failures` — provider/store/operation failure log with throttle clock
  - **Reads:** `dashboard-web/src/lib/postgresReaders.ts` (9 reader functions, `getSupabase()` anon)
  - **Writes:** every Inngest function calls `getSupabaseAdmin()` and UPSERTs with `ON CONFLICT`
- **RLS:** disabled on all tables (URL-obscurity trust model, single operator)

**File Storage:**
- Not applicable. No file uploads, no blob store. Operator console renders state from Postgres only.

**Caching:**
- In-process token caches:
  - Google Ads OAuth (`googleAds.ts:91`)
  - Shopify OAuth (`shopifyAuth.ts:42`)
  - TikTok advertiser info (`tiktok.ts:199`)
- Next.js HTTP cache: every `/api/*` GET route imports TTLs from `dashboard-web/src/lib/cacheConfig.ts` (literal `revalidate = N` per route segment, see `api/operator/jobs/route.ts:24-30` for the Pitfall-12 explanation)
- No Redis / Memcached / external cache.

## Authentication & Identity

**Auth provider:** None. The dashboard is single-operator and protected by URL-obscurity only (documented trust model). No login, no JWTs, no sessions.

**Service-to-service auth used inside the system:**
- Inngest signing key: `INNGEST_SIGNING_KEY` validates `X-Inngest-Signature` on every POST to `/api/inngest` (`route.ts:122-124`); auto-injected by Vercel-Inngest marketplace integration
- Supabase service-role key: `SUPABASE_SERVICE_ROLE_KEY` for all writers (never exposed client-side; explicit comment at `supabaseAdmin.ts:14-20`)

## Monitoring & Observability

**Error tracking:**
- Sentry (`@sentry/nextjs ^8.40.0`)
- Server config: `dashboard-web/sentry.server.config.ts` (gates on `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN`)
- Client config: `dashboard-web/sentry.client.config.ts` (gates on `NEXT_PUBLIC_SENTRY_DSN`; NO replay integration per privacy note)
- Edge config: `dashboard-web/sentry.edge.config.ts`
- Build wrapping: `withSentryConfig` in `dashboard-web/next.config.ts:15`
- Source maps: hidden (`hideSourceMaps: true`)
- Silent unless DSN is set (no-op no-warn)
- Env vars: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (build-time source-map upload)

**Logs:**
- `console.warn` / `console.error` only — read in Inngest run logs (Inngest Cloud UI), Vercel function logs, and Sentry breadcrumbs

**Job runs / operator console:**
- `dashboard-web/src/app/api/operator/jobs/route.ts` — proxies to Inngest REST v1 (`https://api.inngest.com/v1/events?…` + `/v1/events/{id}/runs`) using the same `INNGEST_SIGNING_KEY` as Bearer auth. Polled every 15s by the `/operator` page

**Token-failure log:**
- Supabase `token_failures` table — populated by `notifyTokenFailure()` calls at every fetcher error site; surfaced on `/operator > בעיות טוקן`

## CI/CD & Deployment

**Hosting:**
- Vercel — Next.js app; production URL referenced in `notification_config.dashboard_url` (`https://roas-dashboard-smoky.vercel.app` per PROPS-MAP example value)
- Auto-deploys on push to `main` (Vercel's GitHub integration)

**CI Pipeline:**
- No `.github/workflows/` for app deploys after Phase 11 (clasp/Apps Script CI removed). Vercel handles build + deploy. Inngest function registration happens via `PUT /api/inngest` from Inngest Cloud immediately after Vercel deploy completes (`route.ts:9-13`)

**Database migrations:**
- Supabase CLI (`supabase db push` against the linked cloud project). Discipline rules in `supabase/MIGRATION-DISCIPLINE.md` (additive-only tripwire)

## Environment Configuration

**Authoritative reference:** `docs/PROPS-MAP.md` — 43-row classification table (SECRET / CONFIG / DATA). Operator checklist gating environment seeding.

**Required env vars (production, by category):**

**Supabase (3):**
- `SUPABASE_URL` (CONFIG)
- `SUPABASE_ANON_KEY` (SECRET)
- `SUPABASE_SERVICE_ROLE_KEY` (SECRET)

**Inngest (2, auto-injected by Vercel-Inngest integration):**
- `INNGEST_EVENT_KEY` — consumed by `inngest.send()` from operator API routes
- `INNGEST_SIGNING_KEY` — consumed by `serve()` in `route.ts:122` AND by `api/operator/jobs/route.ts` as Bearer for Inngest REST v1

**Meta Marketing (per-store):**
- `${STORE_UPPER}_META_ACCESS_TOKEN` (SECRET) × 3
- `${STORE_UPPER}_META_AD_ACCOUNT_ID` (CONFIG) × 3
- `META_GLOBAL_TOKEN` (SECRET, optional dev-only fallback)

**Google Ads (global + per-store):**
- `GOOGLEADS_CLIENT_ID` (CONFIG)
- `GOOGLEADS_CLIENT_SECRET` (SECRET)
- `GOOGLEADS_DEVELOPER_TOKEN` (SECRET)
- `GOOGLEADS_LOGIN_CUSTOMER_ID` (CONFIG)
- `GOOGLEADS_REFRESH_TOKEN` (SECRET) — single global, currently used only by uzoshop
- `UZOSHOP_GOOGLEADS_CUSTOMER_ID` (CONFIG)
- Optional per-store override: `${STORE_UPPER}_GOOGLEADS_REFRESH_TOKEN`

**Shopify (per-store, OAuth client-credentials):**
- `${STORE_UPPER}_SHOPIFY_DOMAIN` (CONFIG) × 3 (e.g. `uzo-d-s-2.myshopify.com`, `2x1gqx-y0.myshopify.com`, `360usmile.myshopify.com`)
- `${STORE_UPPER}_SHOPIFY_CLIENT_ID` (CONFIG) × 3
- `${STORE_UPPER}_SHOPIFY_CLIENT_SECRET` (SECRET) × 3
- Legacy `${STORE_UPPER}_SHOPIFY_TOKEN` is NO LONGER USED (Phase 05.7.7 switched to OAuth; comment at `shopifyAuth.ts:1-12`)

**TikTok (per-store, currently uzoshop only):**
- `${STORE_UPPER}_TIKTOK_ADVERTISER_ID` (CONFIG)
- `${STORE_UPPER}_TIKTOK_ACCESS_TOKEN` (SECRET)

**WhatsApp Cloud:**
- `WHATSAPP_PHONE_NUMBER_ID` (CONFIG)
- `WHATSAPP_ACCESS_TOKEN` (SECRET — System User token, never-expires)
- `NOTIFICATION_RECIPIENT_ALLOWLIST` (CONFIG, optional; comma-separated phone digits; operator memory expects `+972524809540`)

**COGS (per-store, optional):**
- `${STORE_UPPER}_COGS_RATE` — 0..1 (`cronDaily.ts:109-121`). Default 0.25 (25%) when unset

**Sentry (optional):**
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`

**Secrets location:**
- Vercel project env vars (single source of production truth)
- `dashboard-web/.env.local` (gitignored, dev only; never read or copied here)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/inngest` — Inngest Cloud → Vercel function. Validates `X-Inngest-Signature` via `INNGEST_SIGNING_KEY` (`dashboard-web/src/app/api/inngest/route.ts:112-125`)
- `GET /api/inngest` + `PUT /api/inngest` — Inngest function registration (called by Inngest Cloud on every Vercel deploy)
- `GET /api/oauth/tiktok/callback?auth_code&state` — TikTok OAuth one-time landing page (`dashboard-web/src/app/api/oauth/tiktok/callback/route.ts:59`). Renders bilingual HTML; does NOT auto-exchange the code (operator runs cURL manually)

**Outgoing:**
- Inngest events fired via `inngest.send(...)`:
  - `event/sync-now` — from `/api/operator/sync-now` (`eventSyncNow.ts`)
  - `event/backfill` — from `/api/operator/backfill` (`eventBackfill.ts`)
  - `notifications/whatsapp.send-now` — from `/api/operator/notifications` (`cronWhatsapp.ts:133`)

## Inngest Function Inventory

Registered in `dashboard-web/src/app/api/inngest/route.ts:113-121`:

| Function | Type | Schedule / Trigger | File |
|---|---|---|---|
| `cron-daily-uzoshop` / `-zolplus` / `-usmile360` | cron × 3 | `TZ=Asia/Jerusalem 5 0 * * *` (00:05 IL daily) | `dashboard-web/src/inngest/functions/cronDaily.ts:1172` |
| `cron-live-uzoshop` / `-zolplus` / `-usmile360` | cron × 3 | `TZ=Asia/Jerusalem */10 * * * *` (every 10 min) | `dashboard-web/src/inngest/functions/cronLive.ts:1213` |
| `whatsapp-noon` | cron | `TZ=Asia/Jerusalem 0 12 * * *` | `dashboard-web/src/inngest/functions/cronWhatsapp.ts:52` |
| `whatsapp-evening` | cron | `TZ=Asia/Jerusalem 0 18 * * *` | `dashboard-web/src/inngest/functions/cronWhatsapp.ts:70` |
| `whatsapp-eod` | cron | `TZ=Asia/Jerusalem 30 0 * * *` | `dashboard-web/src/inngest/functions/cronWhatsapp.ts:104` |
| `event-sync-now` | event | `event/sync-now` | `dashboard-web/src/inngest/functions/eventSyncNow.ts` |
| `event-backfill` | event | `event/backfill` | `dashboard-web/src/inngest/functions/eventBackfill.ts:178` |
| `event-whatsapp-send-now` | event | `notifications/whatsapp.send-now` | `dashboard-web/src/inngest/functions/cronWhatsapp.ts:128` |

Total: **11 functions** (6 store-scoped crons + 3 WhatsApp crons + 3 operator-triggered events — `eventSyncNow` counted as 1 event function).

---

*Integration audit: 2026-05-24*
