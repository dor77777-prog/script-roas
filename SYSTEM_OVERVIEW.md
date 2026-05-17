# ROAS Tracker — אפיון מערכת מלא

מסמך מקיף שמתעד את המערכת במצבה הנוכחי: ארכיטקטורה, רכיבים, זרימת נתונים, פיצ'רים, ותפעול שוטף.
**עודכן לאחרונה: מאי 2026** — משקף את כל מה שנבנה עד `d8f916a`.

---

## 📌 תוכן עניינים

1. [תמונה גדולה](#-תמונה-גדולה)
2. [רכיבי המערכת](#-רכיבי-המערכת)
3. [זרימת נתונים](#-זרימת-נתונים)
4. [פיצ'רים עיקריים](#-פיצרים-עיקריים)
5. [מבנה הגיליון](#-מבנה-הגיליון)
6. [מבנה הדשבורד](#-מבנה-הדשבורד)
7. [שכבת Cloud Sync](#-שכבת-cloud-sync)
8. [פירוט קבצים](#-פירוט-קבצים)
9. [תפעול שוטף](#-תפעול-שוטף)
10. [פתרון תקלות](#-פתרון-תקלות)
11. [אבטחה](#-אבטחה)
12. [מגבלות ידועות](#-מגבלות-ידועות)

---

## 🎯 תמונה גדולה

המערכת עוקבת אחרי ROAS, רווחיות וביצועי קמפיינים של **3 חנויות Shopify** ב-3 רמות, ומחברת בין נתוני מודעות (Meta + Google Ads) לנתוני מכירות בפועל (Shopify) כדי לזהות פערי attribution אמיתיים.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🌐 שכבת תצוגה (Next.js 15 + React 19 on Vercel)                       │
│   - 6 טאבים: בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט             │
│   - CampaignsTable + 3 drawers nested (Campaign → Ads)                │
│   - Cloud-synced state: billing / annotations / goal / insights /     │
│     campaign-optimized / product-map (כל מכשיר רואה אותו דבר)         │
│   - SyncIndicator pill בכותרת + Sheets-backed כתיבה (write-through)   │
│   ↑↓                                                                   │
│   קריאות REST + POST /api/dashboard-state                              │
└──────────────────────────────────────────────────────────────────────┘
                                ↑↓
┌──────────────────────────────────────────────────────────────────────┐
│ 📊 שכבת נתונים (Google Sheets — spreadsheet אחד, 11 סוגי טאבים)       │
│   קריאה לדשבורד:                                                       │
│     - data-daily           · sums per (date, store)                    │
│     - products-daily       · per-product sales per day                 │
│     - {store}-campaigns    · per-adset daily + budgets + CBO/ABO       │
│     - {store}-ads          · per-ad daily metrics                      │
│     - {store}-products-catalog · full Shopify catalog (active)        │
│     - store-meta           · plan name + Meta/Google account IDs      │
│     - dashboard-state      · cloud-sync key-value                     │
│   נוסחאות (legacy ROAS pages):                                         │
│     - סיכום + {store}-sheets                                           │
│   ↑                                                                    │
│   נכתב ע"י Apps Script + service account (write)                       │
└──────────────────────────────────────────────────────────────────────┘
                                ↑
┌──────────────────────────────────────────────────────────────────────┐
│ 🔧 שכבת איסוף (Google Apps Script)                                    │
│   Triggers:                                                            │
│     - runDailyUpdate · 00:05 IT  → סוגר אתמול                          │
│     - runLiveUpdate  · כל 15 דק׳ → מרענן את היום                      │
│   שולף:                                                                │
│     - Shopify revenue + orders + line items + refunds                  │
│     - Shopify full catalog (per store, weekly cache)                   │
│     - Shopify plan name (GraphQL)                                      │
│     - Meta insights (account + ad-set + ad levels)                     │
│     - Meta budgets (campaign + adset, current state)                   │
│     - Google Ads spend + ad-group insights (uzoshop בלבד)              │
│     - Manual override sheet (חשבונות מושבתים וכו')                     │
│   מטפל ב:                                                              │
│     - 401 → auto-bootstrap (Client Credentials Grant) → retry          │
│     - 429/5xx → retry עם backoff                                       │
│     - Timeout של Sheets → retry, לעולם לא יוצר phantom spreadsheet     │
│     - ILS/USD/EUR → CAD לפי שער יומי (Frankfurter API)                 │
└──────────────────────────────────────────────────────────────────────┘
                                ↑
┌──────────────────────────────────────────────────────────────────────┐
│ 🌍 APIs חיצוניים                                                       │
│   - Shopify Admin (REST + GraphQL): orders, products, plan            │
│   - Meta Marketing API v20.0: insights + campaigns + adsets           │
│   - Google Ads API v20: campaigns + ad groups                         │
│   - Frankfurter (FX): ILS/USD/EUR → CAD                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🧩 רכיבי המערכת

### 1. Google Apps Script (איסוף נתונים)

**קבצים עיקריים** (`*.gs`):

| קובץ | אחריות |
|------|--------|
| `Main.gs` | nav entrypoint, setup triggers |
| `Config.gs` | constants, getProp/setProp, fetchWithRetry, verifyConfig, **resetSpreadsheetIdToKnownGood**, **printCurrentSpreadsheetId** |
| `Shopify.gs` | revenue + product sales + plan + **auto-bootstrap on 401** + product catalog |
| `MetaAds.gs` | account spend + ad-set insights + **ad-level insights** + **getMetaBudgets** |
| `GoogleAds.gs` | account spend + ad-group insights (OAuth refresh-token flow) |
| `FX.gs` | Frankfurter API, daily cache ב-Script Properties |
| `ManualOverrides.gs` | קריאה מטאב manual-spend |
| `DailyUpdate.gs` | `runDailyUpdate`, `runLiveUpdate`, `backfillRange*`, **notifyError_ עם 3-tier email resolver** |
| `SheetBuilder.gs` | יצירה/תחזוקת כל הטאבים, מיגרציות אידמפוטנטיות, **refreshAllProductCatalogs**, **catalogNeedsRefresh_**, chunked writes |

**טריגרים**:
- `runDailyUpdate` — 00:05 שעון ישראל
- `runLiveUpdate` — כל 15 דקות

### 2. Google Sheets (נתונים)

**11 סוגי טאבים** (לפי מטרה):

**Read-only למשתמש**:
- `סיכום` — נוסחה-driven, שורת ROAS לכל יום (legacy view)
- `uzoshop` / `Zol Plus` / `360usmile` — סיכום פר-חנות, נוסחה-driven
- `manual-spend` — overrides ידניים שהמשתמש כותב

**מוסתרים (data-only)**:
- `data-daily` — שורה לכל (יום, חנות). מקור האמת ל-`/api/data` בדשבורד
- `products-daily` — שורה לכל (יום, חנות, מוצר) — רק מוצרים שנמכרו
- `{storeId}-campaigns` — שורה לכל (יום, חנות, קמפיין, ad-set). כולל **תקציב יומי + סוג CBO/ABO**
- `{storeId}-ads` — שורה לכל (יום, חנות, קמפיין, ad-set, מודעה)
- `{storeId}-products-catalog` — **קטלוג מלא של חנות**, כולל מוצרים פעילים בלי הזמנות. מתחדש כל 7 ימים (cache gate)
- `store-meta` — שורה לחנות: שם תוכנית Shopify + Meta ad-account ID + Google customer ID + last-error
- `dashboard-state` — Key-value: billing / annotations / goal / insight-states / campaign-optimized / **campaign-product-map**

### 3. Next.js Dashboard (תצוגה)

**6 טאבים ראשיים** (`TabNav`):

1. **בית** — HeroOverview chart + Filters + AI report + TodayLive + GoalTracker + InsightsBoard + AnnotationsPanel + KpiCards + PerStoreCards
2. **P&L** — SectionIntro + BillingSettings + PnLBreakdown (hero strip + waterfall, פתוח כברירת מחדל)
3. **ניתוח** — RoasChart trend + MonthlyTables
4. **קמפיינים** — CampaignsTable (Meta + Google, sortable, **per-campaign optimization marks**, **CBO/ABO budgets**, **ROAS Shopify + confidence chip**, **Shopify actual revenue + units**)
5. **מוצרים** — ProductsTable
6. **פירוט** — DetailTable

**Drawers** (z-indexed stack):
- `CampaignDrawer` (z-50) — נפתח בלחיצה על שורת קמפיין
  - Hero stats, daily chart, **mapped products + picker**, **Meta-vs-Shopify reconciliation** (Pearson r + lag detection + per-day delta table), sortable ad-sets
- `AdsDrawer` (z-60) — נפתח בלחיצה על שורת ad-set (Meta בלבד)
  - Totals strip, sortable ads table, optimization toggle per ad, deep link to Ads Manager
- `ProductPickerModal` (z-70) — נפתח מתוך CampaignDrawer
  - Search + multi-select של מוצרי החנות (קטלוג מלא)

ה-stack מנוהל ע"י `lib/drawerStack.ts` — Esc סוגר רק את העליון.

### 4. Service Account & Auth

**Server-side** (`dashboard-web/src/lib/sheets.ts`):
- Service account `roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com`
- Scopes: `spreadsheets.readonly` לכל הקריאות + `spreadsheets` (write) רק לכתיבת `dashboard-state` (cloud sync)
- Env vars ב-Vercel: `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`

**Apps Script**: רץ כמשתמש שמחזיק את ה-Script Properties (`spreadsheet.id`, `{storeId}.shopify.token`, וכו'). יש לוודא שהוא Editor על ה-Sheet.

---

## 🔄 זרימת נתונים

### זרימת הקריאה (כשאתה פותח את הדשבורד):

```
Browser ─ GET /api/data
       │  └─ fetchDailyData() → Sheets read data-daily → DailyRow[]
       ├─ GET /api/campaigns
       │  └─ fetchCampaignsData() → batchGet {store}-campaigns × 3 → CampaignRow[]
       ├─ GET /api/products
       │  └─ fetchProductsData() → Sheets read products-daily → ProductRow[]
       ├─ GET /api/ads
       │  └─ fetchAdsData() → batchGet {store}-ads × 3 → AdRow[]
       ├─ GET /api/product-catalog
       │  └─ fetchProductCatalog() → batchGet {store}-products-catalog × 3
       ├─ GET /api/store-meta
       │  └─ fetchStoreMeta() → Sheets read store-meta → StoreMetaRow[]
       └─ GET /api/dashboard-state
          └─ fetchDashboardState() → reads dashboard-state tab → kv map
              (CloudSync polls every 30s)
```

### זרימת הכתיבה (כש-Apps Script רץ):

```
runDailyUpdate(dateStr):
  ensureSpreadsheet()                    # opens existing, retry-on-timeout
  for each store:
    updateStoreForDate_(store, dateStr):
      revenueCad = getShopifyRevenue(...)     # Shopify orders
      metaSpend  = getMetaSpend(...) (or manual override)
      googleAdsSpend = getGoogleAdsSpend(...) # if hasGoogleAds
      writeDayRow(...)                          # store sheet
      updateCampaignDataForStoreDate_(...):
        budgets = getMetaBudgets(...)           # campaign + adset budgets
        metaRows = getMetaAdSetInsights(...)
        gaRows = getGoogleAdsAdGroupInsights(...) # if hasGoogleAds
        writeCampaignRowsForDay(...)            # {store}-campaigns
      cogsCad = revenueCad × 0.25
      writeDailyFlatRow_(...)                   # data-daily
      products = getShopifyProductSalesForDay(...)
      writeProductSalesForDay_(...)             # products-daily
      updateAdDataForStoreDate_(...):           # {store}-ads
        adRows = getMetaAdInsights(level=ad)
        writeAdsRowsForDay(...)
      if catalogNeedsRefresh_(store, 7):        # weekly cache gate
        catalog = getShopifyProductsCatalog(...)
        writeProductCatalogForStore_(...)
  refreshAllStoreMeta()                          # plan + Meta/GA IDs
  notifyError_(...) on errors                    # email via 3-tier resolver
```

### זרימת user actions:

```
משתמש לוחץ "שמור" ב-BillingSettings:
  writeRecurring(items)
    → localStorage.setItem
    → window.dispatchEvent('roas-billing-changed')
    → pushCloudKey('roas-dashboard:billing-recurring', items)
        → debounce 400ms
        → fetch POST /api/dashboard-state { key, value }
            → upsertDashboardStateKey (serialized append to dashboard-state)

מכשיר אחר (כל 30 שניות):
  CloudSync.hydrateFromCloud()
    → GET /api/dashboard-state
    → for each STATE_KEYS:
        if cloud has value:
          writeLocal(key, value)
          dispatchEvent('roas-billing-changed' / etc.)
            → component re-reads localStorage → re-renders
```

---

## ✨ פיצ'רים עיקריים

### 1. P&L מפורט (טאב משלו)

`PnLBreakdown` (`src/components/PnLBreakdown.tsx`):
- **Hero strip** תמיד גלוי: הכנסות / סך עלויות / רווח נטו עם פסי גרף יחסיים
- Waterfall (פתוח כברירת מחדל): Revenue → -Ad Spend → -COGS → -Transaction Fees → -Fixed → True Net
- COGS: 25% מהכנסות (גלובלי)
- Transaction Fees: 6.5% מהכנסות (PayPal + FX)
- Fixed Costs: מ-`lib/billing` — recurring monthly subs + one-time charges, prorated לטווח

### 2. BillingSettings — ניהול עלויות שותפים

`BillingSettings.tsx` + `lib/billing.ts`:
- 3 טאבים: חודשי קבוע · חד-פעמיים · ייבא CSV
- Auto-detect: שואב מ-store-meta את שם תוכנית Shopify של כל חנות → מציע "הוסף Basic Shopify ≈ CAD 53/mo" בלחיצה
- CSV import עם classifier heuristic + dedup (`findMatchingRecurring`)
- מסונכרן בענן ל-`dashboard-state`

### 3. CampaignsTable — שכבת הקמפיינים

`CampaignsTable.tsx` (940+ שורות, הקומפוננטה הגדולה במערכת):

**עמודות** (סדר מימין לשמאל ב-RTL):
1. Toggle (סימון אופטימיזציה ✓)
2. שם קמפיין/ad-set + CBO/ABO chip (Meta בלבד)
3. הוצאה
4. תקציב יומי (Meta בלבד, מאד-set לפי ABO/קמפיין לפי CBO)
5. ערך המרות (Meta)
6. ROAS (Meta)
7. **ROAS Shopify** + confidence chip (אם יש mapping)
8. **ערך Shopify** (Shopify-actual)
9. **יח׳ Shopify** (units)
10. המרות (Meta)
11. CTR / CPC / CPA
12. External link

**Confidence chip** (מבוסס heuristic, לא מבחן סטטיסטי):
- **High** (ירוק "אמין"): מיפוי מלא + פער < 30% + שני המקורות עקביים
- **Medium** (כתום "חלקי"): פער 30-70%, או מוצרים משותפים + פער > 15%, או הוצאה < 200 + פער > 15%
- **Low** (אדום "לא אמין"): פער > 70%, או 3+ קמפיינים חולקים מוצר, או מוצר יחיד + פער > 50%
- **חשוב**: low spend לבדה אינה מורידה לאוטומטית — רק בשילוב עם פער. אם המספרים מסכימים, הצ׳יפ נשאר ירוק עם FYI על המדגם הקטן

### 4. Campaign → Product Mapping

`lib/campaignProductMap.ts` + `ProductPickerModal.tsx`:
- Many-to-many: קמפיין יכול לקדם N מוצרים, מוצר יכול להיות מקודם ע"י N קמפיינים
- מאוחסן כ-`Record<storeId::campaignId, productId[]>`
- מסונכרן בענן ל-`dashboard-state`
- ה-picker שואב מ-`{store}-products-catalog` (קטלוג מלא, כולל מוצרים בלי מכירות)
- Fallback ל-products-daily אם הקטלוג עוד לא סונכרן (עם warning banner)
- ⚠️ Google PMax — picker מוסתר (אין attribution per-product, הפיד מנהל)

**Allocation logic** (`allocateProductRevenue`):
- מוצר עם spend > 0 בכמה קמפיינים → חלוקה פרופורציונלית להוצאה
- כל הקמפיינים עם 0 spend → חלוקה שווה
- מוצר orphan (אין mapping) → לא מוקצה
- **גם units וגם revenue** מוקצים באותו share

### 5. Meta ↔ Shopify Reconciliation (בתוך CampaignDrawer)

עבור קמפיין עם mapped products (Meta בלבד):
- **Pearson r** בין conversionValue יומי של Meta לבין mapped product revenue יומי
- r > 0.7 → "Meta תופס את הטרנדים נכון, הפער הוא bias קבוע" (ירוק)
- r 0.3-0.7 → "התעלם מ-Meta ברמת יום בודד, הסתכל על 7+ ימים" (כתום)
- r < 0.3 → "Meta מדווח על המרות שלא קורות, אל תקבל החלטות לפי המספרים שלו" (אדום)
- **Lag detection** ב-3 ימים אחורה/קדימה — מזהה חלון attribution
- טבלה collapsable יום-לפי-יום: Meta / Shopify / Δ%

### 6. AdsDrawer — drill-down ברמת המודעה

`AdsDrawer.tsx`:
- נפתח בלחיצה על ad-set ב-CampaignsTable (Meta בלבד)
- שואב lazy מ-`/api/ads`
- Totals strip + sortable table (7 metric columns: name/spend/value/ROAS/conversions/impressions/clicks)
- Optimization toggle לכל ad
- Deep link לכל מודעה ב-Ads Manager (`?selected_ad_ids=...`)

### 7. Optimization Marks

`lib/campaignOptimized.ts`:
- Set של composite keys: `storeId::platform::campaignId::adSetId::adId`
- Toggle בכל שורה (בטבלה הראשית + AdsDrawer + ad-sets table ב-CampaignDrawer)
- שורה מסומנת מתעמעת ל-50% opacity + ריחוף מחזיר ל-100%
- "נקה הכל" בלחיצה אחת
- מסונכרן בענן — שותפים רואים אותם סימונים

### 8. Annotations System

`lib/annotations.ts` + `AnnotationsPanel.tsx`:
- 8 סוגי events: launch · pause · budget · pricing · sale · creative · supplier · other
- כל אחד עם emoji + Hebrew label + צבע פלטה
- נצפים כ-ReferenceLines על גרף ה-ROAS ב-HeroOverview
- מסונכרן בענן

### 9. SyncIndicator (בכותרת)

`SyncIndicator.tsx`:
- Pill קטן ליד "רענן": Cloud / RefreshCw / CloudOff
- 4 מצבים: idle · syncing · ok · error
- בכישלון: לחיצה פותחת popover עם השגיאה המדויקת מהשרת + רשימת בדיקות מהירות (Editor permission, env vars)

### 10. Insights Engine

`lib/insights.ts` + `InsightsBoard.tsx`:
- 3 סוגי תובנות: anomalies (z-score נגד trailing 14d), recommendations, forecasts
- 5 רמות severity: critical → warning → opportunity → positive → info
- כשהלוח סגור: "headline" אדיטוריאלי של התובנה הכי דחופה (typographic moment)
- States: handled / hidden — נשמרים בענן, "טיפלתי"/"הסתר"/"החזר"

### 11. Goal Tracker

`GoalTracker.tsx` + `lib/insights.ts:readGoal/writeGoal`:
- יעד הכנסות חודשי, מסונכרן בענן
- מחשב MTD vs יעד + projected end-of-month based on trailing 7d avg
- חיווי: ahead / on-pace / behind

### 12. Today Live (real-time)

`TodayLive.tsx`:
- מציג את היום הנוכחי עם הכנסות + הוצאות עד עכשיו (פיגור ~20 דק׳ מ-Meta/Google API)
- מתעדכן כל 15 דק׳ ע"י runLiveUpdate ב-Apps Script

---

## 📊 מבנה הגיליון

ראה הסעיף "רכיבי המערכת > Google Sheets" לעיל לפירוט מלא של 11 סוגי הטאבים.

**Critical**: ה-`SPREADSHEET_ID` ב-Vercel וה-`spreadsheet.id` ב-Script Properties **חייבים להתאים**. אם לא — Apps Script כותב לגיליון אחד והדשבורד קורא מגיליון אחר. הוסף ב-`Config.gs`: `resetSpreadsheetIdToKnownGood()` ו-`printCurrentSpreadsheetId()` לזיהוי ותיקון.

---

## 🖥 מבנה הדשבורד

### עץ הקומפוננטות:

```
Dashboard
├── CloudSync (invisible — שואב/דוחף state)
├── Header
│   ├── CommandPalette (Cmd-K)
│   ├── SyncIndicator
│   └── RefreshButton
├── TabNav (בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט)
├── Main:
│   ├── HomeTab
│   │   ├── HeroOverview
│   │   ├── Filters + AiReportButton
│   │   ├── TodayLive
│   │   ├── GoalTracker
│   │   ├── InsightsBoard
│   │   │   └── InsightHero (כשסגור) / SeverityGroup[] (כשפתוח)
│   │   ├── AnnotationsPanel
│   │   ├── KpiCards
│   │   └── PerStoreCards
│   ├── PnLTab
│   │   ├── SectionIntro
│   │   ├── Filters
│   │   ├── BillingSettings (modal)
│   │   └── PnLBreakdown (hero strip + waterfall)
│   ├── AnalysisTab → RoasChart + MonthlyTables
│   ├── CampaignsTab → CampaignsTable
│   │   ├── CampaignDrawer (on row click)
│   │   │   ├── ProductPickerModal (z-70)
│   │   │   └── AdsDrawer (z-60, on ad-set click)
│   ├── ProductsTab → ProductsTable
│   └── DetailTab → DetailTable
└── Footer
```

### State management:

- **URL state** (`lib/urlState.ts`): tab + filters → URL params, restored on refresh
- **localStorage**: 6 keys מסונכרנים בענן (ראה Cloud Sync)
- **SWR** caches: per-API-route, dedupe interval 30s-5min

---

## ☁️ שכבת Cloud Sync

`lib/cloudSync.ts` + `components/CloudSync.tsx`:

**7 keys מסונכרנים** (`STATE_KEYS`):
1. `roas-dashboard:billing-recurring` — recurring costs (Klaviyo, Shopify Plan, וכו')
2. `roas-dashboard:billing-onetime` — one-time charges
3. `roas-dashboard:annotations` — activity events
4. `roas-dashboard:monthly-revenue-goal` — single number
5. `roas-dashboard:insight-states` — handled/hidden per insight ID
6. `roas-dashboard:campaign-optimized` — Set of marked campaign keys
7. `roas-dashboard:campaign-product-map` — `{campaignKey → productId[]}`

**Lifecycle**:
- **On mount**: `hydrateFromCloud()` → GET `/api/dashboard-state` → writeLocal each key → dispatch change events
- **On any write**: localStorage immediate + `pushCloudKey()` debounced 400ms → POST `/api/dashboard-state`
- **Every 30s**: poll `hydrateFromCloud()` → merge cloud changes
- **On focus**: extra hydrate

**Conflict policy**: last-write-wins. Acceptable for low-frequency edits. Race window protected by `lastPushAt` grace of 8 seconds.

**Defense in depth**:
- ALLOWED_STATE_KEYS allowlist on the server (`lib/sheets.ts`) prevents prototype pollution via arbitrary keys
- `Object.create(null)` for the kv map on read
- Drops cloud `null` values (treated as cleared)

---

## 📁 פירוט קבצים

### Apps Script (`/`)

| קובץ | תפקיד |
|------|-------|
| `Main.gs` | UI menu + setup helpers |
| `Config.gs` | constants, prop helpers, fetchWithRetry_, verifyConfig, **resetSpreadsheetIdToKnownGood**, **printCurrentSpreadsheetId** |
| `Shopify.gs` | revenue + products + plan (GraphQL) + **catalog** + auto-bootstrap on 401 |
| `MetaAds.gs` | account spend + adset insights + **ad insights** + **getMetaBudgets** |
| `GoogleAds.gs` | account spend + ad-group insights, OAuth refresh |
| `FX.gs` | Frankfurter API, daily caching ב-Script Properties |
| `ManualOverrides.gs` | קריאה מטאב manual-spend |
| `DailyUpdate.gs` | runDailyUpdate, runLiveUpdate, backfillRange*, debugTodaySpend, notifyError_ |
| `SheetBuilder.gs` | יצירה+תחזוקה של כל הטאבים, **refreshAllProductCatalogs**, **catalogNeedsRefresh_**, chunked writes |

### Dashboard data layer (`dashboard-web/src/lib/`)

| קובץ | תפקיד |
|------|-------|
| `sheets.ts` | Google Sheets read (kv state) + write helpers + allowlist |
| `campaigns.ts` | parse `{store}-campaigns` → CampaignRow[] |
| `campaignsLinks.ts` | `buildAdsManagerLink` עם `act=` / `__c=` / `selected_ad_ids=` |
| `campaignOptimized.ts` | optimization marks (Set + toggle/clear) |
| `campaignProductMap.ts` | mapping + `allocateProductRevenue` |
| `ads.ts` | parse `{store}-ads` → AdRow[] |
| `productCatalog.ts` | parse `{store}-products-catalog` → CatalogProduct[] |
| `products.ts` | parse `products-daily` → ProductRow[] |
| `analytics.ts` | aggregate / dailySeries / deltaPct / forecastMonthEnd / cogsRate |
| `insights.ts` | InsightsBoard logic + goal + insight-states |
| `annotations.ts` | annotation CRUD + scope filtering |
| `billing.ts` | recurring + one-time + CSV importer + `billingForRange` |
| `cloudSync.ts` | STATE_KEYS, hydrate, push, sync state |
| `drawerStack.ts` | shared Esc handler for nested drawers |
| `urlState.ts` | URL ↔ tab+filters serialization |
| `presets.ts` | date range presets |
| `constants.ts` | FROZEN_USD_TO_CAD |
| `costs.ts` | TRANSACTION_FEES_RATE |
| `utils.ts` | formatters (currency, number, date) |
| `types.ts` | shared types (Filters, DailyRow, etc.) |

### API routes (`dashboard-web/src/app/api/`)

| Route | מטרה | Cache |
|-------|------|-------|
| `/api/data` | daily rows + FX | 60s |
| `/api/campaigns` | per-adset rows × 3 stores | 60s |
| `/api/products` | per-product daily sales | 5m |
| `/api/ads` | per-ad daily rows × 3 stores | 5m |
| `/api/product-catalog` | full catalog × 3 stores | 60s |
| `/api/store-meta` | plan + Meta/Google IDs | 1h |
| `/api/dashboard-state` | kv cloud sync (GET/POST) | 10s |

### Components (`dashboard-web/src/components/`)

24+ קומפוננטות. עיקריות (>200 lines):
- `Dashboard.tsx` (~500) — root + tab routing
- `CampaignsTable.tsx` (~940) — שורת הליבה של המוצר
- `CampaignDrawer.tsx` (~700) — drill-down + reconciliation + ad-sets
- `AdsDrawer.tsx` (~450) — drill-down למודעות
- `ProductPickerModal.tsx` (~360) — multi-select modal לשיוך מוצרים
- `BillingSettings.tsx` (~1100) — billing modal עם 3 טאבים + CSV import + recurring/onetime CRUD
- `PnLBreakdown.tsx` (~400) — hero strip + waterfall
- `InsightsBoard.tsx` (~600) — collapsable insights surface + InsightHero

---

## 🔧 תפעול שוטף

### פעולות ידניות נפוצות

| מה | איך |
|-----|------|
| כל הטוקנים של Shopify פגי-תוקף | אוטומטי — auto-bootstrap on 401 |
| מוצר חדש בחנות לא מופיע ב-picker | Apps Script → `refreshAllProductCatalogs` (SheetBuilder.gs) |
| שיוך מחדש של קמפיין למוצר | פתח את ה-Campaign drawer → "מוצרי Shopify משויכים" → "ערוך מיפוי" |
| Apps Script timeout פתאומי | בדוק ש-`spreadsheet.id` ב-Script Properties מצביע לגיליון הנכון (`printCurrentSpreadsheetId`) |
| ה-`spreadsheet.id` מצביע ל-phantom | `resetSpreadsheetIdToKnownGood` (Config.gs) — צריך לערוך את REAL_ID לפי הצורך |
| Backfill טווח תאריכים | `backfillRange('2026-01-01', '2026-01-31')` |
| backfill חנות אחת בלבד | `backfillRangeForStores(start, end, ['zolplus'])` |
| אימייל אזעקות לא מגיע | Script Properties → `notification.email` → הגדר ידנית |

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

- `bootstrapAllShopifyTokens` ידני, או
- מחדש את הטוקן ב-Shopify Admin ושים ב-Script Properties

### "Cannot find name 'XXX'" ב-Apps Script

- Apps Script לא תומך ב-ES modules; כל הפונקציות globals
- בדוק שהקובץ קיים בעורך ב-Apps Script (לפעמים `clasp push` מפספס)

### `Service Spreadsheets timed out`

- אוטומטי — `ensureSpreadsheet` מנסה 3 פעמים עם backoff
- אם נמשך → בדוק ב-https://www.google.com/appsstatus
- ⚠️ הקוד **לא יוצר phantom sheet עוד** — תקלת timeout פשוט מבטלת את הריצה

### Phantom spreadsheet (15tYa...)

- אם בעבר נוצר → מוצב ב-Script Property
- `printCurrentSpreadsheetId` יראה זאת
- `resetSpreadsheetIdToKnownGood` יתקן

### `Confidence chip` מציג "לא אמין" למרות שהמספרים דומים

- מתוקן ב-`d8f916a`. ה-rule של spend < 200 כבר לא מוריד אוטומטית — רק אם יש גם פער > 15%.

---

## 🔐 אבטחה

- **Service Account**: scope `spreadsheets.readonly` לרוב הקריאות + `spreadsheets` (write) רק ל-dashboard-state
- **Allowlist on POST**: `/api/dashboard-state` בודק `isAllowedStateKey(body.key)` כדי למנוע prototype pollution
- **Env vars**: `GOOGLE_PRIVATE_KEY` נשמר ב-Vercel Encrypted. רק bypass אם הפעם הראשונה ב-`pull`
- **Apps Script credentials**: רק ב-Script Properties, לא ב-source
- **Error sanitization**: `/api/dashboard-state` עוטף Sheets errors ב-`userFacingError()` כדי לא לדלוף Sheet ID / service account email
- **CloudSync error reporting**: שגיאות נחשפות ב-SyncIndicator עם הטקסט המסונן, לא הגלם

---

## 🚧 מגבלות ידועות

| איזור | מגבלה | סיבה |
|------|--------|------|
| Google PMax | אין mapping per-product | PMax מנהל הצגה לפי הפיד, לא לפי קמפיין |
| Attribution | proportional split כשמוצר משויך לכמה קמפיינים | אין real attribution data — חישוב מקורב |
| Confidence chip | heuristic, לא מבחן סטטיסטי | פער + הוצאה + sharing — לא MTA אמיתי |
| Last-write-wins | שני שותפים שעורכים אותה רשומה במקביל → השני מנצח | Acceptable עבור עריכות לא-תכופות |
| Historical campaigns paused | לא מופיעים בנתונים חדשים אחרי הפסקה | Meta API מחזיר רק ad-sets פעילים — היסטוריה נשמרת בגיליון |
| Catalog refresh weekly | מוצר חדש לא יופיע מיד | `refreshAllProductCatalogs` ידני, או חכה לטריגר השבועי |
| FX rate | יומי, לא inter-day | Frankfurter API מספק שערים יומיים בלבד |
| Per-order attribution | עדיין לא ממומש — רק campaign-level | utm/fbclid/gclid parsing מתוכנן אבל לא נבנה |

---

## 📞 קישורים שימושיים

- **Dashboard**: https://roas-dashboard-smoky.vercel.app
- **Spreadsheet**: בקש מהמפעיל את ה-ID (sensitive in Vercel env). אזכור היסטורי: `1f5tbc-8eMG60Go1ubTldWALc_kwnpaXD_33IsPDWrAk`
- **Apps Script**: `printCurrentSpreadsheetId` בעורך → תקבל את הקישור הישיר
- **Vercel project**: roas-dashboard

---

_עודכן בקומיט: `d8f916a` (מאי 2026). שינויים גדולים מאז גרסה קודמת: P&L tab משלו, BillingSettings, CloudSync cross-device, Campaign→Product mapping + Confidence chip, Meta↔Shopify reconciliation, Optimization marks, AdsDrawer (ad-level drilldown), Shopify catalog (full inventory), CBO/ABO budget display, Annotations, GoalTracker, SyncIndicator, auto-bootstrap on 401, phantom-spreadsheet protection._
