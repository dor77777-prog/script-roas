# COGS (Cost of Goods Sold) — שיטת חישוב

החל ממאי 2026, **COGS מחושב כ-25% מההכנסה היומית** של כל חנות.
זוהי הערכה שמרנית שמשקפת את הממוצע ההיסטורי בכל שלוש החנויות.

> **למה לא דרך Shopify cost-per-item?**
> ניסינו את זה והיו בעיות: לחלק מהמוצרים אין `cost` מוגדר ב-Shopify, ולחלק יש ערכים לא מעודכנים, מה שגרם לחישוב לא מדויק. החישוב הקבוע של 25% נותן מספר אמין שאפשר לסמוך עליו.

> **השפעה על ROAS**: אין. ROAS = Revenue / Ad Spend בלבד.
> COGS משפיע רק על **רווח נטו** = Revenue − Ad Spend − COGS.

---

## איפה הערך מוגדר

- **Apps Script** ([Config.gs](Config.gs)): `COGS_RATE_OF_REVENUE = 0.25`
- **Dashboard** ([dashboard-web/src/lib/analytics.ts](dashboard-web/src/lib/analytics.ts)): `COGS_RATE_OF_REVENUE = 0.25`

לשינוי האחוז (למשל ל-20% או 30%):
1. ערוך את שני הקבצים — שניהם צריכים אותו ערך כדי שהשורות החדשות וההיסטוריות יהיו עקביות.
2. דחוף ל-git (Vercel ידפלוי דשבורד אוטומטית).
3. (אופציונלי) ב-Apps Script: הרץ `backfillRange('YYYY-MM-DD', 'YYYY-MM-DD')` כדי שהעמודה ב-`data-daily` תעודכן רטרואקטיבית. הדשבורד יציג את הערך החדש מיד גם בלי backfill, אבל ה-Sheet עצמו יישאר עם הערכים הישנים עד שתריץ backfill.

---

## איפה זה מופיע

### בטאב `data-daily`
- **J: COGS (CAD)** — `revenue * 0.25` נכתב אוטומטית בכל ריצה.
- **K: Net Profit (CAD)** — נוסחה: `=G-F-IF(J="",0,J)` → Revenue − Spend − COGS.

### ב-Web Dashboard
- KPI cards: **עלות סחורה (COGS)** ו**רווח נטו** מוצגים תמיד.
- טבלת פירוט: עמודות COGS ורווח נטו תמיד מאוכלסות.
- TodayLive: כרטיסי ROAS / הכנסות / הוצאות / רווח גולמי (COGS/Net Profit מופיעים בטבלת הסיכום הראשית).
