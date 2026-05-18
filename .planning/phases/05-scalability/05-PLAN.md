---
phase: 05-scalability
plan: 0
type: outline
tags: [apps-script, scalability, pagination, retention, swr]
plans:
  - id: 01
    wave: 1
    title: "Per-store Apps Script trigger split"
    files_modified:
      - Main.gs
      - DailyUpdate.gs
    depends_on: []
    autonomous: false
    requirements: [P5-TRIGGER-SPLIT]
  - id: 02
    wave: 1
    title: "API pagination (?from=&to=) + SWR keys"
    files_modified:
      - dashboard-web/src/app/api/data/route.ts
      - dashboard-web/src/app/api/campaigns/route.ts
      - dashboard-web/src/app/api/products/route.ts
      - dashboard-web/src/app/api/orders-attribution/route.ts
      - dashboard-web/src/lib/sheets.ts
      - dashboard-web/src/lib/campaigns.ts
      - dashboard-web/src/lib/products.ts
      - dashboard-web/src/lib/ordersAttribution.ts
      - dashboard-web/src/lib/dateRange.ts
      - dashboard-web/src/components/Dashboard.tsx
      - dashboard-web/src/components/CampaignsTable.tsx
      - dashboard-web/src/components/CampaignDrawer.tsx
      - dashboard-web/src/components/ProductsTable.tsx
    depends_on: []
    autonomous: true
    requirements: [P5-API-PAGINATION, P5-SWR-KEYS]
  - id: 03
    wave: 2
    title: "Lazy line-items on /api/orders-attribution"
    files_modified:
      - dashboard-web/src/app/api/orders-attribution/route.ts
      - dashboard-web/src/lib/ordersAttribution.ts
      - dashboard-web/src/components/CampaignsTable.tsx
      - dashboard-web/src/components/CampaignDrawer.tsx
    depends_on: [02]
    autonomous: true
    requirements: [P5-LAZY-LINEITEMS]
  - id: 04
    wave: 3
    title: "Archive (retention) + dashboard fallback"
    files_modified:
      - DailyUpdate.gs
      - Main.gs
      - dashboard-web/src/app/api/data/route.ts
      - dashboard-web/src/lib/sheets.ts
    depends_on: [01, 02]
    autonomous: false
    requirements: [P5-ARCHIVE-SCRIPT, P5-ARCHIVE-FALLBACK]
---

# Phase 5 — Scalability (Outline)

מסמך תיכנון לפיצול הפאזה לארבעה PLAN-ים סדרתיים, מתאמים זה לזה דרך תלויות מפורשות.

## למה ארבעה PLAN-ים

הפאזה נוגעת בשתי שכבות שונות (Apps Script + Dashboard Next.js) ובארבע יכולות נפרדות (triggers, pagination, lazy fields, archive). ניסיון להכניס הכל ל-PLAN אחד יחרוג מתקציב הקונטקסט של אגנט יחיד. הפיצול:

- **01 — Trigger split** (Apps Script בלבד) ⇒ עצמאי, גל 1
- **02 — API pagination** (Routes + lib + components) ⇒ עצמאי, גל 1
- **03 — Lazy line-items** ⇒ דורש את שינויי ה-pagination ב-`/api/orders-attribution` ⇒ גל 2
- **04 — Archive script** ⇒ דורש שגם ה-Apps Script שינוי (`DailyUpdate.gs` נכנס ב-PLAN 01) וגם ה-route של `/api/data` כבר תומך ב-`from=&to=` ⇒ גל 3

## גלים (Waves) ומקבילים

| גל | PLAN-ים | מקבילים? |
|----|---------|---------|
| 1  | 01, 02  | כן (אין חפיפת קבצים) |
| 2  | 03      | חופף ל-02 ב-`/api/orders-attribution` ו-`ordersAttribution.ts` ⇒ סדרתי אחרי 02 |
| 3  | 04      | חופף ל-01 ב-`DailyUpdate.gs/Main.gs` וגם ל-02 ב-`/api/data/route.ts` ⇒ סדרתי אחרי שניהם |

## סדר מומלץ להרצה

```
wave 1:  01 (Apps Script triggers)       wave 1:  02 (API pagination)
                       ↓                                    ↓
                                wave 2: 03 (lazy line-items)
                                            ↓
                                wave 3: 04 (archive + dashboard fallback)
```

## הערות סיכון

- **PLAN 01** — מסכן את ההרצה היומית. Verify ידני: להריץ כל אחת מ-3 הפונקציות החדשות מהעורך לפני התקנת ה-triggers (checkpoint:human-verify).
- **PLAN 02** — שינוי צורת SWR keys. שורות ישנות ב-cache עלולות להאפיל. mitigation: SWR keys נבנים ע"י helper שמקודד את ה-range, כך שהמפתח ישתנה אוטומטית.
- **PLAN 03** — backwards-compat. קוראים ישנים שעדיין מבקשים ללא `?lineItems=` יקבלו את התנהגות ברירת המחדל (`false` = ללא lineItems). CampaignDrawer מתעדכן במפורש ל-`?lineItems=true`.
- **PLAN 04** — destructive. dry-run mode חובה לפני production. ה-archive spreadsheet ID חייב להיות מוגדר ב-Script Property לפני הרצה. checkpoint:human-verify לאחר dry-run לפני שמאפשרים `dryRun=false`.

## אינדקס PLAN-ים

- `05-01-PLAN.md` — Per-store Apps Script trigger split
- `05-02-PLAN.md` — API pagination + SWR keys
- `05-03-PLAN.md` — Lazy line-items on `/api/orders-attribution`
- `05-04-PLAN.md` — Archive script (retention) + dashboard fallback

(ה-PLAN-ים השונים נכתבים כקבצים נפרדים ב-`.planning/phases/05-scalability/`.)
