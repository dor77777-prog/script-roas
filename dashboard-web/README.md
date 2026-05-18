# ROAS Dashboard Web

דשבורד Next.js 15.5 + React 19 + TypeScript + Tailwind 3.4, פרוס ב-Vercel, מקושר ל-Google Sheets דרך service account read-only (+ write רק על טאב `dashboard-state`).

> ראה [SYSTEM_OVERVIEW.md](../SYSTEM_OVERVIEW.md) באקס לראש הרפו לתיעוד מערכת מלא.

---

## תכונות עיקריות

### 6 טאבים
- **בית** — HeroOverview (ROAS chart + annotations), Filters, AiReportButton, TodayLive, GoalTracker, InsightsBoard, AnnotationsPanel, KpiCards, PerStoreCards, WhatsWorking
- **P&L** — Hero strip תמיד גלוי + Waterfall פתוח כברירת מחדל (Revenue → -Ad Spend → -COGS → -Transaction Fees → -Fixed → True Net) + BillingSettings modal
- **ניתוח** — RoasChart trend + MonthlyTables (פר חנות + סיכום משולב)
- **קמפיינים** — CampaignsTable עם drill-down 3 רמות (Campaign → Ads)
- **מוצרים** — ProductsTable עם units + revenue
- **פירוט** — DetailTable (100 רשומות אחרונות)

### Drawer drill-down
- **CampaignDrawer** (1370 שורות): hero stats + daily chart + **Attribution Analysis Panel** (Bayesian CI + window stability + outlier days) + **Channel-level breakdown** (Phase 1 — מציג % הזמנות מפייסבוק עבור המוצרים המשויכים) + **Meta↔Shopify reconciliation** (Pearson r + lag detection) + mapped products + sortable ad-sets
- **AdsDrawer** (586 שורות): totals strip + sortable ads + per-ad attribution chip
- **ProductPickerModal** (368 שורות): search + multi-select של מוצרי החנות

### Attribution layer (`lib/attributionAnalysis.ts`)
- Click-id דטרמיניסטי: `analyzeAttribution` / `analyzeAttributionForAdSet` / `analyzeAttributionForAd` — matches utm_id={{campaign.id}} / utm_term={{adset.id}} / utm_content={{ad.id}}
- 4-level trust chip: high / medium / low / unknown
- Fallback למיפוי מוצרים heuristic כש-click-id חסר (suffix `·מיפוי`)
- **`analyzeProductChannel`** (Phase 1) — channel-level signal של המוצרים המשויכים: מחזיר `ProductChannelBreakdown` עם `totalOrders / totalRevenue / bySource / facebookShare`. Facebook predicate רחב (`meta-paid ∨ meta-organic ∨ fbclidPresent`). Pure source-grouping — לא משתמש ב-`buildAnalysis`. נצרך ע"י `CampaignDrawer` בלבד.
- Recommendations עם רקע: סיבות + פעולות מוצעות

### Cloud Sync (`lib/cloudSync.ts` — 413 שורות)
7 keys מסונכרנים בין מכשירים דרך `/api/dashboard-state`:
- billing-recurring, billing-onetime, annotations
- monthly-revenue-goal, insight-states
- campaign-optimized, campaign-product-map

Debounced 400ms, hydrate על mount + every 30s + on focus.

### KPI Cards, Filters, Multi-store views, Real-time updates

---

## הקמה - שלב אחר שלב

### 1. צור Service Account ב-Google Cloud

הדשבורד צריך גישה לקריאה לגיליון. הדרך הסטנדרטית: Service Account.

1. גש ל-**https://console.cloud.google.com**.
2. צור פרויקט חדש (או השתמש בקיים) - לדוגמה `roas-dashboard-sa`.
3. **APIs & Services → Library** → אפשר את **Google Sheets API**.
4. **APIs & Services → Credentials → + Create Credentials → Service account**.
5. שם: `roas-dashboard-reader`. **Create and continue**. **Done** (לא חובה לתת תפקידים).
6. בעמוד ה-Service Accounts לחץ על החשבון החדש → **Keys → Add Key → Create new key → JSON**.
7. הורד את הקובץ JSON. בתוכו תמצא `client_email` ו-`private_key`.

### 2. שתף את הגיליון עם ה-Service Account

1. פתח את הגיליון של הדשבורד (`ROAS Tracker - מעקב חנויות`).
2. כפתור **Share** בפינה ימין למעלה.
3. הוסף את ה-`client_email` של ה-Service Account (לדוגמה `roas-dashboard-reader@your-project.iam.gserviceaccount.com`).
4. הרשאה: **Editor** (לא Viewer! הדשבורד כותב לטאב `dashboard-state` בשביל cloud-sync). **Send**.

### 3. הקמת הפרויקט מקומית

```bash
cd dashboard-web
npm install
cp .env.local.example .env.local
```

ערוך את `.env.local`:

```bash
GOOGLE_CLIENT_EMAIL=roas-dashboard-reader@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n<מהקובץ JSON>\n-----END PRIVATE KEY-----\n"
SPREADSHEET_ID=<ה-ID של הגיליון>
```

> 💡 **טיפ**: בגרסת ה-JSON של ה-private key, השורות מופרדות ב-`\n` (literal backslash-n). השאר ככה - הקוד מטפל בהמרה.

הרץ את שרת הפיתוח:
```bash
npm run dev
```

פתח **http://localhost:3000**. הדשבורד יטען עם הנתונים מהגיליון.

---

## פריסה ל-Vercel

### 1. צור חשבון ב-Vercel

https://vercel.com/signup - חינמי, התחבר עם GitHub.

### 2. חבר את הריפו ל-Vercel

1. Vercel Dashboard → **Add New → Project**.
2. בחר את הריפו `script-roas` מ-GitHub.
3. **Root Directory**: לחץ **Edit** → בחר `dashboard-web`. (חשוב - כי Next.js יושב בתת-תיקייה)
4. **Framework Preset**: Next.js (יזוהה אוטומטית).
5. **Build & Output Settings**: השאר ברירת מחדל.

### 3. הוסף את משתני הסביבה ב-Vercel

לפני שלוחצים Deploy, הוסף את ה-Environment Variables:

| Key | Value |
|-----|-------|
| `GOOGLE_CLIENT_EMAIL` | מה-JSON של Service Account |
| `GOOGLE_PRIVATE_KEY` | מה-JSON של Service Account (כולל המעטפת `-----BEGIN PRIVATE KEY-----`) |
| `SPREADSHEET_ID` | ה-ID של הגיליון (מ-URL: `/d/{ID}/edit`) |

> ⚠️ ל-`GOOGLE_PRIVATE_KEY`: Vercel תופס מעברי שורות אוטומטית כשמדביקים. הקוד מטפל גם ב-`\n` ב-string וגם במעברי שורה אמיתיים.

### 4. Deploy

לחץ **Deploy**. ייקח ~30 שניות.

תקבל URL כמו `https://script-roas.vercel.app`. אם תרצה דומיין משלך (`dashboard.yourdomain.com`), הגדר ב-Vercel → Settings → Domains.

### 5. עדכונים אוטומטיים

כל push ל-branch `main` ב-GitHub יפרוס אוטומטית גרסה חדשה. בלי כפתורים, בלי הגדרות. בערך 30 שניות מ-push ועד שזה Live.

---

## מבנה הפרויקט

```
dashboard-web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── .env.local.example       (תבנית למשתני סביבה)
├── README.md                (קובץ זה)
└── src/
    ├── app/
    │   ├── layout.tsx       (root layout, RTL, Heebo font)
    │   ├── page.tsx         (טוען את הדשבורד)
    │   ├── globals.css
    │   └── api/
    │       ├── data/              GET — daily aggregated rows (data-daily)
    │       ├── campaigns/         GET — per-adset per-day × 3 stores
    │       ├── products/          GET — per-product per-day sales
    │       ├── ads/               GET — per-ad per-day (lazy)
    │       ├── orders-attribution/ GET — per-order classification (lazy)
    │       ├── product-catalog/   GET — full catalog × 3 stores
    │       ├── store-meta/        GET — plan + Meta/Google account IDs
    │       └── dashboard-state/   GET/POST — cloud-sync kv (allowlisted)
    │
    ├── components/         (31 קומפוננטות)
    │   ├── Dashboard.tsx          root + tab routing (545 lines)
    │   ├── Header / TabNav / Footer
    │   ├── CloudSync.tsx          (invisible — hydrate/push every 30s)
    │   ├── SyncIndicator.tsx
    │   ├── CommandPalette.tsx     Cmd-K navigator (626 lines)
    │   │
    │   ├── HomeTab components:
    │   ├── HeroOverview.tsx       (525) ROAS chart + annotations
    │   ├── Filters.tsx
    │   ├── AiReportButton.tsx     (240) prompt assembly + copy
    │   ├── TodayLive.tsx          (298) snapshot של היום הנוכחי
    │   ├── GoalTracker.tsx        (335) monthly goal + projection
    │   ├── InsightsBoard.tsx      (707) anomalies + recs + forecasts
    │   ├── AnnotationsPanel.tsx   (347) events CRUD
    │   ├── KpiCards.tsx           (327)
    │   ├── PerStoreCards.tsx
    │   ├── WhatsWorking.tsx       (292)
    │   │
    │   ├── PnLTab components:
    │   ├── PnLBreakdown.tsx       (442) hero strip + waterfall
    │   ├── BillingSettings.tsx    (1328) modal עם 3 טאבים + CSV
    │   ├── SectionIntro.tsx
    │   │
    │   ├── AnalysisTab components:
    │   ├── RoasChart.tsx
    │   ├── MonthlyTables.tsx      (349)
    │   │
    │   ├── CampaignsTab components:
    │   ├── CampaignsTable.tsx     (1722) ⭐ הקומפוננטה הגדולה
    │   ├── CampaignDrawer.tsx     (1310) drill-down + reconciliation
    │   ├── AdsDrawer.tsx          (586) ad-level drilldown
    │   ├── ProductPickerModal.tsx (368)
    │   │
    │   ├── ProductsTab components:
    │   ├── ProductsTable.tsx      (884)
    │   │
    │   ├── DetailTab components:
    │   ├── DetailTable.tsx
    │   │
    │   ├── Shared atoms:
    │   ├── CollapsibleSection.tsx
    │   ├── MetricHelp.tsx
    │   ├── RollingNumber.tsx
    │   └── Sparkline.tsx
    │
    └── lib/                (24 modules)
        ├── types.ts                  shared TypeScript types
        ├── sheets.ts            (470) Google Sheets client + allowlist
        │
        ├── Data parsers:
        ├── analytics.ts              aggregate / dailySeries / deltaPct
        ├── campaigns.ts              parse {store}-campaigns
        ├── ads.ts                    parse {store}-ads
        ├── products.ts               parse products-daily
        ├── ordersAttribution.ts      parse {store}-orders-attribution ⭐ NEW
        ├── productCatalog.ts         parse {store}-products-catalog
        │
        ├── Attribution layer:
        ├── attributionAnalysis.ts     Bayesian CI + window stability +
        │                              outlier detection, 4 entry points:
        │                              analyzeAttribution / *ForAdSet /
        │                              *ForAd + analyzeProductChannel
        │                              (Phase 1 — channel-level)
        ├── campaignProductMap.ts     mapping + allocateProductRevenue
        ├── campaignOptimized.ts      optimization marks (Set + toggle)
        ├── campaignsLinks.ts         buildAdsManagerLink
        │
        ├── Cloud sync + state:
        ├── cloudSync.ts          (413) STATE_KEYS, hydrate, push
        ├── insights.ts           (671) InsightsBoard logic + goal
        ├── annotations.ts            annotation CRUD
        ├── billing.ts            (561) recurring + onetime + CSV
        ├── aiReport.ts           (564) prompt assembly
        │
        ├── Utilities:
        ├── drawerStack.ts            Esc handler for nested drawers
        ├── urlState.ts               URL ↔ tab+filters serialization
        ├── presets.ts                date range presets
        ├── constants.ts              FROZEN_USD_TO_CAD
        ├── costs.ts                  TRANSACTION_FEES_RATE
        ├── format.ts                 additional formatters
        └── utils.ts                  formatters (currency, number, date)
```

---

## תחזוקה שוטפת

**הוספת חנות חדשה?** עדכן `STORES` ב-`Config.gs` (Apps Script), הוסף Script Properties, והרץ `setupAll`. הדשבורד יציג את החנות החדשה אוטומטית בלי שינוי קוד.

**שינוי סף ROAS?** ערוך `src/lib/analytics.ts` → פונקציה `roasLabel`.

**שינוי פלטת צבעים?** `tailwind.config.ts` או הקבועים `STORE_COLORS` בקומפוננטות.

**הרענון איטי מדי?** SWR `revalidateOnFocus` + per-route `dedupingInterval` ב-`Dashboard.tsx`. Cache headers ב-API routes (`Cache-Control: s-maxage=...`).

---

## פתרון תקלות

| תופעה | סיבה |
|--------|------|
| "שגיאה בטעינת הנתונים" + "Missing GOOGLE_..." | משתני סביבה לא מוגדרים. ב-Vercel: Settings → Environment Variables. מקומית: `.env.local`. |
| "403 The caller does not have permission" | לא שיתפת את הגיליון עם ה-Service Account email, או שיתפת כ-Viewer במקום Editor. ראה שלב 2. |
| "Range not found" | טאב חסר בגיליון. הרץ `setupAll` ב-Apps Script כדי לייצר אותו. |
| הנתונים לא מתעדכנים | בדוק שה-trigger היומי של Apps Script רץ (אמור לרוץ ב-00:05). הרץ ידנית `runDailyUpdate`. |
| Trust chip מראה `·מיפוי` | URL Parameters ב-Meta Ads Manager לא מוגדרים — ודא ש-`utm_id={{campaign.id}}` ו-utm_term/utm_content מופיעים שם. |
| SyncIndicator אדום | אדמין של הגיליון לא נתן Editor ל-Service Account, או ה-state tab לא נוצר. |

---

## מערכת היחסים עם Apps Script

- **Apps Script** = הצד הכותב. שואב נתונים מ-Shopify / Meta / Google Ads ורושם לגיליון.
- **Next.js Dashboard** = הצד הקורא. קורא מ-`data-daily`, `{store}-campaigns`, `{store}-ads`, `{store}-orders-attribution`, וכו'.
- ה-cloud-sync state יוצא דופן: הדשבורד **כותב** ל-`dashboard-state` (לא Apps Script).
- שני הצדדים עצמאיים. אם תרצה לשנות את הדשבורד, אין צורך לגעת ב-Apps Script. שינויים ב-Apps Script — לא דורשים deploy של הדשבורד.
