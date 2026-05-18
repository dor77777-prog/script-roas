# Codebase Concerns

**Analysis Date:** 2026-05-18

המסמך הזה מתעד סיכונים, חוב טכני ופערים שהמערכת תרוויח מתיקונם. נכון לסוף Round 5
(commit `6d9df13`) — אחרי 5 סבבי `/gsd-code-review` ו-60+ commits של תיקונים.
חלק מהנקודות הן fragile-by-design (Apps Script 6-min cap), חלק מתחילות להופיע ככל
שהמערכת גדלה (products-daily ללא rotation), וחלק נכנסו מתי שהוחלפה אסטרטגיה
באמצע הדרך (CampaignsTable שגדל ל-1722 שורות תוך כדי הוספת trust-chip + attribution).

---

## Tech Debt

### Apps Script 6-min Execution Limit

- **Issue:** כל `runUpdateForDate` חייב להסתיים תוך 6 דקות. כיום 3 חנויות ≈ 4–5 דקות
  עם sleep של 1.5s בין חנויות + 500ms בין כתיבות (`DailyUpdate.gs:42, 122, 142, 151`).
  ה-backfill הידני נדרש להתחלק לחתיכות (`backfillRangeForStores` + `backfillZolUsmileMay1to14`
  ב-`DailyUpdate.gs:423`).
- **Files:** `DailyUpdate.gs:22-72`, `DailyUpdate.gs:351-425`.
- **Impact:** כאשר תיווסף חנות רביעית או כשנפח ההזמנות יגדל (orders-attribution כותב
  שורה לכל הזמנה — היום אחד עם 200+ הזמנות לחנות = 600+ כתיבות + chunked formatting),
  ה-`runDailyUpdate` היומי יתחיל לגעת ב-cap. הסימן הראשון יהיה ש-store 3 יתחיל
  להיכשל ב-timeout, בדיוק התסמין ש-Round 4 כבר טיפל בו אחת.
- **Fix approach:** לפצל את ה-trigger ל-3 פונקציות נפרדות (one-per-store) שכל אחת
  מקבלת trigger יומי משלה ב-00:05 / 00:10 / 00:15. כל אחת מקבלת 6 דקות נפרדות,
  אין בעיית quota cascade ביניהן, ו-`refreshAllStoreMeta` יוקפץ ל-trigger רביעי.

### אין test suite

- **Issue:** ה-codebase כולו ללא יחידת בדיקות. אין Jest / Vitest מותקן (ב-`dashboard-web/package.json`
  אין dependencies של testing), אין `*.test.*` או `*.spec.*` קבצים בכל הפרויקט.
- **Files:** מודולים קריטיים ללא כיסוי: `dashboard-web/src/lib/attributionAnalysis.ts`
  (878 שורות, Bayesian CI, window stability, outlier detection),
  `dashboard-web/src/lib/analytics.ts`, `dashboard-web/src/lib/campaignProductMap.ts`,
  `dashboard-web/src/lib/ordersAttribution.ts`, `Shopify.gs::classifyOrderAttribution_`,
  `SheetBuilder.gs::writeOrdersAttributionForDay`.
- **Impact:** כל refactor שעובר על מודולי analytics הוא ריצה בעיניים עצומות. הבאגים
  שהתגלו ב-Round 5 (CR5-01 fall-through ב-`orderMatchesCampaign`, CR5-02 `decodeURIComponent`
  ללא try/catch, WR5-04 degenerate-CI כשsoldim AOV זהה) — כולם היו נתפסים בטריוויאליות
  ע"י unit-tests מינימליות.
- **Fix approach:** להוסיף Vitest + לכתוב 30–50 בדיקות שכבת ה-pure-functions
  ב-`attributionAnalysis.ts` (analyzeAttribution / detectOutlierDays / computeWindowStability),
  `analytics.ts` (aggregations), `campaignProductMap.ts`, `ordersAttribution.ts::parseSource`.
  לא צריך e2e — מספיק בודקים deterministic על data fixtures.

### COGS rate מ-duplicated בשני מקומות

- **Issue:** `COGS_RATE_OF_REVENUE = 0.25` מוגדר ב-2 מקומות:
  - `Config.gs:20` (Apps Script side — נכתב ל-`data-daily` עם COGS כבר מחושב)
  - `dashboard-web/src/lib/analytics.ts:11` (dashboard side — fallback לתאריכים שטרם
    נכתבו ל-`data-daily`)
- **Files:** `Config.gs:20`, `dashboard-web/src/lib/analytics.ts:11`.
- **Impact:** עדכון בצד אחד בלי השני יצור פער בין נתונים היסטוריים (נכתבו ב-rate
  אחד) לנתונים החיים (מחושבים ב-rate אחר). כבר יש הערה ב-`Config.gs:18` שמזכירה
  לעדכן את שני המקומות, אבל זה דורש משמעת אנושית.
- **Fix approach:** למשוך את ה-COGS rate ל-Script Property
  (`getProp('cogs.rateOfRevenue', 0.25)` ב-Apps Script + ב-API `/api/cogs-config`
  בצד הדשבורד שמחזיר את אותו ערך). מקור אמת אחד.

### Reconciliation panel משתמש ב-campaign-active days

- **Issue:** ה-`MetaShopifyReconciliation` ב-`CampaignDrawer` מצמצם את חלון
  ההשוואה לימים שבהם היה Meta-spend > 0 (תוקן ב-`8de9d32`: channel breakdown
  עכשיו משתמש בטווח המלא של המשתמש, אבל ה-reconciliation עדיין מסתמך על
  active-only).
- **Files:** `dashboard-web/src/components/CampaignDrawer.tsx`.
- **Impact:** ימים שבהם הקמפיין הופסק (paused) אבל היו מכירות (organic / retargeting
  של ad-set אחר באותו קמפיין?) לא נראים ב-reconciliation, מה שגורם לפער הכאילו
  "חסרות מכירות". מסיט את ה-Pearson r ו-lag detection.
- **Fix approach:** להוסיף toggle ב-UI ("הצג רק ימים פעילים" vs "הצג את כל הטווח")
  או להפריד את שני המתודות לשתי קופסאות נפרדות (each labeled clearly).

### Product ID precision — `setNumberFormat('@')` רק על שורות חדשות

- **Issue:** ב-commit `8de9d32` נוסף `setNumberFormat('@')` בעמודות productId
  ב-`products-daily` ו-`orders-attribution` כדי למנוע איבוד דיוק ב-IDs ארוכים
  (`1234567890123` שהפך ל-`1.23456789012e12`). אבל זה מטפל רק בכתיבות חדשות —
  שורות היסטוריות שכבר אבדו את הדיוק לא בודקות בחזרה.
- **Files:** `SheetBuilder.gs::writeProductSalesForDay_`, `SheetBuilder.gs::writeOrdersAttributionForDay`,
  `dashboard-web/src/lib/products.ts`, `dashboard-web/src/lib/ordersAttribution.ts`.
- **Impact:** מוצרים ישנים שהוקלדו לפני המיגרציה — productId שלהם מאוחסן ב-Sheets
  כ-scientific notation. הדשבורד מפרסר אותם כ-`Number`, ולכן ה-lookup ב-product-map
  נכשל (לא מוצא התאמה). הסיכון: trueRevenue allocation מתעלם מהמוצרים האלה ברצף
  שקט.
- **Fix approach:** סקריפט חד-פעמי שעובר על שני הטאבים, ממיר כל cell בעמודת
  productId חזרה ל-string (`String(value).replace(/\..*$/,'')` אם זה כן number)
  + `setNumberFormat('@')` על כל הטווח. הרצה אחת ידנית מהעורך.

### Cloud-sync last-write-wins

- **Issue:** 7 keys (`billing` / `annotations` / `goal` / `insight-states` /
  `campaign-optimized` / `product-map` / `billing-onetime`) מסונכרנים ב-cloud דרך
  `/api/dashboard-state` POST. כל POST דורס את הערך הקיים. אין vector-clock /
  CRDT / Last-Modified check.
- **Files:** `dashboard-web/src/lib/cloudSync.ts`, `dashboard-web/src/app/api/dashboard-state/route.ts:59-84`.
- **Impact:** אם 2 שותפים עורכים את `billing` באותה דקה, הכתיבה השנייה דורסת את
  הראשונה. בקצב עריכה הנמוך של היום (פעם ביום, בדרך כלל by one operator) הסיכון
  קטן, אבל אין לוג מי כתב מה.
- **Fix approach:** קצר טווח — להוסיף `updatedAt` per-key (כבר קיים ב-`updatedAtByKey`)
  ו-`If-Match` header על ה-POST. ארוך טווח — לעבור למודל merge-by-shape (לדוגמה,
  annotations הוא Array של אובייקטים יחודיים-by-id → אפשר למזג).

### Phantom-spreadsheet protection חד-פעמית

- **Issue:** ה-`ensureSpreadsheet` ב-`Main.gs` מטפל ב-timeout transient דרך retry
  + לעולם לא יוצר spreadsheet חדש כשמקבל "not found" אחרי timeout. ההגנה
  שילובית: `resetSpreadsheetIdToKnownGood` (`Config.gs:249-278`) +
  `printCurrentSpreadsheetId` (`Config.gs:285-295`) מאפשרים reset ידני אם
  ה-property בכל זאת התקלקל.
- **Files:** `Config.gs:249-295`, `Main.gs::ensureSpreadsheet`.
- **Impact:** אם `spreadsheet.id` Script Property מוחלף ידנית למזהה שגוי (operator
  טועה בעת deployment חדש), ה-Apps Script יקרא וייכתב לגיליון אחר מהדשבורד —
  data fork שקט. אין alert שתופס את ההבדל בין `SPREADSHEET_ID` ב-Vercel לבין
  `spreadsheet.id` ב-Apps Script.
- **Fix approach:** להוסיף assertion יומי שמשווה את שני המזהים (אם ה-Apps Script
  יודע איך לזהות את ה-Vercel side) או — פשוט יותר — לפרסם את `spreadsheet.id`
  בלוג היומי + להוסיף הערה ב-tab `store-meta` שמראה שטיפן ה-id מה-Apps Script.

---

## Anti-Patterns / Smells

### קומפוננטות ענק (>1000 שורות) שמקשות על תחזוקה

- **Issue:** שלושת הקבצים הגדולים בדשבורד:
  - `dashboard-web/src/components/CampaignsTable.tsx` — **1732 שורות**
  - `dashboard-web/src/components/CampaignDrawer.tsx` — **1440 שורות**
  - `dashboard-web/src/components/BillingSettings.tsx` — **1328 שורות**
- **Files:** ראה למעלה.
- **Impact:** ה-IDE איטי בקבצים כאלה, refactor שגיאות-prone (כל edit עלול לשבור
  משהו ברחוק), code review מסורבל. במיוחד `CampaignsTable.tsx` שבו `useMemo` ענקיים
  של חישוב per-campaign true-revenue/attribution קופצים בין `Map<string, number>`,
  `Map<string, AttributionAnalysis>`, ו-`trueRevenueByKey` בשורות 600–700.
- **Fix approach:**
  - `CampaignsTable` → לפצל ל-`CampaignsTable` (טבלה ראשית) + `useCampaignTrueRevenue`
    (hook) + `useCampaignAttribution` (hook) + `CampaignRow` (sub-component).
    יעד: כל קובץ ≤500 שורות.
  - `CampaignDrawer` → לפצל ל-`CampaignDrawer` + `AdSetTable` + `AttributionPanel`
    + `MetaShopifyReconciliation` (כבר קיים partially).
  - `BillingSettings` → לפצל ל-`BillingSettings` (UI) + `useBillingPartners` (hook)
    + `useBillingOneTime` (hook).

### מחרוזות עברית מקודדות בקוד

- **Issue:** מחרוזות UI בעברית פזורות ישירות ב-JSX לאורך כל הקומפוננטות
  (`PerStoreCards.tsx:100` עם `"ROAS נמוך — דורש בחינה"`,
  `CommandPalette.tsx:146` עם `"מעבר ל-קמפיינים"`, וכו'). אין שכבת i18n.
- **Files:** כל ה-`dashboard-web/src/components/*.tsx`.
- **Impact:** הוספת שפה שניה (אנגלית / ערבית) דורשת refactor מסיבי. שינוי
  ניסוח של מחרוזת מצריך grep + multiple edits — אין מקור אמת אחד.
- **Fix approach:** להוציא ל-`dashboard-web/src/lib/strings.he.ts` עם
  type-safe key map. ראשון: לעבור עם codemod שמחליף כל string literal עברי
  ב-`s.tabCampaigns` (וכו') ולשלוח את המפתחות לקובץ אחד.

### Apps Script Upload ידני

- **Issue:** כל שינוי ב-`*.gs` דורש פתיחה ידנית של עורך Apps Script + paste של
  הקובץ. אין `clasp` או deployment דרך CI/CD. גם אין pre-commit hook שמוודא שה-`.gs`
  המקומי תואם ל-deployed.
- **Files:** כל ה-`*.gs` ב-root הפרויקט.
- **Impact:** סיכון להעלות גרסה חלקית (חצי קובץ מקומי, חצי בעורך), קושי
  לעקוב מתי בדיוק שינוי הגיע ל-production. תיעוד ב-`SYSTEM_OVERVIEW.md` מסתמך
  על "commit hash" אבל אין הגרנטיה שה-deploy תואם.
- **Fix approach:** להגדיר `clasp` עם `.clasprc.json` (לא ב-git), להוסיף
  `clasp push` ל-`package.json` כ-`deploy:gs`. שלב הבא — GitHub Action שעושה
  `clasp push` ב-push ל-`main` (דורש `CLASPRC_JSON` כ-GH Secret).

### Cache TTLs hardcoded per-route

- **Issue:** כל route ב-`/api/*` מגדיר את ה-`revalidate` וה-`Cache-Control`
  בנפרד עם מספר sayım (60 / 300 / 3600 / 10). אין מקור אמת אחד.
- **Files:** `dashboard-web/src/app/api/data/route.ts:7,35`,
  `dashboard-web/src/app/api/campaigns/route.ts:4,20`,
  `dashboard-web/src/app/api/products/route.ts:4,20`,
  `dashboard-web/src/app/api/ads/route.ts:4,18`,
  `dashboard-web/src/app/api/orders-attribution/route.ts:6,24`,
  `dashboard-web/src/app/api/store-meta/route.ts:8,30`,
  `dashboard-web/src/app/api/product-catalog/route.ts:8,25`,
  `dashboard-web/src/app/api/dashboard-state/route.ts:46`.
- **Impact:** שינוי policy ("נחזק את כל הקריאות ל-30s במקום 60s") דורש 8 edits.
  סבירות גבוהה להחמיץ כתובת אחת ולקבל פערים.
- **Fix approach:** `dashboard-web/src/lib/cacheConfig.ts` עם:
  ```ts
  export const CACHE_CONFIG = {
    data: { revalidate: 60, swr: 120 },
    campaigns: { revalidate: 60, swr: 120 },
    ads: { revalidate: 300, swr: 900 },
    ordersAttribution: { revalidate: 300, swr: 900 },
    storeMeta: { revalidate: 3600, swr: 86400 },
    dashboardState: { revalidate: 10, swr: 60 },
    productCatalog: { revalidate: 60, swr: 300 },
    products: { revalidate: 60, swr: 120 },
  } as const;
  ```
  + helper `cacheControl(key)` שמחזיר `'public, s-maxage=X, stale-while-revalidate=Y'`.

### `analyzeAttribution` נקרא inside `.map(...)` ב-render

- **Issue:** ב-`CampaignDrawer.tsx:1011-1024` וב-`AdsDrawer.tsx:378-390`,
  `analyzeAttributionForAdSet`/`analyzeAttributionForAd` נקראים inside IIFE per
  row בכל render. ב-CampaignsTable זה מקופל ב-`useMemo` אבל ב-drawers לא.
- **Files:** ראה למעלה (תועד ב-REVIEW-5.md IN5-01).
- **Impact:** Drawer עם 20 ad-sets + orders-attribution של ~2000 שורות → 20×O(N)
  filter ב-כל render, גם כשמשנים sort בלבד. אין כרגע user complaint אבל זה
  סוללה לבעיה performance ככל שהנתונים גדלים.
- **Fix approach:** לבנות `Map<adSetId, AttributionAnalysis>` ב-`useMemo` אחד
  ולחפש per row — בדיוק כמו `trueRevenueByKey` ב-CampaignsTable.

### `decodeURIComponent` ללא try/catch (already-known)

- **Issue:** תוקן ב-Round 5 (`Shopify.gs::safeDecode_`), אבל ה-pattern של
  "decode user-supplied string" עדיין מופיע במקומות אחרים — `dashboard-web/src/lib/ordersAttribution.ts`
  על `utm_source/utm_medium/utm_campaign` שמגיעים מ-Sheets כ-strings שכבר עברו
  decode פעם אחת.
- **Files:** `Shopify.gs:601-610` (תוקן), אבל יש שאריות ב-API routes שלא נסרקו.
- **Impact:** אם משתמש מוסיף landing URL ידנית ב-manual-spend tab עם `%E0`,
  הסיכון חוזר.
- **Fix approach:** ליצור `safeDecode` ב-`dashboard-web/src/lib/utils.ts` כ-utility
  משותף, ולהחליף כל קריאת `decodeURIComponent` בה.

---

## Security Gaps + Recommendations

### Service-account scope רחב מהצורך

- **Issue:** ה-service-account
  (`roas-dashboard-reader@roas-tracker-ga.iam.gserviceaccount.com`) משתמש
  ב-`spreadsheets.readonly` לקריאות + `spreadsheets` (write) לכתיבת
  `dashboard-state`. ה-write scope נותן הרשאה לכתוב על כל הגיליון, כולל data-daily
  / campaigns / orders-attribution.
- **Files:** `dashboard-web/src/lib/sheets.ts:24-27`.
- **Impact:** אם המפתח של ה-service-account דולף, התוקף יכול לזהם את כל הנתונים,
  לא רק את `dashboard-state`. אין named-range scoping ב-Google Sheets API
  (כל ה-scope הוא רוחבי על ה-file).
- **Recommendations:**
  1. ליצור service-account שני (`roas-dashboard-writer@...`) בעל `spreadsheets`
     scope ב-API key נפרד שמשמש רק את ה-POST של `/api/dashboard-state`.
     ה-service-account הראשי יישאר read-only קשיח.
  2. בנוסף, ב-Google Sheets, להעניק לה-writer רק access ל-spreadsheet אחד
     (כן default), אבל בצד Vercel — להפריד את שני המפתחות לשני env vars שונים
     (`GOOGLE_READER_KEY` / `GOOGLE_WRITER_KEY`) כך שדליפה של אחד לא תפגע בשני.

### `ALLOWED_STATE_KEYS` — pattern טוב, לשמור

- **Status:** ב-Round 4 נוסף allowlist על POST `/api/dashboard-state` שדוחה
  כל key שלא ב-`ALLOWED_STATE_KEYS` (`dashboard-web/src/app/api/dashboard-state/route.ts:74`).
  זה כתבי הגנה נגד prototype-pollution + הסכמה type-safe מול `StateKey` union.
- **Files:** `dashboard-web/src/lib/sheets.ts::isAllowedStateKey`,
  `dashboard-web/src/lib/cloudSync.ts::StateKey`.
- **Recommendation:** **כן לשמור.** כל הוספה של key חדש חייבת לעבור גם
  ב-`StateKey` וגם ב-`ALLOWED_STATE_KEYS` — היום זה manual, כדאי להוסיף test
  שמוודא שהשניים מסונכרנים.

### אין rate limiting על POST `/api/dashboard-state`

- **Issue:** Endpoint שכותב ל-Google Sheets API (יקר). אין rate limit per-IP
  או per-session. כל קליינט שמתחבר לדשבורד יכול לשלוח 1000 POSTs בשנייה.
- **Files:** `dashboard-web/src/app/api/dashboard-state/route.ts:59-84`.
- **Impact:** משתמש זדוני שיכול לפתוח את הדשבורד (אם זה internal — לא ציבורי,
  לא קריטי; אבל אם נחליט לחשוף — קריטי) יכול למצות את ה-quota היומי של
  Sheets API → כל הדשבורד נופל ל-24 שעות.
- **Recommendations:**
  1. להוסיף rate-limit middleware (Upstash Redis + `@vercel/edge-rate-limit`,
     או נכון יותר — Vercel's built-in Edge Config) — 10 POSTs/min/IP.
  2. בנוסף, להוסיף server-side debounce של 1s על כל key — אם 2 POSTs לאותו key
     מגיעים ב-100ms, רק האחרון יבוצע.
  3. אופציה — ל-batching: לחבר את 7 ה-keys לכתיבה אחת `POST /api/dashboard-state/batch`
     במקום 7 POSTs נפרדים.

### `notification.email` ב-Script Property — בטוח אבל לא tested

- **Issue:** `notification.email` נשמר ב-Script Properties יחד עם tokens של
  Meta / Google / Shopify. כל מי שיש לו edit access ל-Apps Script Project
  יכול לראות את כל ה-properties.
- **Files:** `Config.gs:164`, `DailyUpdate.gs:502-538`.
- **Impact:** אין דליפה ב-git (Properties לא ב-source), אבל אם איש GTI עוזב
  והחשבון שלו לא מבוטל, יש לו גישה ל-tokens של 3 חנויות + ad accounts.
- **Recommendations:**
  1. תיעוד clear של מי יש לו access ל-Apps Script Project (כיום ל-1–2 שותפים?).
  2. סקירה רבעונית — מי על רשימת ה-collaborators ולמה.
  3. אופציה — להעביר את ה-tokens החשובים (Meta + Google) ל-Google Secret Manager
     ולשלוף ב-runtime; דורש refactor אבל גודל הסיכון מצדיק.

### אין audit log על cloud-state edits

- **Issue:** `dashboard-state` tab שומר את הערך הנוכחי + `updatedAtByKey` (per
  key timestamp). אין log "מי שינה מה ומתי, ומה היה הערך הקודם".
- **Files:** `dashboard-web/src/lib/sheets.ts::upsertDashboardStateKey`,
  `dashboard-web/src/app/api/dashboard-state/route.ts:77`.
- **Impact:** אם שותף משנה ערך billing בטעות וצריך לשחזר — אין דרך. גם debug
  של "מי שינה את ה-product-map?" בלתי אפשרי.
- **Recommendations:**
  1. להוסיף tab `dashboard-state-audit` עם 4 עמודות: timestamp, key, old-value,
     new-value (truncated to 500 chars). כתיבה אחת לכל POST.
  2. retention — keep last 30 days, חסל ישנים.
  3. ב-UI להוסיף "תיעוד" tab שמראה את 50 השינויים האחרונים.

---

## Scalability Concerns

### Single spreadsheet עבור כל 3 החנויות

- **Issue:** כל הנתונים יושבים ב-spreadsheet אחד (8 סוגי טאבים × 3 חנויות =
  ~17 טאבים פעילים). Sheets API מגביל ל-10 מיליון cells per-spreadsheet.
- **Files:** `dashboard-web/src/lib/sheets.ts` (כל הקריאות), `Main.gs::ensureSpreadsheet`.
- **Current usage estimate (rough):** data-daily ~2k שורות × 13 cols = 26k cells.
  campaigns × 3 × ~300 ad-sets-per-day × 365 days × 13 cols ≈ 4.3M cells.
  orders-attribution × 3 × ~100 orders/day × 365 days × 14 cols ≈ 1.5M cells.
  **סה"כ ~6M cells.** אם תיווסף חנות 4 ברמה דומה — נגיע ל-8M, מתקרבים ל-cap.
- **Impact:** מעבר ל-10M cells דורש פיצול ל-2 spreadsheets שונים, וכל ה-`fetchDailyData`
  / `fetchCampaignsData` יצטרכו לעשות 2 קריאות במקום אחת.
- **Recommendations:**
  1. **רוטציה:** להעביר נתונים מעל גיל 18 חודש ל-archive spreadsheet (קר). הדשבורד
     יקרא רק את ה-warm spreadsheet כברירת מחדל, ויטען מ-archive on-demand אם
     המשתמש בוחר טווח ישן.
  2. **per-store splitting:** לפצל את ה-spreadsheet ל-3 (`roas-uzoshop`, `roas-zolplus`,
     `roas-usmile`) + מאסטר אחד ל-`data-daily` + `dashboard-state`. ה-Apps Script
     יכתוב לכל חנות לקובץ שלה, הדשבורד יקרא במקביל.

### `products-daily` ללא rotation

- **Issue:** שורה לכל (יום, חנות, מוצר) מצטברת ללא מחיקה. אם חנות מוכרת 30
  מוצרים שונים ביום, אחרי שנה ⇒ 30 × 365 = 11k שורות. אחרי 5 שנים — 55k שורות
  per-store, 165k שורות סה"כ.
- **Files:** `SheetBuilder.gs::writeProductSalesForDay_`,
  `dashboard-web/src/app/api/products/route.ts`.
- **Impact:** הדשבורד עושה batchGet של כל הטאב בכל קריאה ל-`/api/products`,
  ואז המחשב של הקליינט עושה filter לפי הטווח שהמשתמש בחר. ב-165k שורות זה
  יתחיל להראות איטיות הן ב-Sheets read (5–10 שניות) הן ב-rendering.
- **Recommendations:**
  1. **שלב 1 (קצר טווח):** להוסיף `?from=YYYY-MM-DD&to=YYYY-MM-DD` ל-`/api/products`
     ולעשות filter על ה-Sheets call (`A:N` →
     רק שורות בתוך הטווח). דורש index sort של הטאב לפי תאריך + binary search
     על range A.
  2. **שלב 2 (ארוך טווח):** רוטציה — שורות מעל 18 חודש ⇒ ל-`products-daily-archive`.
     `/api/products` קורא רק מהחדש אלא אם המשתמש בחר טווח > 18 חודש.

### `orders-attribution` עם line items JSON per row

- **Issue:** Phase 1 הוסיף עמודה `Line Items (JSON)` לכל שורה ב-`orders-attribution`.
  cell גודל ממוצע ~200–500 chars, יכול לגדול ל-2000 chars לhotline orders עם
  10 פריטים. Sheets API range read קורא את כל ה-cells, גם הריקים, גם הגדולים.
- **Files:** `SheetBuilder.gs::writeOrdersAttributionForDay`,
  `dashboard-web/src/lib/ordersAttribution.ts`,
  `dashboard-web/src/app/api/orders-attribution/route.ts`.
- **Impact:** אחרי 3 שנים × 3 חנויות × 100 orders/day = ~330k שורות עם cells
  גדולים. ה-range read יזחל. נוסף לכך, parse JSON ב-client per-row יהיה
  CPU-heavy.
- **Recommendations:**
  1. **rotation** — דומה ל-products-daily, שורות מעל 18 חודש לarchive.
  2. **lazy parsing** — הדשבורד מחזיר רק את ה-IDs בקובץ ה-API, ה-JSON של
     line items נטען על-demand כש-CampaignDrawer פתוח עבור קמפיין ספציפי.
  3. **שקול** — להעביר את ה-line-items ל-tab נפרד `{store}-line-items` (one row
     per item, foreign-key ל-order_id). פתרון יותר נכון מבחינת data modeling
     אבל דורש refactor.

### `/api/data` ו-`/api/campaigns` מחזירים את כל ההיסטוריה

- **Issue:** ב-current implementation, אין pagination. בכל קריאה — כל הtable
  נשלח לקליינט, וה-Filter על הטווח קורה ב-client (`useMemo` over rows).
- **Files:** `dashboard-web/src/app/api/data/route.ts`,
  `dashboard-web/src/app/api/campaigns/route.ts`,
  `dashboard-web/src/lib/data.ts`.
- **Impact:** היום, ~2k שורות ב-data-daily ו-~10k שורות ב-campaigns מועברים
  ב-payload של ~500KB-1MB. תוך שנה זה יהיה 5MB+. browsers יתחילו להחזיק זה לא טוב,
  TTI יעלה ב-2-3 שניות.
- **Recommendations:**
  1. להוסיף `?from=&to=` ל-`/api/data` ו-`/api/campaigns` — ה-default יחזיר רק
     last 90 days. אם המשתמש בחר טווח רחב יותר ב-`Filters`, יישלח request חדש
     (cached separately by SWR key).
  2. אופציה משלימה — server-side aggregation: `/api/data?from=X&to=Y&agg=month`
     יחזיר 12 שורות במקום 365. שימושי בעיקר ל-AnalysisTab.

### Cloud-sync hydration כל 30s × N partners

- **Issue:** `CloudSync.tsx:21` poll ל-`/api/dashboard-state` כל 30s.
  אם 5 שותפים פתחו את הדשבורד במקביל — 5 × 120/hour = **600 reads/hour**
  על `dashboard-state`.
- **Files:** `dashboard-web/src/components/CloudSync.tsx`,
  `dashboard-web/src/app/api/dashboard-state/route.ts`.
- **Impact:** Sheets API quota הוא 60 reads/minute/user — עם service-account
  משותף, 5 שותפים × 2 polls/min = 10 reads/min, יש מרווח. אבל אם יגדל ל-20
  שותפים נגיע ל-quota wall.
- **Recommendations:**
  1. להחליף polling ב-Server-Sent Events (Vercel תומך) או WebSocket — הקצה
     משדר רק כשיש שינוי. דורש refactor אבל מבטל את ה-quota stress.
  2. או — adaptive polling: visible tab → 30s, hidden tab → 5min, idle → stop.
     קל יותר ליישם.
  3. במקביל — לקצר את ה-payload: `/api/dashboard-state?since=<lastUpdated>`
     יחזיר רק את ה-keys ש-`updatedAtByKey[key] > since`. ה-CDN cache עדיין
     עובד כי הtimestamp עוקב.

---

## Robustness / Observability Gaps

### `Logger.log` ב-Apps Script — retention קצר

- **Issue:** `Logger.log` הולך ל-Apps Script Executions, נשמר ~30 ימים אז נמחק.
- **Files:** כל ה-`*.gs`.
- **Impact:** debug של בעיה שצצה לפני 6 חודשים ("למה החודש של יוני 2025 נראה
  שונה ב-Shopify מה-data-daily?") — אין logs לבחון.
- **Recommendations:**
  1. **שלב 1:** להעביר את כל ה-Logger.log המשמעותיים לקובץ `logs` tab
     ב-spreadsheet עצמו (`SheetBuilder.gs::appendLogRow`). שמירה ל-ever
     (rotation לאחר 6 חודשים).
  2. **שלב 2:** structured logging — במקום `Logger.log("text")`, להשתמש
     ב-`logEvent({type, store, date, msg, durMs})` שמקודד ל-JSON ושומר
     ב-tab `logs`. אם נדרש analytics על ה-logs — `=JSONPATH()` נוסחאות + tab
     מסכם.
  3. **שלב 3 (אם רלוונטי):** אקספורט יומי של ה-logs ל-BigQuery ל-3y retention
     + query capabilities.

### דשבורד ללא client-side error reporting

- **Issue:** אין Sentry / Datadog / NewRelic / log-rocket. שגיאות JS שקורות
  אצל המשתמש (browser-specific bug, network blip, malformed sheet row) לא
  מגיעות אליי.
- **Files:** `dashboard-web/src/app/layout.tsx` — אין `ErrorBoundary` global.
- **Impact:** משתמש פותח דשבורד, רואה white-screen, סוגר, פותח שוב, עובד. אני
  לעולם לא יודע שזה קרה.
- **Recommendations:**
  1. להוסיף Sentry (free tier מספיק) — `@sentry/nextjs` install + Sentry DSN
     ב-env. ב-`layout.tsx` להוסיף `ErrorBoundary` שמדווח גם שגיאות שלא
     נתפסו ב-React.
  2. ל-Edge functions של Vercel — `console.error` כבר נכנס ל-Vercel Logs;
     מספיק להוסיף לשם רק parsing/aggregation. אופציונלי — להעביר גם את ה-server
     logs ל-Sentry.

### בדיקת phantom-spreadsheet — חד-פעמית

- **Issue:** ה-`ensureSpreadsheet` בודק פעם בתחילת ריצה. אם property משתנה
  באמצע ריצה (אורגנית לא יקרה, אבל race קיים) — undefined behavior.
- **Files:** `Main.gs::ensureSpreadsheet`.
- **Impact:** קצה-מקרה מאוד נדיר. בעיקר מסוכן אם operator מריץ
  `resetSpreadsheetIdToKnownGood` תוך כדי שrun יומי באמצע ריצה.
- **Recommendations:**
  1. להוסיף `Cache-Service lock` שמונע מ-`runDailyUpdate` ו-`resetSpreadsheetIdToKnownGood`
     לרוץ במקביל.
  2. או — לדגום שוב את הproperty בנקודות קריטיות (לפני כל write batch), אבל זה
     overkill לקצה מקרה.

### אין alerts לגבי quota approach

- **Issue:** `notifyError_` שולח מייל **רק כשהריצה כשלה** (לרבות quota error
  שקרה). אין מנגנון "אנחנו ב-80% מהquota — היזהר".
- **Files:** `DailyUpdate.gs:67-71`, `DailyUpdate.gs:502-538`.
- **Impact:** ביום שבו נגיע ל-quota cap, נדע רק כשהריצה תיכשל — לא יום קודם.
  כיום הריצה לוקחת ~4 דק' מתוך 6 → יש מרווח, אבל ככל שיוסיפו חנויות/קמפיינים
  זה יתחיל לטעון.
- **Recommendations:**
  1. למדוד duration של `runDailyUpdate` (כבר חלקית לוגית) ולשלוח התראה אם
     `duration > 4.5 min` באופן עקבי 3 ימים ברצף.
  2. דומה ל-Sheets API quota usage — לעקוב אחרי `429` responses
     מ-`UrlFetchApp` ולשלוח התראה אם שיעור 429 ביום עולה על 5%.

---

## Recommendations (prioritized — what would have the highest leverage)

מסודר לפי "tradeoff": כמה זה עוזר vs כמה זה לוקח לעשות.

### 1. Unit tests עבור `attributionAnalysis.ts`  [HIGH IMPACT, LOW EFFORT]

המודול היחיד שהכי קרוב למסחר-קריטי (החישוב ש-true ROAS נשען עליו) — ועדיין
חסר כיסוי לחלוטין. הוספת 30–50 בדיקות vitest עם data fixtures (יום עם spend +
מספר orders, יום בלי spend, יום ש-Meta דיווח על conversion ללא click-ID, יום
עם ad-set שמשובץ למספר קמפיינים) תפס מיידית את הבאגים ש-Round 5 חשף.

**Effort:** ~1 day. **Risk reduction:** עצום — כל refactor עתידי של המודול
יקבל regression safety net.

### 2. Split `CampaignsTable` ל-≤500-line sub-components  [HIGH IMPACT, MED EFFORT]

1732 שורות הופכות את הקובץ ל-cognitive load גבוה. פיצול ל-`useCampaignTrueRevenue`
+ `useCampaignAttribution` (hooks) + `CampaignsTableRow` (component) + הtable
עצמה יחסוך זמן IDE ויאפשר tests cellular per-hook.

**Effort:** ~2 days. **Maintenance saving:** הרבה — כל פיצ'ר חדש בטבלה יהיה
מהיר יותר.

### 3. `clasp` push + GitHub Action  [HIGH IMPACT, LOW EFFORT]

הוצאת ה"manual upload" של `*.gs` החוצה ⇒ deployment אחיד עם git. לא נצטרך לדאוג
"האם הgs שב-production תואם ל-main".

**Effort:** ~2 hours. **Risk reduction:** סופית — סוף לסיכון של חצי-deploy.

### 4. Sentry client-side error reporting  [HIGH IMPACT, LOW EFFORT]

free tier מספיק. ה-install הוא 2 dependencies + DSN ב-env. ⇒ visibility מלאה לכשלי
client שלא היו ידועים.

**Effort:** ~3 hours. **Visibility:** גבוהה.

### 5. `data-daily` ו-`products-daily` retention policy  [MED IMPACT, MED EFFORT]

לפני שה-spreadsheet מגיע ל-cell-cap. רוטציה ל-archive spreadsheet, עם דשבורד
שיודע to-fall-back.

**Effort:** ~3 days. **Future risk reduction:** משמעותית — מונע "fire" עתידי.

### 6. ADR למודל ה-7-key cloud-sync  [LOW IMPACT, LOW EFFORT]

מסמך אחד שמתעד את המודל המלא (keys, validation rules, who edits when) ⇒ source
of truth ל-onboarding שותפים חדשים + ל-refactor עתידי.

**Effort:** ~3 hours. **Value:** documentation-only, אבל חוסך לי שעות onboarding.

### 7. `cacheConfig.ts` module  [LOW IMPACT, LOW EFFORT]

הוצאת ה-TTL hardcoded למקור אחד. שינוי policy עתידי יהיה אחיד.

**Effort:** ~2 hours. **Maintenance saving:** קטנה אבל מצטברת.

### 8. Row-count guards ב-API routes  [LOW IMPACT, LOW EFFORT]

הוספת `if (rows.length > 50000) console.warn(...)` בכל route. עוזר לזהות
מתי באמת נדרשת pagination.

**Effort:** ~1 hour. **Value:** signal צף לפני שזה הופך לבעיה.

### 9. Externalize Hebrew strings  [MED IMPACT, HIGH EFFORT]

לא עוזר ב-day-1 (אין דרישה ל-i18n כעת), אבל הופך הוספת שפה לקלה. עדיף לעשות
זאת אגב ה-CampaignsTable split (לחסוך עבודה כפולה).

**Effort:** ~4 days. **Future value:** קריטית אם תהיה צורך באנגלית.

### 10. Structured logging  [LOW IMPACT, MED EFFORT]

JSON logs ב-Apps Script ⇒ tab `logs` ב-Spreadsheet + לאחר מכן BigQuery export.
Pre-requisite להזרים ל-Splunk/Looker/Datadog בעתיד.

**Effort:** ~3 days. **Value:** ארוך-טווח, debugging של בעיות היסטוריות.

---

## Things Going Well (Worth Preserving)

המסמך הזה מתמקד בריט פערים, אבל יש דברים שצריך לזהות ולשמר כי הם עובדים טוב.

### `/gsd-code-review` discipline

5 סבבי code-review (`REVIEW.md`, `REVIEW-2.md`, ... `REVIEW-5.md`), כל אחד הוליד
~12 תיקונים. המערכת היום בטוחה משמעותית ממה שהיתה ב-Round 1. **לשמר** את הקצב —
כל פיצ'ר משמעותי שתי-עיניים-נוספות לפני שmerge.

### Idempotent write pattern

`writeOrdersAttributionForDay` / `writeCampaignRowsForDay` / `writeProductSalesForDay_`
כולם בנויים על "clear rows for dateStr, append new ones". ⇒ הרצה שניה (גם
backfill, גם live update כל 15 דק') לא יוצרת duplicates. **לשמר.**

### Phantom-spreadsheet protection

`resetSpreadsheetIdToKnownGood` + `printCurrentSpreadsheetId` + `ensureSpreadsheet`
שעמיד ל-timeout (לא יוצר חדש). ⇒ סיכון של data fork קטן משמעותית. **לשמר.**

### Trust chip + fallback pattern ב-CampaignsTable

4-level confidence chip + fallback ל-product-map כש-attribution לא קיים ⇒ UX
שטרם נשבר גם בתסריטי edge (orders-attribution tab חסר, Google campaign בלי
per-product mapping). **לשמר** ולא להחליף ב-"all-or-nothing".

### Round 5 defensive patterns

- `Object.create(null)` ב-`Shopify.gs::classifyOrderAttribution_` (params object)
- `Number.isFinite(...)` guards ב-aggregations
- `safeDecode_` (try/catch מסביב ל-`decodeURIComponent`)
- 3-tier email resolver ב-`notifyError_` (configured → owner → active)
- Inter-store sleep מ-runUpdateForDate שpropagated גם ל-runUpdateForDateForStores_

כל אחד מהם מטפל ב-failure mode ספציפי שכבר ראינו. **לשמר** ולחקות את הpattern
ב-קוד חדש.

---

*Concerns audit: 2026-05-18*
