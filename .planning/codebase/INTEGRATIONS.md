# External Integrations

**Analysis Date:** 2026-05-18

This system integrates **five external APIs** plus a **Google Sheets data plane** that sits between the Apps Script collector and the Next.js dashboard. There are no internal microservices, no message queues, no webhook endpoints exposed to third parties. All cross-system communication funnels through one Google spreadsheet.

## APIs & External Services

### Shopify Admin API (per-store, 3 stores)

**Used for:** Daily revenue, order-level attribution signals (`landing_site`, `referring_site`, `note_attributes`), per-order line items (product breakdown), full product catalog, Shopify plan name.

**Endpoints called from Apps Script:**

| Endpoint | Where | Purpose |
|----------|-------|---------|
| `GET /admin/api/2024-10/orders.json?status=any&financial_status=any&fields=id,current_total_price,financial_status,test` | `Shopify.gs:getShopifyRevenue` | Daily revenue sum (excludes `test` and `voided` orders) |
| `GET /admin/api/2024-10/orders.json?...&fields=id,financial_status,test,line_items,refunds` | `Shopify.gs:getShopifyProductSalesForDay` | Per-product daily sales — units, gross/net revenue with line-item refund attribution |
| `GET /admin/api/2024-10/orders.json?...&fields=id,current_total_price,financial_status,test,landing_site,referring_site,note_attributes,source_name,line_items` | `Shopify.gs:getShopifyOrdersAttribution` (`Shopify.gs:516`) | Per-order attribution pipeline (see "Data Flow" below) |
| `GET /admin/api/2024-10/products.json` | `Shopify.gs:getShopifyProductsCatalog` | Full active-product catalog (for `ProductPickerModal`) |
| `POST /admin/api/2024-10/graphql.json` | `Shopify.gs:getShopifyPlan` (line ~329) | Shopify plan name (`{ shop { plan { displayName } } }`) — written to `store-meta` |
| `POST /admin/oauth/access_token` (Client Credentials Grant) | `Shopify.gs:bootstrapShopifyToken` | Mint a fresh `shpat_…` token when the stored one returns 401 |

**SDK/Client:** None. Direct `UrlFetchApp.fetch` (wrapped by `Config.gs:fetchWithRetry_`).

**API version:** `2024-10` (`Config.gs:SHOPIFY_API_VERSION`). The Apps Script side speaks REST primarily, with one GraphQL call (`getShopifyPlan`).

**Auth:**
- **Custom App Admin Access Token** (`shpat_…`) per store, sent as `X-Shopify-Access-Token` header.
- **Auto-bootstrap on 401** is unique to this codebase: if a Shopify call returns 401, `Shopify.gs:tryAutoBootstrapShopify_` performs a Client Credentials Grant against the store's Dev Dashboard app (using stored `clientId` + `clientSecret`), saves the new token to `{storeId}.shopify.token` Script Property, and retries the original request once. Bootstrapping is guarded by a `bootstrapTried` flag so a permanently bad credential cannot loop.
- Two onboarding flows exist (Path A = classic "Reveal token once"; Path B = Dev Dashboard + Client Credentials Grant). Both produce the same `shpat_…` token at runtime. See `SETUP.md` Step 1 for the full ladder. Path B is the only one that supports auto-refresh; Path A stores require manual token rotation when expired.

**Pagination & rate limiting:**
- Cursor-based via `Link: <url>; rel="next"` response header. `Shopify.gs:getShopifyRevenue` parses this with a regex.
- Safety cap of 50 pages per call — beyond that, a `WARNING` is logged but the run completes.
- 429 responses → `Utilities.sleep(2000)` then retry the same URL.

**Stores configured:**
- `uzoshop` → `uzo-d-s-2.myshopify.com`
- `zolplus` → `2x1gqx-y0.myshopify.com`
- `usmile360` → `360usmile.myshopify.com`

### Meta Marketing API (Facebook + Instagram Ads)

**Used for:** Ad spend + insights at three levels (account, ad-set, ad), campaign + ad-set budgets (current state, for CBO/ABO detection).

**Endpoints called from `MetaAds.gs`:**

| Endpoint | Function | Purpose |
|----------|----------|---------|
| `GET /v20.0/act_{adAccountId}/insights?level=adset&time_range={since,until}&fields=campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,action_values,account_currency` | `getMetaAdSetInsights` | Per-ad-set daily insights |
| `GET /v20.0/act_{adAccountId}/insights?level=ad&...` | `getMetaAdInsights` | Per-ad daily insights (Meta only — no equivalent on Google) |
| `GET /v20.0/act_{adAccountId}/insights?level=account&...` | `getMetaSpend` | Account-level daily spend |
| `GET /v20.0/act_{adAccountId}/campaigns` / `…/adsets` | `getMetaBudgets` | Current campaign + ad-set budgets (for CBO/ABO state) |

**SDK/Client:** None. Direct REST via `fetchWithRetry_`.

**API version:** `v20.0` (`Config.gs:META_API_VERSION`).

**Auth:**
- **System User access token** (does not expire). One token per Business Portfolio. A user may have 2-3 tokens covering 3 ad accounts.
- Stored at `{storeId}.meta.accessToken` (per-store override) with fallback to global `meta.accessToken`. The lookup pattern is consistent: `getProp(${storeId}.meta.accessToken) || getProp('meta.accessToken')`.
- Token passed as `access_token` query parameter (Meta convention).
- Required scopes on the System User token: `ads_read`, `business_management`. The Meta app stays in Development mode — System User tokens work in Development for Marketing API reads.

**Conversion extraction quirk** (`MetaAds.gs:extractMetaPurchases_`):
- Iterates the `actions` array looking for `omni_purchase` first, then `purchase`, then `offsite_conversion.fb_pixel_purchase`. The same priority applies to `action_values`.
- This is important: Meta's API does not return a single normalized `conversions` field; the consumer has to choose which action type maps to "purchase" in their attribution model.

**Pagination & safety:**
- Cursor pagination via `body.paging.next` in the JSON response.
- Same 50-page safety cap as Shopify.

**Currency:** Meta returns spend in the **ad account's local currency** (ILS for these stores) via `account_currency`. The Apps Script converts to CAD using `FX.getFxRate` before writing.

**URL Parameters convention (operational requirement, not enforced in code):**
Meta Ads Manager must be configured per ad account with:
```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&...
```
This is what makes the attribution pipeline (below) tier-1 deterministic. Without it, attribution falls back to product-mapping heuristics.

### Google Ads API (uzoshop only)

**Used for:** Daily ad spend, per-ad-group insights (with shopping/PMax fallback to campaign-level).

**Endpoints called from `GoogleAds.gs`:**

| Endpoint | Function | Purpose |
|----------|----------|---------|
| `POST https://googleads.googleapis.com/v20/customers/{customerId}/googleAds:search` with GAQL query selecting from `ad_group` | `getGoogleAdsAdGroupInsights` | Per-ad-group daily metrics |
| Same endpoint, query from `campaign` | `getGoogleAdsAdGroupInsights` (fallback path) | Campaign-level fallback for Shopping / Performance Max where ad-group data is all zeros |
| Same endpoint, query from `customer` | `getGoogleAdsSpend` | Account-level total spend |
| `POST https://oauth2.googleapis.com/token` | `getGoogleAdsAccessToken_` | Exchange refresh token for access token |

**SDK/Client:** None. Direct REST via `fetchWithRetry_`, GAQL strings hand-built.

**API version:** `v20` (`Config.gs:GOOGLE_ADS_API_VERSION`).

**Auth (OAuth 2.0 refresh-token flow):**
- Four credentials live in Script Properties:
  - `googleads.developerToken` — Approved on the Google Ads Manager (MCC) account. Test access is sufficient for own-account reads (~22 chars).
  - `googleads.clientId` + `googleads.clientSecret` — From a Google Cloud OAuth Client (Web application type, with `https://developers.google.com/oauthplayground` as authorized redirect URI).
  - `googleads.refreshToken` — Obtained one-time via OAuth Playground with scope `https://www.googleapis.com/auth/adwords`. Never expires (until user revokes or password changes).
- Optional: `googleads.loginCustomerId` (no dashes) — required when the account is under an MCC. Sent as `login-customer-id` HTTP header.
- Per store: `{storeId}.googleads.customerId` (no dashes).
- **Access token caching:** `getGoogleAdsAccessToken_` caches the refresh-issued access token in `CacheService.getScriptCache()` for `max(60, expires_in - 120)` seconds. This avoids re-issuing on every per-store call within the daily run.

**Cost units:** Google returns `cost_micros` (1/1,000,000 of account currency). The collector divides by 1,000,000 and treats the result as CAD (uzoshop's account is CAD-native).

**Shopping/PMax fallback:** The `ad_group` query returns rows with all-zero metrics for Shopping/PMax campaigns. `GoogleAds.gs:getGoogleAdsAdGroupInsights` falls back to a `campaign`-level query for those, synthesizing a single row with `adSetName = '(רמת קמפיין)'` (Hebrew: "campaign level") to signal aggregation.

### Frankfurter (FX rates)

**Used for:** Daily exchange rates ILS/USD/EUR → CAD.

**Endpoint:** `GET https://api.frankfurter.dev/v1/{dateStr}?base={from}&symbols={to}` — see `FX.gs:14`.

**Auth:** None. Free, public, no key required. Based on ECB rates.

**Caching:** Per `(from, to, date)` triple, cached in `CacheService.getScriptCache()` for **21,600 seconds (6 hours)**. Weekend/holiday dates automatically return the previous business day's rate (handled by Frankfurter, not the client).

**Why this and not another provider:** Reliability + zero auth surface + ECB-anchored rates. The codebase comment in `FX.gs:2` explicitly calls out the weekend handling.

### Google Sheets API (the data plane)

**Used as the cross-system bus.** Apps Script writes, the Next.js dashboard reads (mostly). Two clients with different auth and different scopes:

**Apps Script side:**
- Uses the native `SpreadsheetApp` global (built into the runtime, no SDK).
- Runs under the script owner's identity — needs `https://www.googleapis.com/auth/spreadsheets` + `drive` scopes (declared in `appsscript.json`).
- The owner must be an Editor on the target sheet.
- The spreadsheet ID is stored in `spreadsheet.id` Script Property (and emergency-recovery copy at `spreadsheet.canonical-id`).
- Retry logic: `ensureSpreadsheet()` in `SheetBuilder.gs` retries 3× with backoff on timeout, and explicitly **does not create a new spreadsheet on timeout** (a historical bug that produced phantom spreadsheets).

**Dashboard side (`dashboard-web/src/lib/sheets.ts`):**
- Uses `googleapis ^144.0.0`. `google.auth.GoogleAuth` with `credentials: { client_email, private_key }` from env vars.
- **Scope split by intent:**
  - `https://www.googleapis.com/auth/spreadsheets.readonly` for every read (default — `getAuth(false)`)
  - `https://www.googleapis.com/auth/spreadsheets` (write) only for `upsertDashboardStateKey`. `getAuth(true)` is only called from that single function.
- All reads use `valueRenderOption: 'UNFORMATTED_VALUE'` so dates come as serial numbers; `parseDate()` in `sheets.ts` handles both Excel serials and ISO strings.

**Tab layout (8 logical tab types in the single spreadsheet):**

| Tab | Written by | Read by dashboard via |
|-----|-----------|----------------------|
| `data-daily` | Apps Script (1 row per day×store) | `/api/data` |
| `products-daily` | Apps Script | `/api/products` |
| `{storeId}-campaigns` (×3) | Apps Script | `/api/campaigns` |
| `{storeId}-ads` (×3) | Apps Script | `/api/ads` |
| `{storeId}-orders-attribution` (×3) | Apps Script | `/api/orders-attribution` |
| `{storeId}-products-catalog` (×3) | Apps Script (manual: `refreshAllProductCatalogs`) | `/api/product-catalog` |
| `store-meta` | Apps Script | `/api/store-meta` |
| `dashboard-state` | Dashboard (write-through from clients) | `/api/dashboard-state` |
| `manual-spend` | User (manual editing) | Apps Script reads as API override |
| Visible legacy tabs: `סיכום`, `uzoshop`, `Zol Plus`, `360usmile` | Apps Script (formulas) | Not read by dashboard |

## Data Storage

**Primary store:** A single Google Sheets spreadsheet. The ID is in env vars (Vercel) and Script Properties (Apps Script). Tab purposes documented above.

**No databases.** No Postgres, no MongoDB, no SQLite. The spreadsheet is the system's only persistent data layer.

**File Storage:** None. No file uploads, no image storage. Product images are referenced by URL pointing at Shopify's CDN (`{storeId}-products-catalog` rows store `imageUrl` from Shopify's `product.image.src`).

**Caching:**
- `CacheService.getScriptCache()` in Apps Script — FX rates (6h), Google Ads access token (~58 min).
- `Cache-Control: s-maxage=… stale-while-revalidate=…` on every Next.js API route — Vercel CDN edge cache.
- SWR client-side in-memory dedupe (30s-1h depending on route).

## Authentication & Identity

**There is no end-user authentication.** The dashboard is publicly accessible at `https://roas-dashboard-smoky.vercel.app` (per `SYSTEM_OVERVIEW.md` line 942). It relies on URL obscurity for access control. There is no login screen, no session management, no user accounts.

**Service identities (machine):**

| Identity | Used for | Lives where |
|----------|---------|------------|
| Apps Script script owner (Google user) | Spreadsheet write, trigger execution, error emails | Manifest OAuth scopes |
| Dashboard service account (`*-reader@*.iam.gserviceaccount.com`) | Server-side spreadsheet read + dashboard-state write | `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` Vercel env vars |
| Shopify Custom App tokens (×3 stores) | Shopify Admin reads | `{storeId}.shopify.token` Script Property |
| Meta System User tokens (×2 portfolios) | Meta Marketing API reads | `{storeId}.meta.accessToken` or global `meta.accessToken` |
| Google Ads refresh token | Google Ads API reads | `googleads.refreshToken` Script Property |

**Defense-in-depth on dashboard-state writes** (`dashboard-web/src/app/api/dashboard-state/route.ts`):
- `isAllowedStateKey` allowlist gates POST requests to a fixed set of 7 keys (`billing-recurring`, `billing-onetime`, `annotations`, `monthly-revenue-goal`, `insight-states`, `campaign-optimized`, `campaign-product-map` — see `dashboard-web/src/lib/sheets.ts:231`).
- Prototype-pollution guard: even if a row reached the sheet with key `__proto__`, the read uses `Object.create(null)` so it can't mutate `Object.prototype`.
- `userFacingError` (in the same file) sanitizes Google API error messages so spreadsheet ID and service-account email never reach the client UI.

## Monitoring & Observability

**Error Tracking:**
- **No third-party error tracker** (no Sentry, no Datadog, no Rollbar).
- Apps Script side: `console.log`/`Logger.log` → Stackdriver via the manifest's `exceptionLogging: "STACKDRIVER"`. Operators inspect via Apps Script editor → Executions / View → Logs.
- Dashboard side: `console.error` → Vercel runtime logs. The `userFacingError` function (`dashboard-web/src/app/api/dashboard-state/route.ts:18`) translates server errors to sanitized Hebrew strings for the UI.

**Error notifications:**
- `DailyUpdate.gs:notifyError_` sends email via `MailApp.sendEmail` (uses Apps Script's built-in mail quota) when a daily run fails for one or more stores.
- Recipient is resolved via 3-tier fallback: `notification.email` Script Property → `Session.getActiveUser().getEmail()` → script owner (default trigger-failure email).

**Sync status UI:**
- `dashboard-web/src/components/SyncIndicator.tsx` shows a pill in the header (idle / syncing / ok / error). On error, clicking reveals a popover with the sanitized error + checklist (Editor permission, env vars set).
- Updated every 30s by the cloud-sync polling tick.

**Logs:** Stackdriver (Apps Script) + Vercel function logs (dashboard). No centralized log aggregation.

## CI/CD & Deployment

**Hosting:**
- **Apps Script:** script.google.com — Google-managed, no deployment artifact. Code is edited live in the web IDE (or pushed via `clasp` — see `.clasp.json` in `.gitignore`).
- **Next.js dashboard:** Vercel. Project name `roas-dashboard` (per `SYSTEM_OVERVIEW.md`).

**CI Pipeline:**
- **None for Apps Script.** Code changes are propagated manually (copy-paste into the editor, or `clasp push`).
- **Vercel auto-deploy** for the dashboard: every `git push` to `main` triggers a Vercel build → preview/production deploy. There is no `.github/workflows/` directory, no separate CI yaml.

**No pre-commit hooks** — `.git/hooks/` is gitignored standard, and no `husky` / `lint-staged` is in `dashboard-web/package.json`.

**Build:**
- Apps Script: no build step (V8 reads `.gs` files directly).
- Dashboard: `next build` invoked by Vercel on every push. Outputs `.next/` (gitignored at `dashboard-web/.gitignore:2`).

## Environment Configuration

### Required env vars (`dashboard-web` — Vercel)

| Variable | Where set | Used in |
|----------|-----------|---------|
| `GOOGLE_CLIENT_EMAIL` | Vercel encrypted env | `dashboard-web/src/lib/sheets.ts:10` |
| `GOOGLE_PRIVATE_KEY` | Vercel encrypted env | `dashboard-web/src/lib/sheets.ts:11` (newlines normalized at load) |
| `SPREADSHEET_ID` | Vercel encrypted env | `dashboard-web/src/lib/sheets.ts:36` |

Template at `dashboard-web/.env.local.example` (committed); actual values live in `dashboard-web/.env.local` (gitignored).

### Required Script Properties (Apps Script)

The full list is in `SETUP.md` Step 4. Categories:

**Global:**
- `meta.accessToken` (optional — only when all ad accounts share one Business)
- `googleads.developerToken`
- `googleads.clientId`, `googleads.clientSecret`, `googleads.refreshToken`
- `googleads.loginCustomerId` (optional, for MCC)
- `notification.email` (optional, for error alerts)
- `spreadsheet.id` (auto-populated by `setupAll`; recovery via `spreadsheet.canonical-id`)

**Per-store (×3 stores: `uzoshop`, `zolplus`, `usmile360`):**
- `{storeId}.shopify.domain` — always required
- `{storeId}.shopify.token` — Path A or auto-bootstrapped Path B
- `{storeId}.shopify.clientId` + `clientSecret` — Path B only
- `{storeId}.meta.accessToken` — if ad account is in a separate Business
- `{storeId}.meta.adAccountId` — always required
- `{storeId}.googleads.customerId` — only if `hasGoogleAds: true` (uzoshop)

**Secrets storage:**
- Apps Script: `PropertiesService.getScriptProperties()` — encrypted at rest by Google, never in source.
- Vercel: encrypted env vars.
- **Never** committed to git. `.env.local` and `.clasp.json` are gitignored.

## Webhooks & Callbacks

**Incoming webhooks:** None. The system has no public endpoints accepting external webhooks. Shopify webhooks are not used — data is pulled.

**Outgoing webhooks:** None. The system does not call any third-party webhook URLs.

## Triggers & Scheduling

**Apps Script time-based triggers** (installed by `Main.gs:setupAll` / `installDailyTrigger` / `installLiveTrigger`):

| Trigger | Handler | Schedule |
|---------|---------|----------|
| Daily | `runDailyUpdate` | 00:05 Asia/Jerusalem — closes yesterday's data |
| Live | `runLiveUpdate` | Every 15 minutes — refreshes today's data |

Both triggers are configured via `ScriptApp.newTrigger(...).timeBased()...create()`. Installing the daily trigger also fires an immediate execution to catch up yesterday without waiting for midnight.

**Vercel deploy trigger:** `git push origin main` → Vercel auto-deploys the dashboard.

**No other schedulers.** No cron jobs, no external scheduler services, no GitHub Actions schedules.

## Data Flow

### Daily collection cycle

```
00:05 IL ─ runDailyUpdate(yesterday) on Apps Script triggers
         ↓
         for each store in [uzoshop, zolplus, usmile360]:
           sleep(1500ms) between stores      ← quota relief
           ↓
           Shopify Admin REST:
             - GET /orders.json (revenue)           → CAD sum
             - GET /orders.json (orders-attribution) → classify each order
             - GET /orders.json (product breakdown) → product-day rows
           ↓
           Meta Marketing API v20:
             - GET /act_X/insights?level=adset  (campaigns table)
             - GET /act_X/insights?level=ad     (ads table — Meta only)
             - GET /act_X/insights?level=account (totals)
             - GET /act_X/campaigns + /act_X/adsets (budgets)
           ↓
           Google Ads API v20 (uzoshop only):
             - googleAds:search ad_group + campaign queries
           ↓
           Frankfurter (cached 6h):
             - convert ILS/USD/EUR → CAD
           ↓
           SpreadsheetApp:
             - data-daily (1 row)
             - {store}-campaigns (N rows, idempotent for date)
             - {store}-ads (N rows, idempotent for date)
             - {store}-orders-attribution (1 row per order, idempotent for date)
             - products-daily (N rows)
             - store-meta (Shopify plan via GraphQL)

Every 15 min ─ runLiveUpdate(today) refreshes the in-flight day's
              data so the dashboard's TodayLive panel shows ~real-time numbers
```

### Dashboard read path

```
Browser ─ open dashboard
       ↓
       GET /api/data            → 60s s-maxage CDN cache → reads data-daily
       GET /api/campaigns       → 60s
       GET /api/products        → 60s
       GET /api/ads             → 300s (lazy, only when AdsDrawer opens)
       GET /api/orders-attribution → 300s (lazy)
       GET /api/product-catalog → 60s
       GET /api/store-meta      → 3600s
       GET /api/dashboard-state → 10s, polled every 30s by CloudSync
       ↓
       useSWR client cache → React components render
```

### User-state write-through path

```
User edits in BillingSettings / AnnotationsPanel / GoalTracker / etc.
       ↓
       writeRecurring() / writeAnnotations() / writeGoal() / ...
       ↓
       1. localStorage.setItem(key, JSON.stringify(value))    ← immediate
       2. window.dispatchEvent(CHANGE_EVENT)                  ← component re-reads
       3. pushCloudKey(key, value)                            ← debounced 400ms
            ↓
            POST /api/dashboard-state { key, value }
            ↓ allowlist check → upsertDashboardStateKey()
            appends row to `dashboard-state` tab (last-write-wins)
       ↓
       Other device polls GET /api/dashboard-state every 30s:
         hydrateFromCloud() → for each key:
           if cloud value !== local && no in-flight push for this key:
             writeLocal(key, value); dispatchEvent(CHANGE_EVENT)
```

### Orders attribution pipeline (the Phase 1 attribution layer)

This is the central deterministic-attribution mechanism. Code lives across three files:

```
Shopify Admin API
  GET /admin/api/2024-10/orders.json?fields=…,landing_site,referring_site,note_attributes,source_name,line_items
       ↓
Shopify.gs:getShopifyOrdersAttribution(storeId, dateStr)
       ↓
  for each order:
    classifyOrderAttribution_(order)   ← parses landing_site URL params
       ↓
       priority ladder:
         1. fbclid present (URL or note_attributes)  → 'meta-paid'
         2. gclid present                            → 'google-paid'
         3. utm_medium ∈ {cpc, paid_social, paidsearch, …}:
              utm_source ≈ facebook/fb/instagram/ig/meta → 'meta-paid'
              utm_source ≈ google/youtube              → 'google-paid'
              else                                      → 'other-paid'
         4. utm_source ∈ {email, newsletter, klaviyo} → 'email'
         5. referring_site ~ facebook.com|instagram.com (no UTM) → 'meta-organic'
         6. referring_site ~ google.com (no UTM)      → 'google-organic'
         7. referring_site set                        → 'other-referral'
         8. else                                      → 'direct'
       ↓
    extract utm_id (= {{campaign.id}} when Meta URL Parameters configured)
    extract utm_term (= {{adset.id}})
    extract utm_content (= {{ad.id}})
    extract fbclidPresent / gclidPresent booleans
    encode line_items as compact JSON `[{"p":productId,"u":units,"r":revenueCad}, …]`
       ↓
SheetBuilder.gs:writeOrdersAttributionForDay(...)
   1. Filter out existing rows for dateStr (idempotent re-runs)
   2. Append new rows to `{storeId}-orders-attribution` tab
   3. Rows with unparseable dates (key === null) are preserved (Round 5 fix WR5-02)
       ↓
─────────────── data plane boundary ───────────────
       ↓
dashboard-web/src/app/api/orders-attribution/route.ts
  GET /api/orders-attribution
    → fetchOrdersAttribution() reads all 3 store tabs
    → parses each row via dashboard-web/src/lib/ordersAttribution.ts
    → returns OrderAttributionRow[]
    → Cache-Control: s-maxage=300, stale-while-revalidate=900
       ↓
dashboard-web/src/lib/attributionAnalysis.ts (~746 LOC)
  analyzeAttribution(campaignId, orders, metaDailyClaims):
    deterministicRevenue = Σ orders where utm_id == campaignId
                            OR utm_campaign ≈ campaignName (fallback)
                                ↑ name match only used when utm_id absent
                                  (utm_id is authoritative — Round 5 fix CR5-01)
    deterministicOrders  = N matching
    coverage = min(2, deterministicRevenue / metaClaim)
    trust = 'high'    if coverage ≥ 0.8
          | 'medium'  if coverage ≥ 0.4
          | 'low'     if coverage < 0.4
          | 'unknown' if metaClaim == 0 || deterministicOrders == 0
    + Bayesian-flavored 95% CI on AOV
    + Multi-window stability (σ across 7-day buckets)
    + Outlier detection (>2.5σ above trailing 14d baseline)
       ↓
analyzeAttributionForAdSet(adSetId, orders, …)   uses utm_term
analyzeAttributionForAd(adId, orders, …)          uses utm_content
       ↓
Rendered as the 4-level trust chip in `CampaignsTable`, `CampaignDrawer`, `AdsDrawer`.
When trust = 'unknown', `CampaignsTable` falls back to product-mapping confidence
from dashboard-web/src/lib/campaignProductMap.ts (chip suffix becomes `·מיפוי`).
```

The strict prerequisite for tier-1 deterministic attribution: **Meta Ads Manager → Account Settings → URL Parameters must contain** the `utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}` block (see `SETUP.md` Step 8). Historical orders predating that configuration fall back to product-mapping. There is no backfill path — `utm_id` is captured only at click time and lives on the `landing_site` of the order.

---

*Integration audit: 2026-05-18*
