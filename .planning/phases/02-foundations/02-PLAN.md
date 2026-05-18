---
phase: 02
phase_name: Foundations
created: 2026-05-18
status: planned
task_count: 14
requirements: [REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06]
deploy_order: dashboard-only  # Phase 2 lives entirely in dashboard-web/. No Apps Script changes.
files_modified:
  - dashboard-web/package.json
  - dashboard-web/package-lock.json
  - dashboard-web/vitest.config.ts
  - dashboard-web/tsconfig.json
  - dashboard-web/.gitignore
  - dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttribution.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttributionForAdSet.test.ts
  - dashboard-web/src/lib/__tests__/analyzeAttributionForAd.test.ts
  - dashboard-web/src/lib/__tests__/analyzeProductChannel.test.ts
  - dashboard-web/src/lib/__tests__/detectOutlierDays.test.ts
  - dashboard-web/src/lib/__tests__/computeWindowStability.test.ts
  - dashboard-web/src/lib/__tests__/fixtures.ts
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/lib/cacheConfig.ts
  - dashboard-web/src/lib/utils.ts
  - dashboard-web/src/lib/__tests__/utils.test.ts
  - dashboard-web/src/app/layout.tsx
  - dashboard-web/src/components/ErrorBoundary.tsx
  - dashboard-web/sentry.client.config.ts
  - dashboard-web/sentry.server.config.ts
  - dashboard-web/sentry.edge.config.ts
  - dashboard-web/instrumentation.ts
  - dashboard-web/next.config.ts
  - dashboard-web/.env.local.example
  - dashboard-web/src/app/api/data/route.ts
  - dashboard-web/src/app/api/campaigns/route.ts
  - dashboard-web/src/app/api/products/route.ts
  - dashboard-web/src/app/api/ads/route.ts
  - dashboard-web/src/app/api/orders-attribution/route.ts
  - dashboard-web/src/app/api/store-meta/route.ts
  - dashboard-web/src/app/api/product-catalog/route.ts
  - dashboard-web/src/app/api/dashboard-state/route.ts
  - dashboard-web/README.md
  - SYSTEM_OVERVIEW.md
---

# Phase 2 — Foundations (PLAN)

תוכנית אטומית, ממוסדרת. כל משימה היא commit אחד עם acceptance ברור. מטרת הphase: לבסס את התשתיות הקטנות-מאמץ-גבוהות-מינוף ש-phases 3-8 ייסמכו עליהן — test harness, error reporting, shared utilities. בלי זה, כל refactor (במיוחד Phase 4 component decomposition) הוא "ריצה בעיניים עצומות" כפי שמתועד ב-CONCERNS.md.

**Phase boundaries (do NOT touch):**
- Apps Script files (`*.gs`) — Phase 2 הוא dashboard-only. שינויי Apps Script מתוכננים ל-Phase 3 ו-Phase 7.
- ה-business logic ב-`attributionAnalysis.ts` — אנחנו מוסיפים בדיקות *מעל* הקוד הקיים בלי לשנות אותו. אם בדיקה חושפת באג — לתעד ב-`FOLLOWUP.md` ולתקן ב-task נפרד (לא לערבב).
- `cloudSync.ts` `STATE_KEYS` — אין שינוי ב-cloud-sync model ב-phase הזה.
- ה-`CampaignsTable.tsx` / `CampaignDrawer.tsx` / `BillingSettings.tsx` — אלה ייגעו רק ב-Phase 4 (component decomposition).
- כתיבת tests ל-Apps Script side — אין test runner ל-Apps Script ב-V8. Phase 7 (observability) ידאג ל-logging tab במקום.

**Atomicity invariant per task:**
כל task הוא commit אחד עצמאי. אחרי כל task: (1) `npm run build` עובר, (2) `npm run test` עובר (החל מ-T-02 והלאה), (3) ה-dashboard נטען ידנית ללא white-screen. אם task נכשל באמצע, החזר reset לפני להוסיף את הבא.

---

## Task List

- [ ] **T-01** — Install Vitest + add config + add `test` script (zero tests yet)
- [ ] **T-02** — Add test fixtures file (`OrderAttributionRow` + dailyMetaSeries shared data)
- [ ] **T-03** — Tests for `orderMatchesCampaign` (utm_id, utm_campaign, fall-through guards)
- [ ] **T-04** — Tests for `analyzeAttribution` (coverage tiers, trust ladder, degenerate-CI, no-conversions edge case)
- [ ] **T-05** — Tests for `analyzeAttributionForAdSet` + `analyzeAttributionForAd` (utm_term / utm_content matching, level-specific advice)
- [ ] **T-06** — Tests for `analyzeProductChannel` (empty inputs, Facebook predicate, divide-by-zero guard, lineItems edge cases)
- [ ] **T-07** — Tests for `detectOutlierDays` + `computeWindowStability` (z-score gates, tail bucket rules, NaN guards)
- [ ] **T-08** — Install `@sentry/nextjs` + 3 config files + `instrumentation.ts` + env-driven DSN
- [ ] **T-09** — Add `ErrorBoundary` client component + wire into `app/layout.tsx`
- [ ] **T-10** — Create `cacheConfig.ts` + `cacheControl(key)` helper; update all 8 API routes atomically
- [ ] **T-11** — Add row-count guards (`> 50000 → console.warn`) to all 8 API routes (single commit)
- [ ] **T-12** — Add `safeDecode` utility to `utils.ts` + tests + one call site (or document why none exist today)
- [ ] **T-13** — Update `dashboard-web/README.md` + `SYSTEM_OVERVIEW.md` to document the new infrastructure
- [ ] **T-14** — Manual smoke + final verification gate

---

## Task Details

### T-01 — Install Vitest + add config + add `test` script

**type:** `infra`
**files:**
- `dashboard-web/package.json`
- `dashboard-web/package-lock.json`
- `dashboard-web/vitest.config.ts`
- `dashboard-web/tsconfig.json`

**description:**
התקנת Vitest + הגדרת config מינימלי. **לא כותבים בדיקות עדיין** — רק מוודאים ש-`npm run test` רץ ומחזיר "no test files found" (או 0 passed) ושה-build לא נשבר.

1. **`package.json`** — להוסיף ל-`devDependencies`:
   - `"vitest": "^2.1.0"` (matches Node 22 / Vercel LTS)
   - `"@vitest/coverage-v8": "^2.1.0"` (לcoverage אופציונלי, no extra deps)
   - להוסיף ל-`scripts`:
     - `"test": "vitest run"` (CI-mode default — exits with code אחרי הריצה)
     - `"test:watch": "vitest"` (interactive)
     - `"test:coverage": "vitest run --coverage"`
2. **`vitest.config.ts`** (root of `dashboard-web/`) — config מינימלי:
   ```typescript
   import { defineConfig } from 'vitest/config';
   import path from 'path';

   export default defineConfig({
     test: {
       environment: 'node', // אין JSDOM — כל הבדיקות ב-Phase 2 הן pure functions
       include: ['src/lib/__tests__/**/*.test.ts'],
       globals: false, // explicit imports — לא מסתמכים על describe/it globals
     },
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './src'),
       },
     },
   });
   ```
3. **`tsconfig.json`** — לוודא ש-`include` כולל את `src/lib/__tests__/**` (כיום הוא `src/**/*` — כן כולל). אם לא, להוסיף. **אין צורך** ב-`tsconfig.test.json` נפרד — Vitest משתמש ב-`esbuild` ול-types היחיד שחסר הוא `vitest/globals`, שאנחנו לא משתמשים בו (globals: false). אם TypeScript מתלונן על `import.meta` או `vi`, להוסיף `"types": ["vitest/globals"]` ל-tsconfig.
4. **לא ליצור** קובץ test עדיין — זה ה-task הבא.

**pattern_ref:** `dashboard-web/package.json` (existing scripts shape) + STACK.md "Testing — None" — phase 2 הופך את ה-trade-off הזה.

**research caveats applied:**
- אין mocking ב-fixtures (CONCERNS.md §"אין test suite": "deterministic על data fixtures"). אין `vi.mock()` ב-Phase 2.
- Vitest 2.x (לא 3.x) — מותאם ל-Vite 5 ול-Node 22; מבחני Phase 4 ידרשו JSDOM אבל זה לא ב-scope.

**acceptance:**
- `cd dashboard-web && npm install` רץ ללא errors
- `cd dashboard-web && npm run test` יוצא עם exit code 0 ומדפיס משהו כמו "no test files found" (Vitest behavior כשאין קבצים תואמים) או דומה
- `cd dashboard-web && npm run build` עובר ללא warnings חדשים מ-tsc
- `grep -n "\"vitest\"" dashboard-web/package.json` מראה את התלות
- `grep -n "\"test\":" dashboard-web/package.json` מראה את ה-script

**commit_message:** `chore(P2-01): install vitest + add test config (no tests yet)`

---

### T-02 — Add test fixtures file

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/fixtures.ts`

**description:**
קובץ deterministic data fixtures שכל הבדיקות הבאות (T-03 .. T-07) יבנו עליו. אין mocking — רק נתונים ידועים.

תוכן הקובץ:

1. **`makeOrder(overrides)`** — factory לקבל `Partial<OrderAttributionRow>` ולחזיר `OrderAttributionRow` שלם. ערכי defaults:
   - `orderId: 'o-1'`, `storeId: 'uzoshop'`, `date: '2026-05-15'`
   - `totalCad: 100`, `source: 'meta-paid'`, `fbclidPresent: true`, `gclidPresent: false`
   - `utmId: 'camp-1'`, `utmCampaign: 'Summer Sale'`, `utmTerm: 'adset-1'`, `utmContent: 'ad-1'`
   - `utmSource: 'facebook'`, `utmMedium: 'cpc'`
   - `lineItems: []`
2. **`makeCampaign(overrides)`** — factory ל-`{ campaignName, campaignId, storeId, platform, metaClaim, spend }`. defaults: name `'Summer Sale'`, id `'camp-1'`, store `'uzoshop'`, platform `'Meta'`, metaClaim 500, spend 200.
3. **`makeAdSet(overrides)`** + **`makeAd(overrides)`** — אותו דפוס לרמות ad-set ו-ad.
4. **`makeLineItem(overrides)`** — factory ל-`OrderLineItem` (פר Phase 1): `{ productId: 'p-1', units: 1, revenueCad: 50 }`.
5. **`makeDailySeries(days, valueFn)`** — helper שמייצר `Array<{date: string; value: number}>` עבור N ימים רצופים החל מ-`2026-05-01`. `valueFn(dayIdx)` מחזיר את הערך לאותו יום (לדוגמה `i => 100` למבחני baseline, `i => i === 7 ? 1000 : 100` למבחני outlier).
6. **`makeDateRange(from, to)`** — helper שמחזיר `{dateFrom, dateTo}` ב-format `'YYYY-MM-DD'`.

**הערה:** ה-factories הם **pure** — אין side effects. כל overrides נעטף ב-`{...defaults, ...overrides}` עם **shallow merge**. אם בדיקה צריכה לעקוף `lineItems`, היא מעבירה `lineItems: [...]` ב-overrides ומקבלת array חדש (לא mutation על שעדף).

**pattern_ref:** Apps Script side has manual diagnostic functions (`Config.gs::verifyConfig`) — `fixtures.ts` הוא ה-dashboard-equivalent. אין pattern קיים ב-dashboard-web (phase 2 יוצר אותו).

**research caveats applied:**
- CONCERNS.md §"אין test suite" — "מספיק בודקים deterministic על data fixtures". אין `faker`, אין `randomBytes`, אין IO.
- כל ה-factories מוגדרים ב-`__tests__/fixtures.ts` ולא ב-`__fixtures__/` — Vitest מתעלם מקבצים שלא תואמים ל-`*.test.ts` pattern, אז אין סיכון של פרשנות שגויה.

**acceptance:**
- `cd dashboard-web && npm run build` עובר (TypeScript מאמת ש-factories מקיימים את ה-types)
- `cd dashboard-web && npm run test` עדיין יוצא ב-exit code 0 (עדיין אין `*.test.ts`)
- `grep -n "export function makeOrder\|export function makeCampaign\|export function makeAdSet\|export function makeAd\|export function makeLineItem\|export function makeDailySeries\|export function makeDateRange" dashboard-web/src/lib/__tests__/fixtures.ts` מראה את כל 7 ה-exports
- `import` של `OrderAttributionRow` ו-`OrderLineItem` מ-`@/lib/ordersAttribution` עובד; `import` של `AttributionAnalysis` מ-`@/lib/attributionAnalysis` עובד

**commit_message:** `test(P2-02): add deterministic fixtures for attribution tests`

---

### T-03 — Tests for `orderMatchesCampaign`

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts`

**description:**
~6-8 בדיקות שמכסות את ה-tier-matcher של utm_id → utm_campaign → reject. הבדיקות האלה תופסות מיידית את הבאג ש-CR5-01 חשף ("utm_id fall-through to name match").

נושאים מינימליים לכסות:

1. **Tier 1 — utm_id match:** `utmId === campaignId` → `true`.
2. **Tier 1 — utm_id mismatch must NOT fall through to name (CR5-01):** order עם `utmId: 'camp-99'` ו-`utmCampaign: 'Summer Sale'`, vs campaign `{campaignId: 'camp-1', campaignName: 'Summer Sale'}` → **`false`** (לא `true`). זו הבדיקה הקריטית.
3. **Tier 1 — utm_id present without `campaign.campaignId`:** order עם `utmId: 'camp-1'` vs campaign בלי `campaignId` → **`false`** (לא fall-through ל-name).
4. **Tier 2 — name match:** order ללא `utmId`, עם `utmCampaign: 'summer sale'` (lower-case) vs campaign `campaignName: 'Summer Sale'` → `true` (case-insensitive + trimmed).
5. **Tier 2 — name mismatch:** order עם `utmCampaign: 'Winter Sale'` vs `campaignName: 'Summer Sale'` → `false`.
6. **No utm signals:** order עם `utmId: ''` ו-`utmCampaign: ''` → `false`.
7. **storeId mismatch:** order עם `storeId: 'uzoshop'` vs campaign `storeId: 'zolplus'` → `false` (גם אם utm_id תואם).
8. **platform mismatch:** campaign `platform: 'Google'` → תמיד `false`.

**pattern_ref:** `attributionAnalysis.ts:93-127` (`orderMatchesCampaign` ערכי-bool מובחנים) + CR5-01 documented in Round 5 review.

**research caveats applied:**
- CONCERNS.md ציטוט: "CR5-01 fall-through ב-`orderMatchesCampaign`" — זו הבדיקה ה-#2 לעיל. אם היא נכשלה, הקוד הקיים שונה ממה ש-Round 5 קבע.
- אין mocking — ה-function pure-functional, כל קלט הוא פשוט אובייקטים שנבנים ב-fixtures.

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/orderMatchesCampaign.test.ts` רץ עם exit code 0, מדפיס לפחות 6 passed
- `cd dashboard-web && npm run build` עובר
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/orderMatchesCampaign.test.ts` >= 6
- **negative test sanity:** הסיר זמנית את ה-guard ב-line 116 (`return !!campaign.campaignId && ...`) → ה-test #2 חייב להיכשל. השב את הקוד ל-state המקורי לפני commit. (זו בדיקה ידנית — לא מאוטומטת, אבל מומלץ כווידוא שהבדיקה אכן תופסת את הבאג.)

**commit_message:** `test(P2-03): add orderMatchesCampaign tests (covers CR5-01 fall-through)`

---

### T-04 — Tests for `analyzeAttribution`

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/analyzeAttribution.test.ts`

**description:**
~10-14 בדיקות שמכסות את הליבה של ה-campaign-level analyzer. ה-function הזה (`attributionAnalysis.ts:168-388`) הוא הרגיש ביותר לשינויים — refactor שיגרום ל-`trust.level === 'low'` במקום `'medium'` ינפח אזעקות-שווא לדשבורד.

נושאים לכסות:

1. **Non-Meta returns null:** `platform: 'Google'` → `null`.
2. **Empty orders returns null:** `orders: []` → `null`.
3. **No matched orders + metaClaim > 0:** trust `'unknown'`, score `30`, label `'לא ניתן לקבוע'`, recommendation מכיל "utm_campaign".
4. **No conversions on either side (metaClaim=0, no matched):** trust `'unknown'`, label `'אין המרות'`, score `0`. (זו ה-edge case ש-`analyzeAttribution` קיבל לאחרונה.)
5. **High coverage (>= 0.8):** 5 orders של 100 CAD vs metaClaim 500 → coverage 1.0 → trust `'high'`, label `'אמין'`. score בטווח `[70, 100]`.
6. **Halo (coverage >= 1.0):** 8 orders של 100 CAD vs metaClaim 500 → coverage clamped ל-2.0. recommendation מכיל "halo" / "גידול תקציב".
7. **Medium coverage (0.4 <= coverage < 0.8):** 3 orders של 100 CAD vs metaClaim 500 → coverage 0.6 → trust `'medium'`, label `'חלקי'`.
8. **Low coverage (< 0.4):** 1 order של 100 CAD vs metaClaim 500 → coverage 0.2 → trust `'low'`, label `'לא אמין'`. recommendation מכיל "Meta מנפח".
9. **Bayesian CI — sufficient sample with variance:** 5 orders, AOVs `[80, 100, 120, 90, 110]`, spend 200 → `roasInterval` לא-null, `low < mid < high`, `mid === deterministicRevenue / spend`.
10. **Bayesian CI — degenerate (variance=0, WR5-04):** 5 orders של 100 CAD זהה, spend 200 → `roasInterval === null` (לא degenerate point). זו הבדיקה הקריטית ל-fix של WR5-04.
11. **Bayesian CI — sample too small:** 2 orders → `roasInterval === null` (מתחת ל-3-order gate).
12. **Bayesian CI — spend=0:** `spend: 0` → `roasInterval === null` (guard בקוד).
13. **Outliers in reasons:** `dailyMetaSeries` עם yspike → אחד מה-`reasons` כולל "spikes" או "modeled".
14. **Window stability downgrade:** volatile windowStability + trust שהיה `'high'` → downgraded ל-`'medium'` (`trust.level !== 'high'` final). זו בדיקה לrouteline ב-`attributionAnalysis.ts:360-363`.

**pattern_ref:** `attributionAnalysis.ts:168-388` (`analyzeAttribution` הליבה) + `attributionAnalysis.ts:215-240` (Bayesian CI block — שם WR5-04 התגלה).

**research caveats applied:**
- CONCERNS.md ציטוט: "WR5-04 degenerate-CI כש-AOV זהה" — בדיקה #10 לעיל.
- בדיקות trust assertions: **לא** להשוות ל-`label` המדויק במחרוזת עברית פר test (skapes brittle). במקום, להשוות ל-`trust.level` (enum) ולעיתים `score` בטווח. אסור לחלוטין: `expect(trust.label).toBe('אמין')` ככלל; מותר רק כשהוא מהווה את ה-invariant הקריטי (כמו test #4 — שם ה-label "אין המרות" הוא ה-fix).
- Tolerance על מספרים: כל השוואת float יש להפעיל עם `toBeCloseTo(x, 4)` או `toBeGreaterThan` / `toBeLessThan`. אסור `===` על floats.

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/analyzeAttribution.test.ts` רץ עם exit code 0, מדפיס לפחות 10 passed
- `cd dashboard-web && npm run build` עובר
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/analyzeAttribution.test.ts` >= 10
- **negative test sanity (manual):** הסיר זמנית את ה-`if (variance === 0)` guard ב-line 220-226 → test #10 חייב להיכשל (`roasInterval` יהיה non-null עם low === high). השב את הקוד לפני commit.

**commit_message:** `test(P2-04): add analyzeAttribution tests (covers WR5-04 degenerate CI)`

---

### T-05 — Tests for `analyzeAttributionForAdSet` + `analyzeAttributionForAd`

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/analyzeAttributionForAdSet.test.ts`
- `dashboard-web/src/lib/__tests__/analyzeAttributionForAd.test.ts`

**description:**
שני קבצים, ~8-10 בדיקות לכל אחד. ה-functions האלה (`attributionAnalysis.ts:524-615`) משתמשים ב-shared engine `buildAnalysis` (line 622+), אז הרבה מהלוגיקה זהה ל-T-04 — **לא לכפול את ההגיון**. במקום, להתמקד ב:

**`analyzeAttributionForAdSet.test.ts`:**

1. **Non-Meta:** `platform: 'Google'` → `null`.
2. **Empty orders:** `orders: []` → `null`.
3. **Empty adSetId:** `adSetId: ''` → `null`.
4. **utm_term match:** order עם `utmTerm: 'adset-1'` vs adSet `adSetId: 'adset-1'` → matched.
5. **utm_term whitespace tolerance:** order עם `utmTerm: '  adset-1  '` vs adSet `adSetId: 'adset-1'` → matched (פר `.trim()` בקוד).
6. **utm_term mismatch:** order עם `utmTerm: 'adset-99'` → לא matched.
7. **storeId mismatch:** order `storeId: 'zolplus'` vs adSet `storeId: 'uzoshop'` → לא matched.
8. **Date filter:** order מחוץ ל-`[dateFrom, dateTo]` → לא matched.
9. **Level-specific advice (misconfigured):** trust `'unknown'` + `metaClaim > 0` → recommendation מכיל "ad-set" או "utm_term" (לא "utm_campaign").
10. **Level-specific advice (good halo):** coverage >= 1.0 → recommendation מכיל "ad-set" (האותיות הללו במחרוזת המתאימה ב-PATTERNS.md).
11. **Degenerate CI mirror (CR5-04 in buildAnalysis):** 5 orders של 100 CAD זהה → `roasInterval === null` (mirror של T-04 #10).

**`analyzeAttributionForAd.test.ts`:**

1-9 — אותו הדבר, אבל `utm_content` במקום `utm_term`, ו-`adId`/`adName` במקום `adSetId`/`adSetName`. הוסף לפחות 2 specific:
- 10. **Level-specific advice (good halo) מכיל "ad-sets נוספים":** ה-string ה-exact ב-`attributionAnalysis.ts:609`.
- 11. **Level-specific advice (bad) מכיל "לכבות":** ה-string ב-line 612.

**הערה:** אסור לבדוק את ה-trust ladder כולו פעמיים (כבר נבדק ב-T-04 ע"י עצם זה ש-`buildAnalysis` משותף). פה רק level-specific behaviors.

**pattern_ref:** `attributionAnalysis.ts:524-615` (שני ה-functions) + `attributionAnalysis.ts:622-746` (shared engine).

**research caveats applied:**
- אין כפילות לוגית עם T-04 — `buildAnalysis` משותף, אז זה sufficient לבדוק ה-trust ladder פעם אחת ב-T-04 ולאמת רק wiring + level-specific advice פה.
- האותיות הללו ב-recommendations — מתאימים בדיוק ל-source לעת הfreeze בPhase 1. אם השם משתנה ב-phase מאוחר יותר (Phase 8 i18n), בדיקה זו תיכשל ויש לעדכן ל-key lookup. **בPhase 2 — strict string match.**

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/analyzeAttributionForAdSet.test.ts src/lib/__tests__/analyzeAttributionForAd.test.ts` רץ עם exit code 0, סך passed >= 18
- `cd dashboard-web && npm run build` עובר
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/analyzeAttributionForAdSet.test.ts` >= 8
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/analyzeAttributionForAd.test.ts` >= 8

**commit_message:** `test(P2-05): add ad-set + ad attribution tests (level-specific advice)`

---

### T-06 — Tests for `analyzeProductChannel`

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/analyzeProductChannel.test.ts`

**description:**
~8-10 בדיקות ל-Phase-1 analyzer (`attributionAnalysis.ts:799-878`). הקריטריונים החשובים: empty-zero return (לא null), Facebook predicate locked, divide-by-zero guard, lineItems handling.

נושאים לכסות:

1. **Empty productIds → explicit-zero (not null):** `productIds: []` → `{totalOrders: 0, facebookShare: 0, ...}` (אובייקט שלם, לא null).
2. **Empty orders → explicit-zero:** `orders: []` → אותו דבר.
3. **Order without lineItems → skipped:** order עם `lineItems: undefined` או `lineItems: []` → לא נספר. **קריטי**: order עם `lineItems: []` חייב לחזור `totalOrders === 0` כשזה האונליגיר. (זה הbug ש-Round 5 חשף בעקיפין — "empty lineItems handling".)
4. **Facebook predicate — meta-paid:** order `source: 'meta-paid'` + `fbclidPresent: false` + has matching lineItem → counted as facebook.
5. **Facebook predicate — meta-organic:** order `source: 'meta-organic'` → counted as facebook.
6. **Facebook predicate — fbclidPresent only:** order `source: 'google-paid'` + `fbclidPresent: true` → **counted as facebook** (per locked CONTEXT predicate). זו בדיקה קריטית — אם הקוד שונה ל-`source.startsWith('meta-')` בלבד, בדיקה זו תיכשל.
7. **Non-Facebook order:** order `source: 'direct'` + `fbclidPresent: false` → לא facebook; נמצא ב-`bySource.direct`.
8. **Order counted ONCE even with multiple matched products:** order עם 2 lineItems שניהם תואמים `wantedIds` → `totalOrders === 1` (לא 2), אבל `totalRevenue` סוכם את שני ה-revenues.
9. **`facebookShare` divide-by-zero guard (Pitfall 3):** state עם `totalOrders === 0` → `facebookShare === 0` (לא NaN, לא Infinity). זה Pitfall 3 ב-Phase 1 RESEARCH.
10. **bySource bucketing:** 3 orders — 1 meta-paid, 1 google-paid, 1 source: '' → `bySource['meta-paid'].orders === 1`, `bySource['google-paid'].orders === 1`, `bySource.direct.orders === 1` (empty source lumped לdirect).
11. **Date+store filter:** orders מחוץ ל-`[dateFrom, dateTo]` או ב-store אחר → לא נספרים.
12. **`coverage` clamped at 2 (sanity):** **לא רלוונטי** ל-`analyzeProductChannel` — ה-analyzer הזה לא מחזיר coverage. אל תוסיף בדיקה כזו.

**pattern_ref:** `attributionAnalysis.ts:799-878` (`analyzeProductChannel`) + Phase 1 RESEARCH.md Pitfall 3.

**research caveats applied:**
- Pitfall 3 — `facebookShare = totalOrders > 0 ? facebookOrders / totalOrders : 0` (line 876). אסור לקבל NaN.
- Phase 1 §A4 — אין לוגריתם לקבצים מעל 40K — לא בדיקה לעת עתה, אבל אם תוסיף, יהיה ב-Phase 7.

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/analyzeProductChannel.test.ts` רץ עם exit code 0, מדפיס לפחות 8 passed
- `cd dashboard-web && npm run build` עובר
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/analyzeProductChannel.test.ts` >= 8
- **negative test sanity (manual):** שנה זמנית את line 876 ל-`facebookOrders / totalOrders` (ללא guard) → bdika #9 חייבת להיכשל (NaN במקום 0). השב את הקוד.

**commit_message:** `test(P2-06): add analyzeProductChannel tests (covers Pitfall 3 divide-by-zero)`

---

### T-07 — Tests for `detectOutlierDays` + `computeWindowStability`

**type:** `test`
**files:**
- `dashboard-web/src/lib/__tests__/detectOutlierDays.test.ts`
- `dashboard-web/src/lib/__tests__/computeWindowStability.test.ts`

**description:**
**הערה אדריכלית:** שני ה-helpers האלה הם **non-exported** ב-`attributionAnalysis.ts` (lines 398 ו-471). יש שתי דרכים לבדוק אותם:

- **אופציה A (preferred):** לבדוק עקיפית דרך `analyzeAttribution` — להעביר fixtures שכופים ערכים ספציפיים ולוודא שה-`outlierDays` או `windowStability` ב-output תואמים. **חסרון:** רעש מהlogic של trust ladder.
- **אופציה B:** לעדכן את ה-source לייצא את ה-helpers (`export function detectOutlierDays`, `export function computeWindowStability`). **חסרון:** modifies source.

**החלטה:** הולכים על **אופציה B** — מסיר את `function` ומשנה ל-`export function` עבור שני ה-helpers ב-`attributionAnalysis.ts`. זה שינוי additive (אין call sites קיימים שמסתמכים על internal scope), ו-Phase 4 component decomposition הם beneficiary של ה-export הזה ממילא (hooks יוכלו לייבא ישירות).

**עריכה ב-`attributionAnalysis.ts`** (במסגרת T-07 — same commit):
- line 398: `function computeWindowStability(` → `export function computeWindowStability(`
- line 471: `function detectOutlierDays(` → `export function detectOutlierDays(`

**`detectOutlierDays.test.ts`** — נושאים:

1. **Empty series → []:** `series: []` → `[]`.
2. **Too few points (< 8) → []:** `series` של 7 ימים → `[]`.
3. **No outliers (uniform values):** 14 ימים בערך 100 → `[]`.
4. **Single outlier:** 13 ימים של 100 + יום אחד של 1000 (ב-index 13) → ה-array כולל את התאריך של היום ה-14.
5. **Z-threshold (2.5σ):** 13 ימים של 100 + יום של 200 (≈ 1.5σ) → לא outlier. יום של 500 (≈ 5σ) → outlier.
6. **Trailing window scoping:** עם `LOOKBACK = Math.min(14, ...)` — ב-series של 10 ימים, ה-lookback הוא `min(14, max(5, floor(10/2)))` = 5. שני ימי outlier ב-idx 8 ו-9 → 2 outliers ב-output.
7. **Non-finite value in series → skip:** יום עם `value: NaN` → לא הופך ל-outlier בעצמו, ולא מזהם את הbaseline (פר line 487-488 בקוד).
8. **`stdDev === 0` skip (IN5-02):** series של 5 ימים זהים (100, 100, ..., 100) ואז יום של 500 → לא outlier, כי stdDev = 0 ולא ניתן לחשב z-score.

**`computeWindowStability.test.ts`** — נושאים:

1. **Range < 14 days → null:** dateRange של 7 ימים → `null`.
2. **No matched orders, no metaSeries → null:** `coverages.length < 2` → `null`.
3. **Tail bucket >= 3 days included:** 17 ימים (2 full windows + 3 tail) → `windowCount === 3` ב-output.
4. **Tail bucket < 3 days excluded (IN5-03):** 15 ימים (2 full windows + 1 tail) → `windowCount === 2` (tail dropped).
5. **`verdict === 'stable'`:** coverages קרובים (σ < 0.15) → verdict stable.
6. **`verdict === 'mixed'`:** σ בטווח [0.15, 0.35] → verdict mixed.
7. **`verdict === 'volatile'`:** σ > 0.35 → verdict volatile.
8. **Non-finite metaSeries value skipped (line 440-441):** יום עם `value: NaN` → לא מקלקל את ה-bucket. ה-bucket מחושב כאילו אותו יום לא היה.
9. **Non-finite order totalCad skipped (line 431):** order עם `totalCad: NaN` → לא נספר ב-bucket. (Hardening edge case.)

**pattern_ref:** `attributionAnalysis.ts:398-459` (`computeWindowStability`) + `attributionAnalysis.ts:471-499` (`detectOutlierDays`) + IN5-02 + IN5-03 documented.

**research caveats applied:**
- IN5-02 — `LOOKBACK = Math.min(14, Math.max(5, Math.floor(sorted.length / 2)))` — אם זה משתנה ב-refactor, בדיקה #6 תופסת.
- IN5-03 — tail bucket >= 3 — בדיקה #4.
- ה-`export` עריכת source היא חלק מה-task — לא לפצל לcommit נפרד (atomic).

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/detectOutlierDays.test.ts src/lib/__tests__/computeWindowStability.test.ts` רץ עם exit code 0, סך passed >= 16
- `cd dashboard-web && npm run build` עובר (export קיים → אין tsc errors)
- `grep -n "^export function computeWindowStability\|^export function detectOutlierDays" dashboard-web/src/lib/attributionAnalysis.ts` → 2 matches
- **`analyzeAttribution` ו-`buildAnalysis` עדיין עובדים אחרי שינוי ה-export:** קומפילציה עברה + הtests ב-T-04/T-05 עדיין עוברים (re-run them).

**commit_message:** `test(P2-07): add window stability + outlier tests; export helpers`

**Followup verification (after this task):**
ה-`grep -c` count של בדיקות-מבוצעות סה"כ אחרי T-07 צריך להיות **≥ 36**. כך נדע שכיסינו את היעד של 30-50 בדיקות.

---

### T-08 — Install `@sentry/nextjs` + config + env-driven DSN

**type:** `infra`
**files:**
- `dashboard-web/package.json`
- `dashboard-web/package-lock.json`
- `dashboard-web/sentry.client.config.ts`
- `dashboard-web/sentry.server.config.ts`
- `dashboard-web/sentry.edge.config.ts`
- `dashboard-web/instrumentation.ts`
- `dashboard-web/next.config.ts`
- `dashboard-web/.env.local.example`
- `dashboard-web/.gitignore`

**description:**
התקנה + wiring של `@sentry/nextjs` עם DSN env-driven. ה-config: Sentry מופעל **רק** כשה-DSN env var קיים. ב-localhost ללא DSN → no-op (כל ה-init יוצא מוקדם). זו ה-pattern של RESEARCH-ish-approach לתאימות עם development שלא רוצים noise.

1. **`package.json`** — להוסיף `"@sentry/nextjs": "^8.40.0"` ל-`dependencies` (לא devDeps — נדרש ב-runtime). גרסה 8.x מותאמת ל-Next.js 15 (גרסת 7.x ישנה מדי).

2. **`sentry.client.config.ts`** (root of `dashboard-web/`):
   ```typescript
   import * as Sentry from '@sentry/nextjs';

   const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
   if (dsn) {
     Sentry.init({
       dsn,
       tracesSampleRate: 0.1, // 10% — מספיק ל-debugging, חסכוני ב-quota
       replaysOnErrorSampleRate: 1.0,
       replaysSessionSampleRate: 0, // אין session replays רגילות — רק על error
       environment: process.env.NODE_ENV,
       integrations: [
         Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
       ],
     });
   }
   // אם dsn ריק → לא נעשה init. אין warning, אין log — silent no-op בlocalhost.
   ```

3. **`sentry.server.config.ts`** — דומה, אבל בלי replayIntegration (server side):
   ```typescript
   import * as Sentry from '@sentry/nextjs';

   const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
   if (dsn) {
     Sentry.init({
       dsn,
       tracesSampleRate: 0.1,
       environment: process.env.NODE_ENV,
     });
   }
   ```

4. **`sentry.edge.config.ts`** — דומה ל-server, ל-Edge Runtime (אם Vercel משלב). Phase 2 לא יוצר routes ב-Edge, אבל ה-config דרוש כי `@sentry/nextjs` reads אותו אם הוא קיים.

5. **`instrumentation.ts`** (root of `dashboard-web/`) — נדרש ב-Next.js 15:
   ```typescript
   export async function register() {
     if (process.env.NEXT_RUNTIME === 'nodejs') {
       await import('./sentry.server.config');
     }
     if (process.env.NEXT_RUNTIME === 'edge') {
       await import('./sentry.edge.config');
     }
   }

   export const onRequestError = (await import('@sentry/nextjs')).captureRequestError;
   ```

6. **`next.config.ts`** — לעטוף את ה-export עם `withSentryConfig`:
   ```typescript
   import type { NextConfig } from 'next';
   import { withSentryConfig } from '@sentry/nextjs';

   const nextConfig: NextConfig = {
     reactStrictMode: true,
     experimental: { serverActions: { bodySizeLimit: '2mb' } },
   };

   // Sentry build-time wrapper. כשאין SENTRY_AUTH_TOKEN, ה-wrapper לא יעלה sourcemaps —
   // אבל ה-runtime instrumentation ימשיך לעבוד. הgated behavior כאן ע"י ה-process.env בלבד.
   export default withSentryConfig(nextConfig, {
     org: process.env.SENTRY_ORG,
     project: process.env.SENTRY_PROJECT,
     silent: !process.env.CI, // ב-CI להראות logs; localhost שקט
     widenClientFileUpload: true,
     hideSourceMaps: true,
     disableLogger: true,
   });
   ```

7. **`.env.local.example`** — להוסיף 4 vars (כולם **אופציונליים** — מסומנים בהערה):
   ```
   # === Sentry (optional, errors reporting) ===
   # Without these, Sentry is a no-op. Get the DSN from sentry.io project settings.
   NEXT_PUBLIC_SENTRY_DSN=
   SENTRY_DSN=
   SENTRY_ORG=
   SENTRY_PROJECT=
   SENTRY_AUTH_TOKEN=
   ```

8. **`.gitignore`** — לוודא ש-`.env*.local` already-listed. להוסיף `.sentryclirc` אם יווצר ע"י ה-Sentry CLI.

**pattern_ref:** STACK.md "next.config.ts — minimal (strict mode + body size limit only)" — המבנה הנוכחי. CONCERNS.md §"דשבורד ללא client-side error reporting": "להוסיף Sentry (free tier מספיק)".

**research caveats applied:**
- DSN absent → no-op. אסור Sentry להפעיל את עצמו עם DSN חסר ולהדפיס warnings ב-localhost — זה מטעה.
- `widenClientFileUpload: true` + `hideSourceMaps: true` — מועיל ב-production ל-stack traces משוחזרים, אבל ה-sourcemaps לא נחשפים ב-client.
- ה-`silent: !process.env.CI` — חוסך noise ב-localhost.
- Sentry SDK 8.x — Next.js 15 compatibility (7.x crashes on App Router instrumentation).

**acceptance:**
- `cd dashboard-web && npm install` עובר ללא errors
- `cd dashboard-web && npm run build` עובר ללא errors **גם בלי DSN env vars** (no-op behavior)
- `grep -n "@sentry/nextjs" dashboard-web/package.json` מראה את התלות
- `ls dashboard-web/sentry.*.config.ts dashboard-web/instrumentation.ts` — כל 4 הקבצים קיימים
- Manual: שנה זמנית `NEXT_PUBLIC_SENTRY_DSN` למחרוזת invalid (לא DSN אמיתי, רק `"x"`) → `npm run dev` עדיין מעלה את ה-app (Sentry לא crashes — הוא loggs warning אבל לא חוסם). השב למחרוזת ריקה.
- ה-`next.config.ts` עכשיו עוטף את ה-config ב-`withSentryConfig` — `grep -n "withSentryConfig" dashboard-web/next.config.ts` יראה זאת.

**commit_message:** `feat(P2-08): install @sentry/nextjs + env-driven DSN config`

---

### T-09 — Add `ErrorBoundary` + wire into `app/layout.tsx`

**type:** `feature`
**files:**
- `dashboard-web/src/components/ErrorBoundary.tsx`
- `dashboard-web/src/app/layout.tsx`

**description:**
React class-component `ErrorBoundary` שתופס שגיאות בrendering tree של הילדים, מציג fallback UI בעברית RTL, ושולח את השגיאה ל-Sentry (אם מוגדר).

1. **`ErrorBoundary.tsx`** (חדש, client component):
   ```typescript
   'use client';

   import { Component, type ReactNode, type ErrorInfo } from 'react';
   import * as Sentry from '@sentry/nextjs';

   type Props = { children: ReactNode };
   type State = { hasError: boolean; error: Error | null };

   export class ErrorBoundary extends Component<Props, State> {
     state: State = { hasError: false, error: null };

     static getDerivedStateFromError(error: Error): State {
       return { hasError: true, error };
     }

     componentDidCatch(error: Error, info: ErrorInfo) {
       // ב-prod עם Sentry — נשלח. ב-localhost בלי DSN — Sentry.captureException
       // הוא no-op כי לא קרא ל-init. אז safe לקרוא ללא תנאי.
       Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
       // גם console.error ל-Vercel logs (במקרה ש-Sentry לא מוגדר).
       console.error('Dashboard crashed:', error, info.componentStack);
     }

     handleReset = () => {
       this.setState({ hasError: false, error: null });
     };

     render() {
       if (this.state.hasError) {
         return (
           <div className="min-h-screen flex items-center justify-center bg-background p-6">
             <div className="max-w-md rounded-2xl border border-borderSubtle bg-surface p-6 shadow-lg space-y-4">
               <h1 className="text-xl font-semibold text-text-primary">משהו השתבש</h1>
               <p className="text-sm text-text-secondary">
                 הדשבורד נתקל בשגיאה בלתי צפויה. ניתן לרענן את הדף או לנסות שוב.
               </p>
               <p className="text-[11px] text-text-muted font-mono break-all">
                 {this.state.error?.message ?? 'Unknown error'}
               </p>
               <div className="flex gap-2">
                 <button
                   onClick={this.handleReset}
                   className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                 >
                   נסה שוב
                 </button>
                 <button
                   onClick={() => window.location.reload()}
                   className="rounded-lg border border-borderSubtle px-4 py-2 text-sm font-medium text-text-primary hover:bg-surfaceMuted"
                 >
                   רענן דף
                 </button>
               </div>
             </div>
           </div>
         );
       }
       return this.props.children;
     }
   }
   ```

2. **`app/layout.tsx`** — לעטוף את `{children}` ב-`<ErrorBoundary>`:
   - להוסיף `import { ErrorBoundary } from '@/components/ErrorBoundary';`
   - לשנות:
     ```tsx
     <body className="font-sans antialiased text-text-primary bg-background">
       <ErrorBoundary>{children}</ErrorBoundary>
     </body>
     ```

**ה-ErrorBoundary צריך להיות client component** (`'use client'`) — class components לא ניתן להפעיל ב-server. `layout.tsx` נשאר server component, אבל מותר לו לרנדר client-component-child.

**pattern_ref:** STACK.md "אין `ErrorBoundary` global" (CONCERNS.md §"דשבורד ללא client-side error reporting") — phase 2 ממלא את ה-gap. עיצוב ה-fallback מתבסס על Tailwind tokens הקיימים (`bg-surface`, `border-borderSubtle`, `text-text-primary`).

**research caveats applied:**
- Class component הוא **חובה** ל-ErrorBoundary — אין hooks equivalent (React 19 כולם error handlers הוא class-only).
- `Sentry.captureException` במצב no-op (DSN חסר) — safe to call. אין צורך ב-conditional.
- Boundary ב-root הוא ה-catch-all האחרון. ל-Phase 4 (decomposition) — בעתיד ייתכן וisbn ניתן להוסיף boundaries מקומיים סביב CampaignDrawer וכו'. **לא בPhase 2.**
- RTL — `min-h-screen flex items-center justify-center` עובד אותו דבר ב-RTL וב-LTR; הכפתורים מוצבים ע"י flex עם `gap-2`, ה-RTL flip של Tailwind לא משפיע על gap.

**acceptance:**
- `cd dashboard-web && npm run build` עובר
- `cd dashboard-web && npm run test` עדיין עובר (אין test לERrorBoundary, אבל ה-imports שלו דרך `@sentry/nextjs` חייבים לעמוד ב-tsc)
- `grep -n "<ErrorBoundary>" dashboard-web/src/app/layout.tsx` → 1 match
- Manual smoke: `npm run dev`, פתח דף, אין white-screen, אין warnings ב-DevTools console.
- Manual smoke for actually triggering boundary (optional, לתיעוד בלבד — לא לcommitnik):
  - הוסף זמנית `throw new Error('test');` ב-`Dashboard.tsx` render
  - load → ה-fallback מופיע עם "משהו השתבש"
  - "נסה שוב" כפתור מאפס את ה-state — לאחר שהthrow הוסר, ה-app מתחיל לעבוד
  - **הסר את ה-throw לפני commit.**

**commit_message:** `feat(P2-09): add global ErrorBoundary with RTL fallback UI`

---

### T-10 — Create `cacheConfig.ts` + update all 8 API routes atomically

**type:** `refactor`
**files:**
- `dashboard-web/src/lib/cacheConfig.ts`
- `dashboard-web/src/app/api/data/route.ts`
- `dashboard-web/src/app/api/campaigns/route.ts`
- `dashboard-web/src/app/api/products/route.ts`
- `dashboard-web/src/app/api/ads/route.ts`
- `dashboard-web/src/app/api/orders-attribution/route.ts`
- `dashboard-web/src/app/api/store-meta/route.ts`
- `dashboard-web/src/app/api/product-catalog/route.ts`
- `dashboard-web/src/app/api/dashboard-state/route.ts`

**description:**
**משימה אטומית — single commit.** אם נפצל את ה-`cacheConfig.ts` create לcommit אחד ואת ה-routes update לcommit שני, ה-routes לא יקמפלו ב-commit אמצעי. כל ה-8 routes חייבים לעדכן ביחד.

1. **`cacheConfig.ts`** (חדש):
   ```typescript
   /**
    * Single source of truth for API route cache settings. Each entry pairs
    * `revalidate` (server-side ISR window in seconds) with `swr` (CDN
    * stale-while-revalidate window). The `cacheControl(key)` helper returns
    * the corresponding `Cache-Control` header value.
    *
    * Adding a new route: extend `CACHE_CONFIG`, then use both
    * `CACHE_CONFIG[key].revalidate` for `export const revalidate` and
    * `cacheControl(key)` for the response header.
    */

   export const CACHE_CONFIG = {
     data: { revalidate: 60, swr: 120 },
     campaigns: { revalidate: 60, swr: 120 },
     products: { revalidate: 60, swr: 120 },
     ads: { revalidate: 300, swr: 900 },
     ordersAttribution: { revalidate: 300, swr: 900 },
     storeMeta: { revalidate: 3600, swr: 86400 },
     productCatalog: { revalidate: 60, swr: 300 },
     dashboardState: { revalidate: 10, swr: 60 },
   } as const;

   export type CacheKey = keyof typeof CACHE_CONFIG;

   export function cacheControl(key: CacheKey): string {
     const { revalidate, swr } = CACHE_CONFIG[key];
     return `public, s-maxage=${revalidate}, stale-while-revalidate=${swr}`;
   }
   ```

2. **כל 8 ה-routes** — לעדכן את ה-`export const revalidate = N` ולחליף את ה-`Cache-Control` המחרוזת ב-`cacheControl(key)`. דוגמה ל-`api/data/route.ts`:

   **לפני:**
   ```typescript
   export const revalidate = 60;
   ...
   headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
   ```

   **אחרי:**
   ```typescript
   import { CACHE_CONFIG, cacheControl } from '@/lib/cacheConfig';
   export const revalidate = CACHE_CONFIG.data.revalidate;
   ...
   headers: { 'Cache-Control': cacheControl('data') },
   ```

   חזור על כל route עם ה-key המתאים:
   - `api/data` → key `'data'`
   - `api/campaigns` → key `'campaigns'`
   - `api/products` → key `'products'`
   - `api/ads` → key `'ads'`
   - `api/orders-attribution` → key `'ordersAttribution'`
   - `api/store-meta` → key `'storeMeta'`
   - `api/product-catalog` → key `'productCatalog'`
   - `api/dashboard-state` → key `'dashboardState'`

3. **Two values previously-different to consolidate:** ה-`api/product-catalog/route.ts` היה עם `s-maxage=60, swr=300`. ב-`cacheConfig.ts` שמרנו את אותם ערכים. אם בעתיד נרצה לעדכן, שינוי במקום אחד.

4. **לא לשנות ערכי TTL ב-Phase הזה!** המטרה היא לcentral מקור-אמת, **לא** לכוון את ה-values. אם יבחר אגב refactor לשנות TTL, זה task נפרד. ה-`CACHE_CONFIG` חייב להחזיר 1-to-1 את הערכים הקיימים.

**pattern_ref:** CONCERNS.md §"Cache TTLs hardcoded per-route" — code snippet שלם מצוטט שם. הקובץ החדש הוא מימוש מדוייק שלו.

**research caveats applied:**
- ה-`as const` נחוץ כדי ש-`CacheKey` יקבל את ה-union הצר (`'data' | 'campaigns' | ...`) ולא `string` רחב — type-safety.
- חייב לעדכן את שני ה-references בכל route: `export const revalidate` **וגם** ה-header. אם יוחלף רק אחד, יש drift בין הם.
- `api/data/route.ts:8` כולל גם `export const dynamic = 'force-dynamic';` — **לא** לגעת בזה. ה-`force-dynamic` נדרש כדי לעקוף את `revalidate` ב-server side; ה-`Cache-Control` קובע ב-CDN. (יש הערה ב-store-meta/route.ts על הכפילות הזו.)
- ה-`api/dashboard-state` משתמש ב-revalidate=10 — מעוצב כדי לתמוך ב-cloudSync polling. **לא** לשנות.

**acceptance:**
- `cd dashboard-web && npm run build` עובר (TypeScript מאמת את כל ה-keys)
- `cd dashboard-web && npm run test` עובר
- `cd dashboard-web && npm run lint` עובר
- `grep -c "s-maxage=" dashboard-web/src/app/api/*/route.ts` = **0** (כל ה-hardcoded strings הוחלפו ב-`cacheControl()`)
- `grep -c "cacheControl\|CACHE_CONFIG" dashboard-web/src/app/api/*/route.ts` = **>= 16** (8 routes × 2 references min — `revalidate` + header)
- `grep -n "export const CACHE_CONFIG\|export function cacheControl" dashboard-web/src/lib/cacheConfig.ts` → 2 matches
- Manual smoke: `npm run dev`, פתח `localhost:3000`, ה-dashboard נטען. בdevtools Network tab, response headers ל-`/api/data` עדיין מכילים `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`.

**commit_message:** `refactor(P2-10): extract cache TTLs to cacheConfig + cacheControl helper`

---

### T-11 — Add row-count guards to all 8 API routes (single commit)

**type:** `feature`
**files:**
- `dashboard-web/src/app/api/data/route.ts`
- `dashboard-web/src/app/api/campaigns/route.ts`
- `dashboard-web/src/app/api/products/route.ts`
- `dashboard-web/src/app/api/ads/route.ts`
- `dashboard-web/src/app/api/orders-attribution/route.ts`
- `dashboard-web/src/app/api/store-meta/route.ts`
- `dashboard-web/src/app/api/product-catalog/route.ts`
- `dashboard-web/src/app/api/dashboard-state/route.ts`

**description:**
**משימה אטומית — single commit.** הפעם ה-pattern זהה ב-8 הroutes, אז commit יחד מסתבר (אין סיכון של half-applied).

לכל route — אחרי קריאת הdata (לפני ה-`NextResponse.json`), להוסיף:

```typescript
if (rows.length > 50000) {
  console.warn(`/api/<route-name>: large response (${rows.length} rows) — consider pagination`);
}
```

הheuristic: ה-threshold 50000 נבחר בעקבות CONCERNS.md §"Recommendations 8" וההערכה הנוכחית של ~10k שורות ב-campaigns. 50k = 5× headroom; ערכת sane signal לפני שpagination הופך לחובה.

**variable name לכל route** (לא תמיד `rows`):
- `api/data` → `rows` (כבר ב-data)
- `api/campaigns` — fetch returns `rows` (לבדוק את הקובץ — variable name)
- `api/products` — דומה
- `api/ads` — דומה
- `api/orders-attribution` → `rows`
- `api/store-meta` → `stores` (array, not necessarily `rows` — להתאים)
- `api/product-catalog` — דומה
- `api/dashboard-state` — **edge case**: ה-response הוא `Object.fromEntries(...)` (kv map), לא array. שם להוסיף `Object.keys(state).length > 50000` עם הודעה שונה ("large state size"). או — לדלג ב-`dashboard-state` כי הוא מוגבל ע"י `ALLOWED_STATE_KEYS` (8 keys בלבד). **החלטה:** לדלג — להוסיף הערה inline `// dashboard-state is bounded by ALLOWED_STATE_KEYS (8 keys) — no guard needed`.

**route-by-route walkthrough:**
1. **`api/data`** — אחרי `const [rows, fxIlsToCad] = await Promise.all(...)`, לפני `const stores = ...`: `if (rows.length > 50000) console.warn('/api/data: large response (${rows.length} rows) ...');`
2. **`api/campaigns`** — אחרי fetch, לפני ה-response.
3. **`api/products`** — אחרי fetch.
4. **`api/ads`** — אחרי fetch.
5. **`api/orders-attribution`** — אחרי `const rows = await fetchOrdersAttribution();`, לפני `return NextResponse.json(...)`.
6. **`api/store-meta`** — אחרי fetch (probably variable `stores`).
7. **`api/product-catalog`** — אחרי fetch.
8. **`api/dashboard-state`** — דלג עם הערה inline.

**pattern_ref:** CONCERNS.md §"Recommendations 8 — Row-count guards ב-API routes": "להוסיף `if (rows.length > 50000) console.warn(...)` בכל route".

**research caveats applied:**
- ה-`console.warn` הולך ל-Vercel logs בproduction. אם Sentry מוגדר (Phase 2 T-08), serverSide Sentry יתפוס את ה-warn אוטומטית. **לא** ל-`Sentry.captureMessage` ב-קוד — `console.warn` enough.
- threshold 50000 — לתעד שזה plan-level decision. אם נתונים גדלים יותר מ-200k בעתיד, להעלות. לא לעשות "תכלה לעת עתה".

**acceptance:**
- `cd dashboard-web && npm run build` עובר
- `cd dashboard-web && npm run test` עובר
- `grep -c "rows.length > 50000\|Object.keys.*> 50000\|stores.length > 50000" dashboard-web/src/app/api/*/route.ts` = **>= 7** (7 routes + dashboard-state skipped)
- `grep -n "ALLOWED_STATE_KEYS (8 keys)" dashboard-web/src/app/api/dashboard-state/route.ts` → 1 match (הסיבה לדלג)
- Manual smoke: `npm run dev`, פתח dashboard — אין warnings בקונסול (כי <50k rows). אם נרצה לוודא שה-guard פועל — אפשר לעקוף זמנית את ה-threshold ל-`> 1` ולראות warning. **לא ל-commit את העקיפה הזו.**

**commit_message:** `feat(P2-11): add 50k row-count warnings to all 8 API routes`

---

### T-12 — Add `safeDecode` utility + tests + call site (or document why none)

**type:** `feature`
**files:**
- `dashboard-web/src/lib/utils.ts`
- `dashboard-web/src/lib/__tests__/utils.test.ts`

**description:**
לבנות `safeDecode` ב-`utils.ts` עם בדיקות יחידה. ה-utility היא הגנה preemptive — CONCERNS.md §"`decodeURIComponent` ללא try/catch" מציין ש-Round 5 כבר תיקן את Apps Script side; phase 2 מוסיף ה-equivalent ב-dashboard-web ל-future use.

1. **`utils.ts`** — להוסיף בסוף הקובץ:
   ```typescript
   /**
    * Try/catch wrapper around `decodeURIComponent`. Returns the decoded
    * string on success, or the input unchanged on failure. Use anywhere a
    * decoded URL-encoded user-supplied string is consumed (utm parameters
    * already in Sheets, landing-URL manual-spend rows, anything that could
    * contain a lone `%` character that crashes `decodeURIComponent`).
    *
    * Why not throw? The original `decodeURIComponent('%E0')` throws
    * `URIError: URI malformed`. In a UI render path that's a white-screen.
    * Returning the raw input lets the caller render the as-is value
    * (slightly ugly) rather than crash the page.
    */
   export function safeDecode(value: string | null | undefined): string {
     if (value == null) return '';
     try {
       return decodeURIComponent(value);
     } catch {
       return value;
     }
   }
   ```

2. **`__tests__/utils.test.ts`** (new) — בדיקות ל-`safeDecode`:
   - **Valid encoded:** `safeDecode('Summer%20Sale')` → `'Summer Sale'`.
   - **Invalid encoded (lone %):** `safeDecode('100%')` → `'100%'` (לא crash).
   - **Empty string:** `safeDecode('')` → `''`.
   - **null:** `safeDecode(null)` → `''`.
   - **undefined:** `safeDecode(undefined)` → `''`.
   - **Already-decoded (no %):** `safeDecode('Summer Sale')` → `'Summer Sale'`.
   - **Hebrew encoded:** `safeDecode('%D7%A7%D7%99%D7%A5')` → `'קיץ'` (sanity לUTF-8 multi-byte).
   - **Malformed mid-string:** `safeDecode('foo%E0bar')` → `'foo%E0bar'` (returns input as-is — the catch path).

   ~7-8 בדיקות. **Negative test sanity (manual):** הסיר זמנית את ה-`try/catch` ב-utils.ts → bdika #2 חייבת לcrash עם URIError. השב.

3. **Call site swap (REQ-05 — "one or more existing call sites switched to use it"):**

   **חיפוש בפועל בדשבורד:** `grep -rn "decodeURIComponent" dashboard-web/src/` — נכון להיום, **0 matches**.

   **המשמעות:** אין call site קיים ב-dashboard-web. ה-utility נכנס preemptively כי:
   1. Phase 5 (Scalability) יוסיף `?from=&to=` query params לroutes — ה-`searchParams.get('utm_campaign')` שיגיע ידני יצטרך safeDecode.
   2. Phase 8 (i18n) ייתכן ויקרא query params לאסוף UI strings.
   3. השאיפה ב-CONCERNS.md היא "להחליף כל קריאת `decodeURIComponent` בה" — לא "להחליף כיוון שאין כאלה".

   **תיעוד:** להוסיף הערה בראש ה-`safeDecode` הdocblock (כבר נכלל לעיל) שמסבירה שאין call sites קיימים, אך ה-utility מוכן ל-`ordersAttribution.ts` ול-Phase 5/8.

   **אם משהו השתנה בין task design ל-execution** (ניתוח `grep` חוזר ב-execution time מראה call sites חדשים — למשל אם Phase 1 הוסיף משהו שלא שמתי לב לו): **כן** להחליף את כל ה-call sites ל-`safeDecode`. אחרת — לרשום ב-acceptance ש"0 call sites existed at task time" ולהמשיך.

**pattern_ref:** STACK.md `lib/utils.ts` (existing helpers `cn`, `formatCurrency`, `formatNumber`, `formatDate`, `formatPct`) — `safeDecode` נוסף כsibling. CONCERNS.md §"`decodeURIComponent` ללא try/catch": "ליצור `safeDecode` ב-`dashboard-web/src/lib/utils.ts` כ-utility משותף".

**research caveats applied:**
- null/undefined → `''` (לא `null`) — מקל על callers, ע"י matching pattern של `formatDate` הקיים שמחזיר string תמיד.
- במקרה של URIError, **לא** ל-`console.warn` (ה-call sites עתידיים יקראו את זה ב-render hot paths — לא רוצים noise).
- אם רוצים observability, אפשר ב-Phase 7 להוסיף Sentry breadcrumb. **לא ב-Phase 2.**

**acceptance:**
- `cd dashboard-web && npm run test src/lib/__tests__/utils.test.ts` רץ עם exit code 0, מדפיס לפחות 7 passed
- `cd dashboard-web && npm run build` עובר
- `grep -n "export function safeDecode" dashboard-web/src/lib/utils.ts` → 1 match
- `grep -c "^  it\|^    it\|^  test\|^    test" dashboard-web/src/lib/__tests__/utils.test.ts` >= 7
- `grep -rn "decodeURIComponent" dashboard-web/src/ | grep -v "__tests__\|utils.ts"` count: אם 0 — תיעוד ב-commit message ש"no call sites existed at task time". אם >0 — כל ה-call sites הוחלפו ל-`safeDecode`.

**commit_message:** `feat(P2-12): add safeDecode utility + tests (no existing call sites)`

או, אם נמצאו call sites:

**commit_message:** `feat(P2-12): add safeDecode utility + replace N existing decodeURIComponent call sites`

---

### T-13 — Update README.md + SYSTEM_OVERVIEW.md

**type:** `docs`
**files:**
- `dashboard-web/README.md`
- `SYSTEM_OVERVIEW.md`

**description:**
שתי דfunקציות תיעוד אחרי שכל הקוד התקבל:

1. **`dashboard-web/README.md`** — להוסיף סעיפים:
   - **Testing:** "Run `npm run test` to run vitest. Tests live in `src/lib/__tests__/`. Coverage focuses on `attributionAnalysis.ts` pure functions (30-50 tests). No integration tests yet — they're in scope for Phase 4."
   - **Sentry:** "Set `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` to enable client + server error reporting. Without these vars, Sentry is a silent no-op (zero overhead, zero warnings in localhost)."
   - **Cache config:** "All API route cache settings live in `src/lib/cacheConfig.ts`. To change a TTL, edit that file — don't touch the route handlers."
   - **Utilities:** הוסף `safeDecode` לרשימת ה-exports ב-`lib/utils.ts`.

2. **`SYSTEM_OVERVIEW.md`** — להוסיף תת-סעיף בסעיף "שכבת ה-Dashboard" (אחרי ה-cloudSync explanation):
   - **שכבת בדיקות (Phase 2):** "ה-dashboard מצויד ב-Vitest. הבדיקות ב-`src/lib/__tests__/` מכסות את ה-pure-functions ב-`attributionAnalysis.ts`. `npm run test` לפני כל merge ל-main."
   - **שכבת monitoring (Phase 2):** "Sentry mountd ב-`instrumentation.ts` + global ErrorBoundary ב-`app/layout.tsx`. שגיאות client + server זורמות ל-Sentry dashboard (כשמוגדר DSN). ב-localhost — no-op."
   - **שכבת cache config (Phase 2):** "`src/lib/cacheConfig.ts` הוא מקור-אמת יחיד ל-revalidate + Cache-Control של כל 8 ה-API routes."
   - **שכבת row-count guards (Phase 2):** "כל route עם `console.warn` אם תוצאות > 50k שורות. רץ ב-Vercel logs."

**pattern_ref:** Phase 1 T-08 — אותה דפוס של double-doc update (README + SYSTEM_OVERVIEW).

**research caveats applied:**
- אין כאן side effects לקוד — pure docs.
- **לא** ל-overwrite סעיפים קיימים. כל החתימה היא **additive**.

**acceptance:**
- `grep -ni "vitest\|Sentry\|cacheConfig\|safeDecode" dashboard-web/README.md` → multiple matches
- `grep -ni "Phase 2\|Sentry\|cacheConfig\|בדיקות\|monitoring" SYSTEM_OVERVIEW.md | head -20` → multiple matches (Phase 2 sections)
- `git diff dashboard-web/README.md SYSTEM_OVERVIEW.md` — purely additive (no deletions)
- `cd dashboard-web && npm run build` עובר (sanity — לא תפסיק את ה-build בעת editing of docs)

**commit_message:** `docs(P2-13): document vitest + Sentry + cacheConfig + row-count guards`

---

### T-14 — Manual smoke + final verification gate

**type:** `operator-manual`
**files:**
- *(none — verification only)*

**description:**
**Final gate** של ה-Phase. ה-operator (User) רץ את הבדיקות הבאות באופן ידני לאחר ש-T-01..T-13 בוצעו:

1. **`cd dashboard-web && npm run test`** — exit code 0, סך passed >= 36 (3 + 10 + 8 + 8 + 8 + 7 = שווה ערך לcounts מ-T-03..T-07, T-12).
2. **`cd dashboard-web && npm run build`** — exit code 0, אין tsc errors, אין SWC warnings חדשים.
3. **`cd dashboard-web && npm run lint`** — exit code 0.
4. **`cd dashboard-web && npm run dev`** — server עולה (port 3000 default), אין crashes ב-startup.
5. **פתח `localhost:3000`** — ה-dashboard נטען. אין white-screen. בdevtools Console — אין warnings חדשים.
6. **Network tab** — ה-response של `/api/data` כולל `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`. (וידוא ש-T-10 לא שבר את הheaders.)
7. **בלי DSN env vars** — אין Sentry logs בקונסול. (Verify ש-T-08 לא תקף את ה-no-op-ness.)
8. **(Optional, אם יש DSN לviz)** — Set `NEXT_PUBLIC_SENTRY_DSN=<real_dsn>`, restart dev, fire an error manually (`throw new Error('phase2-smoke')` ב-Dashboard render, לטעון, להסיר את ה-throw). תוך 30s ה-error יופיע ב-Sentry dashboard. **חוזר ל-DSN ריק לפני commit.**

**אם משהו נכשל ב-T-14, **לא לcommit את phase-completion marker** ב-ROADMAP. במקום, לחזור לtask הספציפי, לתקן, לרץ T-14 שוב.

**pattern_ref:** Phase 1 T-07 — operator-manual verification step בסוף. Phase 2 פשוט יותר כי אין Apps Script — אין backfill, אין uploads.

**research caveats applied:**
- ה-`npm run test` count: 36 הוא מינימום בעקבות targets ב-T-03..T-07 (6+10+18+8+16+7=65 אם כולל T-12+T-07. עכבן 36 הוא ה-floor). אם הספירה גבוהה יותר — מצוין.
- אין רגרסיה ב-Apps Script side — phase 2 dashboard-only, אז אין reason לrun הApps Script tests (אין כאלה ממילא).

**acceptance:**
- כל 7 הבדיקות לעיל עברו
- ה-operator מאשר ב-PR description: "T-14 passed: tests=N, build=clean, lint=clean, manual smoke=clean"
- ROADMAP.md — סמן Phase 2 כ-`[x]` (commit נפרד ע"י המשתמש)

**commit_message:** *(אין commit — verification only. ה-ROADMAP toggle הוא commit נפרד שלאחר מכן.)*

---

## Verification Gates Between Tasks

**אחרי T-01:** `npm run test` exit 0 (no tests found), `npm run build` עובר. **gate 1 — vitest מותקן.**

**אחרי T-02:** ה-fixtures מקמפלים. `npm run test` עדיין exit 0. **gate 2 — fixtures readable.**

**אחרי T-03..T-07:** סך הבדיקות הולך וגדל. אחרי T-07 — סך passed >= 36. `npm run build` עובר. **gate 3 — tests pass.**

**אחרי T-08:** `npm install` עובר, `npm run build` עובר **גם בלי DSN env vars**. אם build נכשל בלי DSN, ה-config שגוי. **gate 4 — sentry no-op safe.**

**אחרי T-09:** dashboard נטען ב-`npm run dev` ללא white-screen. **gate 5 — boundary doesn't crash.**

**אחרי T-10:** `grep -c "s-maxage="` ב-routes = 0 (כל ה-hardcoded strings הוחלפו). dashboard עדיין טוען. **gate 6 — cache refactor clean.**

**אחרי T-11:** `npm run build` עובר. **gate 7 — guards added.**

**אחרי T-12:** `safeDecode` tests עוברים. **gate 8 — utility ready.**

**אחרי T-13:** docs additive. **gate 9 — docs done.**

**אחרי T-14:** ה-operator מאשר. **final gate — phase done.**

---

## Risks + Rollback Notes

### Risk 1 — Test reveals a bug in attributionAnalysis (e.g. CR5-01 not actually fixed)
**Cause:** ה-test ב-T-03 (`orderMatchesCampaign` #2) נכשל. סימן ש-Round 5 לא תוקן או שregression חדש נכנס.
**Mitigation:** ל-**lo** לתקן את הקוד ב-`attributionAnalysis.ts` במסגרת Phase 2 (atomicity). במקום: לתעד את הbaאג ב-`FOLLOWUP.md` עם file:line + הt טסט שמכשל. ליצור task `T-99 — Fix discovered bug` ב-Phase 2 (או commit ידני נפרד) אחרי T-14.
**Severity:** Recoverable. ה-test הופיע לeven זאת ב-Phase 2 — זה ערך נטו.

### Risk 2 — Sentry config breaks build ב-CI ללא env vars
**Cause:** `withSentryConfig` ב-`next.config.ts` מצפה ל-`org`/`project` ב-build time. אם הם חסרים → silent skip ב-localhost, אבל ב-CI/Vercel — אולי warning.
**Mitigation:** ה-config משתמש ב-`silent: !process.env.CI` — לפי STACK.md הdeploy הוא ל-Vercel; ה-`CI=true` שם default. Vercel will not crash על warning של missing sourcemaps.
**Severity:** Low. אם build נכשל בכל זאת, להסיר את `withSentryConfig` ולחזור ל-`export default nextConfig;` ב-task נפרד (ה-runtime instrumentation ימשיך לעבוד בלי ה-build wrapper).

### Risk 3 — `cacheConfig.ts` שינוי ב-route מקלקל את ה-CDN cache
**Cause:** ה-`Cache-Control` value שונה ב-route ב-deploy → Vercel CDN רואה את ה-`stale-while-revalidate` עם ערך חדש → cache miss תקופתית.
**Effect:** הdashboard "טעון מחדש" פעם או שתיים. לא קריטי.
**Mitigation:** T-10 שומר את הערכים זהים ל-pre-refactor. אם בעתיד ירצו לעדכן, יוקדם change-log notice.
**Severity:** Self-recovers. ה-cache settles תוך 60-300s.

### Risk 4 — ה-`row-count-guard` ב-T-11 משקר על באמת
**Cause:** ה-threshold 50000 נקבע ע"י heuristic. ייתכן ובעוד שנה הנתונים יגדלו מתחת ל-50k ועדיין צריך pagination.
**Mitigation:** ב-Phase 5 (Scalability) — pagination יושלם. ה-warning הוא רק signal, לא חוסם.
**Severity:** Cosmetic. ה-warning יופיע 50k+ row, או לא יופיע 10k row — אופציה לעצב את ה-threshold ב-Phase 5.

### Rollback path (worst case)
ה-phase כולו additive (אין שמות-שורות שהוסרו, אין types שעודכנו ב-breaking way).

1. **ירוץ revert על T-08..T-09** אם Sentry מקלקל deploys → ה-dashboard ימשיך לעבוד בלי error reporting.
2. **ירוץ revert על T-10** אם ה-cacheConfig מסבך — ה-routes עדיין מקבלים את ה-hardcoded values revert-ed.
3. **T-01..T-07 ו-T-11..T-13** — pure additions; אין סיכון לrevert (Vitest install נמצא ב-devDependencies — אם revert, just `npm install` שוב).
4. **שום data corruption לא אפשרית** — Phase 2 אין שינויי schema, אין Apps Script changes, אין Sheets writes משונות.

---

## Multi-Source Coverage Audit

| Source Item | Type | Plan Coverage |
|-------------|------|---------------|
| **ROADMAP Goal** — "smallest-effort highest-leverage infrastructure" testing/observability/utilities | GOAL | T-01 .. T-13 |
| **REQ-01** — Vitest + 30-50 unit tests covering `attributionAnalysis.ts` (all 7 named functions) | REQ | T-01 (vitest) + T-02 (fixtures) + T-03 (orderMatchesCampaign) + T-04 (analyzeAttribution) + T-05 (forAdSet + forAd) + T-06 (analyzeProductChannel) + T-07 (detectOutlierDays + computeWindowStability) |
| **REQ-02** — Sentry SDK + global ErrorBoundary | REQ | T-08 (Sentry) + T-09 (ErrorBoundary) |
| **REQ-03** — `cacheConfig.ts` + `cacheControl(key)` helper, all 8 routes use it | REQ | T-10 |
| **REQ-04** — Row-count guards in all `/api/*` routes | REQ | T-11 |
| **REQ-05** — `safeDecode` utility + at least one call site (or document) | REQ | T-12 |
| **REQ-06** — `npm run build` passes with zero new TypeScript errors | REQ | Verification gate after every task + T-14 final |
| **CONCERNS.md §"אין test suite"** — focus on `attributionAnalysis.ts` deterministic fixtures | CONCERNS | T-02 (fixtures) + T-03..T-07 (tests) |
| **CONCERNS.md §"דשבורד ללא client-side error reporting"** — Sentry + ErrorBoundary | CONCERNS | T-08 + T-09 |
| **CONCERNS.md §"Cache TTLs hardcoded per-route"** — `cacheConfig.ts` שלם | CONCERNS | T-10 |
| **CONCERNS.md §"Row-count guards in API routes"** | CONCERNS | T-11 |
| **CONCERNS.md §"`decodeURIComponent` ללא try/catch"** — `safeDecode` ב-`utils.ts` | CONCERNS | T-12 |
| **CR5-01 (utm_id fall-through)** | Round 5 bug | T-03 test #2 |
| **WR5-04 (degenerate Bayesian CI when variance=0)** | Round 5 bug | T-04 test #10 |
| **Pitfall 3 (divide-by-zero in facebookShare)** | Phase 1 RESEARCH | T-06 test #9 |
| **Phase 1 "empty lineItems handling"** | Phase 1 fix | T-06 test #3 |
| **IN5-02 (LOOKBACK adaptive sizing)** | Round 5 internal | T-07 (detectOutlierDays) test #6 |
| **IN5-03 (tail bucket >= 3 days)** | Round 5 internal | T-07 (computeWindowStability) test #4 |
| **Phase 4 dependency** — needs tests to verify no regression | ROADMAP | T-03..T-07 provide the regression net |

**All items COVERED. No gaps. No items deferred to a later phase.**

---

## Notes on Scope Discipline

**Phase 2 ב-strict scope:**
- **In scope:** Vitest install, attributionAnalysis tests, Sentry, ErrorBoundary, cacheConfig, row-count guards, safeDecode.
- **Out of scope (deferred to later phases):**
  - בדיקות ל-`analytics.ts` / `campaignProductMap.ts` / `ordersAttribution.ts::parseSource` — CONCERNS.md מציין שגם הם חסרי-tests, אבל phase 2 מתמקד ב-`attributionAnalysis.ts` בלבד פר ROADMAP. אם נשאר זמן/budget ב-phase, אפשר להוסיף ב-`T-15-bonus` task — **אבל לא כschedule דרישה.**
  - End-to-end browser tests — Phase 4 + Phase 7 ידאגו לכך.
  - Apps Script-side tests — אין test runner ל-Apps Script V8; Phase 7 (observability) ידאג ל-logs tab במקום.
  - Sentry monitoring dashboard setup — נדרש user-side (Vercel env var + Sentry account). תהליך מתועד ב-README אבל לא commit-able.

**אם בזמן execution התעורר רעיון:** לתעד ב-`.planning/FOLLOWUP.md`, **לא** להוסיף לphase 2 mid-execution. Phase 2 שלם וsealed ב-T-14.
