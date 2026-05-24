# COGS (Cost of Goods Sold) — שיטת חישוב

COGS מחושב כ-**אחוז קבוע מההכנסה היומית** של כל חנות (לא דרך Shopify cost-per-item). ברירת המחדל: **25%**, עם אפשרות לדריסה פר-חנות.

> **למה לא דרך Shopify cost-per-item?**
> לחלק מהמוצרים אין `cost` מוגדר ב-Shopify ולחלק יש ערכים לא מעודכנים — חישוב לא מדויק. אחוז קבוע נותן מספר אמין שאפשר לסמוך עליו.

> **השפעה על ROAS**: אין. ROAS = Revenue / Ad Spend בלבד.
> COGS משפיע רק על **רווח גולמי** = Revenue − COGS, ועל **רווח נטו** = Revenue − Ad Spend − COGS − Transaction Fees − Fixed Costs.

---

## איפה הערך מוגדר

מאז Phase 11 (2026-05-24), כל הקוד רץ ב-tier אחד: Next.js dashboard + Inngest crons שכותבים ל-Supabase Postgres. ה-COGS rate נקרא משני מקורות בסדר העדיפות הבא:

1. **Per-store env var** (מומלץ) — `${STORE_UPPERCASE}_COGS_RATE` ב-Vercel env vars. דוגמה:
   ```
   UZOSHOP_COGS_RATE=0.22
   ZOLPLUS_COGS_RATE=0.28
   USMILE360_COGS_RATE=0.18
   ```
   השם מתבסס על `storeId` (uzoshop / zolplus / usmile360) באותיות גדולות, ועם `_COGS_RATE`.
2. **Fallback גלובלי** — `COGS_RATE_OF_REVENUE = 0.25` ב-[dashboard-web/src/lib/analytics.ts](dashboard-web/src/lib/analytics.ts). משמש כש-אין env var ספציפי לחנות.

ה-helper `getCogsRateForStore(storeId)` ב-[dashboard-web/src/lib/costs.ts](dashboard-web/src/lib/costs.ts) הוא נקודת הקריאה היחידה — כל המשנה הזה זורם דרכו: cron-daily (כתיבה לטבלת `data_daily.cogs_cad`), cron-live (כתיבת LIVE-day), וקוד הדשבורד (KpiCards, PnLBreakdown, DetailTable, forecastMonthEnd).

## לשינוי האחוז

לחנות בודדת:
1. ב-Vercel Project Settings → Environment Variables → הוסף/עדכן `${STORE}_COGS_RATE` (למשל `UZOSHOP_COGS_RATE=0.20`)
2. הפעל מחדש את ה-deployment האחרון (Vercel → Deployments → ⋯ → Redeploy)
3. cron-daily הבא (00:05 IL) יכתוב את הערך החדש ל-`data_daily.cogs_cad` עבור היום ההוא והלאה
4. ערכים היסטוריים נשארים כפי שהיו אלא אם תפעיל backfill ידני (Operator → Backfill range)

לכל החנויות (שינוי גלובלי):
- ערוך את `COGS_RATE_OF_REVENUE` ב-[dashboard-web/src/lib/analytics.ts](dashboard-web/src/lib/analytics.ts)
- הדשבורד יציג את הערך החדש מיד לכל הימים — בלי backfill (חישוב on-the-fly מ-`revenue × rate`)
- שורות ב-DB יישארו בערכים הישנים עד הריצה הבאה של cron-daily / backfill ידני

---

## איפה זה מופיע

### בטבלת `data_daily` (מקור האמת שהדשבורד קורא ממנה)
- **`cogs_cad`** — `revenue_cad × rate` נכתב אוטומטית בכל ריצה של cron-daily (לפי per-store rate)
- **`net_profit_cad`** — מחושב on-the-fly בדשבורד: `revenue − ad_spend − cogs`. לא נכתב לטבלה.

### בדשבורד
- **KPI cards** (טאב בית): כרטיס "רווח גולמי" = Revenue − COGS
- **P&L Waterfall** (טאב P&L): COGS מופיע כצעד בwaterfall (Revenue → -Ad Spend → **-COGS** → -Transaction Fees → -Fixed → True Net)
- **PnLBreakdown Hero strip**: סך עלויות = Ad Spend + COGS + Transaction Fees + Fixed Costs
- **DetailTable**: עמודה COGS מאוכלסת לכל יום + עמודת Net Profit
- **TodayLive**: לא מציג COGS ישירות, אבל "רווח גולמי" עוטף אותו
- **GoalTracker** (יעד חודשי): forecast כולל COGS בחישוב trueNetProfit + projectedNet (החל מ-AUDIT HIGH-9 + HIGH-NEW-2 — הקבוע 0.25 הוחלף ב-rate שמופק מ-`last7Cogs/last7Rev`)

### Transaction Fees
לידה ל-COGS, הדשבורד מנכה גם **Transaction Fees** (PayPal + FX overhead). מוגדר ב-[dashboard-web/src/lib/costs.ts](dashboard-web/src/lib/costs.ts) דרך `getTransactionFeesRateForStore(storeId)` — env var `${STORE}_TX_FEES_RATE` (fallback `TRANSACTION_FEES_RATE = 0.065`). מחושב on-the-fly בדשבורד; לא נכתב לטבלה.

### Fixed Costs
האופרטור מגדיר ב-[BillingSettings](dashboard-web/src/components/BillingSettings.tsx) (recurring monthly subs + one-time charges). מסונכרן בענן תחת `roas-dashboard:billing-recurring` ו-`billing-onetime`. הדשבורד עושה prorate לטווח הנבחר.
