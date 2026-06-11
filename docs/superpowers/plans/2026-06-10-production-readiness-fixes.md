# Production-Readiness Fixes — Implementation Plan (from the 2026-06-10 full-system audit)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, wave-by-wave. Each task: TDD (failing test → fix → green), full suites (`npx tsc --noEmit`, `npx vitest run`, `npm run test:components`) before commit. **No push / no prod-migration without the operator's explicit "deploy".**
>
> **Source findings:** `docs/superpowers/specs/2026-06-10-full-system-audit-report.md` (4 P0 · 32 P1 · 50 P2 · UX report · live-pass). Every task below cites its finding id — the report carries the full evidence (file:line) and exact fix text.

**Goal:** Close the production-readiness gaps the deep audit confirmed, in risk-ordered waves, without touching the 15 verified-OK areas or the 14 refuted false-alarms.

**Architecture:** Same doctrine as the 2026-06-09 batch — single source of truth, honest states, guards that make regressions impossible. Load-bearing changes (SQL, FX, money math) ship alone with the reconcile harness as the gate.

**Tech stack:** Next.js/React + TS, Vitest (node+jsdom), Supabase RPC migrations, Inngest.

---

## ⚠️ DECISION POINTS — לאישור המפעיל לפני ביצוע

| # | החלטה | אפשרויות | המלצה |
|---|---|---|---|
| **D1** | P0-3 — הרחבת override-guard ל-meta/google + ל-RPC האחות של TikTok | מיגרציה אחת בתבנית NOT-EXISTS המוכחת (20260609180000) | **לאשר** — אותה תבנית בדיוק; אימות עם reconcile אחרי החלה |
| **D2** | P0-1 — payments מעל תקרת 50K שורות | (a) RPC חדש `GROUP BY month/store/gateway` (מבטל את ההעברה) · (b) קריאות בחלונות-חודש | **(a) RPC** — פותר גם ביצועים; מיגרציה חדשה |
| **D3** | P1-31a — פרורציית עלויות-קבועות `/30` → פר-חודש-קלנדרי (כמו שכר) | משנה מספרי P&L מוצגים (מאי +3.3%, פברואר −6.7%) | **לאשר** — שתי קונבנציות באותו מספר זה באג; טסטים נעולים יעודכנו |
| **D4** | P1-31b — סינון-חנות מחייב את כל העלויות הקבועות לחנות אחת | (a) scopedStoreNames=כלל-החנויות (הקצאה הוגנת) · (b) הערת-UI בלבד | **(a)** — עקבי עם ה-hero per-store; לאשר כי משנה מספרים בתצוגת חנות-בודדת |
| **D5** | P1-15 — סינון test/cancelled בייצוא-bulk + **re-seed חד-פעמי** של ledger+cohorts | restatement גלוי של LTV/cohorts | **לאשר** — הנתונים היום מזוהמים; להריץ re-seed מחוץ לשעות |
| **D6** | היקף: גלים 1–8 עכשיו; גלים 9–10 (production-grade backlog) לפי החלטה | — | גלים 1–8 עכשיו, 9–10 backlog מתוזמן |

---

## Wave 1 — P0 pipeline/data (load-bearing; each its own commit)

### Task 1.1 · P0-3: Manual-override guards — meta/google + TikTok sibling RPC
- **Files:** new `supabase/migrations/<ts>_override_guards_meta_google_tiktok.sql` (CREATE OR REPLACE `agg_data_daily_for_date` + `agg_tiktok_spend_per_store_for_date`).
- Mirror the 20260609180000 NOT-EXISTS pattern: `fb_spend_cad` guarded on `mo.platform='meta'`, `ga_spend_cad` on `'google'` (Pass 1 zero + Pass 2 set), and add the tiktok guard to the sibling RPC's Pass 1a/1b (covers `scripts/backfillTikTokMapping.ts:192` too).
- **Verify:** local SQL review → (deploy-gated) `supabase db push` per the documented procedure → `npm run audit:reconcile`.
- Risk: load-bearing SQL. Prod-apply only on operator "deploy".

### Task 1.2 · P0-2: cron-yesterday event-id discriminator
- **Files:** `src/inngest/functions/planStoreJobs.ts:94-97` — event id `cron-yesterday-{store}-{date}-{tickBucket}` (payload `date` unchanged).
- **Test:** fold-guard asserting two scheduler runs on the same date emit DIFFERENT ids; existing dedupe semantics for the live family untouched.
- Post-deploy check: Inngest dashboard shows the 2h fires actually invoking.

### Task 1.3 · P0-1: paginate() truncation tripwire + payments RPC (per D2a)
- **Files:** `src/lib/postgresReaders.ts:174-188` (loop exits via MAX_CHUNKS with a full page → console.error + Sentry event), route guards flipped to `>= 50000` (data:73, ads:45, campaigns:88, products:46, orders-attribution:58), `readPaymentMethodsByMonth` → new SQL `GROUP BY` RPC migration; `fetchCurrentCampaignStatuses` Query 2 → adset_registry (its own comment's prescription); `fetchLastKnownBudgetTypes` date-bound ~120 days.
- **Tests:** unit on the tripwire; payments route returns identical shape (snapshot vs current prod output for a 3-month window).

### Task 1.4 · P0-4: CampaignDrawer 4 fetchers → strict contract
- **Files:** `src/components/campaign-drawer/index.tsx:230-266` — all four fetchers: throw on `!r.ok` + `throwOnErrorBody`; drawer-level error strip (reuse AdsDrawer's P0-9 UI) per failed source.
- **Tests:** DOM — 200+`{rows:[],error}` for each of the 4 endpoints renders the error strip, NOT empty-tabs.

## Wave 2 — quick safe pair (one commit)
- **Task 2.1 · P1-20:** `useDashboardRefresh.ts:92` probe → valid `from=to=today-IL` (+ test through parseRangeParams).
- **Task 2.2 · P1-5:** `Cache-Control: no-store` on the six degraded-200 catch paths (store-meta, dashboard-state GET, product-catalog, ads, home/activity-events, operator/status-events) + a unit guard (route with `revalidate` ⇒ no-store on catch).

## Wave 3 — state-honesty sweep (client-only, LARGE; one audited wave + DOM guards; no-drip-deploy)
- **Task 3.1 · P1-2:** Customers + Payments: throwing fetchers + error/isLoading branches (skeleton / red strip / settled-empty only).
- **Task 3.2 · P1-3:** Home order-KPIs: orders==undefined ⇒ null to adapters ("—" not 0); surface `error||data.error` in the WR-06 banner (orders + campaigns).
- **Task 3.3 · P1-4:** the ~10-surface family (ProductCentricView infinite-טוען, AiReportButton spinner, InsightsBoard false-all-clear neutral state, GoalTracker, Archive, ProductPickerModal…) onto one shared throwing fetcher (`fetchJson`+`throwOnErrorBody`); per-surface error UI copied from the nearest exemplar (ProductsTable/ActivityStatsTab patterns).
- **Task 3.4 · P1-27b:** StoresTab — split loadError vs actionError (failed archive/restore must not blank the list).
- **DOM guards for every surface touched.**

## Wave 4 — intelligence honesty (lib-only batch)
- **Task 4.1 · P1-7:** partial-day guards — drop the in-progress IL day from z-score/streak rules + health trajectory (mirror detectCampaignDied's today-1 anchor).
- **Task 4.2 · P1-8:** trust ladder — `claim===0 && detOrders>0` ⇒ "הפלטפורמה מדווחת 0 — בדוק תגית-המרות" (not אמין-90/scale); `coverageExceedsClamp` ⇒ cap trust at medium + swap scale advice for the pixel-check.
- **Task 4.3 · P1-9:** trends per-day MEANS (odd-length test); `meanOrNull_` returns real mean incl. 0 (prev 3.0 → 0 = down); health-scorer partial-evidence floor.
- **Task 4.4 · P1-10:** delete private `bandForRoas` in synthesis/roasChart → canonical helper; extend `roasBandConsistency.guard` to import it (3.0 in SAMPLES).
- **Task 4.5 · P1-1:** `shiftDateBack` clamp (day=min(day, daysInMonth)) + month-end/leap zero-overlap tests.

## Wave 5 — refresh/sync spine (run cloudSync + autoRefresh suites)
- **Task 5.1 · P1-18:** hydrateFromCloud equality-guard (skip writeLocal+dispatch when unchanged) + zero per-hook refreshIntervals.
- **Task 5.2 · P1-19:** `useIlToday()` — re-derive non-custom presets + stableNcacRange on IL-midnight/visibilitychange.

## Wave 6 — FX + pipeline visibility (riskiest; reconcile harness gates)
- **Task 6.1 · P1-11:** FX adapters null-on-failure + omit `*_cad` keys (hot-metrics); null-preserve at cronDaily merge layer; `/api/data` FX timeout.
- **Task 6.2 · P1-12:** Meta `asArray` throw-on-part-error; status branch try/catch; safeCredentials VITEST-gated.
- **Task 6.3 · P1-13:** Google placeholder `is_enabled===true` filter (+unit); registry reaper = backlog (Wave 10).
- **Task 6.4 · P1-14 + P1-32:** sync-now `is_finalized=(date<today-IL)`; status-events `.upsert(…, ignoreDuplicates)`; cronDaily budget-skip side-effects into own step.

## Wave 7 — money math (per D3/D4) + customers data hygiene (per D5)
- **Task 7.1 · P1-31:** per-calendar-month proration (billing.ts) + store-filter scopedStoreNames threading; update locked billing tests to the new convention.
- **Task 7.2 · P1-15:** bulk queries `test:false AND -status:cancelled`; **operator-scheduled** ledger re-seed + cohort re-backfill.
- **Task 7.3 · P1-17:** `recompute_first_order_flags` migration — `IS DISTINCT FROM` guards (kills the ~46k-row rewrite every 10 min).

## Wave 8 — UX shortlist (per the synthesis UX list; one audited visual wave, both themes, then ONE deploy)
1. Esc double-dismiss guard in drawerStack (+popover preventDefault).
2. Touch: double-ⓘ trigger fix + row-tap double-fire suppression; tooltip mode by `(hover:none)/(pointer:coarse)` not width.
3. Flat-sparkline centering (wire computeSparklineGeometry) + RoasTargetChart dynamic yMax (+ LTV chart: include the nCAC reference line in the y-domain — live-pass #2).
4. Copy sweep: dead pipelines (runDailyUpdate / cron-live-heavy / 15-דקות / כל-דקה), "3 חנויות" literals, refresh-duration unification, the 2 surviving hardcoded-Meta sites (P1-25) + grep-guard extension.
5. Keyboard: row-drilldown tabIndex/Enter (Card.tsx pattern) + aria-sort on `<th>`.
6. Polish: Geist Mono var, MiniSparkline layering, annotation-chip bg, Switch RTL thumb, mobile table edge-hint (live-pass #1), TokenFailuresTable scroll container, AOV-boundary color-vs-rounded-display (live-pass #4).
7. Mobile sidebar → Sheet primitive (closes the last hand-rolled dialog).
8. Operator console: AddStoreWizard off-toggles (disable+hint), TikTok OAuth callback allowlist (P1-28) + guard test, OperatorSecretBanner empty-Enter guard, credential-matrix focus jump.

## Wave 9 — store-list dynamization (gate for self-serve Phase 6b) · P1-6
- Derive VALID_STORES / STORE_NAMES / "3 חנויות" copy / ResetData blast-radius from the DB stores table; token_failures CHECK → FK-or-drop migration; hermetic parity test.

## Wave 10 — backlog (production-grade + P2 cherry-picks)
- Registry reaper + Google full sweep (P1-13b) · cohort bulk-op id-verification + atomic replace (P1-16) · Tier-2 platform-agreement gating (P1-30) · mergeCustomerJourney freshness gate (P1-29 — **חובה לפני הפעלת journey לחנויות נוספות**) · P2 cherry-picks (50 בדוח; מומלצים ראשונים: #5 regex anchor, #7 margin rounding, #14 URL-range validation, #21 backfill cap, #27 degraded-200 zeros, #33 BAND_TAG_LABEL copy, #45 hot-set IL-date, #50 chips bg).

---

## Self-review
- **Coverage:** all 4 P0 (Wave 1), all hurts-now P1s (Waves 2–8), production-grade P1s (Waves 9–10), UX shortlist (Wave 8), live-pass findings folded (#1→8.6, #2→8.3, #4→8.6, #5 = שאלת-עיצוב למפעיל). P2s indexed in the report; cherry-picks listed.
- **Risk ordering:** SQL/pipeline P0s isolated first; FX (riskiest) alone in Wave 6 behind the reconcile harness; money-math changes gated on D3/D4; visual work batched per the no-drip-deploy rule.
- **Do-not-touch:** the 15 verified-OK areas + 14 refuted false-alarms are out of scope by definition; Wave 8 extends (not bypasses) the hermetic guards.
