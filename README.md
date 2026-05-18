# ROAS Tracker — מערכת מעקב מודעות + הזמנות לחנויות Shopify

מערכת end-to-end שעוקבת אחרי ROAS, רווחיות, ו-attribution דטרמיניסטי של **3 חנויות Shopify** (uzoshop, Zol Plus, 360usmile). מורכבת משני חלקים שעובדים ביחד:

1. **Google Apps Script** — שואב **כל יום ב-00:05 שעון ישראל** עבור היום הקודם:
   - הכנסות + הזמנות + line-items מ-Shopify Admin API
   - **classification per-order** מ-`landing_site` (utm/fbclid/gclid/referrer) → טאב `{store}-orders-attribution`
   - הוצאות + insights ב-3 רמות (account / ad-set / ad) + budgets מ-Meta Marketing API
   - הוצאות + ad-group insights מ-Google Ads API (uzoshop בלבד)
   - שערי חליפין ILS/USD/EUR → CAD מ-Frankfurter / ECB

2. **Next.js Dashboard** ([dashboard-web/](dashboard-web/)) — נגיש מכל מכשיר עם cloud-sync של state בין שותפים. 6 טאבים: בית · P&L · ניתוח · קמפיינים · מוצרים · פירוט. עם drill-down ב-3 רמות (Campaign → Ads), trust chip של attribution, recommendations engine, ועוד.

לכל הפרטים — ראה [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).

## מבנה הקבצים

```
Apps Script (collection layer):
  appsscript.json          מניפסט (אזור זמן + הרשאות)
  Main.gs                  setup, triggers, תפריט
  Config.gs                קבועים, STORES, prop helpers, fetchWithRetry,
                            phantom-spreadsheet protection helpers
  Shopify.gs               Admin REST + GraphQL, auto-bootstrap on 401,
                            getShopifyOrdersAttribution, safeDecode_
  MetaAds.gs               Marketing API: insights × 3 levels + budgets
  GoogleAds.gs             Ads API + OAuth refresh-token flow
  FX.gs                    Frankfurter (daily cache)
  ManualOverrides.gs       טאב manual-spend לעקיפת API
  SheetBuilder.gs          יצירת/תחזוקת tabs, מיגרציות אידמפוטנטיות,
                            writeOrdersAttributionForDay, catalog ops
  DailyUpdate.gs           runDailyUpdate, runLiveUpdate, backfillRange*,
                            updateStoreForDate_, notifyError_

Dashboard (presentation layer):
  dashboard-web/
    src/app/api/           8 routes: data, campaigns, products, ads,
                           orders-attribution, product-catalog,
                           store-meta, dashboard-state
    src/components/        31 components incl. CampaignsTable,
                           CampaignDrawer, AdsDrawer, ProductPickerModal,
                           BillingSettings, PnLBreakdown, InsightsBoard
    src/lib/               24 modules incl. attributionAnalysis (Bayesian
                           CI + window stability + outlier detection),
                           cloudSync (7-key state sync), campaignProductMap

Docs:
  SETUP.md                 מדריך הקמה צעד-אחר-צעד (Shopify tokens, Meta
                            System Users, Google Ads OAuth, Script Properties)
  SYSTEM_OVERVIEW.md       אפיון מלא — ארכיטקטורה, רכיבים, attribution,
                            zerimat-נתונים, פיצ'רים, פתרון תקלות
  COGS_SETUP.md            הסבר על COGS = 25% מהכנסות
  WELCOME.md               מסמך onboarding ל-non-technical
  dashboard-web/README.md  הקמה מקומית + פריסה ל-Vercel
```

## חוקי צבע ROAS

| ROAS              | צבע   |
|-------------------|-------|
| `< 2`             | אדום  |
| `2` עד `2.69`     | כתום  |
| `2.7` עד `3`      | ירוק  |
| `> 3`             | כחול  |

## פריסת טאב (Sheets, legacy view)

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

חודשים חדשים מצורפים מתחת — חודשים קודמים לעולם לא נדרסים. בשאר הtabs (data-daily, campaigns, ads, orders-attribution) הכתיבה idempotent — שורות של יום מסוים נמחקות לפני שנכתבות מחדש.

## התחלת עבודה

1. ראה [SETUP.md](SETUP.md) למדריך הקמה מלא של Apps Script + Service Account
2. ראה [dashboard-web/README.md](dashboard-web/README.md) לפריסת הדשבורד ב-Vercel
3. ראה [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) להבנת המערכת לעומק

בקצרה (Apps Script):

1. צור פרויקט חדש ב-https://script.google.com
2. העתק את כל קבצי `.gs` ואת `appsscript.json` לפרויקט
3. הגדר Script Properties (טוקנים, ad account IDs וכו') — ראה SETUP.md
4. הרץ פעם אחת את הפונקציה `setupAll` מעורך Apps Script
5. הגיליון נוצר אוטומטית; הטריגר היומי מתוקן
6. אופציונלי: `backfillRange('2026-05-01', '2026-05-15')` למילוי היסטורי

לפיצ'ר ה-attribution — ודא שב-Meta Ads Manager מוגדרים URL Parameters לכל הקמפיינים:
```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}
&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```
זה מאפשר match דטרמיניסטי ברמת קמפיין / ad-set / ad לפי click-id.
