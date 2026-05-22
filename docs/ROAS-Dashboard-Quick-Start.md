# ROAS Dashboard — Quick Start (גרסת כיס)

> מסמך 1-2 עמודים למפעיל. למדריך מלא: `docs/ROAS-Dashboard-User-Manual.md`.

---

## מה אתה צריך לבדוק בכל יום (5 דקות)

1. **Sync Indicator (פינה ימנית עליונה)** — חייב להיות 🟢 ירוק. אם לא, כל מה שאחריו לא רלוונטי.
2. **בית tab → היום עד לרגע זה** — האם יש חנות עם Spend אבל 0 Revenue? אם כן, תחקור.
3. **בית tab → Hero KPI strip** — ROAS chip 🟢 או 🔵 = טוב. 🟠 = גבולי. 🔴 = בעייתי.
4. **Campaigns tab → Top-5** — אילו קמפיינים יש להם ציון D/F? אל תקבל החלטה לפני שתבדוק.

---

## איך לקרוא ROAS

| ROAS | פירוש | תווית |
|---|---|---|
| ≥ 3.0 | מעולה | 🔵 כחול |
| 2.7 – 3.0 | טוב | 🟢 ירוק |
| 2.0 – 2.7 | גבולי | 🟠 כתום |
| < 2.0 | לא רווחי | 🔴 אדום |

**Platform ROAS** = מה ש-Meta/Google/TikTok דיווחו לפי Pixel.
**ROAS Shopify** = הכנסה אמיתית מ-Shopify של המוצרים הממופים, לחלק ב-Spend.

> **כשמיפוי קיים — תאמין ל-ROAS Shopify, לא ל-Platform ROAS.**

---

## ציון הקמפיין (Campaign Health Score)

עמודת "ציון" בטבלת הקמפיינים נותנת אות (A/B/C/D/F) או ⏳ ("מוקדם מדי"):

| אות | מה לעשות |
|---|---|
| 🟢 **A/B** + פער Pixel↔Shopify < 15% | **לסקייל** (+20-40% תקציב) |
| 🔵 **B** + מומנטום מאיץ | **לסקייל בזהירות** (+10-20%) |
| 🟠 **C** | **לעקוב**, לחץ על הציון לראות פירוט הרכיבים |
| 🔴 **D/F** + רווחיות נמוכה | **לעצור / לרענן קריאייטיב** |
| 🔴 **D/F** + רק attribution clarity חלשה | **לתקן UTMs**, לא לעצור |
| ⏳ **מוקדם מדי** | אל תקבל החלטה, חכה לעוד נתונים |

---

## מתי לפתוח CampaignDrawer

לחיצה על שם קמפיין ב-Campaigns table פותחת drawer מפורט. תפתח אותו:

- כשתרצה לקבל החלטה תקציבית (scale / pause / inspect).
- כשתראה ציון C/D/F — תרצה לראות למה.
- כשתרצה לנתח Pixel vs Shopify (Reconciliation panel).
- כשתרצה לראות איזה ad-sets/מודעות נושאים את הקמפיין.

**מה לבדוק ב-Drawer לפני שינוי תקציב:**
- [ ] ציון בריאות A או B?
- [ ] טווח ≥ 7 ימים?
- [ ] ROAS Shopify תואם ל-Platform ROAS (פער < 15%)?
- [ ] Analysis Box של גרף CPM לא שלילי?
- [ ] Reconciliation בלי 5+ ימי Channels/Shopify only?

אם כל הסעיפים מתקיימים — סקייל בסדר.

---

## מתי לא לסמוך על מספר

- ❌ **טווח של פחות מ-5 ימים פעילים** — הניתוח לא יוצג כלל. אל תקבל החלטות.
- ❌ **ציון D/F בגלל "attribution clarity" בלבד** — Pixel ו-Shopify לא מסכימים. תקן UTMs לפני.
- ❌ **Refunds-heavy day** — Revenue ירד יכול להיות לקוח שהחזיר, לא ביצועי קמפיין.
- ❌ **ROAS Shopify שונה מאוד מ-Platform ROAS** — תאמין ל-Shopify.
- ❌ **Organic נראה גבוה מדי** — ייתכן ש-UTMs נשברו ו-traffic של Meta/Google מסווג כ-Organic.

---

## Checklist חירום — Troubleshooting מהיר

| בעיה | פעולה ראשונה |
|---|---|
| הדשבורד לא נטען | רענן (Cmd-Shift-R) |
| Sync Indicator אדום | לחץ עליו לראות שגיאה — דווח למפתח אם נמשך |
| נתונים חסרים להיום | בדוק "Live since" ב-Today Live → אם > שעה, לחץ "רענן הכל" |
| נתונים חסרים לאתמול | `/operator > Backfill טווח תאריכים` → בחר את היום החסר + החנות → הפעל |
| CampaignDrawer ריק | וודא Platform filter תואם לקמפיין (Meta/Google/TikTok) → רענן |
| ROAS Shopify = "—" | מיפוי לא קיים → פתח Drawer → "ערוך מיפוי" |
| Pixel-Shopify לא מסכימים | בדוק Pixel ב-Meta Events Manager → בדוק UTM ב-Shopify Admin |

---

## Backfill מהיר

עבור ל-`/operator` (אייקון ⚙️ בכותרת) → "Backfill טווח תאריכים" → בחר טווח + חנויות → "הפעל Backfill" → עקוב ב-"ריצות אחרונות" עד Completed.

**מתי:** רק אם זיהית פערים בנתונים היסטוריים. אל תרוץ "ליתר ביטחון".

---

## הכי חשוב לזכור

1. **תקבל החלטה רק על בסיס 7+ ימים פעילים** — לא יום אחד, לא 3 ימים.
2. **תקן UTMs לפני שמכבים** — ציון נמוך בגלל attribution clarity דורש תיקון, לא עצירה.
3. **תמיד תצליב Platform ROAS ל-ROAS Shopify** — Shopify הוא האמת.
4. **כל שינוי = Annotation חדש** — כדי שתזכור בעוד חודש מה עשית.
5. **דווחי WhatsApp 12:00 / 18:00 / 00:10** — אם הם לא הגיעו, בדוק `/operator > ריצות אחרונות`.

---

**גרסה:** 2.0 · **תאריך:** 2026-05-22

קישורים:
- מדריך משתמש מלא: [docs/ROAS-Dashboard-User-Manual.md](./ROAS-Dashboard-User-Manual.md)
- Architecture (טכני, לא למפעיל): [docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- Production: https://roas-dashboard-smoky.vercel.app
- Operator console: https://roas-dashboard-smoky.vercel.app/operator
