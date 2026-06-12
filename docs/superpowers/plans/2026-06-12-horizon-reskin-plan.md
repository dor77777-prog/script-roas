# Horizon UI Re-skin + System Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the entire dashboard (211 components, 10 tabs + operator + mobile) to the operator-approved Horizon UI language while unifying the 14 cross-cutting design debts — zero info loss, zero correctness changes, locked ROAS band system preserved, ONE deploy at the end.

**Architecture:** Horizon's exact values are injected into the EXISTING token names in `globals.css` (guards keep working); a small set of new/updated primitives (HorizonCard recipe, Widget, SegmentedControl, band single-source) carries the look; every surface is then migrated to primitives + recipes, wave by wave, against the canonical mockup `docs/superpowers/mockups/2026-06-12-horizon-reskin/home-approved.html` (exact-match rule). New semantic rules (alarm state, chart-line band color, MER bands) are implemented as pure helpers with unit tests + CI pins.

**Tech Stack:** Next.js + Tailwind + CSS custom-property tokens, Radix primitives, Recharts, vitest (node + jsdom DOM configs), Playwright visual/contrast CI gates.

**מסמכי-עוגן (לקרוא לפני כל גל):**
- Spec: `docs/superpowers/specs/2026-06-12-horizon-reskin-design.md` (כללי-העל + הערכים)
- מוקאפ קנוני: `docs/superpowers/mockups/2026-06-12-horizon-reskin/home-approved.html` (exact-match)
- מיפוי-כיסוי: `docs/superpowers/specs/2026-06-12-ui-surface-inventory.md` (211 קומפוננטות — הצ'קליסט המחייב; אסור לדלג על רכיב)
- חוב-חוצה: סעיף "חוב-עיצובי חוצה-פרוסות" במיפוי (14 הערכאות — כולן נסגרות כאן)

## תפקיד ui-ux-pro-max בתוכנית (מחייב)

| שלב | שימוש קונקרטי |
|---|---|
| כל task עם UI | לפני commit: צ'קליסט-הקדם-מסירה של ה-skill — cursor-pointer לכל קליקבילי · hover בלי layout-shift · transitions ‏150–300ms · focus-visible · אין אימוג'י-אייקונים · קונטרסט בהיר 4.5:1 · גלאס נראה בבהיר · borders נראים בשני המצבים |
| גלים 3/5/6 (גרפים) | `python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "<chart type>" --domain chart` — התאמת סוג-גרף + קווי-המלצה לפני מימוש כל chart |
| גל 2 + גל 8 | `--domain ux` על: z-index scale · loading states · touch targets · keyboard-nav — אימות מול כללי-ה-CRITICAL של ה-skill |
| גל 9 (סגירה) | ריצה מלאה של ה-Pre-Delivery Checklist של ה-skill על כל טאב, שני מצבים, כחלק משער-ה-one-deploy |

(הערה היסטורית: מנוע-ה---design-system של ה-skill שימש בתחילת הברינסטורם; הכיוון הסופי נבחר דרך Horizon, אך מאגרי-הכללים שלו — 99 כללי-UX, צ'קליסטים — הם שכבת-אכיפה קבועה בתוכנית.)

**כללי-ברזל לכל task:** ‏RTL · שני מצבים first-class · ‏AA (חוץ מחריג-הכתום המתועד) · token-only (אפס hex בקומפוננטות — הצבעים החדשים נכנסים כטוקנים) · ‏`<Money>` לכל ספרה · אפס-אובדן-מידע (STAYS/MOVES בלבד) · אין commit בלי שה-suites הרלוונטיים ירוקים · צ'קליסט-קדם-מסירה של ui-ux-pro-max בסוף כל גל (cursor-pointer, focus-visible, no-emoji-icons, reduced-motion, ‏375/768/1024/1440).

---

## מפת-קבצים (היכן גר מה)

| שכבה | קבצים |
|---|---|
| טוקנים | `dashboard-web/src/app/globals.css` (ערכי-התמות) · `dashboard-web/tailwind.config.ts` (הרחבת navy/brand/lightPrimary/shadow-3xl/rounded-20) |
| band single-source | `dashboard-web/src/lib/format/useRoasBandGradient.ts` (קיים — מתרחב: alarm + chart-line + MER) — **כל** 7 המימושים המקבילים מתנקזים אליו |
| פרימיטיבים | `src/components/ui/Card.tsx` (מתכון-Horizon) · `src/components/ui/Widget.tsx` (חדש) · `src/components/ui/SegmentedControl.tsx` (חדש — מחליף 12 מימושים) · `src/components/ui/Button.tsx` (וריאנטים) · `src/components/ui/StateBlock.tsx` (חדש — skeleton/error/empty אחידים) |
| כללים חדשים | `src/lib/roasBands.ts` (חדש — bandForRoas יחיד + alarmState($100) + bandForAvg לגרפים; pure + tested) |
| משטחים | לפי המיפוי — כל גל מפרט |

---

## Wave 0 — יסודות: טוקנים + קונפיג + מקור-band יחיד

### Task 0.1: הרחבת tailwind.config + טוקני-Horizon ב-globals.css

**Files:** Modify: `dashboard-web/tailwind.config.ts`, `dashboard-web/src/app/globals.css`
**Test:** `src/lib/__tests__/designColorGuard.test.ts` (קיים — חייב להישאר ירוק)

- [ ] **Step 1:** הוסף ל-`tailwind.config.ts` תחת `theme.extend`:
```ts
colors: {
  brand: {50:"#E9E3FF",100:"#C0B8FE",200:"#A195FD",300:"#8171FC",400:"#7551FF",500:"#422AFB",600:"#3311DB",700:"#2111A5",800:"#190793",900:"#11047A"},
  navy:  {50:"#d0dcfb",100:"#aac0fe",200:"#a3b9f8",300:"#728fea",400:"#3652ba",500:"#1b3bbb",600:"#24388a",700:"#1B254B",800:"#111c44",900:"#0b1437"},
  lightPrimary: "#F4F7FE",
},
boxShadow: { 'hz': '14px 17px 40px 4px rgba(112,144,176,0.08)' },
borderRadius: { 'hz': '20px' },
```
- [ ] **Step 2:** ב-`globals.css` החלף את ערכי-התמות (השמות נשארים!): בהיר `--canvas:#F4F7FE; --surface:#ffffff; --ink:#1B254B; --accent:#422AFB; …` · כהה `--canvas:#0b1437; --surface:#111c44; --inset:#1B254B; …` לפי טבלת-הספק (Spec §2). עדכן את `viewport themeColor` בקוד ל-token-driven (סוגר את החוב מהמיפוי).
- [ ] **Step 3:** הוסף טוקני-band חדשים (גרסת-v11 החיה): `--band-blue-grad`, `--band-orange-grad`, `--band-green-grad`, `--band-red-grad`, `--band-gray-grad`, `--band-alarm-grad: linear-gradient(135deg,#d40b14,#f81b25 48%,#ff4d55)` + `@keyframes alarmPulse`.
- [ ] **Step 4:** Run `npx vitest run src/lib/__tests__/designColorGuard.test.ts` → PASS (אם ה-ratchet מתנגד לערך — הערך נכנס ל-globals כטוקן, לא inline).
- [ ] **Step 5:** Commit `feat(reskin-w0): horizon token layer + band gradients + alarm`.

### Task 0.2: `src/lib/roasBands.ts` — מקור-אמת יחיד (TDD)

**Files:** Create: `dashboard-web/src/lib/roasBands.ts` · Test: `dashboard-web/src/lib/__tests__/roasBands.test.ts`

- [ ] **Step 1 (failing test):**
```ts
import { describe, it, expect } from 'vitest';
import { bandForRoas, alarmState, ALARM_SPEND_THRESHOLD_CAD } from '@/lib/roasBands';
describe('roasBands single source', () => {
  it('locked thresholds', () => {
    expect(bandForRoas(1.99)).toBe('red');
    expect(bandForRoas(2.0)).toBe('orange');
    expect(bandForRoas(2.69)).toBe('orange');
    expect(bandForRoas(2.7)).toBe('green');
    expect(bandForRoas(3.0)).toBe('green');   // 3.00 inclusive = at target
    expect(bandForRoas(3.01)).toBe('blue');
  });
  it('gray when no spend', () => { expect(bandForRoas(0, { spend: 0 })).toBe('gray'); });
  it('alarm ONLY above $100 spend with zero sales', () => {
    expect(ALARM_SPEND_THRESHOLD_CAD).toBe(100);
    expect(alarmState({ spend: 148, revenue: 0 })).toBe(true);
    expect(alarmState({ spend: 99,  revenue: 0 })).toBe(false);  // תחילת-יום רגילה
    expect(alarmState({ spend: 148, revenue: 12 })).toBe(false);
  });
});
```
- [ ] **Step 2:** Run → FAIL (module not found).
- [ ] **Step 3:** Implement:
```ts
export type RoasBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';
export const ALARM_SPEND_THRESHOLD_CAD = 100;
export function bandForRoas(roas: number, opts?: { spend?: number }): RoasBand {
  if (opts && opts.spend === 0) return 'gray';
  if (roas > 3.0) return 'blue';
  if (roas >= 2.7) return 'green';
  if (roas >= 2.0) return 'orange';
  return 'red';
}
export function alarmState(i: { spend: number; revenue: number }): boolean {
  return i.spend > ALARM_SPEND_THRESHOLD_CAD && i.revenue === 0;
}
```
- [ ] **Step 4:** Run → PASS. **Step 5:** רענון `useRoasBandGradient.ts` לצרוך `bandForRoas` (ולא סולם פנימי). **Step 6:** Commit.

### Task 0.3: ניקוז 7 מימושי-ה-band המקבילים

**Files:** Modify (לפי המיפוי, חוב-חוצה #1): `RoasTargetChart.tsx` (bandClassForRoas) · `home/StoreCompareGrid` (PILL_TONE_CLASS) · `campaigns roasCell` (ROAS_TONE_BG) · `ChannelTruthPanel` + 3 הנותרים שהמיפוי מונה. כל אחד עובר ל-`bandForRoas`/`useRoasBandGradient`.
- [ ] לכל קובץ: החלף את המיפוי המקומי בקריאה למקור-היחיד → הרץ את בדיקות-הקובץ → מחק את המיפוי המת. בדיקת-סיום: `grep -rn "ROAS_TONE\|PILL_TONE\|bandClassForRoas" src/` ⇒ 0 תוצאות מחוץ ל-roasBands/useRoasBandGradient.
- [ ] Commit per-file.

---

## Wave 1 — פרימיטיבים

### Task 1.1: Card recipe (Horizon)
**Files:** Modify `src/components/ui/Card.tsx` · Test: existing Card DOM tests + visual.
- [ ] בסיס חדש: `rounded-hz bg-surface shadow-hz dark:shadow-none` (דרך הטוקנים; ‏bg-clip-border). וריאנטים קיימים נשמרים. הרץ את כל ה-DOM suites של צרכני-Card.

### Task 1.2: Widget primitive (חדש)
**Files:** Create `src/components/ui/Widget.tsx` · Test: `src/components/ui/__tests__/widget.dom.test.tsx`
- [ ] מתכון-Horizon המדויק (מהמוקאפ): card flex-row · עיגול-אייקון `bg-lightPrimary dark:bg-navy-700` (או גוון-band כשמוזרק) · props: `{icon, title, value, sub, band?}` — כש-`band` קיים: הערך והאייקון בצבע-הרצועה + תג (כלל-MER). בדיקות: רנדור בסיסי, band=green ⇒ class ירוק על הערך, ערך עובר דרך `<Money>`.

### Task 1.3: SegmentedControl primitive (חדש — מחליף 12)
**Files:** Create `src/components/ui/SegmentedControl.tsx` · Test: `segmentedControl.dom.test.tsx`
- [ ] מתכון: מסילה `bg-inset rounded-full p-1` · אקטיב `bg-brand-500 text-white rounded-full` · keyboard: חצים+Home/End, ‏role=tablist/radiogroup לפי prop · RTL-aware. בדיקות: בחירה, מקלדת, aria.
- [ ] מיגרציית 12 הצרכנים (הרשימה במיפוי, חוב #4): Filters quick-ranges + compare-basis, Products segmented, customers radios, וכו' — אחד-אחד עם בדיקות-הקובץ.

### Task 1.4: StateBlock primitive (skeleton/error/empty אחידים)
**Files:** Create `src/components/ui/StateBlock.tsx` · Test: `stateBlock.dom.test.tsx`
- [ ] שלושה מצבים: `skeleton` (בצורת-התוכן, prop rows/shape) · `error` (role=alert + retry) · `empty` (אייקון+הסבר+CTA). סוגר חוב #7 — כל הטאבים יצרכו אותו בגלי-המשטחים.

### Task 1.5: type-ramp + אייקונים
- [ ] טוקני-טיפוגרפיה ב-globals (סולם-Horizon על Heebo/Rubik; מינימום 10.5px ל-labels — אין יותר 8-9px, חוב #5). ‏grep-ban בבדיקה: `text-\[8px\]|text-\[9px\]` ⇒ 0.
- [ ] החלפת אימוג'י-אייקונים ב-lucide בכל משטחי-הדאטה (הרשימה בחוב #12) — 🥇→Trophy, 🔗→Link, 💡→Lightbulb וכו'. ‏grep-ban על האימוג'ים בקבצי-tsx.

---

## Wave 2 — מעטפת: sidebar, navbar, פילטרים

(מתכונים מדויקים מהמוקאפ; קבצים: `Sidebar.tsx`, ‏header strip ב-`Dashboard.tsx` — מחולץ לקומפוננטה `TopStrip.tsx`, ‏`Filters.tsx`, ‏`CommandPalette.tsx`, ‏login)
- [ ] Sidebar: לבן/navy-800, פס-brand אנכי לאקטיב, קבוצות פרסום/כספים, כרטיס-יעד ירוק בתחתית; מובייל-drawer עובר ל-Radix Sheet (חוב #2 + סוגר את ה-incident-class). ‏⌘\ collision fix: FocusMode עובר ל-`⌘.` (Task נפרד + בדיקת-קיצורים).
- [ ] TopStrip: **לא sticky** (הכרעה) — position רגיל; pills במתכון; ‏CommandPalette נטען גם בזמן loading (חוב).
- [ ] Filters: ‏SegmentedControl החדש; תאריך/חנויות/תצוגות-שמורות כ-pills; ‏compare-basis row.
- [ ] בדיקות: ‏DOM-suites קיימים + ‏`sidebarRadixSheet.dom.test.tsx` חדש (role=dialog+data-state — הדפוס מה-incident).

## Wave 3 — הבית (מול המוקאפ הקנוני, exact-match)

רכיבי הבית מהמיפוי (29) — כל אחד task: Widget-row (6 ווידג'טים; ‏MER band-rule) · annotations strip + "הוסף" · store band cards (גרדיאנטים-חיים + kpi-scrim + CPM-פר-פלטפורמה + alarm-state-hookup ל-`alarmState()`) · RoasTargetChart (קו-לפי-`bandForRoas(avg)` + סיכות-אירועים + tooltip) · StoreCompareGrid · NC-by-platform card (חדש כ-surface — הנתונים קיימים ב-cohort/NC צנרת; ‏STAYS+NEW-layout) · GoalTracker · InsightsBoard/ActionList · ActivityFeed + SourceBadge · StoreDetailModal (לפי מוקאפ-הפתוח) · freshness-fade hookup.
- [ ] כל task: מתכון מהמוקאפ → מימוש → בדיקות-DOM של הרכיב → צילום-אימות מול המוקאפ (chrome-devtools, שני המצבים).
- [ ] בדיקות-כלל חדשות: `merBandWidget.dom.test.tsx` (2.79⇒ירוק; 2.3⇒כתום) · `chartLineBand.test.ts` (avg⇒stroke token) · `storeCardAlarm.dom.test.tsx` ($148/0⇒alarm; $99/0⇒לא).

## Wave 4 — קמפיינים (30 רכיבים מהמיפוי)

CampaignsTable (כותרות+מיון+תפריט-עמודות+שורת-סיכום+health+trust-tooltips) · CampaignsTableRow · המודאל המרכזי + 6 תתי-הטאבים (כל פאנל מהמיפוי) · AdsDrawer+AdSetTable · ProductPickerModal · CPM-chart המשוכפל מתאחד לקומפוננטה אחת (חוב #6) · sparkline אחד (חוב #6).

## Wave 5 — לקוחות + תשלומים (21)

CustomerValueTab (קוהורט-heatmap בערכי-Horizon, ‏LTV/nCAC chart בכלל-קו-band? לא — קו-LTV נשאר ירוק-סמנטי; רק גרפי-ROAS מצייתים לכלל) · PaymentMethodsTab (share-bars; ‏PayPal יורד מטוקן-Meta — חוב #9).

## Wave 6 — מגמות/ארכיון/P&L/מוצרים (35)

PnLBreakdown (קסקדה במתכון) · MonthlyTables · ProductCentricView (type-ramp! היה הצפוף ביותר) · Trends charts (כלל-קו-band על גרפי-ROAS) · BillingSettings/COGS/salary sheets.

## Wave 7 — Operator (33)

כל הפאנלים במתכוני-Horizon; ‏Button-variant bypass מתוקן (חוב #13) — וריאנטים סמנטיים חדשים ל-Button (success/danger/warning) במקום className-repaint.

## Wave 8 — מובייל + מצבים + נגישות

קרוסלה/sticky-ROAS/מגירת-מובייל במתכונים · StateBlock בכל 10 הטאבים (סקלטון-בצורת-הטאב!) · סריקת-קונטרסט שני-המצבים · צ'קליסט-ui-ux-pro-max מלא · reduced-motion על alarmPulse/count-up.

## Wave 9 — סגירה הרמטית + One-Deploy

- [ ] בדיקות-CI חדשות: alarm-threshold pin · chart-band pin · MER-band pin · grep-bans (8px, אימוג'ים, band-forks, native-title) · Playwright visual snapshots regen שני-מצבים · axe.
- [ ] ‏UM (גרסה חדשה + צ'אנגלוג מלא) + ‏ARCHITECTURE (סעיף re-skin) — שערי-קדם-push.
- [ ] אימות-מלא לוקאלי: ‏tsc · lint · node · DOM · visual · כל טאב בשני מצבים מול המוקאפ.
- [ ] ‏ONE `git push origin main` (כלל no-drip-deploy) → אימות-פרוד חי (operator walkthrough).

---

## Self-Review (בוצע)
1. **כיסוי-spec:** כל סעיף ב-spec ממופה לגל (טוקנים→W0, פרימיטיבים→W1, מעטפת→W2, בית+כללים-חדשים→W3, המשטחים→W4-7, מובייל/מצבים→W8, הרמטיות→W9). ✓
2. **placeholders:** אין TBD; גלי 4-7 מפנים לרשימות-הרכיבים המלאות במיפוי (מסמך מחייב קיים) עם המתכונים מהמוקאפ. ✓
3. **עקביות-טיפוסים:** `bandForRoas`/`alarmState`/`ALARM_SPEND_THRESHOLD_CAD` עקביים בכל הגלים. ✓
