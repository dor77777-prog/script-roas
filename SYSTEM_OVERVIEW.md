# ROAS Tracker — סקירת מערכת מלאה

מסמך מקיף שמתעד את המערכת שנבנתה: מבנה, טכנולוגיות, זרימת נתונים, תפעול שוטף, ואפשרויות שיפור.

---

## 📌 תוכן עניינים

1. [תמונה גדולה](#-תמונה-גדולה)
2. [רכיבי המערכת](#-רכיבי-המערכת)
3. [זרימת נתונים מלאה](#-זרימת-נתונים-מלאה)
4. [טכנולוגיות](#-טכנולוגיות)
5. [פירוט קבצים](#-פירוט-קבצים)
6. [תפעול שוטף](#-תפעול-שוטף)
7. [פתרון תקלות נפוצות](#-פתרון-תקלות-נפוצות)
8. [אבטחה](#-אבטחה)
9. [אפשרויות שיפור](#-אפשרויות-שיפור)

---

## 🎯 תמונה גדולה

המערכת עוקבת אחרי ROAS (Return on Ad Spend) יומי של 3 חנויות Shopify, ומציגה את הנתונים ב-3 שכבות:

```
┌────────────────────────────────────────────────────────────────┐
│ 🌐 שכבת תצוגה (Web Dashboard - Next.js on Vercel)             │
│   - KPIs, גרפים, טבלאות חודשיות                                 │
│   - בורר תאריכים + חנות                                          │
│   - רענון אוטומטי כל דקה                                         │
│   ↑                                                              │
│   קורא דרך REST API                                              │
└────────────────────────────────────────────────────────────────┘
                              ↑
┌────────────────────────────────────────────────────────────────┐
│ 📊 שכבת נתונים (Google Sheets)                                  │
│   - data-daily (flat) - מקור האמת הדיגיטלי                       │
│   - טאבי חנות + סיכום (legacy/backup, ניתן להסיר)              │
│   ↑                                                              │
│   נכתב מ-Apps Script                                              │
└────────────────────────────────────────────────────────────────┘
                              ↑
┌────────────────────────────────────────────────────────────────┐
│ 🔧 שכבת איסוף (Google Apps Script)                              │
│   - טריגר יומי ב-00:05 שעון ישראל                                │
│   - שולף מ-Shopify (הכנסות) + Meta Ads + Google Ads (הוצאות)   │
│   - ממיר ILS→CAD לפי שער יומי                                    │
│   - כותב ל-Sheet                                                  │
│   ↑                                                              │
│   מתחבר ל-APIs                                                    │
└────────────────────────────────────────────────────────────────┘
                              ↑
        APIs חיצוניים:  Shopify  •  Meta Graph  •  Google Ads  •  Frankfurter (FX)
```

**3 חנויות במעקב:**
- **uzoshop** (uzo-d-s-2.myshopify.com) — Facebook + Google Ads
- **Zol Plus** (2x1gqx-y0.myshopify.com) — Facebook בלבד
- **360usmile** (360usmile.myshopify.com) — Facebook בלבד

הוצאות הפרסום בפועל בשקלים (ILS), הכנסות Shopify בדולר קנדי (CAD). כל המספרים מומרים ל-CAD לפני הצגה.

---

## 🧩 רכיבי המערכת

### 1. Apps Script (`/` שורש הריפו) — שכבת איסוף

קוד Google Apps Script שמותקן בפרויקט Apps Script מקוון. מתחבר ל-Google Sheets API ול-APIs חיצוניים.

**אחריות:**
- ניהול 3 חנויות עם חשבונות שונים בעסקים שונים
- שליפת נתוני הזמנות יומיים מ-Shopify (Admin API + Client Credentials Grant)
- שליפת הוצאות פייסבוק יומיות מ-Meta Marketing API
- שליפת הוצאות גוגל יומיות מ-Google Ads API (uzoshop בלבד)
- שליפת ad-set/ad-group breakdown לכל יום
- המרת מטבעות ILS→CAD דרך Frankfurter API
- כתיבת הכל לטאבי הגיליון
- אכיפת idempotency (הרצה חוזרת לא יוצרת כפילויות)
- retry אוטומטי על כשלי רשת

**הפעלה:**
- טריגר יומי ב-00:05 שעון ישראל
- הרצה ידנית מהתפריט בגיליון לכל יום/טווח

### 2. Google Sheets — שכבת נתונים

גיליון אחד עם הטאבים הבאים:

| טאב | סוג | תוכן |
|------|------|------|
| `סיכום` | unified | סיכום יומי משולב לכל החנויות, מבוסס נוסחאות VLOOKUP |
| `uzoshop` | split | טבלה חודשית: FB + GA + רב + ROAS |
| `Zol Plus` | unified | טבלה חודשית: יצא + נכנס + ROAS |
| `360usmile` | unified | טבלה חודשית: יצא + נכנס + ROAS |
| `data-daily` ⚙️ | flat (LTR, EN headers) | שורה אחת ל-(יום × חנות), מקור לדשבורד ה-web |
| `uzoshop-campaigns` ⚙️ | flat | רזולוציית ad-set יומית עבור uzoshop |
| `zolplus-campaigns` ⚙️ | flat | רזולוציית ad-set יומית עבור zolplus |
| `usmile360-campaigns` ⚙️ | flat | רזולוציית ad-set יומית עבור usmile360 |

⚙️ = טאבים מוסתרים כברירת מחדל (אפשר לחשוף עם `showAuxiliaryTabs`).

### 3. Web Dashboard (`/dashboard-web`) — שכבת תצוגה

Next.js app שפרוס ב-Vercel. קורא מ-Google Sheets API ומציג בדפדפן.

**URL פרודקשן:** https://roas-dashboard-smoky.vercel.app

**מה הוא מציג:**
- KPI Cards (ROAS, הכנסות, הוצאות, רווח גולמי) עם השוואה לתקופה קודמת
- כרטיסיות פר-חנות עם ROAS וסטטוס מילולי
- גרף ROAS לאורך זמן (קו לכל חנות)
- תובנות אוטומטיות (חנות מובילה, חנות בסיכון, יום חזק)
- טבלאות חודשיות פר-חנות (כמו בגיליון, עם צביעת ROAS)
- טבלת סיכום חודשי משולבת
- טבלת פירוט יומי (100 שורות אחרונות)

**מאפיינים:**
- ממשק עברית RTL מלא
- בורר תקופה (השבוע / החודש / חודש קודם / 30 ימים / מותאם)
- בורר חנות
- רענון אוטומטי כל דקה
- מהירה מאוד (cached server-side, SWR client-side)

---

## 🔄 זרימת נתונים מלאה

### יום רגיל (אוטומטי, 00:05 שעון ישראל)

```
00:05  Apps Script trigger מופעל
       └─ runDailyUpdate() → runUpdateForDate(yesterday)

00:05  לכל אחת מ-3 החנויות:
       ├─ getShopifyRevenue(storeId, yesterday)
       │   └─ Shopify Admin API: GET /admin/api/2024-10/orders.json
       │
       ├─ getMetaSpend(storeId, yesterday)
       │   └─ Meta Graph API: GET /act_X/insights?level=account
       │
       ├─ (uzoshop בלבד) getGoogleAdsSpend(storeId, yesterday)
       │   └─ Google Ads API: POST /customers/X/googleAds:search
       │
       └─ updateCampaignDataForStoreDate_(storeId, yesterday)
           ├─ getMetaAdSetInsights — שולף ad-set breakdown (רק פעילים)
           └─ getGoogleAdsAdGroupInsights — uzoshop בלבד

00:06  המרת מטבעות:
       └─ getFxRate('ILS', 'CAD', yesterday) ← Frankfurter API

00:06  כתיבה לגיליון:
       ├─ writeDayRow(storeTab, ...) ← טבלה חודשית פר-חנות
       ├─ writeDailyFlatRow_ ← שורה ב-data-daily (לדשבורד web)
       └─ writeCampaignRowsForDay ← {storeId}-campaigns

00:07  הטאב 'סיכום' מתעדכן אוטומטית דרך נוסחאות VLOOKUP
```

### צפייה בדשבורד (ידני, כל פעם)

```
משתמש פותח https://roas-dashboard-smoky.vercel.app

→ React app נטען
→ SWR מבקש GET /api/data
→ Next.js API route:
   ├─ Google Sheets API: GET data-daily!A:I  (UNFORMATTED_VALUE)
   ├─ פירסור התשובה ל-DailyRow[]
   └─ החזרה כ-JSON עם Cache-Control 60s
→ Dashboard component מצירף KPIs, גרפים, טבלאות
→ SWR poll-ים אוטומטי כל 60 שניות
```

---

## 🛠️ טכנולוגיות

### Backend (Apps Script)

| טכנולוגיה | תפקיד |
|-----------|-------|
| Google Apps Script (V8 runtime) | סביבת ריצה |
| Shopify Admin REST API 2024-10 | קריאת הזמנות |
| Meta Marketing API v20.0 | קריאת ההוצאה פייסבוק |
| Google Ads API v20 (REST) | קריאת ההוצאה גוגל |
| Frankfurter (api.frankfurter.dev) | המרת מטבעות ECB-based |
| Google Sheets API | כתיבה לגיליון |
| OAuth 2.0 Refresh Tokens (Google Ads) | התחדשות אוטומטית של גישה |
| Shopify Client Credentials Grant | השגת access tokens אוטומטית |
| Meta System User Tokens | טוקנים שלא פגים |

### Frontend (Next.js Web)

| טכנולוגיה | גרסה | תפקיד |
|-----------|------|-------|
| Next.js | 15.5+ | App Router, SSR, API routes |
| React | 19 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 3.4 | Styling utility-first |
| Recharts | 2.15 | גרפי קו |
| SWR | 2.3 | Data fetching + revalidation |
| googleapis | 144 | Service Account → Sheets API |
| date-fns | 4 | טיפול בתאריכים |
| lucide-react | 0.469 | אייקונים |

### תשתית (Infrastructure)

| שירות | תפקיד | עלות |
|--------|--------|------|
| Google Apps Script | סביבת ריצה לטריגרים יומיים | חינמי |
| Google Sheets | אחסון נתונים | חינמי |
| Google Cloud (Service Account) | אימות לקריאת Sheet מ-Vercel | חינמי |
| Vercel | פריסת Next.js web | חינמי (Hobby tier) |
| GitHub | git repo | חינמי |

**סה"כ עלות שוטפת: 0$/חודש** — כל השירותים בטיר חינמי.

---

## 📁 פירוט קבצים

### Apps Script (`/`)

| קובץ | תפקיד |
|------|-------|
| `appsscript.json` | מניפסט - הרשאות, timezone, V8 runtime |
| `Config.gs` | קבועים, רשימת חנויות, עזרי Script Properties, parseYMD_, fetchWithRetry_, verifyConfig |
| `FX.gs` | שערי חליפין דרך Frankfurter, עם cache |
| `Shopify.gs` | Shopify Admin API client + bootstrapShopifyToken (Client Credentials Grant) |
| `MetaAds.gs` | Meta Marketing API: getMetaSpend, getMetaAdSetInsights |
| `GoogleAds.gs` | Google Ads API: getGoogleAdsSpend, getGoogleAdsAdGroupInsights + OAuth refresh |
| `SheetBuilder.gs` | בניית טאבים, חודשי בלוקים, צביעת ROAS, repair/verify/reset helpers |
| `DailyUpdate.gs` | תזמור: runDailyUpdate, backfillRange, backfillRangeForStores |
| `Main.gs` | נקודות כניסה: setupAll, installDailyTrigger, onOpen menu |

### Web Dashboard (`/dashboard-web`)

```
dashboard-web/
├── package.json              ← תלויות
├── tsconfig.json             ← TypeScript config
├── next.config.ts            ← Next.js config
├── tailwind.config.ts        ← Tailwind + צבעים
├── postcss.config.mjs
├── .env.local.example        ← תבנית למשתני סביבה
├── .gitignore
├── README.md                 ← מדריך הקמה
└── src/
    ├── app/
    │   ├── layout.tsx        ← Root layout (RTL Hebrew)
    │   ├── page.tsx          ← דף הבית
    │   ├── globals.css       ← סגנונות גלובליים
    │   └── api/data/
    │       └── route.ts      ← REST API: GET /api/data
    ├── components/
    │   ├── Dashboard.tsx     ← Main component (SWR, state, layout)
    │   ├── Filters.tsx       ← בורר תקופה + חנות
    │   ├── KpiCards.tsx      ← 4 KPI cards עם delta
    │   ├── PerStoreCards.tsx ← 3 כרטיסיות פר-חנות
    │   ├── RoasChart.tsx     ← גרף קו (Recharts)
    │   ├── InsightsPanel.tsx ← תובנות אוטומטיות
    │   ├── MonthlyTables.tsx ← טבלאות חודשיות פר-חנות + סיכום
    │   └── DetailTable.tsx   ← טבלת פירוט יומי
    └── lib/
        ├── types.ts          ← TypeScript types
        ├── sheets.ts         ← Google Sheets client (Service Account)
        ├── presets.ts        ← לוגיקה של בוררי תקופה
        ├── analytics.ts      ← aggregate, filterRows, dailySeries, roasLabel
        └── utils.ts          ← cn, formatCurrency, formatDate, formatPct
```

### תיעוד

| קובץ | תוכן |
|------|------|
| `README.md` | סקירה ראשית של ה-Apps Script |
| `SETUP.md` | מדריך הקמה צעד-אחר-צעד של Apps Script (Shopify, Meta, Google Ads) |
| `dashboard-web/README.md` | מדריך הקמה ופריסה של ה-web |
| `SYSTEM_OVERVIEW.md` | המסמך הזה |

---

## 🔁 תפעול שוטף

### יומי (אוטומטי - אין מה לעשות)

- 00:05 שעון ישראל — Apps Script trigger רץ ומעדכן את הגיליון
- 00:05+~30s — הדשבורד באינטרנט מציג את הנתונים החדשים (cache refresh)

### תפעול ידני (לפי הצורך)

**Apps Script (בעורך https://script.google.com):**
- `runDailyUpdate` — עדכן אתמול עכשיו
- `runUpdateForDate('2026-05-15')` — עדכן יום ספציפי
- `backfillRange('2026-05-01', '2026-05-15')` — מילוי טווח
- `verifyConfig` — בדוק שכל Script Properties מוגדרים
- `hideAuxiliaryTabs` / `showAuxiliaryTabs` — שליטה בטאבים העזריים

**Web Dashboard:**
- כפתור **רענן** למעלה בדשבורד — מאלץ refetch
- אוטומטי: refetch כל דקה ובחזרה למסך

**פריסת קוד חדש:**
- Apps Script: עדכן ידנית את הקבצים ב-editor
- Web: `git push` ל-`main` → Vercel deploy אוטומטי

---

## 🆘 פתרון תקלות נפוצות

### Apps Script

| תופעה | סיבה | פתרון |
|--------|------|-------|
| `Missing required property: X` | Script Property חסר | הגדר ב-Project Settings → Script Properties |
| `Meta failed (190)` | Token פג / חסר הרשאה | חדש System User token ב-Business Settings |
| `Shopify failed (401)` | Token לא תקף | הרץ `bootstrapAllShopifyTokens` |
| `Google Ads PERMISSION_DENIED` | חשבון לא מקושר ל-MCC / Developer Token לא מאושר | בדוק MCC + API Center |
| `Address unavailable` | כשל רשת זמני | retry אוטומטי (עד 4 ניסיונות) |
| `Exceeded maximum execution time` | יותר מ-6 דקות | פצל backfill לטווחים קטנים |

### Web Dashboard

| תופעה | סיבה | פתרון |
|--------|------|-------|
| "Missing GOOGLE_..." | משתני סביבה לא מוגדרים | Vercel → Settings → Environment Variables |
| "403 The caller does not have permission" | Service Account לא קיבל גישה לגיליון | Sheet → Share → הוסף את ה-`client_email` |
| הדשבורד מציג 0 לכל הערכים | טאב `data-daily` ריק | הרץ `setupAll` או `backfillFlatFromStoreTabs` ב-Apps Script |
| תאריכים מוצגים כמספרים | נתון בעמודה A הוא string ולא Date | הרץ `backfillFlatFromStoreTabs` ב-Apps Script לרענון |
| Build נכשל ב-Vercel | TypeScript error | בדוק build מקומית ב-`npm run build` לפני push |

---

## 🔒 אבטחה

### מה רגיש

- **Shopify Admin API tokens** (`shpat_*`) — הרשאת קריאה להזמנות
- **Meta System User tokens** — קריאת ad spend
- **Google Ads OAuth tokens** (Refresh + Client Secret) — קריאת ad spend
- **Service Account private key** — קריאה לגיליון

### איפה נשמר

| מיקום | תוכן | אבטחה |
|--------|------|--------|
| Apps Script Properties | כל ה-tokens של Shopify/Meta/Google Ads | מוצפן בשרתי Google, נגיש רק לאוזר שיש לו גישה לפרויקט |
| Vercel Environment Variables | Service Account credentials + Spreadsheet ID | מוצפן בשרתי Vercel, נגיש לקוד בלבד |
| `.env.local` (פיתוח מקומי) | אותם משתנים | קובץ ב-.gitignore, לא נכנס ל-Git |

### מה לעשות אם מפתח דלף

- Shopify token → Custom App → Revoke and regenerate
- Meta token → Business Settings → System Users → Generate new token
- Google Ads refresh token → OAuth Playground → קבל token חדש
- Service Account key → Cloud Console → Keys → Delete old + Create new

---

## 🚀 אפשרויות שיפור

### שיפורים מהירים (שעות בודדות)

1. **התראות במייל ל-ROAS נמוך**
   - הוסף ל-Apps Script: אם ROAS יומי < 1.5, שלח מייל
   - קל למימוש דרך `MailApp.sendEmail`

2. **דשבורד היסטוריה ארוכה**
   - הוסף לדשבורד web: גרפים חודשיים-שנתיים
   - QUERY ב-data-daily שמסכם לפי חודש

3. **השוואה Year-over-Year**
   - KPI נוסף: ROAS החודש מול ROAS אותו חודש לפני שנה
   - הצגה בגרף

4. **Export ל-CSV/Excel**
   - הוסף כפתור בדשבורד web שמוריד את הנתונים המסוננים

5. **Dark mode**
   - Tailwind תומך טיב-טיב, רק להוסיף theme provider

### שיפורים בינוניים (יום-יומיים)

6. **רמת קמפיין/אד-סט בדשבורד**
   - הנתונים כבר נאספים בטאבי `*-campaigns`
   - הוסף component בדשבורד web שמציג top campaigns, decay, וכו'
   - דורש API route נוסף ועוד דף

7. **ניתוח לפי יום בשבוע**
   - שאלה: באיזה יום ROAS הכי טוב?
   - חישוב פשוט מהנתונים הקיימים
   - גרף עמודות בדשבורד

8. **Real-time webhooks מ-Shopify**
   - כל הזמנה ב-Shopify → webhook → כתיבה מיידית לגיליון
   - דורש endpoint נוסף ב-Next.js (אפשרי)
   - הופך את "real-time" מ"כל יום ב-00:05" ל"תוך שניות"

9. **Mobile app**
   - PWA — הדשבורד הקיים עובד טוב במובייל, הוסף manifest
   - או React Native אם רוצים native feel

10. **Budgets ו-anomaly detection**
    - הגדר תקציב חודשי לכל חנות
    - התראה אם spend עובר Y% מהממוצע
    - גרף תקציב נשרף לאורך החודש

### שיפורים גדולים (שבוע+)

11. **מעבר ל-BigQuery במקום Sheets**
    - Sheets מחזיק ~5M תאים, מספיק לכמה שנים
    - אם תרצה היסטוריה ארוכה (~10 שנים) + פלטפורמות נוספות → BigQuery
    - Apps Script יודע לכתוב ל-BigQuery (אבל לרוב עדיף Cloud Function)
    - Looker Studio / Next.js יכולים לקרוא מ-BQ ישירות

12. **הוספת חנויות ופלטפורמות**
    - 4-5+ חנויות: שינוי קטן ב-`STORES` ב-Config.gs
    - פלטפורמה חדשה (TikTok, Snap, Pinterest, Twitter): קובץ חדש דמוי `MetaAds.gs`
    - שדות חדשים (cost per click, ROAS by audience): חדשים בטבלת `data-daily`

13. **רב-משתמש עם הרשאות**
    - אם תרצה לשתף את הדשבורד עם צוות, מעצבים, סוכנות
    - הוסף NextAuth.js + ניהול תפקידים
    - חשבונות יוכלו לראות חלק מהחנויות בלבד

14. **ChatGPT/Claude integration**
    - "שאל שאלה על הנתונים" → AI מסביר/ממליץ
    - דורש OpenAI/Anthropic API
    - אפשר לקפוץ ישר ל-Code Interpreter סטייל

15. **A/B testing ו-attribution**
    - אם תרצה לקבל החלטות יותר חזקות
    - דורש more granular tracking (UTM, conversion events)
    - גישה אנליטית רחבה יותר

### שיפורי תפעול

16. **גיבוי אוטומטי של נתונים**
    - שמירת snapshot של data-daily כל שבוע ב-Drive
    - מגן מפני מחיקה בטעות

17. **Monitoring/Alerting**
    - אם הטריגר היומי לא רץ → התראה
    - אם API קורס מספר ימים ברצף → התראה
    - אפשר ב-Uptime Robot חינמי על endpoint של Vercel

18. **Documentation מעודכן**
    - הסקירה הזאת + README.md + SETUP.md
    - תחזק אחרי כל שינוי משמעותי

---

## 📊 מטריקות שווה לעקוב אחריהן

לפי החשיבות (לפי דעתי) — מה ששווה לראות בדשבורד:

**Tier 1 - חיוניות (קיים):**
- ROAS יומי לכל חנות
- ROAS משוקלל לתקופה
- הכנסות נטו (revenue - spend)
- מגמה לאורך זמן

**Tier 2 - שווה להוסיף בקרוב:**
- ROAS לפי קמפיין/אד-סט (יש נתונים, חסר UI)
- AOV (ערך הזמנה ממוצע) — דורש order count
- שיעור החזרות — דורש refund tracking
- CTR (click-through-rate) — נתונים בטאב campaigns

**Tier 3 - מתקדם:**
- CAC (Customer Acquisition Cost) — דורש לקוחות חדשים מ-Shopify
- LTV (Lifetime Value) — דורש 90+ יום היסטוריה
- ROAS by audience/placement (Meta breakdowns)
- Diminishing returns curve — מתי תוספת תקציב מפסיקה לשלם

---

## ⚙️ מבנה הריפו (קוד מקור)

הריפו ב-GitHub: **https://github.com/dor77777-prog/script-roas**

```
script-roas/
├── README.md                    ← נקודת כניסה ראשית
├── SETUP.md                     ← הקמה מאפס (Apps Script + APIs)
├── SYSTEM_OVERVIEW.md           ← המסמך הזה
├── .gitignore
│
├── appsscript.json              ← Apps Script manifest
├── Config.gs                    ← קבועים + helpers
├── FX.gs                        ← שערי חליפין
├── Shopify.gs                   ← Shopify integration
├── MetaAds.gs                   ← Meta Ads integration
├── GoogleAds.gs                 ← Google Ads integration
├── SheetBuilder.gs              ← בניית sheets
├── DailyUpdate.gs               ← daily run logic
├── Main.gs                      ← entry points + menu
│
└── dashboard-web/               ← Next.js project
    ├── README.md                ← מדריך פריסה
    ├── package.json
    ├── src/
    │   ├── app/
    │   ├── components/
    │   └── lib/
    └── ...
```

---

## 🎬 סיכום מהיר

**מה בנינו:**
- 🤖 שכבת אוטומציה (Apps Script) שמעדכנת נתונים יומיים
- 📊 שכבת אחסון (Google Sheets) עם schema מסודר
- 🌐 שכבת תצוגה (Next.js + Vercel) עם UX איכותי

**כמה זה עלה:**
- 0$/חודש (כל השירותים חינמיים)

**כמה זמן השקעת:**
- הקמה ראשונה: ~10 שעות (Apps Script + APIs)
- בניית Web Dashboard: ~יום
- סה"כ: שבועיים של עבודה רכה כדי לחסוך שעות מדי שבוע

**מה אתה מקבל:**
- ROAS אמיתי, מדויק, ב-real-time
- חיסכון של ~30 דקות ביום של איסוף ידני
- בסיס לתוספות ולשיפורים בעתיד

**איפה הדשבורד שלך:**
- 🔗 **https://roas-dashboard-smoky.vercel.app**

המערכת בנויה כך שאתה לא תלוי בשום מפתח חיצוני. גם אם לא תרצה להשקיע יותר זמן, היא תעבוד שנים קדימה. אם תרצה להרחיב — הארכיטקטורה תומכת.

---

*נוצר: מאי 2026  •  כלי: Claude (Anthropic) + GitHub + Apps Script + Next.js + Vercel*
