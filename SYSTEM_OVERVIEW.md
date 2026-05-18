# ROAS Tracker — אפיון מערכת מלא

מסמך מקיף שמתעד את המערכת במצבה הנוכחי: ארכיטקטורה, רכיבים, זרימת נתונים, פיצ'רים, ותפעול שוטף. **עודכן: מאי 2026** — משקף את הקוד עד `6d9df13` (סוף Round 5 — attribution pipeline + 13 תיקוני code-review).

---

## 📌 תוכן עניינים

1. [תמונה גדולה](#-תמונה-גדולה)
2. [רכיבי המערכת](#-רכיבי-המערכת)
3. [זרימת נתונים](#-זרימת-נתונים)
4. [שכבת ה-Attribution](#-שכבת-ה-attribution)
5. [פיצ'רים עיקריים](#-פיצרים-עיקריים)
6. [מבנה הגיליון](#-מבנה-הגיליון)
7. [מבנה הדשבורד](#-מבנה-הדשבורד)
8. [שכבת Cloud Sync](#-שכבת-cloud-sync)
9. [פירוט קבצים](#-פירוט-קבצים)
10. [תפעול שוטף](#-תפעול-שוטף)
11. [פתרון תקלות](#-פתרון-תקלות)
12. [אבטחה](#-אבטחה)
13. [מגבלות ידועות](#-מגבלות-ידועות)

---

## 🎯 תמונה גדולה

המערכת עוקבת אחרי ROAS, רווחיות וביצועי קמפיינים של **3 חנויות Shopify** (uzoshop, Zol Plus, 360usmile) בשלוש רמות (קמפיין → ad-set → ad), ומחברת בין נתוני מודעות (Meta + Google Ads) לנתוני מכירות בפועל (Shopify) **תוך הסתמכות על click-id דטרמיניסטי** (`fbclid` / `gclid` / `utm_id` / `utm_term` / `utm_content`) שמסביב ל-attribution heuristic של Meta.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🌐 שכבת תצוגה (Next.js 15.5 + React 19 on Vercel)                     │
│   - 6 טאבים: בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט             │
│   - CampaignsTable → CampaignDrawer → AdsDrawer (nested z-stack)      │
│   - 7 keys מסונכרנים בענן: billing / annotations / goal /             │
│     insight-states / campaign-optimized / product-map / billing-onetime│
│   - Attribution trust chip עם 4 רמות + fallback למיפוי מוצרים          │
│   ↑↓                                                                   │
│   קריאות REST + POST /api/dashboard-state (write-through)              │
└──────────────────────────────────────────────────────────────────────┘
                                ↑↓
┌──────────────────────────────────────────────────────────────────────┐
│ 📊 שכבת נתונים (Google Sheets — spreadsheet אחד, 8 סוגי טאבים)        │
│   קריאה לדשבורד (מוסתרים):                                              │
│     - data-daily              · שורה לכל (יום, חנות)                   │
│     - products-daily          · שורה לכל (יום, חנות, מוצר)              │
│     - {store}-campaigns       · שורה לכל (יום, חנות, קמפיין, ad-set)    │
│     - {store}-ads             · שורה לכל (יום, חנות, קמפיין, ad-set,    │
│                                  מודעה)                                 │
│     - {store}-orders-attribution · שורה לכל הזמנה (UTM + fbclid +      │
│                                     gclid + referrer) ← NEW            │
│     - {store}-products-catalog · קטלוג מלא של החנות (active)           │
│     - store-meta              · plan + Meta/Google account IDs        │
│     - dashboard-state         · cloud-sync key-value                  │
│   נוסחאות (legacy ROAS pages, גלויות למשתמש):                          │
│     - סיכום + {store}-sheets                                           │
│   ↑                                                                    │
│   נכתב ע"י Apps Script + service account (write רק על dashboard-state) │
└──────────────────────────────────────────────────────────────────────┘
                                ↑
┌──────────────────────────────────────────────────────────────────────┐
│ 🔧 שכבת איסוף (Google Apps Script V8)                                 │
│   Triggers:                                                            │
│     - runDailyUpdate · 00:05 IL → סוגר את אתמול                        │
│     - runLiveUpdate  · כל 15 דק׳ → מרענן את היום הנוכחי                │
│   שולף לכל יום, לכל חנות:                                              │
│     - Shopify revenue + orders (REST + retry)                          │
│     - Shopify orders attribution: landing_site → UTM + fbclid + gclid │
│     - Shopify line items per order (product-level revenue)             │
│     - Shopify plan name (GraphQL)                                      │
│     - Shopify full catalog (manual, refreshAllProductCatalogs)         │
│     - Meta insights ב-3 רמות (account + ad-set + ad)                  │
│     - Meta budgets (campaign + adset, current state)                   │
│     - Google Ads spend + ad-group insights (uzoshop בלבד)              │
│   מטפל ב:                                                              │
│     - 401 Shopify → auto-bootstrap (Client Credentials Grant) → retry │
│     - 429/5xx → exponential backoff עם jitter                          │
│     - Sheets timeout → 3 retries; לעולם לא יוצר phantom spreadsheet    │
│     - Quota throttle: 1500ms sleep בין חנויות, 500ms בין כתיבות         │
│     - URIError ב-decodeURIComponent → safeDecode_ במקום קריסה            │
│     - ILS/USD/EUR → CAD לפי שער יומי (Frankfurter / ECB)               │
└──────────────────────────────────────────────────────────────────────┘
                                ↑
┌──────────────────────────────────────────────────────────────────────┐
│ 🌍 APIs חיצוניים                                                       │
│   - Shopify Admin (REST + GraphQL): orders (incl. landing_site) +     │
│     products + plan                                                   │
│   - Meta Marketing API v20.0: insights × 3 levels + campaigns/adsets │
│   - Google Ads API v20: campaigns + ad groups (OAuth refresh token)   │
│   - Frankfurter (FX): ILS/USD/EUR → CAD (daily, cached)               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 רכיבי המערכת

### 1. Google Apps Script (איסוף נתונים)

קוד V8, רץ מתחת לחשבון הגוגל של המפעיל. 9 קבצי `.gs` + `appsscript.json`:

| קובץ | אחריות מרכזית |
|------|---------------|
| [Main.gs](Main.gs) | `setupAll`, `installDailyTrigger`, התפריט בעורך |
| [Config.gs](Config.gs) | קבועים (STORES, COGS_RATE_OF_REVENUE = 0.25), `getProp`/`setProp`, `fetchWithRetry_` עם backoff, `verifyConfig`, **`resetSpreadsheetIdToKnownGood`**, **`printCurrentSpreadsheetId`** להגנה מפני phantom-spreadsheet |
| [Shopify.gs](Shopify.gs) | `getShopifyRevenue`, `getShopifyProductSalesForDay`, `getShopifyPlan` (GraphQL), **`getShopifyProductsCatalog`**, **`getShopifyOrdersAttribution`** (Round 5: per-order classification), `bootstrapShopifyTokenForStore_` (auto-bootstrap on 401), `safeDecode_` (URI guard) |
| [MetaAds.gs](MetaAds.gs) | `getMetaSpend` (account level), `getMetaAdSetInsights` (ad-set), `getMetaAdInsights` (ad level — Meta בלבד), `getMetaBudgets` (CBO/ABO state) |
| [GoogleAds.gs](GoogleAds.gs) | `getGoogleAdsSpend`, `getGoogleAdsAdGroupInsights`, OAuth refresh-token flow |
| [FX.gs](FX.gs) | Frankfurter API, daily cache ב-Script Properties |
| [ManualOverrides.gs](ManualOverrides.gs) | קריאה מטאב `manual-spend` כדי לעקוף את ה-API ליום מסוים |
| [DailyUpdate.gs](DailyUpdate.gs) | `runDailyUpdate`, `runLiveUpdate`, `runUpdateForDate`, `backfillRange`, `backfillRangeForStores`, `runUpdateForDateForStores_`, `updateStoreForDate_`, `notifyError_` (3-tier email resolver) |
| [SheetBuilder.gs](SheetBuilder.gs) | יצירת+תחזוקה של כל ה-tabs, מיגרציות אידמפוטנטיות, **`writeOrdersAttributionForDay`**, **`ensureOrdersAttributionTab_`**, **`refreshAllProductCatalogs`**, chunked writes |

**Triggers (מותקנים אוטומטית ע"י `installDailyTrigger`):**
- `runDailyUpdate` — 00:05 שעון ישראל (סוגר את אתמול)
- `runLiveUpdate` — כל 15 דקות (מרענן את היום הנוכחי)

### 2. Google Sheets (נתונים)

**8 סוגי טאבים** (ב-spreadsheet יחיד שה-`SPREADSHEET_ID` מצביע אליו):

**גלויים למשתמש (read-only מהסקריפט):**
- `סיכום` — נוסחה-driven, שורת ROAS לכל יום (legacy view, אינו נדרש לדשבורד)
- `uzoshop` / `Zol Plus` / `360usmile` — סיכום פר-חנות, נוסחה-driven
- `manual-spend` — overrides ידניים שהמשתמש כותב

**מוסתרים (data-only, מקור האמת לדשבורד):**
- `data-daily` — שורה לכל (יום, חנות). 13 עמודות (date, storeId, storeName, FB spend, GA spend, total spend, revenue, ROAS, conversions placeholder, **COGS** = revenue×0.25, **netProfit** = revenue - spend - COGS, וכו'). הבסיס ל-`/api/data`.
- `products-daily` — שורה לכל (יום, חנות, מוצר): productId, productTitle, units, revenue (CAD), netRevenue. רק מוצרים שנמכרו ביום ספציפי.
- `{storeId}-campaigns` — שורה לכל (יום, חנות, קמפיין, ad-set). כולל: spend, conversionValue, conversions, impressions, clicks, **תקציב יומי** (`campaignBudgetCad` / `adSetBudgetCad`), **סוג CBO/ABO**, platform (Meta/Google).
- `{storeId}-ads` — שורה לכל (יום, חנות, קמפיין, ad-set, **מודעה**). Meta בלבד (`level=ad`).
- `{storeId}-orders-attribution` (NEW Round 5, **14 עמודות** מ-Phase 1) — שורה לכל הזמנה ב-Shopify:
  - תאריך, מזהה הזמנה, סכום (CAD)
  - **source** classification: `meta-paid` / `google-paid` / `meta-organic` / `google-organic` / `email` / `other-paid` / `other-referral` / `direct`
  - UTM tags: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`
  - Click IDs (boolean): `fbclidPresent`, `gclidPresent`
  - `referringSite`
  - **`utmId`** (= `{{campaign.id}}` מ-Meta URL Parameters) — match key חזק ביותר
  - **`utmTerm`** (= `{{adset.id}}`) — match לרמת ad-set
  - (`utm_content` כבר נמצא בעמודה 8) — match לרמת מודעה
  - **`Line Items (JSON)`** (עמודה N, Phase 1) — `[{"p":productId,"u":units,"r":revenueCad}, ...]`. רק פריטים עם `product_id` תקין; `r` חולק פרופורציונלית מתוך `order.totalCad`. עמודה ריקה לשורות מלפני המיגרציה — הדשבורד מחזיר `[]` ולא קורס.
- `{storeId}-products-catalog` — **קטלוג מלא** של החנות (כולל מוצרים בלי הזמנות). מתחדש מנואלית ע"י `refreshAllProductCatalogs` (בעבר היה חלק מ-`runDailyUpdate` ומיצה את ה-quota — הוצא ב-Round 4).
- `store-meta` — שורה לכל חנות: שם תוכנית Shopify, Meta ad-account ID, Google customer ID, last-error timestamp.
- `dashboard-state` — Key-value: billing / annotations / goal / insight-states / campaign-optimized / **campaign-product-map**. נכתב ע"י service-account של הדשבורד (Vercel).

### 3. Next.js Dashboard (תצוגה)

`dashboard-web/` — Next.js 15.5 App Router + React 19 + TypeScript + Tailwind 3.4. פרוס ב-Vercel (auto-deploy על push ל-main).

**6 טאבים ראשיים** (`TabNav`):

1. **בית** — `HomeTab`:
   - `HeroOverview` (chart גדול של ROAS לאורך זמן + annotations כ-ReferenceLines)
   - `Filters` + `AiReportButton`
   - `TodayLive` (היום הנוכחי, מתעדכן כל 15 דק׳)
   - `GoalTracker` (יעד הכנסות חודשי + projected EoM)
   - `InsightsBoard` (anomalies + recommendations + forecasts)
   - `AnnotationsPanel` (אירועים על ציר זמן)
   - `KpiCards` (ROAS / Revenue / Spend / Gross Profit + השוואה)
   - `PerStoreCards` (3 כרטיסיות בולטות פר חנות)

2. **P&L** — `PnLTab`:
   - `SectionIntro`
   - `Filters`
   - `BillingSettings` (modal לניהול עלויות שותפים)
   - `PnLBreakdown` (Hero strip תמיד גלוי + Waterfall פתוח כברירת מחדל)

3. **ניתוח** — `AnalysisTab`:
   - `RoasChart` (trend per-store, multi-line)
   - `MonthlyTables` (פר חנות + סיכום משולב)

4. **קמפיינים** — `CampaignsTab` → **`CampaignsTable`** (1722 שורות — הקומפוננטה הגדולה במערכת):
   - מפ-aggregating Meta (3 רמות: campaign / adset / ad-platform-level) + Google (campaign / ad-group)
   - Sortable, RTL, optimization marks, CBO/ABO badges
   - **ROAS Shopify + 4-level trust chip** (high/medium/low/unknown)
   - **Shopify-actual revenue + units** מוקצים פרופורציונלית לקמפיין
   - לחיצה על שורה → `CampaignDrawer`

5. **מוצרים** — `ProductsTab` → `ProductsTable`

6. **פירוט** — `DetailTab` → `DetailTable`

**Drawers** (z-indexed stack, Esc סוגר רק את העליון):

- **`CampaignDrawer`** (z-50, 1310 שורות) — נפתח בלחיצה על קמפיין:
  - Hero stats (spend, value, ROAS, conversions, CTR, CPC, CPA)
  - Daily chart (Meta vs Shopify mapped revenue)
  - **`AttributionAnalysisPanel`** (קופסה מסומנת עם confidence score + recommendation)
  - **`MetaShopifyReconciliation`** (Pearson r + lag detection + per-day delta table)
  - **Mapped products** — list + lחץ לפתוח `ProductPickerModal`
  - **Ad-sets table** עם ROAS Shopify + trust chip לכל ad-set
- **`AdsDrawer`** (z-60, 586 שורות) — נפתח בלחיצה על ad-set:
  - Totals strip, sortable ads table, ROAS Shopify + trust chip לכל מודעה
- **`ProductPickerModal`** (z-70, 368 שורות) — נפתח מ-CampaignDrawer:
  - Search + multi-select של מוצרי החנות (קטלוג מלא)

ה-stack מנוהל ע"י [`lib/drawerStack.ts`](dashboard-web/src/lib/drawerStack.ts).

### 4. Service Account & Auth

**Server-side** (`dashboard-web/src/lib/sheets.ts`):
- Service account: `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com`
- Scopes: `spreadsheets.readonly` לכל הקריאות; `spreadsheets` (write) רק לכתיבת `dashboard-state`
- Env vars ב-Vercel: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`

**Apps Script:** רץ כמשתמש שמחזיק את ה-Script Properties (`spreadsheet.id`, `{storeId}.shopify.token`, וכו'). יש לוודא שהוא Editor על ה-Sheet.

---

## 🔄 זרימת נתונים

### זרימת הקריאה (פתיחת הדשבורד)

```
Browser ─ GET /api/data
       │  └─ fetchDailyData() → batchGet data-daily → DailyRow[]
       ├─ GET /api/campaigns
       │  └─ fetchCampaignsData() → batchGet {store}-campaigns × 3 → CampaignRow[]
       ├─ GET /api/products
       │  └─ fetchProductsData() → batchGet products-daily → ProductRow[]
       ├─ GET /api/ads            (lazy — רק כש-AdsDrawer פתוח)
       │  └─ fetchAdsData() → batchGet {store}-ads × 3 → AdRow[]
       ├─ GET /api/orders-attribution  (lazy — רק כש-CampaignDrawer/AdsDrawer פתוח)
       │  └─ fetchOrdersAttribution() → batchGet {store}-orders-attribution × 3
       │     → OrderAttributionRow[]
       ├─ GET /api/product-catalog
       │  └─ fetchProductCatalog() → batchGet {store}-products-catalog × 3
       ├─ GET /api/store-meta
       │  └─ fetchStoreMeta() → Sheets read store-meta → StoreMetaRow[]
       └─ GET /api/dashboard-state
          └─ fetchDashboardState() → reads dashboard-state tab → kv map
              (CloudSync polls every 30s)
```

**Cache TTLs** (HTTP `Cache-Control: s-maxage=...`):
| Route | s-maxage | stale-while-revalidate |
|-------|----------|------------------------|
| `/api/data` | 60s | 120s |
| `/api/campaigns` | 60s | 120s |
| `/api/products` | 60s | 120s |
| `/api/ads` | 300s (5m) | 900s |
| `/api/orders-attribution` | 300s (5m) | 900s |
| `/api/product-catalog` | 60s | 300s |
| `/api/store-meta` | 3600s (1h) | 86400s |
| `/api/dashboard-state` | 10s | 60s |

SWR client-side dedupe: 30s-60s לפי הroute.

### זרימת הכתיבה (Apps Script)

#### `runDailyUpdate(dateStr)` — הפונקציה המרכזית

```
runDailyUpdate(dateStr):                       # dateStr = ברירת מחדל = אתמול
  ensureSpreadsheet()                          # opens existing, retry-on-timeout
                                                # NEVER creates phantom on timeout
  for i, store in enumerate(STORES):
    if i > 0: Utilities.sleep(1500)            # quota-relief throttle
    updateStoreForDate_(ss, store, dateStr):
      ┌─ revenueCad = getShopifyRevenue(...)           # /orders.json (paid)
      ├─ metaCad = manualOverride? || getMetaSpend(...)
      ├─ googleAdsCad = if hasGoogleAds: getGoogleAdsSpend(...)
      ├─ writeDayRow(...)                              # סיכום + per-store tabs
      │
      ├─ try: updateCampaignDataForStoreDate_(...):   # campaign/ad-set rows
      │     ┌─ budgets = getMetaBudgets(store)        # current state (campaign+adset)
      │     ├─ metaRows = getMetaAdSetInsights(...)
      │     ├─ resolve CBO vs ABO per row
      │     ├─ gaRows = getGoogleAdsAdGroupInsights(...)
      │     └─ writeCampaignRowsForDay(...)           # {store}-campaigns
      ├─ sleep(500)
      │
      ├─ cogsCad = revenueCad × 0.25
      ├─ writeDailyFlatRow_(...)                       # data-daily
      ├─ products = getShopifyProductSalesForDay(...)  # /orders + line_items
      ├─ writeProductSalesForDay_(...)                 # products-daily
      ├─ sleep(500)
      │
      ├─ try: updateAdDataForStoreDate_(...):          # ad-level (Meta only)
      │     ┌─ adRows = getMetaAdInsights(level=ad)
      │     └─ writeAdsRowsForDay(...)                # {store}-ads
      ├─ sleep(500)
      │
      ├─ try: orders = getShopifyOrdersAttribution(store.id, dateStr)
      │     ┌─ /orders.json?status=paid&financial_status=paid
      │     ├─ pull landing_site + referring_site + note_attributes per order
      │     ├─ classify each: fbclid → meta-paid, gclid → google-paid,
      │     │                 utm_source+utm_medium → ..., referrer → ...,
      │     │                 fallback → direct
      │     └─ build OrderAttributionRow[]
      ├─ writeOrdersAttributionForDay(...)             # {store}-orders-attribution
      │     (idempotent: clears rows for dateStr, appends new ones)
      │
      └─ if catalogNeedsRefresh_(store, 14):
           Logger.log("⚠️ catalog stale — run refreshAllProductCatalogs manually")
           # NB: לא מבצע refresh בתוך runDailyUpdate (גורם ל-quota cascade —
           #     הוצא ב-Round 4, commit 225fcb9)

  refreshAllStoreMeta()                                # plan + Meta/GA account IDs
  notifyError_(...) on errors                          # email via 3-tier resolver
```

#### `runLiveUpdate()` — מרענן את היום הנוכחי

מקריא רק את נתוני היום (`asia-jerusalem today`), בלי קריאות catalog/products-daily. נועד לרענן את `TodayLive` בדשבורד.

#### `backfillRange(start, end)` ו-`backfillRangeForStores(start, end, storeIds)`

```
backfillRange(start, end):
  cur = start
  while cur <= end:
    runUpdateForDate(cur)             # ~3-4 min per day with all 3 stores
    cur = nextDayStr_(cur)

backfillRangeForStores(start, end, storeIds):
  stores = STORES.filter(s => storeIds.includes(s.id))
  cur = start
  while cur <= end:
    runUpdateForDateForStores_(cur, stores)
    cur = nextDayStr_(cur)
```

**הגבלת זמן ב-Apps Script:** 6 דקות לכל execution. backfill של 11 ימים × 3 חנויות = ~35 דק׳ → חייב להפצל לחבילות של יום-יומיים בכל run.

### זרימת user actions (write-through to cloud)

```
משתמש לוחץ "שמור" ב-BillingSettings:
  writeRecurring(items)                       # lib/billing.ts
    ↓
    localStorage.setItem(key, JSON.stringify(items))     # immediate
    ↓
    window.dispatchEvent('roas-billing-changed')         # component re-reads
    ↓
    pushCloudKey('roas-dashboard:billing-recurring', items)   # lib/cloudSync.ts
      ↓ debounce 400ms
      fetch POST /api/dashboard-state
        body: { key, value }
        ↓
        upsertDashboardStateKey(key, value)             # lib/sheets.ts
          ↓
          appendValues to dashboard-state tab           # serialised, last-write-wins
            ↓ (cached s-maxage=10s on the route)

מכשיר אחר (כל 30 שניות + on focus):
  CloudSync.hydrateFromCloud()                          # CloudSync.tsx
    ↓
    fetch GET /api/dashboard-state
    ↓
    for each STATE_KEYS:
      if cloud has value && value !== local:
        writeLocal(key, value)
        dispatchEvent(EVENT_MAP[key])                    # billing-changed / annotations-changed / etc.
        ↓ component re-reads localStorage → re-renders
```

---

## 🎯 שכבת ה-Attribution

הליבה של Round 5. שני סיגנלים מסביב ל-Meta:

### סיגנל 1: Click-id דטרמיניסטי (`lib/attributionAnalysis.ts`, 746 שורות)

**מקור הנתונים:** `{store}-orders-attribution` — כל הזמנה ב-Shopify מסווגת לפי `landing_site` (URL שאליו הלקוח נחת):

```js
classifyOrderAttribution_(order) {
  parse landing_site URL → params { utm_source, utm_medium, utm_campaign,
                                      utm_id, utm_term, utm_content }
                             + booleans { fbclidPresent, gclidPresent }
  also scan order.note_attributes for the same keys

  priority ladder:
    1. fbclidPresent && (utm_source≈facebook||no utm) → 'meta-paid'
    2. gclidPresent && (utm_source≈google||no utm)   → 'google-paid'
    3. utm_medium∈{cpc,paid_social,paidsearch,...}:
         utm_source≈facebook → 'meta-paid'
         utm_source≈google   → 'google-paid'
         else                → 'other-paid'
    4. utm_source∈{email,klaviyo,newsletter}        → 'email'
    5. referring_site like *facebook*||*instagram*  → 'meta-organic'
    6. referring_site like *google*                  → 'google-organic'
    7. else if referring_site set                    → 'other-referral'
    8. else                                          → 'direct'
}
```

**Match tiers** (חזק לחלש):

| Tier | זיהוי | מבוסס על |
|------|-------|----------|
| 1 (Campaign) | `utm_id` == `campaignId` | `utm_id={{campaign.id}}` ב-Meta URL Parameters |
| 2 (Campaign) | `utm_campaign` (case-insens.) == `campaignName` | `utm_campaign={{campaign.name}}` |
| 1 (Ad-set) | `utm_term` == `adSetId` | `utm_term={{adset.id}}` |
| 1 (Ad) | `utm_content` == `adId` | `utm_content={{ad.id}}` |

**חשוב (Round 5 fix CR5-01):** כש-`utm_id` קיים על ההזמנה, הוא **authoritative** — אם הוא לא תואם לקמפיין הנבדק, ההזמנה **לא** נופלת חזרה ל-name match. זה מונע מiscattribution להזמנות שעוטפות שני קמפיינים עם שמות זהים.

### האנליזה (`analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`)

לכל קמפיין/ad-set/ad מחושב:

```
deterministicRevenue = Σ(totalCad) של ההזמנות שתואמות לפי utm
deterministicOrders  = N של אותן הזמנות
modeledRevenue       = max(0, metaClaim − deterministicRevenue)
coverage             = min(2, deterministicRevenue / metaClaim)
```

**ועוד שלושה סיגנלים אנליטיים:**

1. **Bayesian-flavoured 95% CI** (`roasInterval`): normal approximation על AOV — `CI = mean ± 1.96 × stdDev/√N`. רק כש-`spend > 0` ו-`N ≥ 3` ו-`variance > 0` (Round 5 fix WR5-04 — variance=0 לא מציג טווח מטעה).

2. **Multi-window stability** (`computeWindowStability`): מפצל את התקופה ל-7-day buckets, מחשב coverage לכל bucket, σ של ה-coverages:
   - σ < 0.15 → `stable` (bias קבוע — אפשר לסמוך על הטרנד)
   - 0.15 ≤ σ < 0.35 → `mixed`
   - σ ≥ 0.35 → `volatile` (downgrades `high` ל-`medium`)
   - Round 5 fix IN5-03: כולל partial trailing bucket כש-`tailDays ≥ 3`.

3. **Outlier detection** (`detectOutlierDays`): ימים שבהם `Meta daily conv-value > 2.5σ` מעל הממוצע הנגרר ב-14 הימים שקדמו. Round 5 fix IN5-02: LOOKBACK אדפטיבי (`min(14, max(5, floor(N/2)))`) כך שטווח של 14 ימים (הברירת מחדל בדשבורד) מייצר signal במקום `[]` ריק.

### Trust ladder

```
if metaClaim === 0 && deterministicOrders === 0:
   trust = 'unknown'      label = "אין המרות"        score = 0
else if deterministicOrders === 0 && metaClaim > 0:
   trust = 'unknown'      label = "לא ניתן לקבוע"     score = 30
   recommendation = "הוסף URL Parameters ב-Meta Ads Manager"
else if coverage >= 0.8:
   trust = 'high'         label = "אמין"              score = 70..100
else if coverage >= 0.4:
   trust = 'medium'       label = "חלקי"              score = 40..60
else:
   trust = 'low'          label = "לא אמין"           score = 0..40
   recommendation = "Meta מנפח דיווחים..."
```

**Round 5 fix:** ה-`metaClaim===0 && det===0` short-circuit נוסף כדי לא לתייג קמפיינים ללא פעילות כ"Meta מנפח" — דבר שלא היה הגיוני בגלל ש-Meta דיווח 0.

### סיגנל 2: Product-mapping heuristic (`lib/campaignProductMap.ts`)

**מקור הנתונים:** מיפוי many-to-many ש-המפעיל מגדיר ידנית (קמפיין → מוצרים). מסונכרן בענן.

**מה זה מודד:**
- `trueRevenue` = הכנסה מ-Shopify של המוצרים המשויכים לקמפיין, מוקצה פרופורציונלית להוצאה כשהמוצר חולק עם כמה קמפיינים
- `confidence` = Heuristic על הפער בין `metaClaim` ל-`trueRevenue`:
  - פער > 70% → `low`
  - פער 30-70% → `medium`
  - מוצרים משותפים עם 3+ קמפיינים → `low`
  - הוצאה < CAD 200 + פער > 15% → `medium`
  - אחרת → `high`

### הסיגנל בדשבורד: Tiered chip

`CampaignsTable.tsx` (lines ~1300-1357) משלב את שני הסיגנלים:

```
useAttr = attribution !== null && attribution.trust.level !== 'unknown'

if useAttr:
  chip = click-id signal (high/medium/low)
  suffix = "·{N}" (deterministicOrders count)
else:                                  # fallback
  chip = product-mapping confidence
  suffix = "·מיפוי"

tooltip = always shows BOTH numbers (Meta claim, click-id revenue, mapping revenue)
          so the operator can triangulate when signals disagree
```

**רמת ad-set + ad:** רק סיגנל ה-click-id. אין fallback למיפוי מוצרים (אין mapping ברמה זו — היא יורשת מהקמפיין).

### סיגנל 3: Channel-level של המוצרים המשויכים (`analyzeProductChannel`, Phase 1 — מאי 2026)

**מקור הנתונים:** עמודה N החדשה ב-`{store}-orders-attribution` — `Line Items (JSON)` בפורמט קומפקטי `[{"p":productId,"u":units,"r":revenueCad}, ...]` (Apps Script מחשב את `r` כפרופורציה מתוך `order.totalCad`, מסנן פריטים עם `product_id=null`).

**מה זה מודד:** "מאיפה הגיעו הקונים של המוצרים המשויכים לקמפיין?" — בלי תלות במצב ה-`utm_id` של ההזמנה. בעוד שה-click-id signal עונה "ההזמנה הזאת ספציפית שייכת לקמפיין A דרך utm_id?", הסיגנל הזה עונה "ההזמנות שכוללות את מוצרי הקמפיין — באו בכלל מפייסבוק?".

**Facebook predicate (רחב יותר ממהשמ-`meta-paid`):** `source === 'meta-paid' || source === 'meta-organic' || fbclidPresent === true`. גם תנועה אורגנית מ-FB/IG נחשבת — הלקוח עדיין הגיע ממשטח Facebook.

**איפה זה מופיע:** ב-`CampaignDrawer` בלבד (לא בטבלה הראשית — לא צריך לגדוש שם), בין `AttributionAnalysisPanel` (סיגנל 1) ל-`MetaShopifyReconciliation`. הסקציה מופיעה רק כש:
- הפלטפורמה היא Meta (Google PMax אין mapping)
- לקמפיין יש מוצרים משויכים
- ≥3 הזמנות בתקופה כוללות לפחות מוצר אחד משויך (פחות מזה — רעש)

**Recommendation chips:**
- `facebookShare ≥ 60%` → ירוק: "ביטחון להעלאת תקציב הקמפיין"
- `facebookShare < 30%` ו-`totalOrders ≥ 5` → אמבר: "ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב"
- בין 30% ל-60% → אין chip (אזור אפור)

**מבדל מסיגנלים 1+2:** סיגנל 1 דורש URL Parameters תקינים ב-Meta; סיגנל 2 תלוי במיפוי המפעיל ל-Shopify-revenue-by-product. הסיגנל החדש דורש רק `line_items` של Shopify (תמיד זמין) ומיפוי מוצרים. הוא משלים — לא מחליף — את שני הסיגנלים הקודמים.

---

## ✨ פיצ'רים עיקריים

### 1. P&L מפורט (טאב משלו)

[`PnLBreakdown.tsx`](dashboard-web/src/components/PnLBreakdown.tsx) (442 שורות):
- **Hero strip** תמיד גלוי: Revenue / Total Costs / Net Profit + פסי גרף יחסיים
- **Waterfall** (פתוח כברירת מחדל): Revenue → -Ad Spend → -COGS → -Transaction Fees → -Fixed → True Net
- COGS: 25% מהכנסות (גלובלי, מוגדר ב-`COGS_RATE_OF_REVENUE` בשני המקומות — Apps Script + dashboard)
- Transaction Fees: 6.5% מהכנסות (PayPal + FX — מוגדר ב-`lib/costs.ts`)
- Fixed Costs: מ-`lib/billing.ts` — recurring monthly subs + one-time charges, prorated לטווח

### 2. BillingSettings — ניהול עלויות שותפים

[`BillingSettings.tsx`](dashboard-web/src/components/BillingSettings.tsx) (1328 שורות):
- 3 טאבים: חודשי קבוע · חד-פעמיים · ייבא CSV
- **Auto-detect**: שואב מ-`store-meta` את שם תוכנית Shopify של כל חנות → מציע "הוסף Basic Shopify ≈ CAD 53/mo" בלחיצה
- CSV import עם classifier heuristic + dedup (`findMatchingRecurring`)
- מסונכרן בענן ל-`dashboard-state` תחת המפתחות `roas-dashboard:billing-recurring` ו-`billing-onetime`

### 3. CampaignsTable — שורת הליבה

[`CampaignsTable.tsx`](dashboard-web/src/components/CampaignsTable.tsx) (1722 שורות):

**עמודות (RTL, מימין לשמאל):**

| # | עמודה | מקור |
|---|-------|------|
| 1 | Toggle (סימון אופטימיזציה ✓) | `lib/campaignOptimized.ts` |
| 2 | שם קמפיין/ad-set + CBO/ABO chip | `{store}-campaigns` |
| 3 | הוצאה | spend |
| 4 | תקציב יומי (Meta) | `campaignBudgetCad` / `adSetBudgetCad` |
| 5 | ערך המרות (Meta) | conversionValue |
| 6 | ROAS (Meta) | conversionValue / spend |
| 7 | **ROAS Shopify** + **4-level trust chip** | `analyzeAttribution` || product-mapping fallback |
| 8 | **ערך Shopify** (actual) | `allocateProductRevenue` |
| 9 | **יח׳ Shopify** | מאותו allocation |
| 10 | המרות (Meta) | conversions |
| 11 | CTR | clicks / impressions |
| 12 | CPC | spend / clicks |
| 13 | CPA | spend / conversions |
| 14 | 🔗 External link ל-Ads Manager | `buildAdsManagerLink` (`campaignsLinks.ts`) |

**Sortable** על כל עמודה מספרית. Optimization marks משתפים State עם ה-AdsDrawer ועם CampaignDrawer's ad-sets table.

**Aggregation:** Apps Script כותב שורה לכל (יום, חנות, קמפיין, ad-set). הדשבורד מ-aggregate אותן לפי `groupBy: campaign` או `groupBy: adSet` בזמן ריצה.

### 4. Campaign → Product Mapping

[`lib/campaignProductMap.ts`](dashboard-web/src/lib/campaignProductMap.ts) + [`ProductPickerModal.tsx`](dashboard-web/src/components/ProductPickerModal.tsx):
- Many-to-many: קמפיין יכול לקדם N מוצרים, מוצר יכול להיות מקודם ע"י N קמפיינים
- נשמר כ-`Record<storeId::campaignId, productId[]>`
- מסונכרן בענן תחת `roas-dashboard:campaign-product-map`
- ה-picker שואב מ-`{store}-products-catalog` (קטלוג מלא, כולל מוצרים בלי מכירות)
- Fallback ל-products-daily אם הקטלוג עוד לא סונכרן (עם warning banner)
- ⚠️ Google PMax — picker מוסתר (אין attribution per-product, הפיד מנהל)

**`allocateProductRevenue`:**
- מוצר עם spend > 0 בכמה קמפיינים → חלוקה פרופורציונלית להוצאה
- כל הקמפיינים עם 0 spend → חלוקה שווה
- מוצר orphan (אין mapping) → לא מוקצה לקמפיין
- **גם units וגם revenue** מוקצים באותו share

### 5. Meta ↔ Shopify Reconciliation (בתוך CampaignDrawer)

עבור קמפיין עם mapped products (Meta בלבד):
- **Pearson r** בין conversionValue יומי של Meta לבין mapped product revenue יומי
- r > 0.7 → "Meta תופס את הטרנדים נכון, הפער הוא bias קבוע" (ירוק)
- r 0.3-0.7 → "התעלם מ-Meta ברמת יום בודד, הסתכל על 7+ ימים" (כתום)
- r < 0.3 → "Meta מדווח על המרות שלא קורות, אל תקבל החלטות לפי המספרים שלו" (אדום)
- **Lag detection** ב-±3 ימים — מזהה חלון attribution
- טבלה collapsable יום-לפי-יום: Meta / Shopify / Δ%

### 6. AdsDrawer — drill-down ברמת המודעה

[`AdsDrawer.tsx`](dashboard-web/src/components/AdsDrawer.tsx) (586 שורות):
- נפתח בלחיצה על ad-set ב-CampaignsTable או ב-CampaignDrawer (Meta בלבד)
- שואב lazy מ-`/api/ads` + `/api/orders-attribution`
- Totals strip + sortable table:
  | עמודה | מקור |
  |-------|------|
  | Toggle ✓ | optimization marks |
  | שם מודעה | `{store}-ads` |
  | הוצאה / ערך / ROAS | aggregated |
  | **ROAS Shopify + trust chip** | `analyzeAttributionForAd` (memoized, IN5-01) |
  | המרות / חשיפות / קליקים | aggregated |
  | 🔗 deep link | `?selected_ad_ids=...` |
- Per-ad daily Meta series מועבר ל-analyzer כך ש-window stability ו-outlier detection מופעלים גם ברמה זו (Round 5 fix WR5-03)

### 7. Optimization Marks

[`lib/campaignOptimized.ts`](dashboard-web/src/lib/campaignOptimized.ts):
- Set של composite keys: `storeId::platform::campaignId::adSetId::adId`
- Toggle בכל שורה (בטבלה הראשית + AdsDrawer + ad-sets table ב-CampaignDrawer)
- שורה מסומנת מתעמעת ל-50% opacity + ריחוף מחזיר ל-100%
- "נקה הכל" בלחיצה אחת
- מסונכרן בענן — שותפים רואים אותם סימונים

### 8. Annotations System

[`lib/annotations.ts`](dashboard-web/src/lib/annotations.ts) + [`AnnotationsPanel.tsx`](dashboard-web/src/components/AnnotationsPanel.tsx):
- 8 סוגי events: launch · pause · budget · pricing · sale · creative · supplier · other
- כל אחד עם emoji + Hebrew label + צבע פלטה
- נצפים כ-ReferenceLines על גרף ה-ROAS ב-HeroOverview
- מסונכרן בענן

### 9. SyncIndicator (בכותרת)

[`SyncIndicator.tsx`](dashboard-web/src/components/SyncIndicator.tsx):
- Pill קטן ליד "רענן": Cloud / RefreshCw / CloudOff
- 4 מצבים: idle · syncing · ok · error
- בכישלון: לחיצה פותחת popover עם השגיאה המדויקת + רשימת בדיקות (Editor permission, env vars)
- מתעדכן כל 30 שניות (refresh tick)

### 10. Insights Engine

[`lib/insights.ts`](dashboard-web/src/lib/insights.ts) (671 שורות) + [`InsightsBoard.tsx`](dashboard-web/src/components/InsightsBoard.tsx) (707 שורות):
- 3 סוגי תובנות: anomalies (z-score נגד trailing 14d), recommendations, forecasts
- 5 רמות severity: critical → warning → opportunity → positive → info
- כשהלוח סגור: "headline" אדיטוריאלי של התובנה הכי דחופה (typographic moment)
- States: handled / hidden — נשמרים בענן, "טיפלתי"/"הסתר"/"החזר"

### 11. Goal Tracker

[`GoalTracker.tsx`](dashboard-web/src/components/GoalTracker.tsx) + insights:
- יעד הכנסות חודשי, מסונכרן בענן
- מחשב MTD vs יעד + projected end-of-month based on trailing 7d avg
- חיווי: ahead / on-pace / behind

### 12. Today Live (real-time)

[`TodayLive.tsx`](dashboard-web/src/components/TodayLive.tsx):
- מציג את היום הנוכחי עם הכנסות + הוצאות עד עכשיו (פיגור ~20 דק׳ מ-Meta/Google API)
- מתעדכן כל 15 דק׳ ע"י `runLiveUpdate` ב-Apps Script

### 13. AI Report

[`AiReportButton.tsx`](dashboard-web/src/components/AiReportButton.tsx) + [`lib/aiReport.ts`](dashboard-web/src/lib/aiReport.ts):
- מייצר prompt מקיף עם כל הנתונים בטווח הנבחר → מעתיק ל-clipboard
- המשתמש מדביק ל-Claude/ChatGPT לקבלת ניתוח עומק

---

## 📊 מבנה הגיליון

ראה הסעיף "רכיבי המערכת > Google Sheets" לעיל לפירוט מלא של 8 סוגי הטאבים.

**Critical**: ה-`SPREADSHEET_ID` ב-Vercel וה-`spreadsheet.id` ב-Script Properties **חייבים להתאים**. אם לא — Apps Script כותב לגיליון אחד והדשבורד קורא מאחר. הוסף ב-`Config.gs`:
- `resetSpreadsheetIdToKnownGood()` — מאפס לדמה אמיתי קבוע בקוד
- `printCurrentSpreadsheetId()` — מדפיס את ה-ID הנוכחי לזיהוי phantom-spreadsheet

**Idempotent writes**: כל פונקציית `write*ForDay` (campaigns, ads, products, orders-attribution) קודם מסננת שורות עם אותו `dateStr` ומשאירה את היתר, ואז מוסיפה את החדשות. Round 5 fix WR5-02: שורות עם תאריך שאינו פיריק (`key === null`) נשמרות במקום להימחק.

---

## 🖥 מבנה הדשבורד

### עץ הקומפוננטות:

```
Dashboard (545 שורות, App Router root)
├── CloudSync (invisible — שואב/דוחף state)
├── Header
│   ├── CommandPalette (Cmd-K)
│   ├── SyncIndicator
│   └── RefreshButton
├── TabNav (בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט)
├── Main:
│   ├── HomeTab
│   │   ├── HeroOverview (525 lines — ROAS chart + annotations)
│   │   ├── Filters + AiReportButton
│   │   ├── TodayLive
│   │   ├── GoalTracker
│   │   ├── InsightsBoard (707 lines)
│   │   │   └── InsightHero (כשסגור) / SeverityGroup[] (כשפתוח)
│   │   ├── AnnotationsPanel
│   │   ├── KpiCards
│   │   ├── PerStoreCards
│   │   └── WhatsWorking (292 lines)
│   ├── PnLTab
│   │   ├── SectionIntro
│   │   ├── Filters
│   │   ├── BillingSettings (modal, 1328 lines)
│   │   └── PnLBreakdown (hero strip + waterfall)
│   ├── AnalysisTab → RoasChart + MonthlyTables
│   ├── CampaignsTab → CampaignsTable (1722 lines)
│   │   └── CampaignDrawer (1310 lines, on row click)
│   │       ├── AttributionAnalysisPanel
│   │       ├── MetaShopifyReconciliation
│   │       ├── ProductPickerModal (368 lines, z-70)
│   │       └── AdsDrawer (586 lines, z-60, on ad-set click)
│   ├── ProductsTab → ProductsTable (884 lines)
│   └── DetailTab → DetailTable
└── Footer
```

### State management:

- **URL state** ([`lib/urlState.ts`](dashboard-web/src/lib/urlState.ts)): tab + filters → URL params, restored on refresh
- **localStorage**: 7 keys מסונכרנים בענן (ראה Cloud Sync)
- **SWR caches**: per-API-route, dedupe interval 30s-5min

---

## 🧪 תשתיות Phase 2 (בדיקות, monitoring, cache, guards)

### שכבת בדיקות (Phase 2)

ה-dashboard מצויד ב-Vitest (תקין ל-Node 22 + Vercel LTS). הבדיקות ב-`src/lib/__tests__/` מכסות את ה-pure-functions ב-`attributionAnalysis.ts` — 76+ בדיקות ל-`orderMatchesCampaign`, `analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`, `analyzeProductChannel`, `detectOutlierDays`, `computeWindowStability`, ו-`safeDecode`. `npm run test` לפני כל merge ל-main.

### שכבת monitoring (Phase 2)

Sentry מחובר ב-`instrumentation.ts` + global `ErrorBoundary` ב-`app/layout.tsx`. שגיאות client + server זורמות ל-Sentry dashboard כשמוגדר DSN. ב-localhost — no-op שקט (אין warnings, אין overhead). ראה `.env.local.example` לרשימת משתני הסביבה.

### שכבת cache config (Phase 2)

`src/lib/cacheConfig.ts` הוא מקור-אמת יחיד ל-`stale-while-revalidate` + `s-maxage` של כל 8 ה-API routes. פונקציית `cacheControl(key)` מייצרת את ה-`Cache-Control` header. כדי לשנות TTL, ערוך רק את `CACHE_CONFIG` — לא את ה-route handlers.

### שכבת row-count guards (Phase 2)

כל route (חוץ מ-`dashboard-state` שמוגבל ל-8 מפתחות) מכיל `if (rows.length > 50000) console.warn(...)`. Threshold 50k = 5× מהנפח הנוכחי הצפוי (~10k שורות). Runs ב-Vercel logs.

---

## ☁️ שכבת Cloud Sync

[`lib/cloudSync.ts`](dashboard-web/src/lib/cloudSync.ts) (413 שורות) + [`components/CloudSync.tsx`](dashboard-web/src/components/CloudSync.tsx):

**7 keys מסונכרנים** (`STATE_KEYS`):

| Key | תוכן |
|-----|------|
| `roas-dashboard:billing-recurring` | recurring costs (Klaviyo, Shopify Plan, וכו') |
| `roas-dashboard:billing-onetime` | one-time charges |
| `roas-dashboard:annotations` | activity events |
| `roas-dashboard:monthly-revenue-goal` | single number |
| `roas-dashboard:insight-states` | handled/hidden per insight ID |
| `roas-dashboard:campaign-optimized` | Set of marked campaign keys |
| `roas-dashboard:campaign-product-map` | `{campaignKey → productId[]}` |

**Lifecycle:**
- **On mount**: `hydrateFromCloud()` → GET `/api/dashboard-state` → writeLocal each key → dispatch change events
- **On any write**: localStorage immediate + `pushCloudKey()` debounced 400ms → POST `/api/dashboard-state`
- **Every 30s**: poll `hydrateFromCloud()` → merge cloud changes
- **On focus**: extra hydrate

**Conflict policy**: last-write-wins. Acceptable for low-frequency edits. Race window protected by `lastPushAt` grace of 8 seconds.

**Defense in depth (security):**
- `ALLOWED_STATE_KEYS` allowlist on the server (`lib/sheets.ts`) prevents prototype pollution via arbitrary keys
- `Object.create(null)` for the kv map on read
- Drops cloud `null` values (treated as cleared)
- `userFacingError()` עוטף Sheets errors כדי לא לדלוף Sheet ID / service account email

---

## 📁 פירוט קבצים

### Apps Script (`/`)

| קובץ | תפקיד |
|------|-------|
| [Main.gs](Main.gs) | UI menu + setup helpers (`setupAll`, `installDailyTrigger`) |
| [Config.gs](Config.gs) | constants, prop helpers, `fetchWithRetry_`, `verifyConfig`, **`resetSpreadsheetIdToKnownGood`**, **`printCurrentSpreadsheetId`**, `campaignTabName_`, `adsTabName_`, **`ordersAttributionTabName_`** |
| [Shopify.gs](Shopify.gs) | `getShopifyRevenue`, `getShopifyProductSalesForDay`, `getShopifyPlan`, `getShopifyProductsCatalog`, **`getShopifyOrdersAttribution`**, **`classifyOrderAttribution_`**, **`safeDecode_`** (Round 5: URI guard), auto-bootstrap on 401 |
| [MetaAds.gs](MetaAds.gs) | `getMetaSpend`, `getMetaAdSetInsights`, `getMetaAdInsights` (ad level), `getMetaBudgets` |
| [GoogleAds.gs](GoogleAds.gs) | `getGoogleAdsSpend`, `getGoogleAdsAdGroupInsights`, OAuth refresh |
| [FX.gs](FX.gs) | Frankfurter API, daily caching ב-Script Properties |
| [ManualOverrides.gs](ManualOverrides.gs) | קריאה מטאב manual-spend |
| [DailyUpdate.gs](DailyUpdate.gs) | `runDailyUpdate`, `runLiveUpdate`, `runUpdateForDate`, `backfillRange`, `backfillRangeForStores`, `runUpdateForDateForStores_` (Round 5 fix WR5-01: sleep בין חנויות), `updateStoreForDate_`, `notifyError_` |
| [SheetBuilder.gs](SheetBuilder.gs) | יצירה+תחזוקה של 8 סוגי tabs, מיגרציות אידמפוטנטיות, **`ensureOrdersAttributionTab_`**, **`writeOrdersAttributionForDay`** (Round 5 fix WR5-02), `refreshAllProductCatalogs`, `catalogNeedsRefresh_`, chunked writes |

### Dashboard data layer (`dashboard-web/src/lib/`)

| קובץ | תפקיד |
|------|-------|
| [sheets.ts](dashboard-web/src/lib/sheets.ts) (470) | Google Sheets read (kv state) + write helpers + ALLOWED_STATE_KEYS allowlist |
| [campaigns.ts](dashboard-web/src/lib/campaigns.ts) | parse `{store}-campaigns` → CampaignRow[] |
| [campaignsLinks.ts](dashboard-web/src/lib/campaignsLinks.ts) | `buildAdsManagerLink` עם `act=` / `__c=` / `selected_ad_ids=` |
| [campaignOptimized.ts](dashboard-web/src/lib/campaignOptimized.ts) | optimization marks (Set + toggle/clear) |
| [campaignProductMap.ts](dashboard-web/src/lib/campaignProductMap.ts) | mapping + `allocateProductRevenue` (proportional split) |
| [ads.ts](dashboard-web/src/lib/ads.ts) | parse `{store}-ads` → AdRow[] |
| [productCatalog.ts](dashboard-web/src/lib/productCatalog.ts) | parse `{store}-products-catalog` → CatalogProduct[] |
| [products.ts](dashboard-web/src/lib/products.ts) | parse `products-daily` → ProductRow[] |
| [ordersAttribution.ts](dashboard-web/src/lib/ordersAttribution.ts) | **NEW Round 5**: parse `{store}-orders-attribution` → OrderAttributionRow[] |
| [attributionAnalysis.ts](dashboard-web/src/lib/attributionAnalysis.ts) (746) | **NEW Round 5**: `analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`, `buildAnalysis` (shared engine), Bayesian CI, window stability, outlier detection, trust ladder, `orderMatchesCampaign` (utm_id authoritative) |
| [analytics.ts](dashboard-web/src/lib/analytics.ts) | aggregate / dailySeries / deltaPct / forecastMonthEnd / cogsRate |
| [insights.ts](dashboard-web/src/lib/insights.ts) (671) | InsightsBoard logic + goal + insight-states |
| [annotations.ts](dashboard-web/src/lib/annotations.ts) | annotation CRUD + scope filtering |
| [billing.ts](dashboard-web/src/lib/billing.ts) (561) | recurring + one-time + CSV importer + `billingForRange` |
| [cloudSync.ts](dashboard-web/src/lib/cloudSync.ts) (413) | STATE_KEYS, hydrate, push, sync state |
| [aiReport.ts](dashboard-web/src/lib/aiReport.ts) (564) | prompt assembly למשלוח ל-AI |
| [drawerStack.ts](dashboard-web/src/lib/drawerStack.ts) | shared Esc handler for nested drawers |
| [urlState.ts](dashboard-web/src/lib/urlState.ts) | URL ↔ tab+filters serialization |
| [presets.ts](dashboard-web/src/lib/presets.ts) | date range presets |
| [constants.ts](dashboard-web/src/lib/constants.ts) | FROZEN_USD_TO_CAD |
| [costs.ts](dashboard-web/src/lib/costs.ts) | TRANSACTION_FEES_RATE |
| [format.ts](dashboard-web/src/lib/format.ts) | additional formatters |
| [utils.ts](dashboard-web/src/lib/utils.ts) | formatters (currency, number, date), cn helper |
| [types.ts](dashboard-web/src/lib/types.ts) | shared types (Filters, DailyRow, etc.) |

### API routes (`dashboard-web/src/app/api/`)

| Route | מטרה | Cache (s-maxage) |
|-------|------|------------------|
| `/api/data` | daily rows + FX | 60s |
| `/api/campaigns` | per-adset rows × 3 stores | 60s |
| `/api/products` | per-product daily sales | 60s |
| `/api/ads` | per-ad daily rows × 3 stores | 300s |
| **`/api/orders-attribution`** | **NEW Round 5**: per-order attribution × 3 stores | 300s |
| `/api/product-catalog` | full catalog × 3 stores | 60s |
| `/api/store-meta` | plan + Meta/Google IDs | 3600s |
| `/api/dashboard-state` | kv cloud sync (GET/POST) | 10s |

### Components (`dashboard-web/src/components/`)

**31 קומפוננטות.** עיקריות (>200 lines):

| קובץ | שורות | תפקיד |
|------|------|-------|
| [CampaignsTable.tsx](dashboard-web/src/components/CampaignsTable.tsx) | 1722 | שורת הליבה — Meta + Google, sortable, attribution chip + fallback |
| [BillingSettings.tsx](dashboard-web/src/components/BillingSettings.tsx) | 1328 | billing modal עם 3 טאבים + CSV |
| [CampaignDrawer.tsx](dashboard-web/src/components/CampaignDrawer.tsx) | 1310 | drill-down + reconciliation + ad-sets table |
| [ProductsTable.tsx](dashboard-web/src/components/ProductsTable.tsx) | 884 | products tab |
| [InsightsBoard.tsx](dashboard-web/src/components/InsightsBoard.tsx) | 707 | collapsable insights surface + InsightHero |
| [CommandPalette.tsx](dashboard-web/src/components/CommandPalette.tsx) | 626 | Cmd-K navigator |
| [AdsDrawer.tsx](dashboard-web/src/components/AdsDrawer.tsx) | 586 | drill-down למודעות |
| [Dashboard.tsx](dashboard-web/src/components/Dashboard.tsx) | 545 | root + tab routing |
| [HeroOverview.tsx](dashboard-web/src/components/HeroOverview.tsx) | 525 | hero chart + annotations |
| [PnLBreakdown.tsx](dashboard-web/src/components/PnLBreakdown.tsx) | 442 | hero strip + waterfall |
| [ProductPickerModal.tsx](dashboard-web/src/components/ProductPickerModal.tsx) | 368 | multi-select modal לשיוך מוצרים |
| [MonthlyTables.tsx](dashboard-web/src/components/MonthlyTables.tsx) | 349 | טבלאות חודשיות |
| [AnnotationsPanel.tsx](dashboard-web/src/components/AnnotationsPanel.tsx) | 347 | annotations CRUD |
| [GoalTracker.tsx](dashboard-web/src/components/GoalTracker.tsx) | 335 | monthly goal + projection |
| [KpiCards.tsx](dashboard-web/src/components/KpiCards.tsx) | 327 | 4-column KPI strip |
| [TodayLive.tsx](dashboard-web/src/components/TodayLive.tsx) | 298 | today's snapshot |
| [WhatsWorking.tsx](dashboard-web/src/components/WhatsWorking.tsx) | 292 | top-performers card |
| [AiReportButton.tsx](dashboard-web/src/components/AiReportButton.tsx) | 240 | prompt assembly + copy |

---

## 🔧 תפעול שוטף

### פעולות ידניות נפוצות

| מה | איך |
|-----|------|
| הטוקנים של Shopify פגי-תוקף | אוטומטי — auto-bootstrap on 401 (`bootstrapShopifyTokenForStore_`) |
| מוצר חדש בחנות לא מופיע ב-picker | Apps Script → `refreshAllProductCatalogs` (SheetBuilder.gs) |
| שיוך מחדש של קמפיין למוצר | פתח את ה-CampaignDrawer → "מוצרי Shopify משויכים" → "ערוך מיפוי" |
| Apps Script timeout פתאומי | בדוק ש-`spreadsheet.id` ב-Script Properties מצביע לגיליון הנכון (`printCurrentSpreadsheetId`) |
| ה-`spreadsheet.id` מצביע ל-phantom | `resetSpreadsheetIdToKnownGood` (Config.gs) — צריך לערוך REAL_ID בקוד לפי הצורך |
| Backfill טווח תאריכים | `backfillRange('2026-01-01', '2026-01-15')` — פצל לחבילות של 1-2 ימים כדי להישאר מתחת ל-6 דק׳ |
| Backfill חנות אחת בלבד | `backfillRangeForStores(start, end, ['zolplus'])` |
| אימייל אזעקות לא מגיע | Script Properties → `notification.email` → הגדר ידנית |

### מגבלת הזמן של Apps Script

כל execution מוגבל ל-**6 דקות**. ריצה אחת של `runUpdateForDate` עם 3 חנויות לוקחת ~3-4 דק׳ (כולל ה-sleeps החדשים). לכן:
- backfill של 1-2 ימים → ריצה אחת (~3-6 דק׳)
- backfill של 11 ימים → חייב לפצל ל-6 ריצות נפרדות

הריצה היומית הרגילה (`runDailyUpdate` ב-00:05) עוסקת ביום אחד ולא נכנסת למגבלה.

### Quota relief (Round 4 + 5)

- `Utilities.sleep(1500)` בין חנויות ב-`runUpdateForDate` וב-`runUpdateForDateForStores_`
- `Utilities.sleep(500)` בין כתיבות גדולות בתוך אותה חנות
- Catalog refresh הוצא מ-`runDailyUpdate` — מנואלי דרך `refreshAllProductCatalogs`
- `getMetaAdInsights` מוגן ב-try/catch כדי לא להפיל את הריצה אם Meta מחזיר 5xx

### אינדיקטורים שכדאי לעקוב אחריהם

1. **SyncIndicator pill בכותרת**: ירוק = OK. אדום = לחץ לפרטים.
2. **`store-meta` `lastError`**: מופיע ב-banner ב-BillingSettings אם Apps Script GraphQL נכשל
3. **`runDailyUpdate` logs**: בודק מספרי orders + spend + Apps Script timeouts
4. **Vercel deploys**: אחרי push, רוב הזמן עולה תוך דקה. אם נכשל — Vercel UI יראה אדום

---

## 🛠 פתרון תקלות

### "הקטלוג עוד לא סונכרן"

1. אמת `printCurrentSpreadsheetId` — האם זה הגיליון הנכון?
2. אם לא → `resetSpreadsheetIdToKnownGood` עם ה-ID הנכון
3. הרץ `refreshAllProductCatalogs`
4. רענן את הדשבורד hard (Cmd/Ctrl+Shift+R)

### "401 Invalid API key" מ-Shopify

- אם זה מסלול B (Dev Dashboard): `bootstrapAllShopifyTokens` ידני
- אם זה מסלול A (קלאסי): מחדש את הטוקן ב-Shopify Admin ושים ב-Script Properties

### "Cannot find name 'XXX'" ב-Apps Script

- Apps Script לא תומך ב-ES modules; כל הפונקציות globals
- בדוק שהקובץ קיים בעורך ב-Apps Script (אם משתמשים בהעתקה ידנית — תוודא ש-3 קבצים אחרונים הועלו)

### `Service Spreadsheets timed out`

- אוטומטי — `ensureSpreadsheet` מנסה 3 פעמים עם backoff
- אם נמשך → בדוק ב-https://www.google.com/appsstatus
- ⚠️ הקוד **לא יוצר phantom sheet עוד** — תקלת timeout פשוט מבטלת את הריצה

### Phantom spreadsheet (15tYa...)

- אם בעבר נוצר → הוצב ב-Script Property
- `printCurrentSpreadsheetId` יראה זאת
- `resetSpreadsheetIdToKnownGood` יתקן

### "אין המרות" על קמפיין שיש לו spend

- זה לא bug — זה אומר שהקמפיין לא הביא המרות לא מ-Meta ולא מ-Shopify
- אם זה קמפיין brand-awareness → תקין
- אחרת → בדוק שה-Pixel/CAPI עובדים והקמפיין מכוון להמרות

### Trust chip מציג `·מיפוי` (fallback)

- ההזמנות בטווח חסרות `utm_id`/`utm_campaign` ב-landing_site
- בדוק שב-Meta Ads Manager > URL Parameters מוגדר:
  ```
  utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}
  &utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
  ```
- אחרי שמגדירים, הזמנות חדשות יקבלו את הפרמטרים; היסטוריות יישארו `·מיפוי`

### URIError ב-Shopify orders

- מתוקן ב-Round 5 (`safeDecode_`). אם רואה את זה בלוגים → ודא ש-Shopify.gs המעודכן ב-Apps Script.

---

## 🔐 אבטחה

- **Service Account**: scope `spreadsheets.readonly` לרוב הקריאות + `spreadsheets` (write) רק ל-dashboard-state
- **Allowlist on POST**: `/api/dashboard-state` בודק `isAllowedStateKey(body.key)` כדי למנוע prototype pollution
- **Env vars**: `GOOGLE_PRIVATE_KEY` נשמר ב-Vercel Encrypted
- **Apps Script credentials**: רק ב-Script Properties, לא ב-source
- **Error sanitization**: `/api/dashboard-state` עוטף Sheets errors ב-`userFacingError()` כדי לא לדלוף Sheet ID / service account email
- **CloudSync error reporting**: שגיאות נחשפות ב-SyncIndicator עם הטקסט המסונן, לא הגלם
- **Object.create(null)**: ב-`classifyOrderAttribution_` (Round 5 IN5-05) למניעת collisions עם Object.prototype
- **safeDecode_**: ב-`classifyOrderAttribution_` (Round 5 CR5-02) להגן מ-URIError על URLs פסולים מבוטים

---

## 🚧 מגבלות ידועות

| איזור | מגבלה | סיבה |
|------|--------|------|
| Google PMax | אין mapping per-product | PMax מנהל הצגה לפי הפיד, לא לפי קמפיין |
| Click-id attribution | רק להזמנות עם UTM/click-id ב-landing_site | תלוי במה ש-Meta הוסיף ל-URL בשעת הקליק |
| Historical orders pre-UTM | לא יוכלו להיות matched ל-utm_id | URL Parameters הוגדרו בנקודה מסוימת בזמן; הזמנות לפני כן יוצרות trust=unknown → fallback למיפוי |
| Trust chip ad-set/ad level | אין fallback למיפוי מוצרים | אין mapping ברמה זו (יורש מהקמפיין) |
| Last-write-wins | שני שותפים שעורכים אותה רשומה במקביל → השני מנצח | Acceptable עבור עריכות לא-תכופות |
| Historical campaigns paused | לא מופיעים בנתונים חדשים אחרי הפסקה | Meta API מחזיר רק ad-sets פעילים — היסטוריה נשמרת בגיליון |
| Catalog refresh manual | מוצר חדש לא יופיע מיד | `refreshAllProductCatalogs` ידני אחרי הוספה |
| FX rate | יומי, לא inter-day | Frankfurter API מספק שערים יומיים בלבד |
| Bayesian CI | normal approximation, לא Wilson מלא | מספיק טוב לתצוגה — אם N קטן ה-CI ממילא רחב |
| Outlier detection | דורש 15+ ימים (Round 5: 10+ עם LOOKBACK אדפטיבי) | trailing baseline צריך מינימום מדגם |
| Window stability | partial trailing bucket דורש ≥3 ימים | פחות מזה מוסיף רעש ל-σ |

---

## 📞 קישורים שימושיים

- **Dashboard**: https://roas-dashboard-smoky.vercel.app
- **Spreadsheet**: בקש מהמפעיל את ה-ID (sensitive in Vercel env)
- **Apps Script**: `printCurrentSpreadsheetId` בעורך → תקבל את הקישור הישיר
- **Vercel project**: roas-dashboard
- **GitHub repo**: dor77777-prog/script-roas

---

_עודכן בקומיט: `6d9df13` (מאי 2026). שינויים גדולים מ-Round 4: orders-attribution pipeline עם classification per-order, Bayesian CI + window stability + outlier detection, attribution analysis ב-3 רמות (campaign / ad-set / ad) דרך utm_id+utm_term+utm_content, trust chip fallback למיפוי מוצרים, safeDecode_ + Object.create(null) + quota throttle, 13 תיקוני code-review (2 critical, 5 warning, 6 info)._
