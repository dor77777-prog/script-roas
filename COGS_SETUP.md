# COGS (Cost of Goods Sold) — הוראות הפעלה

המערכת תומכת כעת בחישוב **עלות סחורה** לכל יום, מבוסס על שדה ה-`cost` שמוגדר לכל מוצר ב-Shopify. הסכום נכתב לעמודות חדשות בטאב `data-daily` ומוצג ב-Web Dashboard.

> **חשוב:** COGS *לא משפיע* על ROAS. ROAS נשאר Revenue / Ad Spend בלבד.
> COGS מאפשר לחשב **רווח נטו אמיתי**: `Revenue − Ad Spend − COGS`.

---

## מה שונה אצלך אחרי השדרוג

### בטאב `data-daily`
נוספו שתי עמודות:
- **J: COGS (CAD)** — סכום העלות של כל הפריטים שנמכרו ביום (לפי `inventory_item.cost`).
- **K: Net Profit (CAD)** — נוסחה: `Revenue − Total Spend − COGS`.

### ב-Web Dashboard
- כרטיסי KPI חדשים: **עלות סחורה** ו**רווח נטו** (מוצגים רק כשיש נתוני COGS).
- עמודות חדשות בטבלת הפירוט: COGS ו"רווח נטו".

### באפליקציית Apps Script
- נוספה הפונקציה `getShopifyCogs()` ב-`Shopify.gs`.
- הקריאה משולבת ב-`updateStoreForDate_` — אם נכשלת, הריצה היומית ממשיכה רגיל.

---

## מה צריך לעשות כדי להפעיל

### שלב 1 — להוסיף הרשאות לאפליקציית ה-Custom של Shopify
לכל אחת מ-3 החנויות:

1. כנס ל-Shopify Admin → **Settings → Apps and sales channels → Develop apps**.
2. פתח את האפליקציה שיצרת קודם (זאת שמספקת את ה-`shpat_…` token).
3. לחץ **Configure Admin API scopes**.
4. הוסף את שני הסקופים האלה (בנוסף ל-`read_orders` שכבר קיים):
   - `read_products`
   - `read_inventory`
5. שמור → לחץ **Save changes**.
6. כעת לחץ **Install app** מחדש (או "Update" אם זה מה שמופיע) כדי שהטוקן יקבל את ההרשאות החדשות.
   > הטוקן הקיים ממשיך לעבוד — לא צריך להוציא טוקן חדש.

### שלב 2 — לוודא שלמוצרים יש Cost
ב-Shopify Admin של כל חנות:
- **Products** → לחץ על מוצר → אזור "Variants" / "Inventory".
- בכל וריאנט יש שדה **Cost per item**. אם זה ריק, COGS שלו = 0.
- מילוי בכמות (Bulk): ניתן לעדכן עלויות דרך Bulk editor או דרך CSV import.

### שלב 3 — להריץ backfill (אופציונלי)
- לימים קדימה: הריצה היומית האוטומטית תכלול COGS ללא פעולה נוספת.
- לימים אחורה: הרץ `backfillRange('2026-04-01', '2026-05-15')` מעורך Apps Script.

### שלב 4 — לאמת בדשבורד
1. רענן את הדשבורד.
2. אם הכל עובד — כרטיסי **עלות סחורה** ו**רווח נטו** יופיעו.
3. אם לא מופיעים — סימן שאף יום בטווח לא קיבל נתוני COGS. בדוק ב-Logger.log של Apps Script אם רואים `SKIPPED (missing read_products scope)` או `(missing read_inventory scope)` — סימן שלא ביצעת את שלב 1.

---

## פתרון בעיות

| תופעה | הסיבה הסבירה | פתרון |
|------|---------------|--------|
| COGS = 0 בכל החנויות | חסרים סקופים | חזור לשלב 1 |
| COGS = 0 רק בחנות אחת | למוצרים שלה אין `cost` ב-Shopify | מלא את שדה Cost per item |
| ROAS השתנה אחרי השדרוג | זה לא קשור — ROAS לא מושפע מ-COGS | בדוק עדכוני Meta/Shopify רגילים |
| KPI עלות סחורה לא מופיע בכלל | אין יום אחד בטווח עם COGS תקין | חזור לשלב 1+2+3 |

---

## איך זה עובד מאחורי הקלעים

לכל יום, לכל חנות:

1. שולפים את כל ה-orders של היום (כבר עושים את זה ל-revenue).
2. בכל הזמנה נכנסים ל-`line_items` ואוספים `variant_id` + `quantity`.
3. ב-API call נפרד: `GET /variants?ids=...` → מקבלים `inventory_item_id` לכל variant.
4. ב-API call נפרד: `GET /inventory_items?ids=...` → מקבלים `cost` (במטבע של החנות, שהוגדר כ-CAD בכל 3 החנויות).
5. סוכמים `cost × quantity` של כל הפריטים → זה ה-COGS היומי.
6. כותבים את הסכום לעמודה J של `data-daily`. נוסחת K מחשבת רווח נטו אוטומטית.

המימוש לא כושל אם חסר scope — מחזיר 0 ועובר הלאה (`getShopifyCogs` ב-`Shopify.gs`).
