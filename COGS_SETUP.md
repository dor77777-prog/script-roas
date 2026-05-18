# COGS (Cost of Goods Sold) — שיטת חישוב

החל ממאי 2026, **COGS מחושב כ-25% מההכנסה היומית** של כל חנות. זוהי הערכה שמרנית שמשקפת את הממוצע ההיסטורי בכל שלוש החנויות.

> **למה לא דרך Shopify cost-per-item?**
> ניסינו את זה והיו בעיות: לחלק מהמוצרים אין `cost` מוגדר ב-Shopify, ולחלק יש ערכים לא מעודכנים, מה שגרם לחישוב לא מדויק. החישוב הקבוע של 25% נותן מספר אמין שאפשר לסמוך עליו.

> **השפעה על ROAS**: אין. ROAS = Revenue / Ad Spend בלבד.
> COGS משפיע רק על **רווח גולמי** = Revenue − COGS, ועל **רווח נטו** = Revenue − Ad Spend − COGS − Transaction Fees − Fixed Costs.

---

## איפה הערך מוגדר

הערך מוגדר בשני מקומות במקביל — חייבים להיות עקביים כדי שהדשבורד יסכים עם הנתונים שהסקריפט כותב:

- **Apps Script** ([Config.gs](Config.gs)): `COGS_RATE_OF_REVENUE = 0.25`
  - בשימוש ב-[DailyUpdate.gs](DailyUpdate.gs) → `updateStoreForDate_` בעת חישוב `cogsCad = revenueCad × COGS_RATE_OF_REVENUE`
  - הערך נכתב ל-`data-daily` עמודה J (COGS CAD)
- **Dashboard** ([dashboard-web/src/lib/analytics.ts](dashboard-web/src/lib/analytics.ts)): `COGS_RATE_OF_REVENUE = 0.25`
  - בשימוש ב-[`KpiCards`](dashboard-web/src/components/KpiCards.tsx), [`PnLBreakdown`](dashboard-web/src/components/PnLBreakdown.tsx), [`DetailTable`](dashboard-web/src/components/DetailTable.tsx) ועוד

לשינוי האחוז (למשל ל-20% או 30%):
1. ערוך את שני הקבצים — שניהם צריכים אותו ערך כדי שהשורות החדשות וההיסטוריות יהיו עקביות
2. דחוף ל-git (Vercel ידפלוי דשבורד אוטומטית)
3. העתק את `Config.gs` המעודכן ל-Apps Script
4. (אופציונלי) ב-Apps Script: הרץ `backfillRange('YYYY-MM-DD', 'YYYY-MM-DD')` כדי שהעמודה ב-`data-daily` תעודכן רטרואקטיבית

הדשבורד יציג את הערך החדש מיד גם בלי backfill (כי הוא מחשב מ-revenue × rate בזמן ריצה), אבל ה-Sheet עצמו יישאר עם הערכים הישנים עד שתריץ backfill.

---

## איפה זה מופיע

### בטאב `data-daily` (מקור האמת)
- **J: COGS (CAD)** — `revenue * 0.25` נכתב אוטומטית בכל ריצה של `runDailyUpdate`
- **K: Net Profit (CAD)** — נוסחה: `=G-F-IF(J="",0,J)` → Revenue − Spend − COGS

### בדשבורד
- **KPI cards** (טאב בית): כרטיס "רווח גולמי" = Revenue − COGS
- **P&L Waterfall** (טאב P&L): COGS מופיע כאחד הצעדים בwaterfall (Revenue → -Ad Spend → **-COGS** → -Transaction Fees → -Fixed → True Net)
- **PnLBreakdown Hero strip**: סך עלויות = Ad Spend + COGS + Transaction Fees + Fixed Costs
- **DetailTable**: עמודה COGS מאוכלסת לכל יום + עמודת Net Profit
- **TodayLive**: לא מציג COGS ישירות, אבל "רווח גולמי" עוטף אותו

### Transaction Fees
לידה ל-COGS, ה-dashboard מנכה גם **Transaction Fees = 6.5% מהכנסות** (PayPal + FX overhead). מוגדר ב-[dashboard-web/src/lib/costs.ts](dashboard-web/src/lib/costs.ts) כקבוע `TRANSACTION_FEES_RATE`. רק בדשבורד — לא נכתב ל-Sheet.

### Fixed Costs
המשתמש מגדיר ב-[BillingSettings](dashboard-web/src/components/BillingSettings.tsx) (recurring monthly subs + one-time charges). מסונכרן בענן תחת `roas-dashboard:billing-recurring` ו-`billing-onetime`. ה-dashboard עושה prorate לטווח הנבחר.
