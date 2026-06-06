# Ads-Off — Phase 4 (Alerts / Insights / WhatsApp suppression) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a (store, platform) is OFF, stop nagging about it — suppress the ad-performance insights/alerts that only make sense for an advertising store (campaign-died, creative-fatigue, anomalies, scale/pause recs, health-score F, AI-report ad commentary), and frame an off store in the WhatsApp daily report as "אורגני" instead of a broken/zero-ROAS alarm. Revenue-side signals keep flowing.

**Architecture:** All surfaces already have (or can cheaply get) the Phase-1/2 helpers + the ad-state. Client insight surfaces read `adStateMap` + `storeApplicablePlatforms` (already on `DashboardData` since Phase 2). The WhatsApp cron path fetches them via `fetchAdStateFromPostgres()` + store-meta. Guards are pure `isAdsEnabled` (per-platform) / `isStoreFullyOff` (per-store) checks — additive, default-ON when the table is empty.

**Tech Stack:** Next.js, Supabase, Inngest, vitest (node + jsdom), React.

**Spec:** `docs/superpowers/specs/2026-06-06-ads-off-state-design.md` (§E alerts, §E2 optimization/insight surfaces, §F WhatsApp, §J.4). Phases 1–3 shipped.

---

## Locked scope decisions (from the 2026-06-06 mapping)

1. **Suppress per-platform ad insights** (campaign-died, creative-fatigue, fatigue early-warning, campaign-level scale/pause/zero recs) when `!isAdsEnabled(map, storeId, platform)`.
2. **Suppress a fully-off store's insights** (anomalies, store-level rebalance/underperformance) when `isStoreFullyOff(storeId, map, applicable)`. A fully-off store's urgent-action items (incl. revenue anomalies) are noise — the operator turned it off deliberately; Phase-2 cards/tables still show its organic revenue. A *partially*-off store keeps its non-off-platform insights.
3. **Health-score:** an off + spend===0 campaign must NOT grade F — flag it `insufficient`/"unknown" at the call site (the score fn stays pure).
4. **AI report:** filter ad-performance sections to exclude off (store, platform); fully-off store → reframe/skip ad commentary. Revenue/product sections untouched.
5. **WhatsApp daily report (v1 live + v2 pending):** a fully-off store with revenue>0 reads "אורגני" (no broken ROAS); off+0 → neutral; totals exclude off-store spend but include its (organic) revenue. Mirror Phase-2 `adDisplayState`.
6. **NO change (deliberately):** token-failure alerts (infrastructure — a dead token must surface even when off, so the operator knows before re-enabling; reactive ones are already moot via Phase-3's fetch-skip; budget-skip already suppresses its WhatsApp send). `cronLiveHeavy` (decommissioned — `cronLiveHeavyFunctions` is an empty array, not in `serve()`). Freshness/status-pill/activity-feed/status-events (system-health, not ad-performance).
7. **Default empty `store_ad_state` ⇒ all-ON ⇒ every surface unchanged.** Every guard defaults ON; every new param is optional (default `{}`).

---

## Task 1: Insight detectors off-aware (`buildAllInsights` + sub-detectors)

**Files:**
- Modify: `dashboard-web/src/lib/insights.ts` (`buildAllInsights` + `detectAnomalies` + `generateRecommendations`)
- Modify: `dashboard-web/src/lib/insights/campaignDied.ts`, `dashboard-web/src/lib/insights/adFatigue.ts`
- Test: extend `dashboard-web/src/lib/insights/__tests__/campaignDied.test.ts`, `adFatigue.test.ts`, `adFatigueEarlyWarning.test.ts`, and a `buildAllInsights` off-filter test (new or in an existing insights test)

- [ ] **Step 1: READ + verify the Insight identity field.** Read the `Insight` type (in `lib/insights.ts` or a types file) and confirm each insight carries a stable **`storeId`** (a real store id like `uzoshop`, NOT the display name) + an optional **`platform`**. Check how `detectAnomalies` sets the store identity (the mapping flagged it groups by `storeName` — if it emits `storeName` rather than `storeId`, note it; the filter must key correctly). Read how `buildAllInsights` (around line 867–887) assembles `[...anomalies, ...recs, ...died, ...fatigue, ...]`.

- [ ] **Step 2: Write the failing tests.** Per-platform detectors — for `campaignDied`, `adFatigue`, `adFatigueEarlyWarning`: add a case that, given an input that WOULD produce an insight, passes `adStateMap = { '<storeId>:<platform>': false }` and asserts the insight is NOT produced; and a case with `adStateMap = {}` (default) asserts it IS produced (unchanged). For `buildAllInsights`: given insights spanning an off store/platform, assert the off ones are filtered out and on ones remain.

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** Preferred approach = a single post-filter in `buildAllInsights` (one guard point), PLUS the per-platform detectors gain an optional `adStateMap` param for unit-level suppression. Concretely:
  - In `lib/adState.ts` (or `lib/insights.ts`) add a small pure helper:
    ```ts
    export function isInsightSuppressedByAdState(
      ins: { storeId?: string; platform?: AdPlatform | string },
      map: AdStateMap,
      applicable: Record<string, AdPlatform[]>,
    ): boolean {
      if (!ins.storeId) return false; // global insight — keep
      if (ins.platform) return !isAdsEnabled(map, ins.storeId, ins.platform as AdPlatform);
      return isStoreFullyOff(ins.storeId, map, applicable[ins.storeId] ?? []);
    }
    ```
  - `buildAllInsights(...)`: add optional params `adStateMap: AdStateMap = {}, storeApplicablePlatforms: Record<string, AdPlatform[]> = {}`. Just before returning the assembled+sorted list, `.filter((ins) => !isInsightSuppressedByAdState(ins, adStateMap, storeApplicablePlatforms))`.
  - Verify EVERY insight carries `storeId` (real id) + `platform` where applicable. If `detectAnomalies` emits `storeName`, normalize it to `storeId` on the insight (or resolve in the filter using the rows). If an insight legitimately has no storeId (global), it is kept.
  - ALSO add an optional `adStateMap` param to `detectCampaignDied` / `detectAdFatigue` / `detectAdFatigueEarlyWarning` and `continue` before `insights.push` when `!isAdsEnabled(map, g.storeId, g.platform)` (belt-and-suspenders + makes the unit tests clean). Default `{}`.

- [ ] **Step 5: Run — confirm PASS** + full insights suite green (`npx vitest run src/lib/insights`).
- [ ] **Step 6: tsc + eslint.**
- [ ] **Step 7: Commit**
```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/insights.ts dashboard-web/src/lib/insights/ dashboard-web/src/lib/adState.ts
git commit -m "feat(ads-off): suppress ad-performance insights for off store/platform (Phase 4)"
```

---

## Task 2: Wire ad-state into InsightsBoard + ActionListPanel (+ belt-and-suspenders)

**Files:**
- Modify: `dashboard-web/src/components/InsightsBoard.tsx`
- Modify: `dashboard-web/src/components/insights/ActionListPanel.tsx` (only if it builds its list independently of InsightsBoard)
- Test: extend `dashboard-web/src/components/__tests__/insightsBoardDataWiring.dom.test.tsx` + `src/components/insights/__tests__/ActionListPanel.dom.test.tsx`

- [ ] **Step 1: READ** how `InsightsBoard` calls `buildAllInsights` (~line 212) and what `data` it has (it receives `DashboardData`, which since Phase 2 carries `adStateMap` + `storeApplicablePlatforms`). Read how ActionListPanel gets its items (from InsightsBoard's filtered output, or independently).

- [ ] **Step 2: Write failing DOM test** — render InsightsBoard with `data.adStateMap` marking a store/platform off + an insight that targets it → assert it does NOT appear in the board or the "פעולות דחופות" list; on insights still appear.

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** Pass `data.adStateMap ?? {}` + `data.storeApplicablePlatforms ?? {}` into the `buildAllInsights(...)` call. If ActionListPanel re-derives or re-filters, add the same `isInsightSuppressedByAdState` filter there as belt-and-suspenders (so a future detector leak can't surface an off-store action). If ActionListPanel purely consumes InsightsBoard's already-filtered list, no change.

- [ ] **Step 5: Run — confirm PASS** + the two DOM suites green.
- [ ] **Step 6: tsc + eslint + design-color guard (no raw colors).**
- [ ] **Step 7: Commit**
```bash
git add dashboard-web/src/components/InsightsBoard.tsx dashboard-web/src/components/insights/ dashboard-web/src/components/__tests__/insightsBoardDataWiring.dom.test.tsx
git commit -m "feat(ads-off): InsightsBoard + action list consume adStateMap (Phase 4)"
```

---

## Task 3: Health-score off-flag at the call sites

**Files:**
- Modify: the call sites that render a campaign health grade — `dashboard-web/src/components/CampaignsTable*.tsx` / the campaign drawer `HealthScorePanel.tsx` (find via `grep -rn "computeCampaignHealth\|campaignHealthScore" src/components`)
- Test: extend the nearest existing health-score DOM/unit test

- [ ] **Step 1: READ** `lib/campaignHealthScore.ts` (`computeCampaignHealth`) + every call site. Confirm the score fn is pure per-campaign. Identify, at each call site, where the campaign's `storeId` + `platform` + `spend` are available, and how an `insufficient`/"unknown"/⏳ state is already rendered (the score likely already has an `insufficient` path for low-data campaigns — reuse it).

- [ ] **Step 2: Write failing test** — a campaign with off (store,platform) + spend===0 → the rendered grade is the `insufficient`/"unknown" state (⏳), NOT an F; an ON campaign or off-but-spend>0 (historical) → normal grade.

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** At each call site, BEFORE rendering the computed grade: `if (!isAdsEnabled(adStateMap, storeId, platform) && spend === 0) { <render the existing insufficient/'unknown' state> }`. Do NOT modify `computeCampaignHealth` itself (keep it pure). Thread `adStateMap` from the component's `DashboardData` (already available) into the call site. Reuse the existing insufficient-state rendering — do not invent a new visual.

- [ ] **Step 5: Run — confirm PASS** + the health-score suite green.
- [ ] **Step 6: tsc + eslint + design-color guard.**
- [ ] **Step 7: Commit**
```bash
git add dashboard-web/src/components/ dashboard-web/src/lib/campaignHealthScore.ts
git commit -m "feat(ads-off): off campaign with zero spend renders insufficient health, not F (Phase 4)"
```

---

## Task 4: AI report off-aware (`lib/aiReport.ts`)

**Files:**
- Modify: `dashboard-web/src/lib/aiReport.ts` + `dashboard-web/src/components/AiReportButton.tsx`
- Test: extend the AI-report test (find via `grep -rln aiReport src/lib/__tests__ src/components/__tests__`)

- [ ] **Step 1: READ** `aiReport.ts` (the ~9 ad-performance sections the mapping flagged: per-store summary, per-platform CPM table, top campaigns, pixel↔shopify, momentum, health-score, budget drainers, ad-level drill-down) + `AiReportButton.tsx` (the `generateAiReport(...)` call, ~line 116-126). Confirm the campaign/ad rows carry `storeId` + `platform`.

- [ ] **Step 2: Write failing test** — generate a report for a fully-off store → the ad-performance sections are skipped/reframed (no "ROAS collapsed" commentary); a partially-off store → off-platform campaigns excluded but on-platform ROAS still reported; revenue/product sections present in both. (Assert on the returned markdown string.)

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.** Add optional `adStateMap?: AdStateMap` + `storeApplicablePlatforms?: Record<string, AdPlatform[]>` to the `generateAiReport` params; thread them from `AiReportButton.tsx` (`data.adStateMap` / `data.storeApplicablePlatforms`). In each ad-performance section, BEFORE aggregating, filter `campaignRows`/`ads` to exclude `(storeId, platform)` where `!isAdsEnabled(map, storeId, platform)`. If a section's list is empty after filtering, skip the section (or, for the per-store summary of a fully-off store, render the organic reframe note). Leave product/order/revenue sections (e.g. `allocateProductRevenue`) untouched. Default `{}` ⇒ unchanged.

- [ ] **Step 5: Run — confirm PASS** + the AI-report suite green.
- [ ] **Step 6: tsc + eslint.**
- [ ] **Step 7: Commit**
```bash
git add dashboard-web/src/lib/aiReport.ts dashboard-web/src/components/AiReportButton.tsx dashboard-web/src/lib/__tests__/
git commit -m "feat(ads-off): AI report excludes/reframes ad-performance for off stores (Phase 4)"
```

---

## Task 5: WhatsApp daily report off-framing (v1 + v2)

**Files:**
- Modify: `dashboard-web/src/lib/notifications/sendDailySummary.ts`, `dashboard-web/src/lib/notifications/templateParams.ts`
- Maybe: `dashboard-web/src/lib/notifications/summary.ts` (tag fully-off stores)
- Test: extend `dashboard-web/src/lib/notifications/__tests__/templateParams.test.ts` (+ sendDailySummary test if present)

- [ ] **Step 1: READ** `sendDailySummary.ts` (the `buildStoreSummary` → `buildTemplateParameters`/`buildTemplateParametersV2` flow), `summary.ts` (`StoreSummary` shape + the per-store + totals aggregation), and `templateParams.ts` (`storeBlock`/`blockParamsV2`/`totalsBlock` for v1 AND v2). Note the `DaySummary`/`StoreSummary` fields (`storeId`, `revenue`, `totalSpend`, `roas`, per-platform).

- [ ] **Step 2: Write failing tests** (in `templateParams.test.ts`): build v1 + v2 params with a fully-off store that has revenue>0 → its block shows "אורגני" (no ROAS/CPM alarm); off+revenue=0 → neutral ("ללא מכירות"/"—"); on store → normal; AND the totals' spend excludes the off store's spend while totals' revenue includes its (organic) revenue. Use `adDisplayState` semantics.

- [ ] **Step 3: Run — confirm FAIL.**

- [ ] **Step 4: Implement.**
  - In `sendDailySummary.ts`: after `buildStoreSummary(dateStr)`, fetch `const adStateMap = await fetchAdStateFromPostgres().catch(() => ({}))` (graceful, matching Phase 3). Compute per-store applicable platforms: fetch `fetchStoreMetaFromPostgres()` (+ `new Set(TIKTOK_SHARED_STORES)`) → `storeApplicablePlatforms` via `applicablePlatforms(store, tiktokStores)`. Pass `adStateMap` + `storeApplicablePlatforms` into BOTH `buildTemplateParameters(...)` and `buildTemplateParametersV2(...)`.
  - In `templateParams.ts`: add optional `adStateMap: AdStateMap = {}` + `storeApplicablePlatforms: Record<string, AdPlatform[]> = {}` to both builders. In `storeBlock`/`blockParamsV2`, compute `const off = isStoreFullyOff(storeId, adStateMap, storeApplicablePlatforms[storeId] ?? [])` then `adDisplayState({ revenue, spend: totalSpend, off })`. For `'organic'` → render "אורגני" (drop the ROAS/CPM figures); `'off-empty'`/`'off-negative'` → neutral ("ללא מכירות"/"—"); else unchanged. Recompute the totals block excluding off-store spend (off store contributes revenue but not spend to the totals). Keep it ADDITIVE — same message structure, only the off-store block + totals math change.

- [ ] **Step 5: Run — confirm PASS** + the notifications suite green. (v1 is live; v2 pending Meta approval — BOTH builders must handle off correctly so the operator can flip `template_name` later with no redeploy.)
- [ ] **Step 6: tsc + eslint.**
- [ ] **Step 7: Commit**
```bash
git add dashboard-web/src/lib/notifications/
git commit -m "feat(ads-off): WhatsApp daily report frames off stores as אורגני; totals exclude off spend (v1+v2) (Phase 4)"
```

---

## Task 6: Docs + full local gate

**Files:**
- Modify: `docs/superpowers/specs/2026-06-06-ads-off-state-design.md`, `docs/ARCHITECTURE.md` (§42), `docs/ROAS-Dashboard-User-Manual.md`

- [ ] **Step 1: Spec addendum** — "## Phase 4 — locked alert/insight/WhatsApp semantics": per-platform vs per-store suppression rule; the `isInsightSuppressedByAdState` filter; health-score insufficient-on-off; AI-report section filtering; WhatsApp "אורגני" framing + totals-exclude-off-spend; the deliberate NON-changes (token-failure infrastructure alerts, cronLiveHeavy dead, freshness/status-pill).
- [ ] **Step 2: ARCHITECTURE §42** — "Ads-off alert/insight suppression (Phase 4)": the surfaces made off-aware + the per-platform/per-store guard rule + why token-failure is intentionally NOT suppressed + the WhatsApp off-framing. Reference the spec.
- [ ] **Step 3: User Manual** — bump version (2.47.0 → 2.48.0, box aligned) + "מה התחדש": when a store/platform is off, the dashboard no longer raises ad alerts about it (no "campaign died"/"fatigue"/F-score panic), the urgent-actions list + AI report skip it, and the WhatsApp daily report shows it as "אורגני" — while genuine token/infrastructure alerts still surface. Note ads-off feature is now complete (phases 1–4).
- [ ] **Step 4: Full local gate** — `cd dashboard-web && npm test && npm run test:components && npx tsc --noEmit && npm run lint` — ALL green (unit 0 failed, DOM 0 failed, tsc clean, lint 0 errors). Report exact counts.
- [ ] **Step 5: Commit**
```bash
git add docs/superpowers/specs/2026-06-06-ads-off-state-design.md docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(ads-off): spec + ARCHITECTURE §42 + User Manual 2.48.0 (Phase 4 alerts/insights/WhatsApp); ads-off feature complete"
```

---

## Self-review (run before execution)

- **Spec coverage (§E / §E2 / §F / §J.4):** insight detectors (T1) ✓ · InsightsBoard/action-list (T2) ✓ · health-score (T3) ✓ · AI report (T4) ✓ · WhatsApp v1+v2 (T5) ✓ · docs (T6) ✓ · token-failure intentionally unchanged (locked #6) ✓.
- **Additive / no-regression:** every new param optional (default `{}`); empty map ⇒ `isAdsEnabled`/`isStoreFullyOff` ⇒ keep everything ⇒ today's behavior. The feature is inert until the operator toggles.
- **Per-platform vs per-store:** campaign/ad insights + token (untouched) = per-platform `isAdsEnabled`; anomalies/store-recs/whatsapp-store/health = per-store `isStoreFullyOff` (or per-(store,platform) for health). Documented in the filter helper.
- **Not suppressed:** token-failure (infrastructure), revenue/product insights of a partially-off store, freshness/status. Confirmed.
- **Type/name consistency:** `isAdsEnabled`, `isStoreFullyOff`, `adDisplayState`, `applicablePlatforms`, `AdStateMap`, `AdPlatform`, `storeApplicablePlatforms`, `fetchAdStateFromPostgres`, `isInsightSuppressedByAdState`, `TIKTOK_SHARED_STORES` identical across tasks.
- **Open verifications for the implementer:** (a) the `Insight` identity field (storeId vs storeName) + that all detectors set it (T1); (b) ActionListPanel independent vs inherited filtering (T2); (c) the existing health-score `insufficient` rendering to reuse (T3); (d) the AI-report section list + that campaign rows carry storeId+platform (T4); (e) the WhatsApp `StoreSummary` fields + how totals are currently summed (T5).
