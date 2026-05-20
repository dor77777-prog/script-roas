# ROAS Dashboard — Quick Start (גרסת כיס)

> מסמך 1-2 עמודים. למדריך המלא: `docs/ROAS-Dashboard-User-Manual.md`.

---

## מה אתה צריך לבדוק בכל יום (5 דקות)

1. **Sync Indicator (פינה ימנית עליונה)** — חייב להיות 🟢 ירוק. אם הוא לא, כל מה שאחריו לא רלוונטי.
2. **בית tab → Today Live** — האם יש חנות עם Spend אבל 0 Revenue? אם כן, תחקור.
3. **בית tab → Hero KPI strip** — ROAS chip 🟢 או 🔵 = טוב. 🟠 = גבולי. 🔴 = בעייתי.
4. **Campaigns tab → Top-5** — אילו קמפיינים יש להם Trust Chip אדום? אל תקבל החלטה לפני שתבדוק.

---

## איך לקרוא ROAS ו-True ROAS

| ROAS | פירוש | תווית |
|---|---|---|
| ≥ 3.0 | מעולה | 🔵 כחול |
| 2.7 – 3.0 | טוב | 🟢 ירוק |
| 2.0 – 2.7 | גבולי | 🟠 כתום |
| < 2.0 | לא רווחי | 🔴 אדום |

**Platform ROAS** = מה ש-Meta/Google דיווחו לפי Pixel.
**True ROAS (ROAS Shopify)** = הכנסה אמיתית מ-Shopify של המוצרים המשויכים, לחלק ב-Spend.

> **כשמיפוי קיים — תאמין ל-True ROAS, לא ל-Platform ROAS.**

---

## מתי לפתוח CampaignDrawer

לחיצה על שם קמפיין ב-Campaigns table פותחת drawer מפורט. תפתח אותו:

- כשתרצה לקבל החלטה תקציבית (scale / pause / inspect).
- כשתראה Trust Chip 🟠 / 🔴 — תרצה לראות למה.
- כשתרצה לנתח Pixel vs Shopify (Reconciliation panel).
- כשתרצה לראות איזה ad-sets/מודעות נושאים את הקמפיין.

**מה לבדוק ב-Drawer לפני שינוי תקציב:**
- [ ] Trust 🟢 High?
- [ ] טווח ≥ 7 ימים?
- [ ] True ROAS תואם ל-Platform ROAS?
- [ ] Analysis Box של גרף CPM לא שלילי?
- [ ] Reconciliation בלי 5+ ימי Channels/Shopify only?

אם כל הסעיפים מתקיימים — סקייל בסדר.

---

## מתי לא לסמוך על מספר

- ❌ **טווח של פחות מ-5 ימים פעילים** — הניתוח לא יוצג כלל. אל תקבל החלטות.
- ❌ **Trust Chip 🔴 Low** — Pixel ו-Shopify לא מסכימים. תקן מעקב לפני.
- ❌ **Refunds-heavy day** — Revenue ירד יכול להיות לקוח שהחזיר, לא ביצועי קמפיין.
- ❌ **True ROAS שונה מאוד מ-Platform ROAS** — תאמין ל-Shopify.
- ❌ **Organic נראה גבוה מדי** — בדוק `orders-attribution` ידנית, מקרי classifier-failure.

---

## Checklist חירום — Troubleshooting מהיר

| בעיה | פעולה ראשונה |
|---|---|
| הדשבורד לא נטען | רענן (Cmd-Shift-R) → בדוק DevTools Network → בדוק Vercel status |
| Sync Indicator אדום | לחץ עליו לראות שגיאה → בדוק Google Sheets permissions של service account |
| נתונים חסרים להיום | בדוק "Live since" ב-Today Live → אם > שעה, הרץ `runDailyUpdateUzoshop()` ידנית ב-Apps Script |
| נתונים חסרים לאתמול | בדוק `data-daily` tab ב-Sheets → אם חסר, הרץ `backfillRangeForStores('YYYY-MM-DD', 'YYYY-MM-DD', ['<store-id>'])` |
| CampaignDrawer ריק | וודא Platform filter תואם לקמפיין (Meta/Google) → רענן |
| True ROAS = "—" | מיפוי לא קיים → פתח Drawer → "ערוך מיפוי" |
| Pixel-Shopify לא מסכימים | בדוק Pixel ב-Meta Events Manager → בדוק UTM ב-Shopify Admin → בדוק Pearson r |

---

## Backfill מהיר (אם נדרש)

**מתי:** רק אחרי תקלה ב-Apps Script או baggige באיסוף.
**לא:** אחרי תיקון פירוש (כמו Phase 5.2.2.1 — לא צריך backfill).

**איך:** Apps Script Editor → Select function → Run

```javascript
// חנות אחת בכל פעם (בטוח, מומלץ):
backfillRangeForStores('2026-05-08', '2026-05-19', ['uzoshop'])
backfillRangeForStores('2026-05-08', '2026-05-19', ['zolplus'])
backfillRangeForStores('2026-05-08', '2026-05-19', ['usmile360'])

// או כל שלוש החנויות יחד (פחות בטוח לטווחים גדולים):
backfillRange('2026-05-08', '2026-05-19')
```

**אחרי:** Cmd-Shift-R בדשבורד + בדוק שהנתונים מופיעים.

---

## הכי חשוב לזכור

1. **תקבל החלטה רק על בסיס 7+ ימים פעילים** — לא יום אחד, לא 3 ימים.
2. **אל תאמין ל-Trust Low** — תקן מעקב לפני שינוי תקציב.
3. **תמיד תצליב Platform ROAS ל-True ROAS** — Shopify הוא האמת.
4. **אל תערוך ידנית טאבים ב-Google Sheets** — Apps Script ידרוס.
5. **כל שינוי = Annotation חדש** — כדי שתזכור בעוד חודש מה עשית.

---

**גרסה:** 1.0 · **תאריך:** 2026-05-20 · **בסיס קוד:** Phase 05.2.2.1 + FIX-25

קישורים:
- מדריך מלא: [docs/ROAS-Dashboard-User-Manual.md](./ROAS-Dashboard-User-Manual.md)
- Production: https://roas-dashboard-smoky.vercel.app
