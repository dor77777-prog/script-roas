# ROAS Tracker — מעקב יומי לחנויות Shopify

מערכת Google Apps Script שמושכת אוטומטית **כל יום ב-06:15 שעון ישראל**:
- הכנסות מ-Shopify (CAD) לכל אחת מ-3 החנויות
- הוצאות פרסום מ-Meta Ads (ILS) לכל החנויות
- הוצאות פרסום מ-Google Ads (CAD) — רק עבור **uzoshop**

ממיר ILS→CAD לפי שער יומי (ECB דרך frankfurter.dev), מחשב ROAS, ורושם
לטאב נפרד לכל חנות + טאב סיכום משולב. עמודת ROAS נצבעת אוטומטית.

## מבנה הקבצים

```
appsscript.json      מניפסט (אזור זמן + הרשאות)
Config.gs            קבועים, רשימת חנויות, עזרי Properties
FX.gs                שערי חליפין (Frankfurter / ECB)
Shopify.gs           Shopify Admin REST API
MetaAds.gs           Meta Marketing API (Insights)
GoogleAds.gs         Google Ads REST API + OAuth refresh
SheetBuilder.gs      פריסת חודשים, עיצוב, עיצוב מותנה
DailyUpdate.gs       תזמור היומי + מילוי היסטורי
Main.gs              setup, triggers, תפריט
SETUP.md             מדריך הקמה צעד-אחר-צעד (אישורים, טוקנים, OAuth)
```

## חוקי צבע ROAS

| ROAS              | צבע   |
|-------------------|-------|
| `< 2`             | אדום  |
| `2` עד `2.69`     | כתום  |
| `2.7` עד `3`      | ירוק  |
| `> 3`             | כחול  |

## פריסת טאב

לכל חנות (וגם בסיכום), כל חודש קלנדרי מקבל בלוק נפרד:

```
מאי 2026                                       ← כותרת ממוזגת
תאריך       יצא (CAD)   נכנס (CAD)   ROAS      ← כותרות עמודות
2026-05-01     ...         ...        ...
...
2026-05-31     ...         ...        ...
סך הכל         =SUM(B)     =SUM(C)    =C/B

יוני 2026
...
```

חודשים חדשים מצורפים מתחת — חודשים קודמים לעולם לא נדרסים.

## התחלת עבודה

ראה [SETUP.md](SETUP.md) למדריך הקמה מלא. בקצרה:

1. צור פרויקט חדש ב-https://script.google.com
2. העתק את כל קבצי `.gs` ואת `appsscript.json` לפרויקט
3. הגדר Script Properties (טוקנים, ad account IDs וכו') — ראה SETUP.md
4. הרץ פעם אחת את הפונקציה `setupAll` מעורך Apps Script
5. הגיליון נוצר אוטומטית; הטריגר היומי מתוקן
6. אופציונלי: הרץ `backfillRange('2026-05-01', '2026-05-15')` למילוי היסטורי
