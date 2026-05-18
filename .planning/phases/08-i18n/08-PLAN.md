---
phase: 08-i18n
plan: 01
type: execute
wave: 1
depends_on: [04-component-decomposition]
files_modified:
  - dashboard-web/src/lib/strings.he.ts
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/AdsDrawer.tsx
  - dashboard-web/src/components/BillingSettings.tsx
  - dashboard-web/src/components/HeroOverview.tsx
  - dashboard-web/src/components/InsightsBoard.tsx
  - dashboard-web/src/components/Dashboard.tsx
  - dashboard-web/src/components/PerStoreCards.tsx
  - dashboard-web/src/components/KpiCards.tsx
  - dashboard-web/src/components/CommandPalette.tsx
  - dashboard-web/src/components/Filters.tsx
  - dashboard-web/src/components/TodayLive.tsx
  - dashboard-web/src/components/MonthlyTables.tsx
  - dashboard-web/src/components/DetailTable.tsx
  - dashboard-web/src/components/ProductsTable.tsx
  - dashboard-web/src/components/RoasChart.tsx
  - dashboard-web/src/components/InsightsPanel.tsx
  - dashboard-web/src/components/GoalTracker.tsx
  - dashboard-web/src/components/AnnotationsPanel.tsx
  - dashboard-web/src/components/ProductPickerModal.tsx
  - dashboard-web/src/components/SyncIndicator.tsx
  - dashboard-web/src/components/TabNav.tsx
  - dashboard-web/src/components/MetricHelp.tsx
  - dashboard-web/src/components/AiReportButton.tsx
  - dashboard-web/src/components/PnLBreakdown.tsx
  - dashboard-web/src/components/WhatsWorking.tsx
  - dashboard-web/src/lib/analytics.ts
  - dashboard-web/src/lib/insights.ts
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/lib/aiReport.ts
  - dashboard-web/src/lib/annotations.ts
  - dashboard-web/src/lib/presets.ts
  - scripts/i18n-extract.mjs
  - dashboard-web/CONTRIBUTING.md
autonomous: false
requirements: [I18N-01, I18N-02, I18N-03, I18N-04, I18N-05]

must_haves:
  truths:
    - "כל מחרוזת UI עברית בקומפוננטות מוצגת דרך `strings.he.ts` ולא כליטרל inline"
    - "המשתמש לא רואה שום שינוי visual/behavioral בדשבורד אחרי המיגרציה (אותן מחרוזות, אותם תרגומים, אותו ניסוח)"
    - "מחרוזות עם interpolation דינמי (storeName, campaignName, roas value וכו') זמינות כפונקציות (`strings.X.Y(args)`) שמחזירות string"
    - "TypeScript תופס מפתח חסר ב-compile time — אי אפשר להפנות ל-`strings.foo.bar` שלא קיים"
    - "`npm run build` עובר ללא שגיאות TS חדשות"
    - "grep `[א-ת]` על תוכן `dashboard-web/src/components/**/*.tsx` ועל קבצי הlib הרלוונטיים (insights, analytics, aiReport, attributionAnalysis, annotations, presets) מחזיר 0 התאמות בקוד פעיל (מותר רק בתוך `strings.he.ts` ובהערות במידת הצורך)"
    - "מתועד דפוס i18n ב-CONTRIBUTING.md כך שמפתח חדש יודע איפה להוסיף מחרוזות"
  artifacts:
    - path: "dashboard-web/src/lib/strings.he.ts"
      provides: "Single source-of-truth של כל מחרוזות UI בעברית, מקובץ לפי surface, עם type-safe access"
      contains: "export const strings"
      min_lines: 200
    - path: "scripts/i18n-extract.mjs"
      provides: "Codemod helper שסורק `*.tsx` ומדפיס מחרוזות עבריות + context לסקירה ידנית"
    - path: "dashboard-web/CONTRIBUTING.md"
      provides: "תיעוד של דפוס הוספת מחרוזות חדשות"
      contains: "strings.he.ts"
  key_links:
    - from: "dashboard-web/src/components/*.tsx"
      to: "dashboard-web/src/lib/strings.he.ts"
      via: "import { strings } from '@/lib/strings.he'"
      pattern: "from '@/lib/strings\\.he'"
    - from: "dashboard-web/src/lib/insights.ts"
      to: "dashboard-web/src/lib/strings.he.ts"
      via: "import + template helpers"
      pattern: "strings\\.insights\\."
    - from: "dashboard-web/src/lib/analytics.ts"
      to: "dashboard-web/src/lib/strings.he.ts"
      via: "roasLabel + classification helpers משתמשים במחרוזות מהקובץ המרכזי"
      pattern: "strings\\.(common|analytics)\\."
---

<objective>
החצנת כל מחרוזות ה-UI בעברית מתוך הקומפוננטות וקבצי ה-lib המייצרים טקסט תצוגתי, לקובץ מרכזי אחד `dashboard-web/src/lib/strings.he.ts` עם type-safe key map. זוהי הפעולה הקריטית-תחזוקה של "פיזור מחרוזות בקוד" שצוין כ-anti-pattern ב-`codebase/CONCERNS.md` תחת "מחרוזות עברית מקודדות בקוד".

Purpose: הסרת ה-anti-pattern "פיזור מחרוזות בקוד" שתועד ב-`codebase/CONCERNS.md`. הקובץ המרכזי מהווה תשתית לתמיכה עתידית באנגלית/ערבית, מאפשר שינוי ניסוח של כל מחרוזת ממקום אחד, ו-TypeScript מבטיח שמפתח חסר נופל ב-compile time במקום ב-production.

Output: קובץ `strings.he.ts` עם ~200+ מפתחות, כל הקומפוננטות וקבצי הספרייה המייצרים UI text משתמשים בו, אפס מחרוזות עבריות inline בקומפוננטות, ותיעוד דפוס ב-CONTRIBUTING.md.

Scope critical notes:
- **NO behavioral changes** — אותם strings, אותו UI; רק מועברים. אם executor מגלה ניסוח שנראה לו "טוב יותר", הוא לא משנה — מעתיק 1:1.
- **Interpolation handling** — מחרוזות כמו `` `ROAS לקמפיין ${name}` `` הופכות ל-`strings.campaigns.roasForCampaign(name)` שמחזיר string. לא קונסטנטה.
- **Comments stay** — Hebrew strings בתוך JS comments / JSDoc / module docstrings (כמו `BillingSettings.tsx:63-69` או `attributionAnalysis.ts:1-19`) נשארות במקום. הgrep gate מסנן רק שורות שאינן הערות.
- **Apps Script לא נוגעים** — `*.gs` files עם הערות בעברית נשארים כמו שהם. הphase הזה הוא frontend-only.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/codebase/CONCERNS.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/STACK.md

# Source code — components הראשיים (sample patterns first task; full migration follows component-by-component)
@dashboard-web/src/components/CampaignsTable.tsx
@dashboard-web/src/components/CampaignDrawer.tsx
@dashboard-web/src/components/AdsDrawer.tsx
@dashboard-web/src/components/BillingSettings.tsx
@dashboard-web/src/components/HeroOverview.tsx
@dashboard-web/src/components/InsightsBoard.tsx
@dashboard-web/src/components/Dashboard.tsx

# Lib files שמייצרים UI text (לא רק נתונים)
@dashboard-web/src/lib/analytics.ts
@dashboard-web/src/lib/insights.ts
@dashboard-web/src/lib/attributionAnalysis.ts
@dashboard-web/src/lib/annotations.ts
@dashboard-web/src/lib/presets.ts
@dashboard-web/src/lib/aiReport.ts

<interfaces>
<!--
תוכן strings.he.ts שייווצר ב-T-01 — בסיס שכל המשימות הבאות יורחיבו. הregistration של מפתחות חדשים תתבצע אגב כל component migration; הexecutor יוסיף namespaces חדשים לפי הצורך אבל לא יסיר namespaces קיימים.
-->

Convention from existing codebase (CONVENTIONS.md):
- `type X = { ... }` only (no `interface`)
- Named exports only (no `export default` in lib/)
- Hebrew is value, never identifier — keys תמיד באנגלית

Expected `strings.he.ts` shape:
```typescript
export const strings = {
  common: {
    refresh: 'רענן',
    loading: 'טוען...',
    empty: 'אין נתונים',
    cancel: 'ביטול',
    save: 'שמור',
    // ...
  },
  tabs: {
    home: 'בית',
    pnl: 'P&L',
    analysis: 'ניתוח',
    campaigns: 'קמפיינים',
    products: 'מוצרים',
    detail: 'פירוט',
  },
  campaigns: {
    title: 'קמפיינים',
    tableHeaderName: 'שם קמפיין',
    // dynamic helper (פונקציה, לא קונסטנטה):
    roasForCampaign: (name: string) => `ROAS לקמפיין ${name}`,
  },
  drawer: {
    attributionTitle: 'ניתוח attribution',
    reconciliationTitle: 'Meta מול Shopify — מתאם יומי',
    // ...
  },
  // נוסיף namespaces נוספים תוך כדי המיגרציה: hero, insights, billing, kpis, perStore, products, filters, todayLive, monthly, detail, annotations, goal, commandPalette, sync, metricHelp, analytics (לroasLabel + סיווגים)
} as const;

export type Strings = typeof strings;
```

Helper functions שמייצרים text דינמי (insights.ts, analytics.ts, aiReport.ts) מצופות לקבל helpers ב-strings.he.ts:
```typescript
insights: {
  revenueSpike: (scope: string) => `הכנסות חריגות גבוהות ב-${scope}`,
  revenueCrash: (scope: string) => `צניחה חריגה בהכנסות ב-${scope}`,
  zScoreReason: (z: number) => `z-score ${z.toFixed(1)} מול חציון 14 ימים. סטטיסטית חריג.`,
  // ...
}
```

Existing roasLabel return shape (`analytics.ts:8`):
```typescript
roasLabel(roas: number): { text: string; tone: 'gray'|'red'|'orange'|'green'|'blue' }
// המעבר: text יהפוך לקריאה ל-strings.analytics.roasLabel.*, tone נשאר זהה.
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task T-01: Create strings.he.ts skeleton + i18n-extract script</name>
  <files>dashboard-web/src/lib/strings.he.ts, scripts/i18n-extract.mjs</files>
  <action>
1. צור `dashboard-web/src/lib/strings.he.ts` עם השלד הבא (namespaces ריקים — תוכן מלא יתווסף ב-tasks הבאות אגב migration של כל קומפוננטה):

```typescript
/**
 * Single source-of-truth for Hebrew UI strings.
 *
 * Pattern (Phase 8):
 *   - לא להוסיף liter Hebrew strings ב-`*.tsx` / `*.ts` תחת `dashboard-web/src/{components,lib}`.
 *   - כל string חדש נכנס כאן עם key אנגלי semantic, מאורגן לפי surface (tabs / hero / campaigns / drawer / ...).
 *   - מחרוזות עם interpolation דינמי הופכות לפונקציה: `(arg: T) => string`. לעולם לא לבנות שרשור inline ב-JSX.
 *   - הערות בעברית בתוך קוד (JSDoc, module docstrings) נשארות. רק UI strings מוחצנים.
 *
 * Type safety: `Strings` exported below — שימוש ב-`strings.foo.bar` שלא קיים נופל ב-compile time.
 */

export const strings = {
  common: {},
  tabs: {},
  hero: {},
  kpis: {},
  perStore: {},
  campaigns: {},
  drawer: {},
  ads: {},
  billing: {},
  insights: {},
  products: {},
  filters: {},
  todayLive: {},
  monthly: {},
  detail: {},
  annotations: {},
  goal: {},
  commandPalette: {},
  sync: {},
  metricHelp: {},
  analytics: {},
  attribution: {},
  presets: {},
  aiReport: {},
} as const;

export type Strings = typeof strings;
```

2. צור `scripts/i18n-extract.mjs` — Node ESM script (root של monorepo, לא בתוך dashboard-web) שמקבל arg `--dir` (default: `dashboard-web/src`) ו-`--out` (default: `i18n-report.txt`), עובר רקורסיבית על `*.tsx` ו-`*.ts`, לכל שורה שמכילה `[א-ת]` מדפיס: `path:line:col → <context snippet>`. הסקריפט הוא read-only — לא משנה קבצים. דוגמת use: `node scripts/i18n-extract.mjs --dir dashboard-web/src/components > i18n-report.txt`.

הסקריפט צריך:
- לדלג על `node_modules`, `.next`, `dist`
- לסנן שורות שהן רק `*` או `//` (הערות) — אבל גם להדפיס warning column אם הן בתוך JSDoc (כדי שהexecutor יוכל לראות בלי לטעות)
- לקבל `--include-lib` flag כדי לכלול קבצי `.ts` (default: רק `.tsx`)

3. הוסף ל-`dashboard-web/package.json` (אם לא קיים): script `"i18n:scan": "node ../scripts/i18n-extract.mjs --dir src --include-lib"`. אם package.json ב-root חסר scripts section relevant, הוסף שם.

קריטריון:
- `npm run build` ב-dashboard-web עובר (האימפורט של `strings` עם namespaces ריקים תקין TS-ית).
- `npm run i18n:scan` ב-dashboard-web מדפיס דוח עם ~700-800 שורות Hebrew (זה ה-baseline שכל task יצמצם).
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -20 &&
      test -f src/lib/strings.he.ts &&
      test -f ../scripts/i18n-extract.mjs &&
      node ../scripts/i18n-extract.mjs --dir src/components --out /tmp/i18n-baseline.txt &&
      wc -l /tmp/i18n-baseline.txt
    </automated>
  </verify>
  <done>קובץ `strings.he.ts` קיים עם 23 namespaces ריקים + JSDoc הסבר. הסקריפט `scripts/i18n-extract.mjs` רץ ומפיק דוח. `npm run build` עובר.</done>
</task>

<task type="auto">
  <name>Task T-02: Migrate CampaignsTable.tsx</name>
  <files>dashboard-web/src/components/CampaignsTable.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
1. הרץ `node scripts/i18n-extract.mjs --dir dashboard-web/src/components/CampaignsTable.tsx > /tmp/campaigns-table-strings.txt` (או grep ידני אם הסקריפט מצפה לתיקייה).
2. עבור על כל מחרוזת עברית בקובץ (~74 שורות). לכל אחת:
   - אם זו מחרוזת UI (JSX text, aria-label, title, placeholder, button label, tooltip text) → הוסף ל-`strings.campaigns.*` ב-`strings.he.ts` עם key אנגלי semantic. החלף את ה-literal ב-`strings.campaigns.<key>`.
   - אם זו interpolated (כמו `` `${count} קמפיינים פעילים` ``) → הוסף helper function: `activeCampaignsCount: (n: number) => `${n} קמפיינים פעילים`` ושנה את הקריאה.
   - אם זו הערה (JSDoc, // comment) → השאר במקום, אל תיגע.
   - אם זה Hebrew בתוך data shape (e.g., `label: 'אמין'` ב-trust chip enums מ-`computeConfidence`) → הוסף ל-`strings.campaigns.trustChip.*` כי זה מוצג ב-UI.
3. ארגן את namespace `strings.campaigns` בתת-קבוצות: `tableHeaders`, `filters`, `trustChip`, `tooltips`, `emptyStates`, `actions`. שמור על type safety — אין `any`, אין string indexing.
4. וודא שאף import מ-`strings.he.ts` לא יוצר circular dep (הקובץ הוא pure constants — לא אמור).
5. Build smoke: `cd dashboard-web && npm run build`. Manual smoke (אם בקלטוף): פתח את ה-dashboard, נווט ל-tab "קמפיינים", ודא שהטבלה רנדרת זהה — אותן כותרות, אותם trust chips, אותו empty state.

קריטריונים:
- grep `[א-ת]` על `CampaignsTable.tsx` מחזיר רק שורות שהן comments / JSDoc (לא JSX / values).
- `strings.campaigns.*` מאוכלס עם ~30-50 entries חדשים.
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      grep -nE '[א-ת]' src/components/CampaignsTable.tsx | grep -v -E '^[[:space:]]*(\*|//)' | grep -v -E '^[0-9]+:[[:space:]]*\*' > /tmp/cT.txt;
      [ ! -s /tmp/cT.txt ] && echo "PASS — no Hebrew in active code" || (echo "FAIL — remaining:"; cat /tmp/cT.txt; exit 1)
    </automated>
  </verify>
  <done>CampaignsTable.tsx משתמש ב-`strings.campaigns.*` לכל UI text. Build עובר. אין Hebrew literals מחוץ להערות.</done>
</task>

<task type="auto">
  <name>Task T-03: Migrate CampaignDrawer.tsx</name>
  <files>dashboard-web/src/components/CampaignDrawer.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
זהה ל-T-02, על `CampaignDrawer.tsx` (~78 שורות Hebrew). הוסף ל-namespace `strings.drawer` (שכבר קיים) — תת-קבוצות: `attribution`, `reconciliation`, `productChannel`, `adSets`, `tabs`, `tooltips`, `actions`.

חשוב במיוחד:
- ה-`MetaShopifyReconciliation` panel מכיל מחרוזות עם הסברים על Pearson r, lag detection — חלקן עם interpolation על מספרים (`r=0.87`, `lag=2 ימים`). השתמש בpatterns של helpers: `correlationLabel: (r: number) => ...`, `lagDays: (n: number) => ...`.
- ה-`ProductChannelBreakdown` משתמש בpercentages — `'X% מההזמנות עם המוצר Y הגיעו מ-Facebook'`. helper: `productChannelPct: (pct: number, productName: string) => ...`.
- כל ה-tab labels בתוך הdrawer (attribution / reconciliation / ad-sets / product-channel) → `strings.drawer.tabs.*`.

ה-Pearson explanation text הוא ארוך (~150 chars) — שים אותו כקונסטנטה בודדת `strings.drawer.reconciliation.pearsonExplanation` כדי לשמור על קריאות.
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      grep -nE '[א-ת]' src/components/CampaignDrawer.tsx | grep -v -E '^[[:space:]]*[0-9]+:[[:space:]]*(\*|//)' > /tmp/cD.txt;
      [ ! -s /tmp/cD.txt ] && echo "PASS" || (echo "FAIL"; cat /tmp/cD.txt; exit 1)
    </automated>
  </verify>
  <done>CampaignDrawer.tsx משתמש ב-`strings.drawer.*`. כל 3 הpanels (attribution / reconciliation / product-channel) רנדרים זהים. Build עובר.</done>
</task>

<task type="auto">
  <name>Task T-04: Migrate AdsDrawer.tsx</name>
  <files>dashboard-web/src/components/AdsDrawer.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
זהה לT-02. AdsDrawer.tsx קטן יחסית (~25 שורות Hebrew). הוסף ל-namespace `strings.ads` עם: `tableHeaders`, `sortLabels`, `emptyState`, `actions`. השתמש ב-CampaignDrawer migration pattern — אם יש מחרוזת שמופיעה בשני הקבצים (e.g., "מודעה ללא שם"), הגדר אותה פעם אחת ב-`strings.common.unnamedAd` ושאל משם.

קריטיקה: שים לב למחרוזות בתוך `analyzeAttributionForAd` callsite (`AdsDrawer.tsx:378-390` per CONCERNS.md) — שם יש string outputs ל-trust labels. אם הfunction עצמה מחזירה Hebrew strings, זה נטפל ב-T-08 (lib migration). בשלב הזה רק ה-JSX literals.
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      grep -nE '[א-ת]' src/components/AdsDrawer.tsx | grep -v -E '^[[:space:]]*[0-9]+:[[:space:]]*(\*|//)' > /tmp/aD.txt;
      [ ! -s /tmp/aD.txt ] && echo "PASS" || (echo "FAIL"; cat /tmp/aD.txt; exit 1)
    </automated>
  </verify>
  <done>AdsDrawer.tsx משתמש ב-`strings.ads.*`. Build עובר.</done>
</task>

<task type="auto">
  <name>Task T-05: Migrate BillingSettings.tsx</name>
  <files>dashboard-web/src/components/BillingSettings.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
זהה לT-02. BillingSettings.tsx (~93 שורות Hebrew). הוסף ל-namespace `strings.billing` עם: `tabs` (recurring / onetime / import), `recurring` (form labels, table columns, actions), `onetime` (form labels, CSV import flow), `import` (drag-drop hints, parse error messages), `actions` (save / cancel / delete confirmations), `costSourceLabels` (the `SOURCE_LABEL` Record בשורות 78-80 — הוצא ל-strings וייבא משם), `tooltips`.

קריטי:
- ה-`SOURCE_LABEL: Record<CostSource, string>` בשורה 78 מכיל "אפליקציה דרך Shopify" — זה UI text שמופיע בטבלה. הוצא ל-`strings.billing.costSourceLabels`.
- ה-CSV parse error messages (probably inside `parseShopifyBillsCsv` callbacks) — אם הם generated במחרוזות JSX, הוצא. אם הם generated בתוך `lib/billing.ts` עצמו, סמן כ-TODO ל-T-08 (lib migration).
- JSDoc למודול (שורות 58-69) — נשאר במקום (זה comment).
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      grep -nE '[א-ת]' src/components/BillingSettings.tsx | grep -v -E '^[[:space:]]*[0-9]+:[[:space:]]*(\*|//)' > /tmp/bS.txt;
      [ ! -s /tmp/bS.txt ] && echo "PASS" || (echo "FAIL"; cat /tmp/bS.txt; exit 1)
    </automated>
  </verify>
  <done>BillingSettings.tsx משתמש ב-`strings.billing.*`. SOURCE_LABEL הוצא לstrings. שני הtabs (recurring + onetime + import) רנדרים זהים. Build עובר.</done>
</task>

<task type="auto">
  <name>Task T-06: Migrate HeroOverview.tsx + InsightsBoard.tsx</name>
  <files>dashboard-web/src/components/HeroOverview.tsx, dashboard-web/src/components/InsightsBoard.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
שני קבצים באותו task כי שניהם בtab "בית" ויש להם overlap קונספטואלי (Hero מציג summary של dashboard, InsightsBoard מציג insights derived).

HeroOverview.tsx (~29 שורות Hebrew):
- namespace `strings.hero`: `eyebrow` (טווח / ימים helper), `kpiLabels` (revenue / ROAS / spend / netProfit), `editorialSentence` helpers — אם הסנטנס נבנה מקטעים deterministic (`${verb} ${metric} ב-${period}`), פצל לhelpers בstrings.

InsightsBoard.tsx (~38 שורות Hebrew):
- namespace `strings.insights` (ה-UI side; ה-content side יטופל בT-08 ב-`lib/insights.ts`):
  - `severityLabels` — ה-`SEVERITY_META` Record בשורות 39-70 מכיל "דורש פעולה מיידית" / "אזהרות" / ... → הוצא ל-`strings.insights.severityLabels.critical/warning/...`. השאר את ה-icon/color/bg/border ב-`SEVERITY_META` (אלה non-text).
  - `sections` — section headers (קריטיים / אזהרות / ניצחונות / רעיונות / וכו')
  - `actions` — dismiss / undismiss / mute / unmute
  - `emptyStates` — "אין insights כרגע" וכו'

תיאום בין שני הקבצים:
- אם HeroOverview משתמש בsummary של insights (e.g., "3 התראות פעילות"), השתמש בכותרת מ-`strings.insights.*` ולא מ-`strings.hero.*`.
- אם יש לkpiLabels overlap עם `strings.kpis.*` שכבר קיים — אחד.

הערה: InsightsBoard מכיל `<{strings.insights.severityLabels.critical}>` בתוך JSX — type narrowing עם discriminated union (`Severity`) כבר קיים, וודא שה-record החדש שומר על אותו type.
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      grep -nE '[א-ת]' src/components/HeroOverview.tsx src/components/InsightsBoard.tsx | grep -v -E ':[[:space:]]*\*' | grep -v -E ':[[:space:]]*//' | grep -v -E ': \*' > /tmp/hI.txt;
      [ ! -s /tmp/hI.txt ] && echo "PASS" || (echo "FAIL"; cat /tmp/hI.txt; exit 1)
    </automated>
  </verify>
  <done>HeroOverview ו-InsightsBoard משתמשים ב-`strings.hero.*` / `strings.insights.*`. SEVERITY_META split: text → strings, visual → component. Build עובר.</done>
</task>

<task type="auto">
  <name>Task T-07: Migrate Dashboard.tsx + smaller components</name>
  <files>dashboard-web/src/components/Dashboard.tsx, dashboard-web/src/components/PerStoreCards.tsx, dashboard-web/src/components/KpiCards.tsx, dashboard-web/src/components/CommandPalette.tsx, dashboard-web/src/components/Filters.tsx, dashboard-web/src/components/TodayLive.tsx, dashboard-web/src/components/MonthlyTables.tsx, dashboard-web/src/components/DetailTable.tsx, dashboard-web/src/components/ProductsTable.tsx, dashboard-web/src/components/RoasChart.tsx, dashboard-web/src/components/InsightsPanel.tsx, dashboard-web/src/components/GoalTracker.tsx, dashboard-web/src/components/AnnotationsPanel.tsx, dashboard-web/src/components/ProductPickerModal.tsx, dashboard-web/src/components/SyncIndicator.tsx, dashboard-web/src/components/TabNav.tsx, dashboard-web/src/components/MetricHelp.tsx, dashboard-web/src/components/AiReportButton.tsx, dashboard-web/src/components/PnLBreakdown.tsx, dashboard-web/src/components/WhatsWorking.tsx, dashboard-web/src/lib/strings.he.ts</files>
  <action>
שכרון הזה הוא המסיבי ביותר — 20 קבצים, אבל רובם עם <15 Hebrew literals כל אחד. עבור על כל קובץ באותו pattern של T-02. רוב המחרוזות יושבות בnamespaces שכבר נוצרו במשימות קודמות; ה-task הזה בעיקר ממלא את ה-namespaces ה"קטנים":

1. **Dashboard.tsx** (~38 שורות): `strings.tabs.*` (TABS const בשורות 58-65), tab navigation labels, error messages ("שגיאה בטעינת נתונים"), refresh button (RefreshCw label).
2. **PerStoreCards.tsx** (8 שורות): `strings.perStore.*` — store status badges ("ROAS נמוך — דורש בחינה" וכו'). חלק חופפים עם `strings.analytics.roasLabel.*` שיטופל בT-08; שמור על consistency.
3. **KpiCards.tsx** (6 שורות): `strings.kpis.*` — `revenue / roas / spend / netProfit / cogs` labels.
4. **CommandPalette.tsx** (44 שורות): `strings.commandPalette.*` — search placeholder, group headers ("נווט / פעולות / תצוגה"), command labels ("מעבר ל-קמפיינים" etc.). הheaviest from this group.
5. **Filters.tsx**: `strings.filters.*` — preset labels (7 ימים / 30 ימים / ...), platform labels (Meta/Google/Both), store labels, "החל" / "אפס" buttons.
6. **TodayLive.tsx**: `strings.todayLive.*` — title, status indicators, last-updated timestamp formatter.
7. **MonthlyTables.tsx**: `strings.monthly.*` — month headers, totals row labels.
8. **DetailTable.tsx**: `strings.detail.*` — column headers, sort indicators.
9. **ProductsTable.tsx**: `strings.products.*` — column headers, filter labels, mapping action labels.
10. **RoasChart.tsx**: `strings.kpis.*` (reuse) + chart axis labels / tooltips.
11. **InsightsPanel.tsx**: extend `strings.insights.*` (different shape from InsightsBoard).
12. **GoalTracker.tsx**: `strings.goal.*` — title, "יעד חודשי", "השג / חסר", progress labels.
13. **AnnotationsPanel.tsx**: `strings.annotations.*` — kind labels (חופף עם `lib/annotations.ts` constants — תיאם בT-08), CRUD actions, modal headers.
14. **ProductPickerModal.tsx**: `strings.products.picker.*` — search placeholder, "בחר / בטל בחירה", confirm/cancel.
15. **SyncIndicator.tsx**: `strings.sync.*` — status labels (idle/syncing/ok/error), tooltip ("synced N ago" — interpolated helper).
16. **TabNav.tsx**: ייתכן שאין Hebrew (רק tab.label שמגיע מבחוץ). אם יש default labels — `strings.tabs.*`.
17. **MetricHelp.tsx**: `strings.metricHelp.*` — explanations per metric (long-form helper text).
18. **AiReportButton.tsx**: `strings.aiReport.*` — button label, loading state, success/error toasts.
19. **PnLBreakdown.tsx**: `strings.kpis.pnl.*` — line item labels (revenue / cogs / spend / netProfit / margin %).
20. **WhatsWorking.tsx**: `strings.insights.workingTitle` + section content (חופף עם InsightsBoard sections — reuse).

עבודה מומלצת: התחל בקבצים הגדולים (CommandPalette, Dashboard) ועבור לקטנים. אחרי כל 4-5 קבצים, הרץ `npm run build` כדי לתפוס אם type-error צף.

חשוב: זה הtask היחיד שעלול ל-blow context budget. אם executor מרגיש שעובר 40% context, יש לעצור, לשמור התקדמות (commit per-file), ולהמליץ ל-orchestrator לפצל לT-07a / T-07b.
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      for f in src/components/Dashboard.tsx src/components/PerStoreCards.tsx src/components/KpiCards.tsx src/components/CommandPalette.tsx src/components/Filters.tsx src/components/TodayLive.tsx src/components/MonthlyTables.tsx src/components/DetailTable.tsx src/components/ProductsTable.tsx src/components/RoasChart.tsx src/components/InsightsPanel.tsx src/components/GoalTracker.tsx src/components/AnnotationsPanel.tsx src/components/ProductPickerModal.tsx src/components/SyncIndicator.tsx src/components/MetricHelp.tsx src/components/AiReportButton.tsx src/components/PnLBreakdown.tsx src/components/WhatsWorking.tsx; do
        grep -nE '[א-ת]' "$f" 2>/dev/null | grep -v -E ':[[:space:]]*\*' | grep -v -E ':[[:space:]]*//' | grep -v -E ': \*' && echo "FAIL in $f" && exit 1;
      done;
      echo "PASS — all components clean"
    </automated>
  </verify>
  <done>כל ה-20 קבצים משתמשים ב-`strings.*`. Build עובר. אין Hebrew literals מחוץ להערות בקומפוננטות.</done>
</task>

<task type="auto">
  <name>Task T-08: Migrate lib/ files generating UI text</name>
  <files>dashboard-web/src/lib/analytics.ts, dashboard-web/src/lib/insights.ts, dashboard-web/src/lib/attributionAnalysis.ts, dashboard-web/src/lib/aiReport.ts, dashboard-web/src/lib/annotations.ts, dashboard-web/src/lib/presets.ts, dashboard-web/src/lib/strings.he.ts</files>
  <action>
זה ה-task הקריטי-טכנית ביותר כי מדובר ב-pure functions שמייצרות text. הpattern: לא לאמץ `strings` ב-lib (זה יוצר tight coupling) — במקום זאת, להפוך כל function שמחזירה Hebrew string לקבל את ה-strings החיוניים מ-strings.he.ts ב-import time.

**analytics.ts** (8 שורות Hebrew):
- `roasLabel(roas)` בשורה 8 מחזיר `{ text: 'אמין', tone: 'blue' }` וכו'. שנה ל-`text: strings.analytics.roasLabel.high` (etc.). השאר את הluk return shape זהה — רק ה-text strings מוחצנים.
- הJSDoc בעברית (`/** הערכת עלות סחורה...`) בשורות 5-7 — נשאר במקום (זה comment).

**insights.ts** (31 שורות Hebrew, רבות עם interpolation):
- כל title / detail / why ב-`buildAllInsights` מחזירים Hebrew strings עם interpolation על `scope`, `c.campaignName`, dollar amounts, z-scores. הוצא ל-helpers ב-`strings.insights.*`:
  ```ts
  // strings.he.ts
  insights: {
    titles: {
      revenueSpike: (scope: string) => `הכנסות חריגות גבוהות ב-${scope}`,
      revenueCrash: (scope: string) => `צניחה חריגה בהכנסות ב-${scope}`,
      adSpendSpike: (scope: string) => `הוצאת פרסום חריגה ב-${scope}`,
      lowRoas3Days: (scope: string) => `ROAS נמוך 3 ימים ברצף ב-${scope}`,
      lostDay: (scope: string) => `יום אבוד ב-${scope}`,
      scaleBudget: (name: string) => `הגדל תקציב ל-${name || 'קמפיין ללא שם'}`,
      pauseCampaign: (name: string) => `שקול לעצור/לשפר את ${name || 'קמפיין ללא שם'}`,
      noConversions: (name: string) => `${name || 'קמפיין'} ללא המרות`,
    },
    details: {
      revenueToday: (cad: number) => `הכנסות היום: CAD ${Math.round(cad).toLocaleString('he-IL')}`,
      spendToday: (cad: number) => `הוצאה היום: CAD ${Math.round(cad).toLocaleString('he-IL')}`,
      // ... וכן הלאה
    },
    reasons: {
      zScoreVs14d: (z: number) => `z-score ${z.toFixed(1)} מול חציון 14 ימים. סטטיסטית חריג.`,
      threeDaysLowRoas: 'שלושה ימים ברצף עם ROAS < 2.0, הירידה משמעותית מהבסיס.',
      // ...
    },
  }
  ```
- ה-import של `strings` ב-insights.ts מוסיף dep אבל הוא ok — strings.he.ts הוא pure constants, ללא side effects.

**attributionAnalysis.ts** (65 שורות Hebrew):
- ה-`AttributionTrust.label` עבור 4 רמות (high/medium/low/unknown) מחזיר Hebrew text. הוצא ל-`strings.attribution.trustLabels.*`.
- הJSDoc בעברית/אנגלית — נשאר.
- Pure function discipline: הfunction עדיין pure (no IO, no side effects) — strings.he.ts הוא pure const, אז ok.

**aiReport.ts** (89 שורות Hebrew — הכי גדול):
- האם זה client-side text או prompt template? אם prompt → Hebrew strings הן ה-system/user prompts לAI ולא UI. הוצא ל-`strings.aiReport.prompts.*` כדי לשמור consistency וtype safety, אבל החליט יחד עם המשתמש (checkpoint) האם prompts באמת UI strings שצריך i18n או שזה content. **המלצה**: כן להוציא — אם בעתיד יוסיפו אנגלית, ה-AI יקבל prompt באנגלית.

**annotations.ts** (8 שורות):
- `ANNOTATION_KIND_LABEL` Record (השם מוזכר ב-HeroOverview imports). הוצא ל-`strings.annotations.kindLabels.*`.
- `ANNOTATION_KIND_EMOJI` / `ANNOTATION_KIND_COLOR` — לא Hebrew, נשארים.

**presets.ts** (8 שורות):
- `computePresetRange` מחזיר Hebrew labels כחלק מה-DateRange? בדוק. אם כן — `strings.presets.presetLabels.*` (7 ימים / 30 ימים / החודש / וכו').

קריטריון:
- כל ה-pure functions עדיין pure (no IO, no side effects). הimport של strings ב-top-level ok כי strings הוא frozen const.
- TypeScript מבדיל בין functions שמחזירות string vs strings instances — `strings.insights.titles.revenueSpike` הוא function, צריך לקרוא לו עם args.
- אין circular import (strings.he.ts לא מייבא מ-lib).
  </action>
  <verify>
    <automated>
      cd dashboard-web && npm run build 2>&1 | tail -10 &&
      for f in src/lib/analytics.ts src/lib/insights.ts src/lib/attributionAnalysis.ts src/lib/aiReport.ts src/lib/annotations.ts src/lib/presets.ts; do
        # רק שורות שאינן comments
        grep -nE '[א-ת]' "$f" 2>/dev/null | grep -v -E ':[[:space:]]*\*' | grep -v -E ':[[:space:]]*//' | grep -v -E ': \*' > /tmp/lib-check.txt;
        if [ -s /tmp/lib-check.txt ]; then echo "FAIL in $f:"; cat /tmp/lib-check.txt; exit 1; fi;
      done;
      echo "PASS — all lib files clean"
    </automated>
  </verify>
  <done>analytics.ts, insights.ts, attributionAnalysis.ts, aiReport.ts, annotations.ts, presets.ts כולם משתמשים ב-`strings.*` ל-text generation. Pure-function discipline נשמר. Build עובר.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task T-09: Manual smoke test — אפס regression visual</name>
  <what-built>
המיגרציה של כל מחרוזות ה-UI מ-inline literals ל-`strings.he.ts` הושלמה. Build עובר. אפס Hebrew literals מחוץ להערות בקבצי `components/**` ו-`lib/{analytics,insights,attributionAnalysis,aiReport,annotations,presets}.ts`.

אבל: TypeScript לא תופס "ניסוח השתבש" — אם executor העתיק 'הכנסות' במקום 'הכנסה' זה type-safe ועדיין רגרסיה. רק עין אנושית תופסת.
  </what-built>
  <how-to-verify>
1. הרץ את הdashboard לוקלית: `cd dashboard-web && npm run dev`. פתח `http://localhost:3000`.
2. עבור על כל tab אחד-אחד וודא שהכל נראה כמו לפני המיגרציה:
   - **Home (בית):** Hero block (eyebrow / KPI labels / editorial sentence) — כל המספרים והטקסטים זהים. InsightsBoard — severity labels, section headers, insight titles/details/why — כולם בעברית תקינה ללא placeholders ריקים.
   - **P&L:** PnLBreakdown rows (revenue / cogs / spend / netProfit / margin %).
   - **ניתוח (Analysis):** RoasChart axis labels, MonthlyTables column headers.
   - **קמפיינים (Campaigns):** CampaignsTable — column headers (שם / חנות / הוצאה / ערך / ROAS / trust chip / ...), trust chip labels (אמין / מתאים / נמוך / אין נתונים) בכל 4 הרמות, empty state, filter labels.
   - לחץ על שורה בטבלת קמפיינים → **CampaignDrawer** נפתח. עבור על 3 הtabs בdrawer (Attribution / Reconciliation / Product-Channel). וודא:
     - Pearson r explanation text עדיין שם.
     - Lag detection labels ("lag 2 ימים").
     - Product channel breakdown ("X% מההזמנות של המוצר Y הגיעו מ-Facebook").
     - Ad-sets table column headers.
   - לחץ על ad-set בdrawer → **AdsDrawer** נפתח. וודא column headers + sort labels.
   - **מוצרים (Products):** ProductsTable + ProductPickerModal — חיפוש placeholder, headers, action buttons.
   - **פירוט (Detail):** DetailTable — headers + sort indicators.
   - לחץ על pill "הגדרות חיובים" → **BillingSettings** נפתח. עבור על 3 הtabs (חודשי קבוע / חיובים חד-פעמיים / Import CSV). וודא:
     - Form labels.
     - Table columns.
     - SOURCE_LABEL ("Shopify Plan" / "אפליקציה דרך Shopify" / וכו').
     - CSV drag-and-drop hint.
     - Save/cancel/delete confirmation modals.
   - **CommandPalette:** ⌘K → group headers (נווט / פעולות / תצוגה), command labels, search placeholder.
   - **Filters bar:** preset labels (7 ימים / 30 ימים / החודש / וכו'), platform labels, store filter.
   - **SyncIndicator** (ב-header): tooltip "synced N ago" עם interpolation תקין.
   - **GoalTracker** (ב-Home): title, progress labels, "השג / חסר".
   - **AnnotationsPanel:** kind labels, CRUD actions, modal headers.
3. בדוק 3 edge cases:
   - empty state ב-CampaignsTable (סנן ל-day עם 0 קמפיינים).
   - error state ב-Dashboard (disconnect network briefly, refresh).
   - insight dismissed ב-InsightsBoard (לחץ "הסתר" על insight, ודא שה-toast הופיע בעברית).
4. וודא שאין `[object Object]` או `undefined` או placeholders ריקים בשום מקום.
5. **חשוב במיוחד:** Hebrew RTL בunchanged — אם מחרוזת interpolated משולבת עם מספרים, הbidi נראה תקין (`<bdi>` wrappers מ-`format.ts` עדיין רנדרים).

resume only after כל הtabs נראו זהים לפני/אחרי. אם משהו נראה שבור — describe מה ובאיזה screen, הexecutor יתקן.
  </how-to-verify>
  <resume-signal>Type "approved" אם הכל זהה visual-wise, או describe אילו screens מציגים regression.</resume-signal>
</task>

<task type="auto">
  <name>Task T-10: Document i18n pattern + final grep gate</name>
  <files>dashboard-web/CONTRIBUTING.md, dashboard-web/src/lib/strings.he.ts</files>
  <action>
1. **תיעוד** — צור או עדכן `dashboard-web/CONTRIBUTING.md` עם סעיף "Adding UI strings":

```markdown
## Adding UI strings (i18n)

כל מחרוזת UI חייבת לחיות ב-`src/lib/strings.he.ts` ולא inline ב-JSX או בlib helpers.

### דפוס הוספה

1. **מחרוזת סטטית:** הוסף key אנגלי semantic לnamespace המתאים ב-`strings.he.ts`:
   ```ts
   campaigns: {
     newKeyName: 'הטקסט בעברית',
   }
   ```
   צרכן: `<span>{strings.campaigns.newKeyName}</span>`.

2. **מחרוזת דינמית (עם interpolation):** הוסף helper function:
   ```ts
   campaigns: {
     roasForCampaign: (name: string) => `ROAS לקמפיין ${name}`,
   }
   ```
   צרכן: `<span>{strings.campaigns.roasForCampaign(campaign.name)}</span>`.
   לעולם **לא** לבנות `` `ROAS לקמפיין ${name}` `` inline ב-JSX.

3. **Namespaces:** ארגן לפי surface — `common`, `tabs`, `hero`, `kpis`, `perStore`, `campaigns`, `drawer`, `ads`, `billing`, `insights`, `products`, `filters`, `todayLive`, `monthly`, `detail`, `annotations`, `goal`, `commandPalette`, `sync`, `metricHelp`, `analytics`, `attribution`, `presets`, `aiReport`. נסה לעבוד בתוך namespace קיים לפני שיוצרים חדש.

4. **Type safety:** ה-`Strings` type מ-`strings.he.ts` מבטיח שהפנייה למפתח שלא קיים נופלת ב-TypeScript. אין `string` indexing — תמיד dot-access.

### מה לא להוציא

- הערות (JSDoc, // comment) בעברית — נשארות במקום, הן מתעדות intent למפתח.
- שמות משתנים, ID, מפתחות localStorage — תמיד באנגלית.
- מחרוזות Apps Script (`.gs` files) — מחוץ לscope, שכבת backend.

### לפני commit

```bash
node ../scripts/i18n-extract.mjs --dir src/components --include-lib > /tmp/i18n-check.txt
# הdiff מ-baseline (הrun הקודם) צריך להיות 0 בקוד פעיל; שורות חדשות רק בstrings.he.ts או בהערות.
```
```

2. **Final grep gate** — הרץ grep-gate סופי על כל הקבצים שמופיעים ב-files_modified. צריך להיות 0 התאמות בקוד פעיל (כלומר, מסנן הערות):

```bash
COMPONENTS="dashboard-web/src/components"
LIBS="dashboard-web/src/lib"
FAIL=0
for f in "$COMPONENTS"/*.tsx "$LIBS/analytics.ts" "$LIBS/insights.ts" "$LIBS/attributionAnalysis.ts" "$LIBS/aiReport.ts" "$LIBS/annotations.ts" "$LIBS/presets.ts"; do
  # מסנן: שורות שמתחילות ב-`*`, `//`, או הן מחרוזת בתוך JSDoc (`*  טקסט`)
  HITS=$(grep -nE '[א-ת]' "$f" 2>/dev/null | grep -v -E '^[0-9]+:[[:space:]]*\*' | grep -v -E '^[0-9]+:[[:space:]]*//' | grep -v -E '^[0-9]+:[[:space:]]*\* ')
  if [ -n "$HITS" ]; then
    echo "=== HEBREW FOUND IN $f ==="
    echo "$HITS"
    FAIL=1
  fi
done
exit $FAIL
```

אם הגייט נופל — אסור לproceed. המיגרציה לא שלמה.

3. **Update strings.he.ts header comment** — עדכן את הJSDoc למעלה של הקובץ עם:
   - תיעוד של כל הnamespaces (לפחות שם + תפקיד) — readability לdiscoverability.
   - הוראה: "כל הוספת מפתח חדש דורשת רק את הnamespace + key — TypeScript תופס בכל מקום שבו צריך לעדכן."
   - link ל-CONTRIBUTING.md.

4. **README mention** — אם `dashboard-web/README.md` קיים, הוסף פיסקה אחת תחת "Project Structure" שמציינת: `src/lib/strings.he.ts — single source-of-truth for all Hebrew UI strings. See CONTRIBUTING.md.`
  </action>
  <verify>
    <automated>
      test -f dashboard-web/CONTRIBUTING.md &&
      grep -q "strings.he.ts" dashboard-web/CONTRIBUTING.md &&
      COMPONENTS="dashboard-web/src/components" &&
      LIBS="dashboard-web/src/lib" &&
      FAIL=0 &&
      for f in "$COMPONENTS"/*.tsx "$LIBS/analytics.ts" "$LIBS/insights.ts" "$LIBS/attributionAnalysis.ts" "$LIBS/aiReport.ts" "$LIBS/annotations.ts" "$LIBS/presets.ts"; do
        HITS=$(grep -nE '[א-ת]' "$f" 2>/dev/null | grep -v -E '^[0-9]+:[[:space:]]*\*' | grep -v -E '^[0-9]+:[[:space:]]*//' | grep -v -E '^[0-9]+:[[:space:]]*\* ');
        if [ -n "$HITS" ]; then echo "FAIL in $f:"; echo "$HITS"; FAIL=1; fi;
      done;
      [ "$FAIL" = "0" ] && echo "PASS — zero Hebrew in active code across all migrated files" || exit 1
    </automated>
  </verify>
  <done>CONTRIBUTING.md מתעד את הדפוס. Final grep gate עובר — 0 Hebrew literals ב-active code בכל הקבצים שעברו migration. JSDoc של strings.he.ts מתעד את כל הnamespaces.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none — UI-text refactor only) | זה refactor של מחרוזות UI; אין כניסת user input חדשה, אין endpoint חדש, אין parsing של data חדש. הthreat surface לא משתנה. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-01 | T (Tampering) | `strings.he.ts` | accept | אם תוקף משנה את הfile, הוא יכול לשנות UI text. אבל הקובץ הוא bundle-time, לא runtime — שינוי דורש redeploy. ה-attack vector שלו זהה לכל קוד אחר ב-repo. |
| T-08-02 | I (Information disclosure) | `strings.he.ts` | accept | הקובץ ארוז ב-client bundle (ככל מחרוזות UI). אין secrets בעברית — אלה תוויות. אין הצורך לסודר. |
| T-08-03 | D (DoS via prototype-pollution) | `strings.he.ts` import time | mitigate | הuse של `as const` ב-`strings` + `export type Strings = typeof strings` מבטיח שהobject קפוא ב-compile time. אין שדה דינמי שמוזן מinput. |
</threat_model>

<verification>
1. **Build gate:** `cd dashboard-web && npm run build` עובר ללא שגיאות TS חדשות אחרי כל task.
2. **Grep gate (final):** `node scripts/i18n-extract.mjs --dir dashboard-web/src --include-lib` מחזיר 0 שורות בקוד פעיל (רק בstrings.he.ts ובהערות).
3. **Visual gate (T-09 checkpoint):** המשתמש מאשר שכל הtabs ו-drawers נראים זהים visual-wise.
4. **Type-safety gate:** הוספת קריאה אקראית ל-`strings.foo.barNonExistent` נופלת ב-`tsc --noEmit` — וודא ידנית פעם אחת בסוף.
5. **Coverage gate:** ספירת keys ב-strings.he.ts ≥ 200 (per ROADMAP success criterion 1).
</verification>

<success_criteria>
- [ ] `dashboard-web/src/lib/strings.he.ts` קיים, ≥ 200 keys, מאורגן ב-~23 namespaces.
- [ ] `scripts/i18n-extract.mjs` קיים ורץ, מייצר דוח אפס שורות עבריות בקוד פעיל.
- [ ] כל 20+ ה-components ב-`dashboard-web/src/components/**/*.tsx` נטולי Hebrew literals (מאומת ב-grep gate).
- [ ] 6 קבצי lib (`analytics.ts`, `insights.ts`, `attributionAnalysis.ts`, `aiReport.ts`, `annotations.ts`, `presets.ts`) נטולי Hebrew literals.
- [ ] `npm run build` עובר.
- [ ] T-09 checkpoint: human-verified — אפס regression visual.
- [ ] `CONTRIBUTING.md` מתעד את הדפוס.
- [ ] גרסת dev של hot-reload עובדת — שינוי key ב-strings.he.ts גורם ל-UI להתעדכן (validate by changing one key during T-09 smoke).
</success_criteria>

<output>
After completion, create `.planning/phases/08-i18n/08-01-SUMMARY.md` עם:
- כמה keys סופית ב-strings.he.ts (count exact).
- breakdown לכל namespace (campaigns: 47, drawer: 38, billing: 31, ...).
- אילו edge cases דרשו patches (e.g., interpolation patterns שלא היו ברורים מראש).
- אילו lib files דרשו refactor אגנטי מעבר לפשוט "החלף literal" (insights.ts בעיקר).
- ה-baseline שהיה (כמה Hebrew literals בעוד הphase התחיל) → כמה נשארו (אמור להיות 0 בקוד פעיל).
</output>
