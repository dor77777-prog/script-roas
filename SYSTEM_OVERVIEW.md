# ROAS Tracker — אפיון מערכת מלא

מסמך מקיף שמתעד את המערכת שנבנתה: ארכיטקטורה, רכיבים, זרימת נתונים, פיצ'רים, ותפעול שוטף. מעודכן לתאריך **מאי 2026**.

---

## 📌 תוכן עניינים

1. [תמונה גדולה](#-תמונה-גדולה)
2. [רכיבי המערכת](#-רכיבי-המערכת)
3. [זרימת נתונים](#-זרימת-נתונים)
4. [פיצ'רים עיקריים](#-פיצרים-עיקריים)
5. [מבנה הגיליון](#-מבנה-הגיליון)
6. [מבנה הדשבורד](#-מבנה-הדשבורד)
7. [טכנולוגיות](#-טכנולוגיות)
8. [פירוט קבצים](#-פירוט-קבצים)
9. [תפעול שוטף](#-תפעול-שוטף)
10. [פתרון תקלות](#-פתרון-תקלות)
11. [אבטחה](#-אבטחה)
12. [אפשרויות שיפור](#-אפשרויות-שיפור)

---

## 🎯 תמונה גדולה

המערכת עוקבת אחרי ROAS (Return on Ad Spend) של 3 חנויות Shopify ב-3 רמות:

```
┌───────────────────────────────────────────────────────────────────┐
│ 🌐 שכבת תצוגה (Next.js on Vercel)                                  │
│   - https://roas-dashboard-smoky.vercel.app                        │
│   - TodayLive + KPI cards + Per-store + Chart + Products + Tables │
│   - סקציות מתקפלות עם state ב-localStorage                          │
│   - רענון אוטומטי כל 60 שניות                                       │
│   ↑                                                                 │
│   קריאות REST                                                       │
└───────────────────────────────────────────────────────────────────┘
                              ↑
┌───────────────────────────────────────────────────────────────────┐
│ 📊 שכבת נתונים (Google Sheets)                                     │
│   - data-daily (flat, LTR) - מקור אמת לדשבורד                       │
│   - products-daily - מוצרים שנמכרו לפי יום                          │
│   - manual-spend - override ידני להוצאות (חשבונות מושבתים וכו')     │
│   - sheets פר-חנות + סיכום (legacy)                                 │
│   ↑                                                                 │
│   נכתב מ-Apps Script                                                │
└───────────────────────────────────────────────────────────────────┘
                              ↑
┌───────────────────────────────────────────────────────────────────┐
│ 🔧 שכבת איסוף (Google Apps Script)                                 │
│   - Daily trigger: 00:05 IT  → סוגר את אתמול                       │
│   - Live trigger: כל 15 דק׳  → מרענן את היום                       │
│   - שולף Shopify (revenue + מוצרים) + Meta + Google Ads             │
│   - בודק manual-spend לפני קריאה ל-API                              │
│   - ממיר ILS/USD/EUR → CAD לפי שער יומי                             │
│   - מחשב COGS = 25% × revenue                                       │
│   ↑                                                                 │
│   מתחבר ל-APIs                                                      │
└───────────────────────────────────────────────────────────────────┘
                              ↑
   APIs:  Shopify Admin · Meta Graph · Google Ads · Frankfurter (FX)
```

**3 חנויות במעקב:**
- **uzoshop** (uzo-d-s-2.myshopify.com) — Meta + Google Ads
- **Zol Plus** (2x1gqx-y0.myshopify.com) — Meta בלבד
- **360usmile** (360usmile.myshopify.com) — Meta בלבד

**מטבעות:**
- Shopify revenue: כל החנויות ב-CAD ישירות.
- Meta spend: ברירת מחדל ILS (uzoshop ישן היה ILS, החדש CAD; Zol/360 ב-ILS).
- Google Ads spend: CAD.
- שער המרה: Frankfurter (ECB), נקרא פעם ביום ומוצג בדשבורד.

---

## 🧩 רכיבי המערכת

### 1. Apps Script — שכבת איסוף

קבצי `.gs` ב-`/` שורש הריפו. מותקנים בפרויקט Apps Script מקוון.

**אחריות:**
- שליפה יומית/חיה של revenue, ad spend, ו-line items של מוצרים
- ניהול 3 חנויות עם חשבונות שונים בעסקים שונים
- override ידני להוצאות (כשחשבון מודעות הושבת)
- המרת מטבעות
- חישוב COGS פלאט (25% של revenue)
- כתיבה מסונכרנת לטאבים השונים
- אכיפת idempotency (הרצה חוזרת ↔ כתיבה מחדש בלי כפילויות)
- retry על כשלי רשת/5xx/429

**שתי הפעלות אוטומטיות:**
- `runDailyUpdate` ב-00:05 IT — סוגר את אתמול עם כל הנתונים
- `runLiveUpdate` כל 15 דקות — מרענן את היום הנוכחי

### 2. Google Sheets — שכבת נתונים

גיליון אחד עם 6 סוגי טאבים. רוב הטאבים מוסתרים — המשתמש רואה רק את הטאבים החודשיים והסיכום.

### 3. Web Dashboard — שכבת תצוגה

Next.js 15 + React 19 + Tailwind 3.4. פרוס ב-Vercel. RTL עברית, מובייל-first.

**URL פרודקשן:** https://roas-dashboard-smoky.vercel.app

---

## 🔄 זרימת נתונים

### יום רגיל (אוטומטי)

```
00:05 IT  Apps Script trigger מופעל
          └─ runDailyUpdate() → runUpdateForDate(yesterday)

00:05+    לכל אחת מ-3 החנויות:
          ├─ getShopifyRevenue          ← Shopify Admin API
          ├─ override-check ב-manual-spend (Meta)
          ├─ override-check ב-manual-spend (Google, אם יש)
          ├─ getMetaSpend                ← Meta Graph (אם אין override)
          ├─ getGoogleAdsSpend           ← Google Ads (אם הוא רלוונטי + אין override)
          ├─ updateCampaignDataForStoreDate_ → ad-set/ad-group breakdown
          └─ getShopifyProductSalesForDay → רשימת מוצרים שנמכרו

00:06     המרת מטבעות + חישוב COGS
          ├─ getFxRate(ILS, CAD, dateStr) ← Frankfurter (cached)
          ├─ metaCad = meta.spend × fx
          ├─ cogsCad = revenueCad × 0.25
          └─ writeDailyFlatRow_ → data-daily
              writeProductSalesForDay_ → products-daily
              writeCampaignRowsForDay → {storeId}-campaigns
              writeDayRow → טאב פר-חנות
```

### Live update (כל 15 דקות)

```
xx:00, xx:15, xx:30, xx:45  Live trigger
                            └─ runLiveUpdate() → runUpdateForDate(today)
                            (אותה לוגיקה כמו daily, אבל על "היום")
```

### צפייה בדשבורד

```
משתמש פותח https://roas-dashboard-smoky.vercel.app

→ React app נטען
→ SWR מבקש GET /api/data + GET /api/products במקביל
→ Next.js API routes:
   ├─ /api/data: קורא data-daily!A:K + Frankfurter rate → JSON
   └─ /api/products: קורא products-daily!A:G → JSON
→ SWR cache 60s server-side + 60s client-side polling
→ Dashboard מציג סקציות מתקפלות (state ב-localStorage)
```

---

## ✨ פיצ'רים עיקריים

### 1. Live Today snapshot
ל-uzoshop וכל החנויות, מציג ROAS / הכנסות / הוצאות של היום עד לרגע זה. מתעדכן כל 15 דק' מצד Apps Script + כל 60 שנ' מצד הלקוח.

### 2. COGS — 25% מההכנסה
`COGS_RATE_OF_REVENUE = 0.25` ב-Config.gs וב-analytics.ts. רווח נטו = Revenue − AdSpend − COGS. **לא משפיע על ROAS** (שמוגדר Revenue/AdSpend בלבד).

### 3. Products breakdown
טאב `products-daily` עם שורה לכל (date, store, product). הדשבורד מציג רשימה עם איגום ליום / שבוע / חודש / חצי-שנה / שנה, מסונן לפי טווח התאריכים והחנות הגלובליים.

### 4. Manual overrides ל-ad spend
טאב `manual-spend` עם דרופ-דאון לחנות/פלטפורמה/מטבע. כל ריצה (יומית/לייב/backfill) בודקת את הטאב לפני קריאה ל-API. שימושי כשחשבון פרסום הושבת.

הוספה מהירה דרך helper:
```javascript
bulkAddManualOverrides('uzoshop', 'Meta', 'CAD', [
  ['2026-04-01', 2575],
  ...
]);
```

או הקפאת ערכים קיימים מ-data-daily:
```javascript
freezeCurrentSpendAsOverride('uzoshop', 'Meta', '2026-05-01', '2026-05-08');
```

### 5. Backfill historical
`backfillRange(start, end)` או `backfillRangeForStores(start, end, ['storeId'])`. כל יום נכתב מחדש באופן idempotent. מומלץ לחתוך לטווחים של ≤12 ימים בגלל מגבלת 6 דק' ב-Apps Script.

### 6. Zero-revenue flag
ROAS cells בטבלאות חודשיות וטבלת פירוט מוצגים עם רקע שחור + טקסט לבן + "0" כשrevenue=0 וspend>0 (יום שהוצאת בו כסף אך לא היו מכירות) — להפרדה ויזואלית בין "אין נתונים" ל-"כשל ROAS אמיתי".

### 7. Collapsible UI
כל סקציה גדולה בדשבורד מתקפלת (פתחו רק את מה שצריכים). מצב פתוח/סגור נשמר ב-`localStorage` בכל דפדפן.

---

## 📋 מבנה הגיליון

| טאב | סוג | תוכן | מוסתר? |
|------|------|------|--------|
| `סיכום` | unified | סיכום יומי משולב לכל החנויות (VLOOKUP) | לא |
| `uzoshop` | per-store | טבלה חודשית: FB + GA + Revenue + ROAS | לא |
| `Zol Plus` | per-store | טבלה חודשית | לא |
| `360usmile` | per-store | טבלה חודשית | לא |
| `data-daily` ⚙️ | flat (EN, LTR) | שורה לכל (יום, חנות) — מקור הדשבורד | כן |
| `products-daily` ⚙️ | flat | שורה לכל (יום, חנות, מוצר) | כן |
| `manual-spend` | flat | override ידני להוצאות פרסום | לא (לעריכה) |
| `uzoshop-campaigns` ⚙️ | flat | ad-set breakdown יומי | כן |
| `zolplus-campaigns` ⚙️ | flat | ad-set breakdown יומי | כן |
| `usmile360-campaigns` ⚙️ | flat | ad-set breakdown יומי | כן |

⚙️ = מוסתר כברירת מחדל. אפשר לחשוף דרך תפריט **ROAS → "הצג טאבים עזריים"**.

### Schema של `data-daily`
| עמ' | שדה | מקור |
|----|------|------|
| A | Date | פעם אחת לכל יום |
| B | Store ID | uzoshop / zolplus / usmile360 |
| C | Store | שם תצוגה |
| D | FB Spend (CAD) | Meta API או override |
| E | GA Spend (CAD) | Google Ads API או override |
| F | Total Spend (CAD) | D + E |
| G | Revenue (CAD) | Shopify |
| H | ROAS | נוסחה: =G/F |
| I | Gross Profit (CAD) | =G - F |
| J | COGS (CAD) | =G × 0.25 |
| K | Net Profit (CAD) | =G - F - J |

### Schema של `products-daily`
| עמ' | שדה |
|----|------|
| A | Date |
| B | Store ID |
| C | Store |
| D | Product ID |
| E | Product Title |
| F | Units |
| G | Gross Revenue (CAD) |

### Schema של `manual-spend`
| עמ' | שדה | dropdown |
|----|------|---------|
| A | Date (YYYY-MM-DD) | — |
| B | Store ID | uzoshop / zolplus / usmile360 |
| C | Platform | Meta / Google |
| D | Spend | מספר |
| E | Currency | ILS / CAD / USD / EUR |
| F | Notes | טקסט חופשי |

---

## 🖥️ מבנה הדשבורד

### היררכיה ויזואלית (מלמעלה למטה)

| # | רכיב | תמיד פתוח? | תיאור |
|---|------|------------|-------|
| 1 | **Header** | תמיד | סטיקי, גרדיינט כחול, כפתור רענון |
| 2 | **TodayLive** | תמיד | פס ירוק עם נתוני היום + שער ILS→CAD |
| 3 | **Filters** | תמיד | טווח מהיר (אתמול/מתחילת החודש) + חנות; טווחים נוספים מתקפלים |
| 4 | **KPI Cards** | תמיד | 6 כרטיסים: ROAS, הכנסות, הוצאות, רווח גולמי, COGS, רווח נטו |
| 5 | **ביצועים לפי חנות** | פתוח | כרטיסים פר-חנות עם trophy/warning badges |
| 6 | **מגמת ROAS** | פתוח | גרף קו (Recharts) |
| 7 | **מוצרים שנמכרו** | מקופל | toolbar עם יומי/שבועי/חודשי/חצי/שנתי; הצג עוד/פחות |
| 8 | **טבלאות חודשיות** | מקופל | per-store / summary, ROAS צבוע |
| 9 | **פירוט יומי** | מקופל | 100 שורות אחרונות |
| 10 | **Footer** | תמיד | זמן עדכון אחרון |

### צבעי ROAS

| תחום | תווית | רקע |
|------|-------|-----|
| ROAS = 0 + spend > 0 | "0" | שחור, טקסט לבן |
| 0 < ROAS < 2 | "דורש בחינה" | אדום בהיר |
| 2 ≤ ROAS < 2.7 | "סביר" | כתום בהיר |
| 2.7 ≤ ROAS ≤ 3 | "טוב" | ירוק בהיר |
| ROAS > 3 | "מעולה" | כחול בהיר |
| ללא נתונים | — | אפור / ריק |

---

## 🛠️ טכנולוגיות

### Backend (Apps Script)

| טכנולוגיה | תפקיד |
|-----------|-------|
| Google Apps Script (V8) | סביבת ריצה לטריגרים |
| Shopify Admin REST API 2024-10 | הזמנות + line items |
| Meta Marketing API v20.0 | ad spend ברמת חשבון + ad-set |
| Google Ads API v20 (REST) | ad spend ברמת חשבון + ad-group |
| Frankfurter (ECB) | המרת מטבעות |
| OAuth 2.0 Refresh Tokens | Google Ads access tokens |
| Shopify Client Credentials Grant | Shopify Admin tokens אוטומטיים |
| Meta System User Tokens | טוקנים שלא פגים |

### Frontend (Next.js)

| טכנולוגיה | גרסה | תפקיד |
|-----------|------|-------|
| Next.js | 15.5+ | App Router, SSR, API routes |
| React | 19 | UI |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 3.4 | Styling |
| Recharts | 2.15 | LineChart |
| SWR | 2.3 | Data fetching + revalidation |
| googleapis | 144 | Service Account → Sheets API |
| lucide-react | 0.469 | אייקונים |

### תשתית

| שירות | תפקיד | עלות |
|--------|--------|------|
| Google Apps Script | טריגרים יומיים + לייב | חינמי |
| Google Sheets | אחסון נתונים | חינמי |
| Google Cloud Service Account | אימות Sheets API | חינמי |
| Vercel | host של Next.js | חינמי (Hobby) |
| GitHub | git repo + auto-deploy | חינמי |
| **סה"כ** | | **0$/חודש** |

---

## 📁 פירוט קבצים

### Apps Script (`/`)

| קובץ | תפקיד |
|------|-------|
| `appsscript.json` | manifest |
| `Config.gs` | קבועים, רשימת חנויות, helpers (parseYMD, fetchWithRetry, verifyConfig, COGS_RATE) |
| `FX.gs` | Frankfurter client + cache |
| `Shopify.gs` | Shopify Admin client + bootstrapShopifyToken + getShopifyProductSalesForDay |
| `MetaAds.gs` | Meta API: getMetaSpend, getMetaAdSetInsights |
| `GoogleAds.gs` | Google Ads API + OAuth refresh |
| `SheetBuilder.gs` | בניית טאבים, חודשי בלוקים, ROAS color rules, daily-flat, products-daily |
| `DailyUpdate.gs` | runDailyUpdate, runLiveUpdate, backfillRange, debugTodaySpend |
| `ManualOverrides.gs` | manual-spend tab, bulkAddManualOverrides, freezeCurrentSpendAsOverride |
| `Main.gs` | setupAll, install*Trigger, onOpen menu |

### Web Dashboard (`/dashboard-web`)

```
dashboard-web/src/
├── app/
│   ├── layout.tsx          ← RTL Hebrew root layout
│   ├── page.tsx            ← דף הבית
│   ├── globals.css
│   └── api/
│       ├── data/route.ts   ← GET /api/data (data-daily + FX rate)
│       └── products/route.ts ← GET /api/products (products-daily)
├── components/
│   ├── Dashboard.tsx           ← Main: SWR, state, layout, collapsible sections
│   ├── CollapsibleSection.tsx  ← reusable disclosure primitive (state in localStorage)
│   ├── TodayLive.tsx           ← live today snapshot + FX rate + Meta/Google split
│   ├── Filters.tsx             ← preset + store + advanced toggle
│   ├── KpiCards.tsx            ← 6 KPI cards
│   ├── PerStoreCards.tsx       ← per-store cards with trophy/warning badges
│   ├── RoasChart.tsx           ← line chart (bare mode supported)
│   ├── MonthlyTables.tsx       ← monthly per-store / summary (bare mode)
│   ├── DetailTable.tsx         ← last 100 daily rows (bare mode)
│   └── ProductsTable.tsx       ← products with day/week/month/year rollup
└── lib/
    ├── types.ts            ← DailyRow, DashboardData, Filters, PresetKey
    ├── sheets.ts           ← data-daily reader
    ├── products.ts         ← products-daily reader
    ├── presets.ts          ← preset → date range
    ├── analytics.ts        ← aggregate, filterRows, dailySeries, roasLabel, COGS_RATE
    └── utils.ts            ← cn, formatCurrency, formatDate, formatPct
```

### תיעוד

| קובץ | תוכן |
|------|------|
| `README.md` | סקירה ראשית של Apps Script |
| `SETUP.md` | מדריך הקמה מאפס |
| `dashboard-web/README.md` | מדריך פריסה של הדשבורד |
| `COGS_SETUP.md` | הסבר על כלל ה-25% |
| `SYSTEM_OVERVIEW.md` | המסמך הזה |
| `WELCOME.md` | תקציר ידידותי למשתמש קצה |

---

## 🔁 תפעול שוטף

### יומי (אוטומטי — אין מה לעשות)
- 00:05 IT: Daily trigger רץ ומעדכן אתמול
- כל 15 דק׳: Live trigger מרענן את היום
- Vercel ידפלוי דשבורד אוטומטית בכל `git push` ל-main

### תפעול ידני (לפי הצורך)

**מעורך Apps Script:**
- `runDailyUpdate` — עדכן אתמול עכשיו
- `runLiveUpdate` — עדכן את היום עכשיו
- `runUpdateForDate('2026-05-15')` — יום ספציפי
- `backfillRange('2026-05-01', '2026-05-15')` — טווח (עד ~12 ימים בריצה)
- `backfillRangeForStores('2026-05-01', '2026-05-15', ['uzoshop'])` — חנות אחת
- `debugTodaySpend` — לוג של ערכי ה-API הגולמיים להיום
- `verifyConfig` — בודק ש-Script Properties תקינים
- `bulkAddManualOverrides(storeId, platform, currency, entries, notes)` — הוסף override-ים
- `freezeCurrentSpendAsOverride(storeId, platform, start, end)` — קפיא ערכים קיימים מ-data-daily

**מתפריט הגיליון (תפריט ROAS):**
- הרץ עדכון ליום אתמול / לתאריך / טווח
- התקן/הסר טריגר Daily ו-Live
- פתח טאב Override ידני
- הצג/הסתר טאבים עזריים
- verifyConfig

**מהדשבורד:**
- כפתור "רענן" למעלה — refetch מיידי
- סקציות מתקפלות — לחץ על כותרת להרחיב/לסגור
- פילטר ניטרלי: "כל החנויות" / "אתמול" / "מתחילת החודש"

---

## 🆘 פתרון תקלות

### Apps Script

| תופעה | סיבה | פתרון |
|--------|------|-------|
| `Missing required property: X` | Script Property חסר | Project Settings → Script Properties |
| `Meta failed (190)` | טוקן פג | חדש System User token ב-Business Settings |
| `Shopify failed (401)` | טוקן לא תקף | הרץ `bootstrapAllShopifyTokens` |
| `Google Ads PERMISSION_DENIED` | חשבון לא ב-MCC | בדוק MCC + Developer Token |
| `Exceeded maximum execution time` | יותר מ-6 דק׳ | פצל backfill ל-12 ימים בכל ריצה |
| `Meta uzoshop: no data` | חשבון מודעות הושבת | השתמש ב-manual-spend לתאריך זה |
| Live trigger לא רץ | טריגר לא הותקן | הרץ `installLiveTrigger` ידנית |

### Web Dashboard

| תופעה | סיבה | פתרון |
|--------|------|-------|
| "Missing GOOGLE_..." | env vars לא מוגדרים | Vercel → Settings → Environment Variables |
| "403 caller does not have permission" | Service Account לא קיבל גישה | Sheet → Share → הוסף את ה-`client_email` |
| הדשבורד מציג 0 לכל הערכים | data-daily ריק | הרץ `setupAll` או `backfillRange` |
| תאריכים כמספרים | בעיית פורמט | הרץ `repairAllFormulas` ב-Apps Script |
| מוצרים ריקים | products-daily ריק | הרץ `runLiveUpdate` או `backfillRange` |
| Build נכשל ב-Vercel | TS error | `npm run build` מקומית קודם |

---

## 🔒 אבטחה

### מפתחות רגישים
| סוג | איפה נשמר |
|-----|-----------|
| Shopify Admin tokens (`shpat_*`) | Apps Script Properties |
| Meta System User tokens | Apps Script Properties |
| Google Ads OAuth refresh tokens | Apps Script Properties |
| Service Account private key | Vercel Environment Variables |

### Best practices
- אין מפתחות hardcoded בקוד
- `.env.local` ב-.gitignore
- Service Account עם הרשאת spreadsheets.readonly בלבד
- אם דלף מפתח: גלגול דרך הפלטפורמה הרלוונטית + עדכון Properties/env vars

---

## 🚀 אפשרויות שיפור

### Tier 1 — שעות בודדות
1. **התראות במייל ל-ROAS נמוך** — `MailApp.sendEmail` אם daily ROAS < 1.5
2. **השוואה Year-over-Year** — KPI נוסף: ROAS החודש מול אותו חודש שנה קודם
3. **Export ל-CSV** — כפתור בדשבורד שמוריד את הנתונים המסוננים
4. **Dark mode** — Tailwind תומך native

### Tier 2 — יום-יומיים
5. **Campaign-level UI בדשבורד** — הנתונים כבר ב-{storeId}-campaigns
6. **ניתוח לפי יום בשבוע** — גרף עמודות "ROAS לפי יום"
7. **Budget tracking** — תקציב חודשי + alert על חריגה
8. **PWA manifest** — installable כאפליקציית מובייל

### Tier 3 — שבוע+
9. **BigQuery** — אם תרצה היסטוריה ארוכה / מקורות נוספים
10. **חנויות/פלטפורמות נוספות** — TikTok/Snap/Pinterest
11. **רב-משתמש עם הרשאות** — NextAuth.js + תפקידים
12. **A/B testing + attribution** — UTM + conversion events

---

## 📊 KPIs שווה לעקוב

**Tier 1 (קיים):** ROAS, Revenue, Spend, COGS, Net Profit, Top product
**Tier 2 (שווה להוסיף):** AOV, refund rate, CTR, CPC, day-of-week ROAS
**Tier 3 (מתקדם):** CAC, LTV, audience breakdowns, diminishing returns curve

---

## 🎬 סיכום מהיר

**מה בנינו:**
- 🤖 Apps Script שאוסף יומי + 24/7 חי
- 📊 Google Sheets כ-source-of-truth
- 🌐 דשבורד Next.js רספונסיבי
- 🛡️ Override system לחשבונות מושבתים
- 📦 מוצרים שנמכרו עם 5 רמות איגום

**כמה זה עולה:** 0$/חודש (הכל בטיר חינמי)

**איפה הדשבורד:** https://roas-dashboard-smoky.vercel.app

המערכת בנויה כך שאתה לא תלוי בשום מפתח חיצוני. גם אם לא תרצה להשקיע יותר זמן, היא תעבוד שנים קדימה. אם תרצה להרחיב — הארכיטקטורה תומכת.

---

*עודכן: מאי 2026  •  Claude (Anthropic) + GitHub + Apps Script + Next.js + Vercel*
