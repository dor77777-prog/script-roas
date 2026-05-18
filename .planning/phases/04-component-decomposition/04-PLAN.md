---
phase: 04-component-decomposition
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/CampaignsTableRow.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/AttributionAnalysisPanel.tsx
  - dashboard-web/src/components/MetaShopifyReconciliation.tsx
  - dashboard-web/src/components/ProductChannelBreakdown.tsx
  - dashboard-web/src/components/AdSetTable.tsx
  - dashboard-web/src/components/BillingSettings.tsx
  - dashboard-web/src/components/BillingCsvImport.tsx
  - dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts
  - dashboard-web/src/lib/hooks/useCampaignAttribution.ts
  - dashboard-web/src/lib/hooks/useBillingRecurring.ts
  - dashboard-web/src/lib/hooks/useBillingOneTime.ts
autonomous: true
requirements:
  - PH4-CT-A
  - PH4-CT-B
  - PH4-CT-C
  - PH4-CD-D
  - PH4-CD-E
  - PH4-CD-F
  - PH4-CD-G
  - PH4-BS-H
  - PH4-BS-I
  - PH4-BS-J

must_haves:
  truths:
    - "CampaignsTable.tsx is ≤500 lines after refactor"
    - "CampaignDrawer.tsx is ≤500 lines after refactor"
    - "BillingSettings.tsx is ≤500 lines after refactor"
    - "trueRevenueByKey memo logic + dependencies are byte-identical to current behavior (IN5-01 invariant preserved)"
    - "attributionByAdSet memo + dailyMetaByAdSet memo + analyzeAttribution call still feed every row + every panel"
    - "Drawer's 3 panels (attribution / channel-breakdown / reconciliation) render in the same DOM order as before"
    - "AdSet table sort + drill-into-ads + per-ad-set ROAS Shopify column behavior is unchanged"
    - "BillingSettings 3 tabs (recurring / onetime / import) all render + CSV import lands rows into the correct buckets"
    - "Trust chip in CampaignsTable still renders all 4 levels (high/medium/low/unknown) + fallback"
    - "`npm run build` passes after every single task"
  artifacts:
    - path: "dashboard-web/src/components/CampaignsTable.tsx"
      provides: "Orchestration shell — toolbar / summary / table head + tbody.map → <CampaignsTableRow />; drawer wiring"
      max_lines: 500
    - path: "dashboard-web/src/components/CampaignsTableRow.tsx"
      provides: "Single row render — receives Aggregated + computed bits, owns all <td> cells incl. ROAS Shopify chip"
      exports: ["CampaignsTableRow"]
    - path: "dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts"
      provides: "Hook — extracts trueRevenueByKey useMemo (lines 552-682) verbatim, returns Map<string, TrueRevenueInfo>"
      exports: ["useCampaignTrueRevenue", "TrueRevenueInfo", "ConfidenceLevel"]
    - path: "dashboard-web/src/lib/hooks/useCampaignAttribution.ts"
      provides: "Hook — extracts analyzeAttribution Map memo, returns Map<key, AttributionAnalysis | null>"
      exports: ["useCampaignAttribution"]
    - path: "dashboard-web/src/components/CampaignDrawer.tsx"
      provides: "Drawer shell — header, KPI strip, daily chart, mapped-products section, drill stack + ad-sets table wiring"
      max_lines: 500
    - path: "dashboard-web/src/components/AttributionAnalysisPanel.tsx"
      provides: "Deterministic attribution callout — trust verdict, det/meta ROAS, ROAS interval, recommendation"
      exports: ["AttributionAnalysisPanel"]
    - path: "dashboard-web/src/components/MetaShopifyReconciliation.tsx"
      provides: "Pearson r + lag detection + per-day reconciliation table + line chart"
      exports: ["MetaShopifyReconciliation", "pearson", "pearsonWithLag"]
    - path: "dashboard-web/src/components/ProductChannelBreakdown.tsx"
      provides: "Phase-1 channel breakdown — 4-segment bar + recommendation chips"
      exports: ["ProductChannelBreakdown"]
    - path: "dashboard-web/src/components/AdSetTable.tsx"
      provides: "Ad-sets table inside drawer — sort headers + per-row optimization toggle + drill-into-ads + per-ad-set ROAS Shopify chip"
      exports: ["AdSetTable"]
    - path: "dashboard-web/src/components/BillingSettings.tsx"
      provides: "Modal shell + tab routing (recurring / onetime / import) + Shopify-plan auto-detect fetch"
      max_lines: 500
    - path: "dashboard-web/src/lib/hooks/useBillingRecurring.ts"
      provides: "Hook — recurring state + persistRecurring + totalMonthly memo + read/write/event-listen lifecycle"
      exports: ["useBillingRecurring"]
    - path: "dashboard-web/src/lib/hooks/useBillingOneTime.ts"
      provides: "Hook — onetime state + persistOneTime + read/write/event-listen lifecycle"
      exports: ["useBillingOneTime"]
    - path: "dashboard-web/src/components/BillingCsvImport.tsx"
      provides: "CSV import surface — parse + preview + per-row override + confirm"
      exports: ["BillingCsvImport"]
  key_links:
    - from: "dashboard-web/src/components/CampaignsTable.tsx"
      to: "dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts"
      via: "useCampaignTrueRevenue({mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange}) → Map"
      pattern: "import.*useCampaignTrueRevenue"
    - from: "dashboard-web/src/components/CampaignsTable.tsx"
      to: "dashboard-web/src/components/CampaignsTableRow.tsx"
      via: "{display.map(a => <CampaignsTableRow .../>)}"
      pattern: "<CampaignsTableRow"
    - from: "dashboard-web/src/components/CampaignDrawer.tsx"
      to: "dashboard-web/src/components/AdSetTable.tsx"
      via: "<AdSetTable adSets={sortedAdSets} attributionByAdSet={...} optimized={...} onDrillAds={setAdDrillSet} />"
      pattern: "<AdSetTable"
    - from: "dashboard-web/src/components/CampaignDrawer.tsx"
      to: "dashboard-web/src/components/MetaShopifyReconciliation.tsx"
      via: "<MetaShopifyReconciliation reconciliation={reconciliation} />"
      pattern: "<MetaShopifyReconciliation"
    - from: "dashboard-web/src/components/BillingSettings.tsx"
      to: "dashboard-web/src/lib/hooks/useBillingRecurring.ts"
      via: "const {recurring, persist} = useBillingRecurring()"
      pattern: "useBillingRecurring"
---

<objective>
פירוק 3 הקומפוננטות הגדולות (CampaignsTable 1735, CampaignDrawer 1443, BillingSettings 1328) לקבצים מטרתיים של ≤500 שורות, ע"י הוצאת hooks ו-sub-components. המטרה היא **organization בלבד** — אסור שום שינוי התנהגותי. כל task הוא רפקטור מכאני: לקחת בלוק קוד מהקובץ המקור, להעביר לקובץ חדש, לתקן imports.

**Purpose:** הקטנת cognitive load (Round 5 הבחין שב-`CampaignsTable.tsx` בלבד יש 4 useMemo גדולים + 8 functions שלוקחות 1700 שורות), ופתיחת הדלת לטסטים cellular לכל hook בנפרד (Phase 2 כבר התקין Vitest).

**Output:**
- 3 קבצי orchestration מצומצמים (≤500 שורות כל אחד)
- 4 hooks חדשים ב-`dashboard-web/src/lib/hooks/`
- 5 sub-components חדשים ב-`dashboard-web/src/components/`
- `npm run build` passing אחרי כל task
- `npm run test` passing אחרי כל task (Phase 2 הוסיף את ה-suite)
- אפס regression visual / functional ב-3 הטאבים

**Critical invariant:** ה-Round 5 IN5-01 fix (caching של analyzeAttribution במפה אחת ב-useMemo במקום קריאה inside `.map(...)` בכל render) חייב להישמר. כשמעבירים את trueRevenueByKey וה-attributionByAdSet ל-hooks — הDependencies של ה-useMemo נשארות מילה במילה.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/codebase/CONCERNS.md
@.planning/codebase/STRUCTURE.md

# Source files being refactored (these ARE the inputs — read first, copy exact ranges):
@dashboard-web/src/components/CampaignsTable.tsx
@dashboard-web/src/components/CampaignDrawer.tsx
@dashboard-web/src/components/BillingSettings.tsx

# Phase 2 deliverables (tests that will catch regressions):
# - dashboard-web/src/lib/__tests__/attributionAnalysis.test.ts (analyzeAttribution + analyzeAttributionForAdSet + analyzeProductChannel)
# - npm run test → Vitest

<interfaces>
<!-- Key exports the extracted hooks/components consume. Extracted from the codebase. -->

From dashboard-web/src/lib/attributionAnalysis.ts:
```typescript
export type AttributionAnalysis = {
  deterministicRevenue: number;
  modeledRevenue: number;
  totalRevenue: number;
  trust: { level: 'high' | 'medium' | 'low' | 'unknown'; score: number; reasons: string[] };
  // ... bayesian CI, window stability, outlier detection
};
export function analyzeAttribution(
  campaign: { campaignName: string; campaignId: string; storeId: string; platform: string; metaClaim: number; spend: number },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  dailyMeta: Array<{ date: string; value: number }>,
): AttributionAnalysis | null;
export function analyzeAttributionForAdSet(/* same shape, ad-set scoped */): AttributionAnalysis | null;
export function analyzeProductChannel(args: { /* ... */ }): ProductChannelBreakdown | null;
```

From dashboard-web/src/lib/campaignProductMap.ts:
```typescript
export type ProductMap = Record<string, string[]>;
export function campaignKey(storeId: string, campaignId: string): string;
export function allocateProductRevenue(args: {
  storeId: string;
  map: ProductMap;
  productRevenue: Array<{ productId: string; netRevenueCad: number; units: number }>;
  campaignSpend: Map<string, number>;
}): Map<string, { revenue: number; units: number }>;
```

From dashboard-web/src/components/CampaignsTable.tsx (current local types — extract into the hook file or a shared types file):
```typescript
type TrueRevenueInfo = {
  trueRevenue: number;
  trueUnits: number;
  metaClaim: number;
  spend: number;
  mappedCount: number;
  sharedCampaigns: number;
  confidence: ConfidenceLevel;
  attribution: AttributionAnalysis | null;
};
type ConfidenceLevel = {
  level: 'high' | 'medium' | 'low';
  label: string;
  reasons: string[];
};
```

From dashboard-web/src/lib/billing.ts (already exists):
```typescript
export type RecurringCost = { id; store; name; source; monthlyCAD; active; notes? };
export type OneTimeCost = { id; date; store; description; source; amountCAD; notes? };
export type CostSource = 'shopify-plan' | 'external-app' | 'other';
export function readRecurring(): RecurringCost[];
export function writeRecurring(rows: RecurringCost[]): void;
export function readOneTime(): OneTimeCost[];
export function writeOneTime(rows: OneTimeCost[]): void;
// CHANGE_EVENTS — 'roas-billing-changed' (recurring) + 'roas-billing-onetime-changed'
```
</interfaces>
</context>

<process>
**עקרונות עליונים — חוצים את כל ה-tasks:**

1. **No behavior change.** כל task הוא move-and-rename. ה-JSX, ה-deps של useMemo, ה-event-listener registration, וה-order של תקציר ה-effects — כולם נשארים byte-identical.
2. **Build + test בין כל שני tasks.** אם build נכשל, *לעצור* ולתקן לפני המעבר ל-task הבא. אסור לחסום את הקבצים אחד על השני.
3. **Single direction extraction.** הקובץ המקור (Campaigns/Drawer/Billing) הוא ה-consumer; הקובץ החדש הוא ה-producer. אסור שה-hook ייבא חזרה מהקובץ ההורה.
4. **שמירת ה-IN5-01 invariant.** `analyzeAttribution` ו-`analyzeAttributionForAdSet` נקראים *רק* inside useMemo, *אף פעם לא* inside `.map(...)` של ה-render. ההזזה ל-hook לא משנה את זה.
5. **לא לגעת ב-trust-chip logic.** ה-`computeConfidence` (CampaignsTable שורות 100-176) נשאר בקובץ המקור או עובר עם ה-hook — *לא* משוכפל.
6. **חתימת ה-hook שמרנית.** כל ה-state ש-CampaignsTable מנהלת (mode/data/productsResp/ordersAttrResp/productMap/aggregated/localRange) נכנס לפרמטרים של ה-hook. אסור שה-hook יעשה fetch בעצמו.

**Order matters:** הקבצים ה-hook-ים (T-A, T-B, T-H, T-I) חייבים להיווצר *לפני* התלויים בהם (T-C, T-J). הגודל של ה-host file יקטן רק אחרי שכל ה-tasks של המארח הסתיימו.
</process>

<tasks>

<task type="auto">
  <name>Task 1 (T-A): Extract useCampaignTrueRevenue hook</name>
  <files>dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts, dashboard-web/src/components/CampaignsTable.tsx</files>
  <action>
    צור `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` והעבר אליו את ה-`trueRevenueByKey` useMemo (שורות 552-682 של `CampaignsTable.tsx` הנוכחי) כפי שהוא — כולל כל ארבעת השלבים (campaignSpend, productsByStore, allocator, build-info-map), כולל ה-dailyMeta IIFE, כולל קריאת `analyzeAttribution`, וכולל ה-`computeConfidence` call.

    **חתימת ה-hook:**
    ```typescript
    export function useCampaignTrueRevenue(args: {
      mode: 'campaign' | 'adset';
      data: { rows: CampaignRow[] } | undefined;
      productsResp: ProductsResponse | undefined;
      ordersAttrResp: OrdersAttributionResponse | undefined;
      productMap: ProductMap;
      aggregated: Aggregated[];
      localRange: DateRange;
    }): Map<string, TrueRevenueInfo>;
    ```

    גם להעביר ל-hook file את ה-types `TrueRevenueInfo` ו-`ConfidenceLevel` (שורות 56-87 של CampaignsTable) ואת ה-function `computeConfidence` (שורות 100-176). גם `Aggregated` type אם הוא מתבסס על local types — אבל סביר שיותר מסודר להעביר אותו ל-`@/lib/types` או להשאיר ב-CampaignsTable ולייבא ל-hook. ה-Aggregated לא מוגדר ע"י Hook, לכן ייבא אותו לתוך ה-hook file כ-named import אם הוא נשאר ב-CampaignsTable (export-it-from-CampaignsTable אם אין מקום טבעי אחר).

    ב-`CampaignsTable.tsx`:
    1. הוסף `import { useCampaignTrueRevenue, type TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';`
    2. החלף את ה-useMemo בשורות 552-682 ב:
       ```typescript
       const trueRevenueByKey = useCampaignTrueRevenue({
         mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange,
       });
       ```
    3. מחק את ה-types `TrueRevenueInfo` + `ConfidenceLevel` + `computeConfidence` מ-CampaignsTable (עברו ל-hook file). שמור `TrueRevenueInfo` כ-re-export אם משהו אחר ב-codebase מייבא ממנו — `grep -rn "TrueRevenueInfo" dashboard-web/src` כדי לבדוק.

    **שמירת ה-deps:** המערך `[mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]` חייב להיות זהה. אל תקרא אותו `[...args]` — זה shadow-deps יוצר react warning.

    **אל תיגע ב:** ה-`aggregated` useMemo (553-537), ה-`totals` useMemo, ה-`displaySource`, ה-`attributionGap`. רק ה-trueRevenueByKey.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>grep -c "useCampaignTrueRevenue" dashboard-web/src/components/CampaignsTable.tsx</automated>
    <automated>test ! -z "$(grep -E 'function computeConfidence' dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts)" && echo "computeConfidence moved"</automated>
  </verify>
  <done>
    קובץ `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` קיים, מייצא `useCampaignTrueRevenue`, `TrueRevenueInfo`, `ConfidenceLevel`. `CampaignsTable.tsx` מייבא את ה-hook ולא מכיל יותר את ה-block של trueRevenueByKey useMemo. `npm run build` עובר. `wc -l dashboard-web/src/components/CampaignsTable.tsx` קטן ב-~130 שורות.
  </done>
</task>

<task type="auto">
  <name>Task 2 (T-B): Extract useCampaignAttribution hook</name>
  <files>dashboard-web/src/lib/hooks/useCampaignAttribution.ts, dashboard-web/src/components/CampaignDrawer.tsx</files>
  <action>
    **הערה חשובה:** למרות שה-spec מציין "moves the analyzeAttribution memoization" עבור CampaignsTable, בקריאה זהירה של הקוד — ה-CampaignsTable כבר משלב את `analyzeAttribution` *בתוך* ה-trueRevenueByKey memo (השלב 4, שורה 656). אין שם memoization נפרדת. ה-memoization הנפרדת של attribution **נמצאת ב-CampaignDrawer**: `attributionByAdSet` ב-`useMemo` בשורות 299-326 + `dailyMetaByAdSet` ב-`useMemo` בשורות 278-298. זוהי הקלאסיקה של IN5-01 fix (analyzeAttributionForAdSet inside .map → analyzeAttributionForAdSet inside useMemo Map<adSetId, ...>).

    לכן ה-task הזה מטפל ב-attribution memoization של ה-drawer. צור `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` שמייצא:

    ```typescript
    export function useCampaignAttribution(args: {
      summary: { campaignName: string; campaignId: string; platform: string; storeName: string; adSets: AdSet[]; dailyArr: DailyPoint[]; spend: number; value: number } | null;
      orderRows: OrderAttributionRow[];
      rows: CampaignRow[];
      rangeFrom: string;
      rangeTo: string;
    }): {
      dailyMetaByAdSet: Map<string, Array<{ date: string; value: number }>>;
      attributionByAdSet: Map<string, AttributionAnalysis | null>;
    };
    ```

    העבר אליו את 2 ה-useMemos:
    1. `dailyMetaByAdSet` (CampaignDrawer שורות 278-298) — מבנה את Map<adSetKey, daily-meta-array>.
    2. `attributionByAdSet` (CampaignDrawer שורות 299-326) — קורא analyzeAttributionForAdSet פעם אחת לכל ad-set, חוזר Map<adSetKey, AttributionAnalysis>.

    **שמירת ה-deps:** 
    - dailyMetaByAdSet: `[summary, rows, rangeFrom, rangeTo]` (זהה למקור)
    - attributionByAdSet: `[summary, orderRows, rows, dailyMetaByAdSet]` (זהה למקור, אם המקור הוא `ordersAttrData` יש להעביר את `ordersAttrData?.rows ?? []` כ-`orderRows` ב-call site)

    ב-`CampaignDrawer.tsx`:
    1. `import { useCampaignAttribution } from '@/lib/hooks/useCampaignAttribution';`
    2. החלף את 2 ה-useMemos ב:
       ```typescript
       const { dailyMetaByAdSet, attributionByAdSet } = useCampaignAttribution({
         summary, orderRows: ordersAttrData?.rows ?? [], rows, rangeFrom, rangeTo,
       });
       ```
    3. מחק את הקוד המוזז.

    **אל תיגע ב:** ה-`summary` useMemo (190-269), ה-`productChannelBreakdown`, ה-`reconciliation`, ה-`mappedIds`. גם לא לזיז את ה-`analyzeAttribution` הראשי שבתוך ה-AttributionAnalysisPanel inline IIFE (שורות 713-857) — הוא יעבור ב-T-D יחד עם ה-panel.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>grep -c "useCampaignAttribution" dashboard-web/src/components/CampaignDrawer.tsx</automated>
    <automated>grep -v '^//' dashboard-web/src/components/CampaignDrawer.tsx | grep -c "const attributionByAdSet = useMemo"</automated>
  </verify>
  <done>
    קובץ `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` קיים, מייצא את ה-hook. CampaignDrawer מייבא ומשתמש בו. ה-`analyzeAttributionForAdSet` כבר לא נקרא *ישירות* ב-CampaignDrawer.tsx (רק דרך ה-hook). build passing. CampaignDrawer.tsx קטן ב-~50 שורות.
  </done>
</task>

<task type="auto">
  <name>Task 3 (T-C): Extract CampaignsTableRow sub-component</name>
  <files>dashboard-web/src/components/CampaignsTableRow.tsx, dashboard-web/src/components/CampaignsTable.tsx</files>
  <action>
    צור `dashboard-web/src/components/CampaignsTableRow.tsx` שמרנדר שורה אחת של הטבלה. ה-body של `{display.map((a, i) => { ... return (<tr ...> ... </tr>); })}` ב-CampaignsTable שורות 1140-1453 (כ-313 שורות) הוא כל מה שעובר.

    **חתימת ה-component:**
    ```typescript
    type Props = {
      a: Aggregated;
      i: number;
      mode: 'campaign' | 'adset';
      trueRevenueByKey: Map<string, TrueRevenueInfo>;
      adAccounts: AdAccountMap;
      optimized: Set<string>;
      onToggleOptimized: (key: string) => void;
      onDrillCampaign: (campaignId: string, platform: string) => void;
      onDrillAd: (args: { storeId: string; campaignId: string; adSetId: string; adSetName: string }) => void;
    };
    export function CampaignsTableRow(props: Props): JSX.Element;
    ```

    הקובץ צריך לכלול:
    - את כל ה-`<td>` cells (10 cells בערך — toggle, name, spend, budget, value, ROAS, ROAS-Shopify chip, conversions, gap, etc.)
    - את ה-IIFEs הפנימיים שמחשבים `roas`, `ctr`, `cpc`, `cpa`, `info`, `link`, `isOptimized`, `tight`, `canDrillToAds`, `key`, `gap`, `trueRoas`, וכן הלאה. כולם מקומיים-לשורה ולא state.
    - את ה-Trust chip logic (החל מ-`const key = campaignKey(...)` בשורה 1295 עד סוף ה-`<td>` של ROAS Shopify).
    - את ה-`TONE_BG` constant — או move-it ל-`@/lib/format.ts` או export-it מ-CampaignsTable. עדיף הראשון: העבר `TONE_BG` (שורה 199) ל-`@/lib/format.ts` כ-named export, וייבא בשני המקומות. הליכה זהירה: וודא ש-`grep -rn "TONE_BG" dashboard-web/src` לא חושף עוד שימושים שיישברו.

    ב-`CampaignsTable.tsx`:
    1. `import { CampaignsTableRow } from './CampaignsTableRow';`
    2. במקום `{display.map((a, i) => { ... return <tr ...>...</tr>; })}` שים:
       ```jsx
       {display.map((a, i) => (
         <CampaignsTableRow
           key={a.key}
           a={a}
           i={i}
           mode={mode}
           trueRevenueByKey={trueRevenueByKey}
           adAccounts={adAccounts}
           optimized={optimized}
           onToggleOptimized={onToggleOptimized}
           onDrillCampaign={(cid, plat) => { setDrillCampaignId(cid); setDrillPlatform(plat); }}
           onDrillAd={setAdDrill}
         />
       ))}
       ```
    3. מחק את ה-IIFE-block ב-1140-1453.

    **אל תיגע ב:** ה-thead + SortHeader rows (1026-1138), ה-empty-state, ה-AttributionGapPanel, ה-CampaignDrawer + AdsDrawer mountings (1486-1522), ה-summary section, ה-toolbar.

    אחרי ה-task הזה, `wc -l CampaignsTable.tsx` צריך להראות ≤500 שורות (כעת ~1735 - 130 - 313 ≈ 1290; הקובץ עדיין יחסית גדול. סביר ש-bonus-cleanup של ה-`computeConfidence` (T-A) + ה-`AttributionGapPanel` בסוף (1534-1638, 105 שורות) שעבר לקובץ נפרד יוריד עוד 100 שורות). אם הקובץ עדיין מעל 500, **רוב הסיכוי שה-aggregate + sortAggregated** (שורות 214-385, 170 שורות) הם מועמדים — שקול להזיז גם אותם ל-`@/lib/campaigns.ts` או ל-`useCampaignTrueRevenue` (אם זה לא יישבר את ה-isolated-testing יעד). דווח על המצב ב-summary; אם הקובץ עדיין >500, ה-acceptance criteria של ROADMAP לא מסופק וצריך task נוסף.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/CampaignsTableRow.tsx && echo "row file exists"</automated>
    <automated>wc -l dashboard-web/src/components/CampaignsTable.tsx</automated>
    <automated>grep -c "<CampaignsTableRow" dashboard-web/src/components/CampaignsTable.tsx</automated>
  </verify>
  <done>
    `CampaignsTableRow.tsx` קיים ומכיל את ה-render של שורה בודדת. `CampaignsTable.tsx` מייבא ומשתמש בו. build + test passing. `wc -l CampaignsTable.tsx` ≤500. Trust chip + drill לקמפיין + drill לאד-עדיין עובדים (manual smoke OK).
  </done>
</task>

<task type="auto">
  <name>Task 4 (T-D): Extract AttributionAnalysisPanel</name>
  <files>dashboard-web/src/components/AttributionAnalysisPanel.tsx, dashboard-web/src/components/CampaignDrawer.tsx</files>
  <action>
    צור `dashboard-web/src/components/AttributionAnalysisPanel.tsx` שמכיל את ה-`{(() => { ... })()}` block של "ניתוח attribution" ב-CampaignDrawer שורות 707-857 (כ-150 שורות).

    **חתימת ה-component:**
    ```typescript
    type Props = {
      summary: {
        campaignName: string;
        platform: string;
        spend: number;
        value: number;
        dailyArr: Array<{ date: string; spend: number; value: number }>;
      };
      campaignId: string;
      storeId: string;
      orderRows: OrderAttributionRow[];
    };
    export function AttributionAnalysisPanel(props: Props): JSX.Element | null;
    ```

    ה-component מבצע:
    1. בונה את ה-`dailyMeta` array (`summary.dailyArr.map(d => ({ date: d.date, value: d.value }))`)
    2. מחשב `dateFrom` / `dateTo` מ-`rows` (לא צריך, כי `rangeFrom`/`rangeTo` ב-CampaignDrawer כבר props — **שינוי קל:** העבר את rangeFrom/rangeTo כ-props ל-panel במקום לחשב מחדש מ-rows — זה אותו ערך, רק עוקף את ה-reduce). הוסף לטיפוסי ה-props.
    3. קורא `analyzeAttribution(...)` עם ה-args הקיימים.
    4. אם `analysis === null` → מחזיר `null`.
    5. אחרת מרנדר את ה-`<section>` המלא — trust verdict header, det/meta ROAS comparison, ROAS interval, recommendation.

    ב-`CampaignDrawer.tsx`:
    1. `import { AttributionAnalysisPanel } from './AttributionAnalysisPanel';`
    2. במקום ה-`{(() => { ... })()}` block שורות 707-857 שים:
       ```jsx
       <AttributionAnalysisPanel
         summary={summary}
         campaignId={campaignId}
         storeId={rows[0]?.storeId ?? ''}
         orderRows={ordersAttrData?.rows ?? []}
       />
       ```
    3. מחק את הbody הישן.

    **אסור:** לא לנגוע ב-`analyzeAttribution` ב-`/lib/attributionAnalysis.ts` עצמה.

    **חבר ל-T-B:** ה-component הזה כן קורא ל-`analyzeAttribution` בקריאה אחת ב-render. זה לא הפרה של IN5-01 כי זה analysis יחיד לקמפיין (לא inside .map), והוא memoize בעצמו דרך React-render-cycle (כי הוא inside JSX block). אם רוצים להיות שמרניים בהמשך, אפשר ב-Phase עתידי לעטוף ב-`useMemo` ב-component עצמו — אבל זה לא חלק מהמשימה.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/AttributionAnalysisPanel.tsx && echo "panel file exists"</automated>
    <automated>grep -c "<AttributionAnalysisPanel" dashboard-web/src/components/CampaignDrawer.tsx</automated>
  </verify>
  <done>
    `AttributionAnalysisPanel.tsx` קיים. ה-trust verdict callout (high/medium/low/unknown) עדיין נמצא לפני channel-breakdown ולפני reconciliation ב-DOM. CampaignDrawer קטן ב-~150 שורות. build passing.
  </done>
</task>

<task type="auto">
  <name>Task 5 (T-E): Extract MetaShopifyReconciliation</name>
  <files>dashboard-web/src/components/MetaShopifyReconciliation.tsx, dashboard-web/src/components/CampaignDrawer.tsx</files>
  <action>
    צור `dashboard-web/src/components/MetaShopifyReconciliation.tsx` שמכיל את ה-Pearson r + lag detection + chart + per-day table.

    **חתימת ה-component:**
    ```typescript
    type ReconciliationData = {
      series: Array<{ date: string; meta: number; shopify: number }>;
      r: number;
      bestLag: number;
      bestR: number;
    };
    export function MetaShopifyReconciliation(props: { reconciliation: ReconciliationData | null }): JSX.Element | null;
    ```

    ה-component:
    1. אם `reconciliation === null` → מחזיר `null`.
    2. אחרת מרנדר את ה-`<section>` המלא: Pearson r header (color-coded by abs(r)), interpretation paragraph (3 cases: r>=0.7, 0.3<=r<0.7, r<0.3), lag-detection banner (אם `bestLag !== 0 && abs(bestR) > abs(r) + 0.1`), the line chart, the per-day reconciliation `<details>` table.

    **חשוב:** העבר את הפונקציות `pearson` ו-`pearsonWithLag` (CampaignDrawer שורות 1406-1442) עם ה-component, כי הן רק היא משתמשת בהן. ייצא אותן `export function pearson(...)` ו-`export function pearsonWithLag(...)` כדי שב-Phase 2 יוכלו לכתוב טסטים עליהן.

    ב-`CampaignDrawer.tsx`:
    1. `import { MetaShopifyReconciliation, pearson, pearsonWithLag } from './MetaShopifyReconciliation';`
    2. ה-`reconciliation` IIFE (שורות 413-460) — שאלת עיצוב: האם להעביר אותו לתוך ה-component או להשאיר בdrawer?
       **החלטה:** להשאיר ב-drawer. החישוב צורך `productsData` + `summary.dailyArr` + `mappedIds` + `storeId` שכבר זמינים שם, ואין סיבה לחזור ולהעבירם. ה-component מקבל את התוצאה המחושבת.
    3. אם ה-import של `pearson`/`pearsonWithLag` כבר נשבר בdrawer (כי הזזת את ה-functions עצמן), זה בסדר — ה-`reconciliation` IIFE קורא להם, אז הוא צריך לייבא אותם חזרה: 
       ```typescript
       import { MetaShopifyReconciliation, pearson, pearsonWithLag } from './MetaShopifyReconciliation';
       ```
       וזה עובד.
    4. במקום ה-`{reconciliation && ( <section>...</section> )}` block בשורות 932-1087 שים:
       ```jsx
       <MetaShopifyReconciliation reconciliation={reconciliation} />
       ```
    5. מחק את ה-block הישן + את הגדרות pearson/pearsonWithLag בתחתית הקובץ.

    **שמירת WR-03:** הGate של "effectiveN < 5" + "series.length < 5" חייב להישמר בלוגיקה של ה-`reconciliation` IIFE (לא ב-component) — לא לזיז את הGate ל-component.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/MetaShopifyReconciliation.tsx && echo "panel file exists"</automated>
    <automated>grep -c "<MetaShopifyReconciliation" dashboard-web/src/components/CampaignDrawer.tsx</automated>
    <automated>grep -v '^//' dashboard-web/src/components/CampaignDrawer.tsx | grep -c "^function pearson"</automated>
  </verify>
  <done>
    `MetaShopifyReconciliation.tsx` קיים, מייצא את ה-component ואת `pearson`/`pearsonWithLag`. CampaignDrawer מייבא ומשתמש בכולם. ה-`reconciliation` IIFE עדיין נמצא ב-CampaignDrawer. build passing. CampaignDrawer קטן ב-~155 שורות (כולל body של panel + 2 functions).
  </done>
</task>

<task type="auto">
  <name>Task 6 (T-F): Extract ProductChannelBreakdown (Phase 1's section)</name>
  <files>dashboard-web/src/components/ProductChannelBreakdown.tsx, dashboard-web/src/components/CampaignDrawer.tsx</files>
  <action>
    צור `dashboard-web/src/components/ProductChannelBreakdown.tsx` שמכיל את ה-`{productChannelBreakdown && (() => { ... })()}` block ב-CampaignDrawer שורות 863-924 (כ-62 שורות).

    **חתימת ה-component:**
    ```typescript
    import type { ReturnType } from '...'; // טיפוס ה-analyzeProductChannel
    type Props = {
      breakdown: NonNullable<ReturnType<typeof analyzeProductChannel>>;
    };
    export function ProductChannelBreakdown({ breakdown }: Props): JSX.Element;
    ```
    
    או, פשוט יותר, ייצא טיפוס מפורש:
    ```typescript
    export type ProductChannelBreakdownData = {
      totalOrders: number;
      facebookOrders: number;
      facebookShare: number;
      totalRevenue: number;
      bySource: Record<string, { orders: number; revenue: number }>;
    };
    export function ProductChannelBreakdown({ breakdown }: { breakdown: ProductChannelBreakdownData }): JSX.Element;
    ```

    ה-component:
    1. מחשב `total`, `fb`, `google`, `direct`, `other`, `fbPct` (אותם derivations שב-IIFE הקיים).
    2. מרנדר את ה-`<section>`: headline, summary line, 4-segment bar, recommendation chips (green ≥60% / amber <30% AND total>=5).
    3. אל תזיז את ה-`productChannelBreakdown` useMemo (שורות 350-374). הוא נשאר ב-CampaignDrawer כי הוא צורך `summary`, `ordersAttrData`, `rows`, `mappedIds`, `rangeFrom`, `rangeTo` — כולם state local.

    ב-`CampaignDrawer.tsx`:
    1. `import { ProductChannelBreakdown } from './ProductChannelBreakdown';`
    2. במקום ה-`{productChannelBreakdown && (() => { ... })()}` block (863-924) שים:
       ```jsx
       {productChannelBreakdown && (
         <ProductChannelBreakdown breakdown={productChannelBreakdown} />
       )}
       ```
    3. מחק את ה-IIFE.

    **שמירת PATTERNS.md §5c:** ה-thresholds (0.6 / 0.3 / total>=5) חייבים להישאר כפי שהם.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/ProductChannelBreakdown.tsx && echo "panel file exists"</automated>
    <automated>grep -c "<ProductChannelBreakdown" dashboard-web/src/components/CampaignDrawer.tsx</automated>
  </verify>
  <done>
    `ProductChannelBreakdown.tsx` קיים. ה-Phase 1 section עדיין מופיע בDOM בין AttributionAnalysisPanel ל-MetaShopifyReconciliation. build passing. CampaignDrawer קטן ב-~62 שורות.
  </done>
</task>

<task type="auto">
  <name>Task 7 (T-G): Extract AdSetTable</name>
  <files>dashboard-web/src/components/AdSetTable.tsx, dashboard-web/src/components/CampaignDrawer.tsx</files>
  <action>
    צור `dashboard-web/src/components/AdSetTable.tsx` שמכיל את ה-section "אד-סטים" + ה-table ב-CampaignDrawer שורות 1089-1290 (כ-200 שורות).

    **חתימת ה-component:**
    ```typescript
    type AdSet = {
      id: string;
      name: string;
      storeId: string;
      campaignId: string;
      platform: string;
      spend: number;
      conversionValue: number;
      conversions: number;
      roas: number;
      adSetBudgetCad?: number;
    };
    type Props = {
      adSets: AdSet[];                                 // sortedAdSets
      sortKey: 'name'|'spend'|'budget'|'value'|'roas'|'conversions';
      sortDir: 'asc'|'desc';
      onSort: (key: Props['sortKey']) => void;
      attributionByAdSet: Map<string, AttributionAnalysis | null>;
      optimized: Set<string>;
      onToggleOptimized: (markKey: string) => void;
      onDrillAds: (args: { storeId; campaignId; adSetId; adSetName }) => void;
    };
    export function AdSetTable(props: Props): JSX.Element;
    ```

    גם להעביר ל-קובץ את ה-sub-component `AdSetSortHeader` (CampaignDrawer שורות 1353-1399). היא משמשת רק כאן.

    **אל תזיז:**
    - ה-`sortedAdSets` IIFE (CampaignDrawer 468-488) — נשאר ב-CampaignDrawer כי הוא צורך `summary.adSets` + `sortKey` + `sortDir` שהם state local.
    - ה-`handleSort` (111-120) — נשאר ב-CampaignDrawer.
    - ה-`useState<AdSetSortKey>('spend')` + `useState<AdSetSortDir>('desc')` (108-109) — נשאר ב-CampaignDrawer.
    - ה-`adDrillSet` state + ה-`<AdsDrawer ... />` mounting (1276-1290) — נשאר ב-CampaignDrawer.

    ב-`CampaignDrawer.tsx`:
    1. `import { AdSetTable } from './AdSetTable';`
    2. במקום ה-`{summary.adSets.length > 0 && (<section>...</section>)}` block (1089-1273) שים:
       ```jsx
       {summary.adSets.length > 0 && (
         <AdSetTable
           adSets={sortedAdSets}
           sortKey={sortKey}
           sortDir={sortDir}
           onSort={handleSort}
           attributionByAdSet={attributionByAdSet}
           optimized={optimized}
           onToggleOptimized={toggleOptimized}
           onDrillAds={setAdDrillSet}
         />
       )}
       ```
    3. מחק את ה-block הישן ואת `AdSetSortHeader` בתחתית הקובץ.

    אחרי ה-task הזה, `wc -l CampaignDrawer.tsx` צריך להיות ≤500 (1443 - 50 [T-B] - 150 [T-D] - 155 [T-E] - 62 [T-F] - 200 [T-G] = ~826). זה עדיין מעל 500. הסיבה: ה-`summary` useMemo עדיין שם, ה-mapped-products section עדיין שם, ה-KPI strip עדיין שם, ה-daily chart עדיין שם, ה-`reconciliation` IIFE עדיין שם. אם הקובץ עדיין >500, **מועמדים נוספים לפיצול:**
    - **MappedProductsSection** (660-705, 45 שורות) — Meta-only mapped products list + edit button + ProductPicker mount.
    - **DailyTrendChart** (577-653, 77 שורות) — האזור של ה-AreaChart היומי.
    - **ה-`summary` useMemo** (190-269, 80 שורות) — אפשר להעביר ל-hook `useCampaignDrawerSummary`. 

    **אם הקובץ עדיין >500 אחרי T-G, צור T-G.2 / T-G.3 שמטפל ב-3 הנ"ל ומדווח על המצב ב-SUMMARY.** אל תסיים את ה-phase עם CampaignDrawer.tsx >500 שורות — זה violation ישיר של success criterion #1.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/AdSetTable.tsx && echo "panel file exists"</automated>
    <automated>wc -l dashboard-web/src/components/CampaignDrawer.tsx</automated>
    <automated>grep -c "<AdSetTable" dashboard-web/src/components/CampaignDrawer.tsx</automated>
  </verify>
  <done>
    `AdSetTable.tsx` קיים. ה-table עדיין מופיע בDOM כצעד אחרון ב-drawer; sort headers עובדים; click → drill ל-AdsDrawer עובד; per-ad-set ROAS Shopify chip עדיין יציב (קורא מ-`attributionByAdSet` Map). build + tests passing. **אם wc -l CampaignDrawer.tsx > 500, פתח task המשך לפי המדריך ב-action.** אחרת — ≤500.
  </done>
</task>

<task type="auto">
  <name>Task 8 (T-H): Extract useBillingRecurring hook</name>
  <files>dashboard-web/src/lib/hooks/useBillingRecurring.ts, dashboard-web/src/components/BillingSettings.tsx</files>
  <action>
    צור `dashboard-web/src/lib/hooks/useBillingRecurring.ts` שמרכז את ה-state + lifecycle של ה-recurring billing.

    **חתימת ה-hook:**
    ```typescript
    export function useBillingRecurring(): {
      recurring: RecurringCost[];
      setRecurring: (next: RecurringCost[]) => void;  // persists + dispatches event
      totalMonthly: number;
    };
    ```

    ה-hook צריך לכלול:
    1. `const [recurring, setRecurringState] = useState<RecurringCost[]>([])`
    2. ה-initial-load `useEffect` (BillingSettings שורה 133): `setRecurringState(readRecurring())`
    3. ה-listener ל-`roas-billing-changed` event (BillingSettings שורות 150-170 — חלץ את ה-recurring חלק). וודא שאתה לא חוטף את `roas-billing-onetime-changed` כאן (זה ל-T-I).
    4. `setRecurring(next)` — wrapper שעושה `setRecurringState(next)` + `writeRecurring(next)` (מתאם ל-`persistRecurring` ב-BillingSettings שורות 189-192). `writeRecurring` כבר עושה pushCloudKey + dispatchEvent ב-`lib/billing.ts`, אז אל תכתוב את זה שוב.
    5. `const totalMonthly = useMemo(...)` (BillingSettings שורות 184-187).

    ב-`BillingSettings.tsx`:
    1. `import { useBillingRecurring } from '@/lib/hooks/useBillingRecurring';`
    2. החלף את ה-state + useEffect + persistRecurring + totalMonthly ב:
       ```typescript
       const { recurring, setRecurring: persistRecurring, totalMonthly } = useBillingRecurring();
       ```
    3. מחק את הקוד המוזז.
    4. **אל תיגע ב:** ה-`oneTime` state, ה-`tab` state, ה-`open` state, ה-`detectedPlans` SWR fetch, ה-`storeNames`. גם לא בקריאות ל-`persistRecurring` מ-`<RecurringTab onChange={persistRecurring} />` (זה הופך לקריאות ל-setRecurring החדש).

    **שים לב:** ה-`useEffect` הקיים מאזין לשני events במאותו handler:
    ```typescript
    window.addEventListener('roas-billing-changed', onChange);
    window.addEventListener('roas-billing-onetime-changed', onChange);
    return () => { /* both */ };
    ```
    
    כאשר אתה מפצל ל-2 hooks, כל hook צריך להאזין ל-event שלו בלבד (T-H ל-`roas-billing-changed`, T-I ל-`roas-billing-onetime-changed`). זה שווה-ערך התנהגותית כי כל handler בעצם קרא לאותו readRecurring/readOneTime — אבל ה-cleanup יותר נקי.

    **CHANGE_EVENTS verification:** `grep -rn "roas-billing" dashboard-web/src/lib/cloudSync.ts` כדי לוודא שמות ה-events. עדכן אם השמות שונים במקור-האמת.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/lib/hooks/useBillingRecurring.ts && echo "hook file exists"</automated>
    <automated>grep -c "useBillingRecurring" dashboard-web/src/components/BillingSettings.tsx</automated>
  </verify>
  <done>
    `useBillingRecurring.ts` קיים. BillingSettings משתמש בו. ה-event listener על `roas-billing-changed` רץ. cloud-sync hydration לאחר re-mount עדיין מעדכן את ה-`recurring` list (manual smoke OK). build passing.
  </done>
</task>

<task type="auto">
  <name>Task 9 (T-I): Extract useBillingOneTime hook</name>
  <files>dashboard-web/src/lib/hooks/useBillingOneTime.ts, dashboard-web/src/components/BillingSettings.tsx</files>
  <action>
    מקבילה של T-H ל-one-time charges.

    **חתימת ה-hook:**
    ```typescript
    export function useBillingOneTime(): {
      oneTime: OneTimeCost[];
      setOneTime: (next: OneTimeCost[]) => void;
    };
    ```

    ה-hook:
    1. `const [oneTime, setOneTimeState] = useState<OneTimeCost[]>([])`
    2. initial load `useEffect`: `setOneTimeState(readOneTime())`
    3. event listener ל-`roas-billing-onetime-changed`: re-read on event.
    4. `setOneTime(next)` wrapper: state-set + `writeOneTime(next)`.

    ב-`BillingSettings.tsx`:
    1. `import { useBillingOneTime } from '@/lib/hooks/useBillingOneTime';`
    2. החלף את ה-`oneTime` state + `persistOneTime` + initial-load `useEffect` segment ב:
       ```typescript
       const { oneTime, setOneTime: persistOneTime } = useBillingOneTime();
       ```
    3. מחק את הקוד המוזז.

    **אל תיגע ב:** `<OneTimeTab items={oneTime} onChange={persistOneTime} />` (props נשארים זהים). גם לא ב-`<ImportTab onImported={(newRec, newOne, dest) => { ... persistOneTime([...]) })}>` — חתימת persistOneTime לא משתנה.

    **שים לב:** אחרי T-H + T-I, ה-`useEffect` הראשי של BillingSettings (שורות 133-172) צריך להיות מצומצם לקריאות שלא קשורות לrecurring/onetime. סביר שתישאר רק טיפול ב-`detectedPlans` או שיש לעוד events. וודא שאין rogue listener שנשאר אחרי שני הextraction-ים.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/lib/hooks/useBillingOneTime.ts && echo "hook file exists"</automated>
    <automated>grep -c "useBillingOneTime" dashboard-web/src/components/BillingSettings.tsx</automated>
  </verify>
  <done>
    `useBillingOneTime.ts` קיים. BillingSettings משתמש בו. CSV import עדיין מצליח להוסיף שורות ל-oneTime ול-recurring כאחד. build passing.
  </done>
</task>

<task type="auto">
  <name>Task 10 (T-J): Extract BillingCsvImport</name>
  <files>dashboard-web/src/components/BillingCsvImport.tsx, dashboard-web/src/components/BillingSettings.tsx</files>
  <action>
    צור `dashboard-web/src/components/BillingCsvImport.tsx` שמכיל את ה-component `ImportTab` (BillingSettings שורות 1044-1325, כ-280 שורות) + ה-type `PreviewRow` (שורות 1030-1042).

    **חתימת ה-component (זהה ל-ImportTab הנוכחי):**
    ```typescript
    type Props = {
      storeNames: string[];
      currentRecurring: RecurringCost[];
      onImported: (
        newRecurring: RecurringCost[],
        newOneTime: OneTimeCost[],
        destination: 'recurring' | 'onetime',
      ) => void;
    };
    export function BillingCsvImport(props: Props): JSX.Element;
    ```

    העבר את כל ה-state + functions של ImportTab (csv, defaultStore, preview, warnings, fileInput, buildPreview, parse, handleFile, setRow, confirm, counts) ל-component החדש בלי שינוי לוגי.

    ב-`BillingSettings.tsx`:
    1. `import { BillingCsvImport } from './BillingCsvImport';`
    2. במקום `<ImportTab ... />` (סביב שורה 296-310) שים:
       ```jsx
       <BillingCsvImport
         storeNames={storeNames}
         currentRecurring={recurring}
         onImported={(newRecurring, newOneTime, destination) => {
           if (newRecurring.length > 0) persistRecurring([...newRecurring, ...recurring]);
           if (newOneTime.length > 0) persistOneTime([...newOneTime, ...oneTime]);
           setTab(destination);  // או כל שם state ב-BillingSettings — שמור את המקור
         }}
       />
       ```
    3. מחק את `function ImportTab(...)` ואת ה-type `PreviewRow` מ-BillingSettings.

    **אל תיגע ב:** `RecurringTab`, `OneTimeTab`, `RecurringEditForm`, `OneTimeEditForm` — הם נשארים ב-BillingSettings (זמנית). הסיבה: כל אחד מהם כבר <250 שורות, וה-tab UI שלהם חי בתוך אותו modal, אז הזזה שלהם מוסיפה load בלי שיפור מעשי. אם BillingSettings.tsx עדיין >500 שורות אחרי T-J, **מועמדים להמשך:**
    - `RecurringTab` (~314 שורות, 318-630) — סביר.
    - `OneTimeTab` (~140 שורות, 755-895) — לא גדול מספיק לחוד.
    - `RecurringEditForm` + `OneTimeEditForm` יחד (~270 שורות) — אופציה.

    אחרי T-J:
    - BillingSettings.tsx צפוי: 1328 - 280 (ImportTab) - ~40 (hooks consolidation) = ~1010 שורות.
    - **זה עדיין >500.** אסור לסיים את phase 4 בכך.

    **לכן:** הוסף **T-K** דה-פקטו לפני סיום ה-phase: הזז את `RecurringTab` (+ ה-edit-form הצמוד) לקובץ `BillingRecurringTab.tsx` ואת `OneTimeTab` (+ edit-form) ל-`BillingOneTimeTab.tsx`. אם wc -l BillingSettings.tsx <=500 אחרי שני אלה — Done. אם לא — ההמשך לפי השיפוט שלך.

    דווח על T-K ב-SUMMARY כ-task נוסף שהפכת.
  </action>
  <verify>
    <automated>cd dashboard-web && npm run build 2>&1 | tail -20</automated>
    <automated>cd dashboard-web && (npm test 2>&1 | tail -20) || echo "tests not yet wired"</automated>
    <automated>test -f dashboard-web/src/components/BillingCsvImport.tsx && echo "csv file exists"</automated>
    <automated>wc -l dashboard-web/src/components/BillingSettings.tsx</automated>
    <automated>grep -c "<BillingCsvImport" dashboard-web/src/components/BillingSettings.tsx</automated>
  </verify>
  <done>
    `BillingCsvImport.tsx` קיים, מייצא את ה-component. CSV import עדיין עובד: dropdown, paste, parse, preview, override per row, confirm → recurring + onetime nazl בקבוצות הנכונות, tab switches אוטומטית. build + tests passing. `wc -l BillingSettings.tsx` ≤500 (כולל T-K אם נדרש).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (פנימי בלבד) | אין trust boundary חדש. הקוד הקיים כולו רץ ב-client בתוך session של משתמש פנימי. ה-refactor הזה לא חוצה קצוות חדשים. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-01 | Tampering | hooks/useCampaign* | accept | רק logic ארגון, לא input חיצוני. אם מוזיקלי ה-hook משנה את ה-memo deps — נתפס ב-tests + manual smoke לפני merge. |
| T-04-02 | Information Disclosure | LocalStorage state (billing CSV preview) | accept | ה-`preview` state ב-BillingCsvImport מכיל את התוכן של ה-CSV שהמשתמש מדביק. כיום בלי refactor הוא כבר ב-DOM/memory — הזזת ה-component לא משנה את הCAt. |
| T-04-03 | Repudiation | אין כתיבת state חדש | accept | רק writeRecurring / writeOneTime הקיימים, שכבר הולכים דרך `pushCloudKey` הקיים. אין endpoint POST חדש. |
| T-04-04 | Denial of Service | ביצועי render | mitigate | ה-IN5-01 invariant חייב להישמר — `analyzeAttribution` *רק* בתוך useMemo. תיקון: בכל task verify ש-`grep -v '^//' dashboard-web/src/components/<file> | grep -c 'analyzeAttribution'` אינו עולה (פעם אחת ב-T-D ב-`<AttributionAnalysisPanel>`, אחרת רק דרך hooks). |
</threat_model>

<verification>
## Phase-level checks (run after T-J / T-K):

1. **Line caps:**
   ```bash
   wc -l dashboard-web/src/components/CampaignsTable.tsx dashboard-web/src/components/CampaignDrawer.tsx dashboard-web/src/components/BillingSettings.tsx | awk '{if ($1>500 && $2!="total") print "FAIL: " $2 " has " $1 " lines"}'
   ```
   ציפייה: אין הדפסות "FAIL".

2. **Build green:**
   ```bash
   cd dashboard-web && npm run build 2>&1 | tail -5
   ```
   ציפייה: "Compiled successfully" + 0 warnings מסוג no-unused-vars.

3. **Tests green (Phase 2 deliverables):**
   ```bash
   cd dashboard-web && (npm test 2>&1 | tail -10) || echo "tests not yet wired — skip"
   ```
   ציפייה: כל ה-tests של attributionAnalysis עוברים. אם הuser עוד לא רץ phase 2, מותר לראות "tests not yet wired" — אך build חייב לעבור.

4. **IN5-01 invariant — analyzeAttribution לא inside .map:**
   ```bash
   for f in dashboard-web/src/components/CampaignsTable.tsx dashboard-web/src/components/CampaignDrawer.tsx; do
     count=$(grep -v '^[[:space:]]*//' "$f" | awk '/analyzeAttribution/{count++} END{print count+0}')
     echo "$f: analyzeAttribution refs = $count"
   done
   ```
   ציפייה: CampaignsTable = 0 (עבר ל-hook), CampaignDrawer = 0 (עבר ל-AttributionAnalysisPanel + ל-useCampaignAttribution hook).

5. **Hooks layout:**
   ```bash
   ls dashboard-web/src/lib/hooks/
   ```
   ציפייה: `useCampaignTrueRevenue.ts`, `useCampaignAttribution.ts`, `useBillingRecurring.ts`, `useBillingOneTime.ts`.

6. **Sub-components layout:**
   ```bash
   ls dashboard-web/src/components/ | grep -E "(CampaignsTableRow|AttributionAnalysisPanel|MetaShopifyReconciliation|ProductChannelBreakdown|AdSetTable|BillingCsvImport)"
   ```
   ציפייה: 6 הקבצים (לפחות).

7. **Manual smoke (אנושית — בסוף הphase):**
   - פתח dashboard בdev mode (`npm run dev`).
   - Tab Campaigns: trust chip מופיע על כל שורה, click → drawer נפתח, AttributionAnalysisPanel + ProductChannelBreakdown + MetaShopifyReconciliation + AdSetTable כולם מרונדרים.
   - Drawer: lag-detection banner מופיע על קמפיין עם lag (אם יש כזה בנתונים).
   - Tab Billing: 3 sub-tabs (recurring / onetime / import) מתחלפים, CSV paste → preview, confirm → ה-recurring tab מקבל את השורות החדשות בראש.
</verification>

<success_criteria>
- [x] `wc -l CampaignsTable.tsx CampaignDrawer.tsx BillingSettings.tsx` כולם ≤500 שורות
- [x] 4 hooks חדשים תחת `dashboard-web/src/lib/hooks/`: `useCampaignTrueRevenue`, `useCampaignAttribution`, `useBillingRecurring`, `useBillingOneTime`
- [x] 6 sub-components חדשים תחת `dashboard-web/src/components/`: `CampaignsTableRow`, `AttributionAnalysisPanel`, `MetaShopifyReconciliation`, `ProductChannelBreakdown`, `AdSetTable`, `BillingCsvImport`
- [x] `npm run build` עובר אחרי כל task (10 builds ירוקים)
- [x] `npm run test` עובר אחרי כל task (Phase 2's Vitest suite), אם זמין
- [x] IN5-01 invariant נשמר — `analyzeAttribution` לא נקרא inside .map() ב-host components
- [x] Trust chip + 4 confidence levels (high / medium / low / unknown) מרונדרים ב-CampaignsTable
- [x] 3 panels של drawer (attribution / channel breakdown / reconciliation) רנדרים באותו סדר DOM
- [x] BillingSettings — 3 sub-tabs (recurring / onetime / import) עובדים, CSV preview + confirm פועלים
- [x] אפס regressions ב-manual smoke (אנושי — 5 דק' לאחר T-K)
</success_criteria>

<output>
לאחר השלמת כל ה-tasks, צור `.planning/phases/04-component-decomposition/04-SUMMARY.md` עם:
- רשימת ה-tasks (T-A ... T-J + T-K אם הוגדר)
- `wc -l` final של 3 הקבצים ההורים
- כל קבצי ה-hooks וה-components החדשים שנוצרו
- כל decisions שעלו ב-execution (האם נדרש T-K לפצל את RecurringTab, האם הזזת gent`Aggregated` ל-`@/lib/types.ts`, וכו')
- "Verification: All success criteria met" אם הכל ירוק; אחרת רשימת gaps
- patterns שנמשכו לקובץ קוד (TONE_BG ל-`@/lib/format.ts`, computeConfidence עבר עם ה-hook, וכו')
</output>
</content>
</invoke>