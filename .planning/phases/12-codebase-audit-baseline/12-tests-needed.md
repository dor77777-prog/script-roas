# Phase 12 — Test Coverage Gaps (Ranked)

**Scanned:** 144 raw-return files (139 Opus reviewers + 5 Codex critiques)
**Total unique gaps:** 88 (after dedup of 430 raw entries → 88 distinct themes/items)
**Verification-blocking (top 5):** 5 gaps
**High priority:** 24 gaps
**Medium:** 39 gaps
**Low:** 20 gaps

> **Cross-reference key:** Phase 10 backfilled tests verified present at:
> - `dashboard-web/src/lib/__tests__/aiReportStatistics.test.ts` (C-01: CPM CV + MAD anomaly math — DOES NOT cover other AI Report sections)
> - `dashboard-web/src/lib/__tests__/postgresReadersNewestRowDedup.test.ts` (C-02: newest-row dedup — confirmed)
> - `dashboard-web/src/inngest/functions/__tests__/cronLivePastRowBackfill.test.ts` (C-03: past-row backfill — confirmed, 581 LOC)
> - `dashboard-web/src/lib/fetchers/__tests__/tiktok.test.ts` (C-04: TikTok `code !== 0` envelope — confirmed)
> Test files for `lib/notifications/summary.ts`, `lib/notifications/whatsapp.ts`, the 3 billing/revenue hooks, and 5 Wave-G components confirmed NOT to exist.

---

## Verification-blocking (top 5)

These 5 gaps are large enough that their parent file's ✅ verdict cannot be considered fully trusted without backfilling at least the suggested fixture. Each touches a load-bearing production path where Phase 10/11 fixes are unenforced by automated regression.

### TG-01: WhatsApp single-chokepoint topology + allowlist enforcement (HR-05)
- **Surface:** `dashboard-web/src/lib/notifications/whatsapp.ts` (entire file uncovered) — `sendWhatsAppTemplate` + `recipientAllowed` + `loadActiveMetacloudConfig` + `toNumber`
- **Why blocking:** Operator-confirmed re-research verdict ("airtight allowlist + symmetric normalization + single chokepoint") is currently anchored on human reading. Any future contributor adding a second direct `fetch('https://graph.facebook.com/.../messages')` call silently breaks the security boundary. Phase 12 re-research explicitly noted "HR-05 single-chokepoint test suggested in whatsapp re-research" but no such test exists today. The ✅ Verified verdict is therefore only as durable as the next commit that adds an alternate send path.
- **Suggested fixture:** Three tests:
  1. Static-topology test (vitest, no mocks): `execSync('git grep -l "graph.facebook.com.*messages" dashboard-web/src/')` → assert exactly one match and it equals `dashboard-web/src/lib/notifications/whatsapp.ts`.
  2. Allowlist enforcement: stub fetch, set `NOTIFICATION_RECIPIENT_ALLOWLIST='+972524809540'`, call `sendWhatsAppTemplate({to:'+972000000000', ...})` → assert throws with allowlist message AND fetch was never called.
  3. `toNumber` normalization round-trip: assert `toNumber('+972 (52) 480-9540') === '972524809540'` sent in Meta URL/body.
- **Flagged by:** `lib_services_whatsapp.json` (8 gaps), `comp_operator_WhatsappTestButtons.json`, `lib_services_sendDailySummary.json` (recipient empty path)

### TG-02: AI Report cross-store collision + status-freshness regression (ALG-03/04/05/06)
- **Surface:** `dashboard-web/src/lib/aiReport.ts` (~700 LOC of unstubbed math + key construction)
- **Why blocking:** Phase 10 C-01 backfilled CPM CV + MAD anomaly math only. The reviewer file `lib_algorithm_aiReport.json` flagged 5 distinct MAJOR bugs (ALG-01..05) involving (a) storeId-less keys causing cross-store data bleed in the default `storeName='All'` view (operator's default workflow), (b) `last-write-wins` on unordered iteration silently flipping `currently-off` verdicts when fetcher row order changes, (c) TikTok-excluded budget allocation hiding 60%+ of spend on TikTok stores. None of these are covered by any current test. The reviewer's verdict was 🔴 Has bug — meaning Phase 12.x fixes will land, and without regression tests the fixes themselves are unverifiable.
- **Suggested fixture:** Multi-section golden fixture with two stores (`zolplus` + `uzoshop`) each having (a) a Meta campaign sharing `campaignId='c1'` and `campaignName='Brand'`, (b) orders tagged `utm_campaign='Brand'` per store, (c) `ttSpend > 0` daily rows, (d) the same `(storeId, platform, campaignId)` appearing twice with different `effectiveStatus` on different dates in non-chronological input order. Snapshot the full markdown output and assert: (i) each store's Currently-Off section receives only its own data, (ii) TikTok row appears in the budget table with correct % over `fb+ga+tt`, (iii) latest status wins regardless of input order.
- **Flagged by:** `lib_algorithm_aiReport.json` (6 gaps spanning ALG-01..05 + ALG-08), `lib_algorithm_aiReport.codex.json` (0 gaps — Codex agreed)

### TG-03: postgresReaders pagination cap silent truncation (STA-05)
- **Surface:** `dashboard-web/src/lib/postgresReaders.ts` — `paginate()` helper, `MAX_CHUNKS=50` cap
- **Why blocking:** Operator-confirmed priority test in `resolutions.json`: *"STA-05 MAX_CHUNKS silent truncation → priority test/backlog per operator."* This is the only flagged-as-priority test gap from the entire 17-row checkpoint resolution. Materializes as "why am I missing recent orders?" on high-volume tables (orders_attribution can exceed 50k rows on the operator's busier stores). Reviewer note: "Silent data loss for high-volume tables."
- **Suggested fixture:** Mock Supabase query to keep returning `chunkSize` rows; assert behavior at chunk 50. Two assertions: (1) a `console.warn` fires identifying the truncated table, (2) the returned array contains exactly `MAX_CHUNKS × chunkSize` rows (the documented soft cap).
- **Flagged by:** `lib_state_postgresReaders.json` (4 gaps total, STA-05 is the priority one), cross-referenced in operator-directives: *"STA-05 postgresReaders MAX_CHUNKS silent truncation: priority test/backlog item in 12-tests-needed.md."*

### TG-04: useCampaignTrueRevenue — zero direct test for 519-LOC orchestration hook
- **Surface:** `dashboard-web/src/lib/services/useCampaignTrueRevenue.ts` (519 LOC, largest hook in codebase)
- **Why blocking:** Operator-confirmed re-research outcome (per `resolutions.json`): *"thin orchestration over audited pure helpers (allocateProductRevenue + analyzeAttribution). Every contract boundary traced correctly. Test-suite gap remains real but is a coverage concern, not a correctness verdict."* The verdict is ✅ but operator explicitly carved out "test gap → 12-tests-needed.md." The hook orchestrates the trust-upgrade contract (operator feedback 2026-05-22 explicitly drove this), refund-row propagation (CR-02), `#WR-02` shared-campaign Set dedup, and Google-platform exclusion (IN-06). Six distinct behavioral contracts, zero direct tests.
- **Suggested fixture:** `renderHook` with synthetic campaigns + products + orders fixtures covering:
  1. Two-method-agreement trust upgrade: `analyzeAttribution` returns `trust='low'`, `metaClaim=100`, `trueRevenue=98` → assert hook upgrades to `'high'`.
  2. CR-02 refund propagation: `products=[{net:-50,units:0},{net:100,units:1}]` → assert allocator receives both and `trueRevenue` reflects net deduction.
  3. WR-02 shared-campaign Set dedup: Campaigns `A=[P1,P2]`, `B=[P1,P2]` → assert `sharedCampaigns=1` not `2`.
  4. IN-06 Google exclusion: `allCampaignRows` includes Google row → assert `dailyMetaByCampaign` does NOT contain its key.
  5. Trust upgrade from `'unknown'` (SVC-14 edge): `trust.level='unknown'` + `deterministicOrders=0` + agreement → upgrade to `'high'` with prepended agreement reason.
- **Flagged by:** `lib_services_useCampaignTrueRevenue.json` (8 gaps)

### TG-05: Multi-mapped cohort ranking — ranking score reference identity + extreme-value regression (HIGH-6)
- **Surface:** `dashboard-web/src/lib/algorithm/multiMappingCohort.ts`
- **Why blocking:** The `lib_algorithm_multiMappingCohort.json` reviewer file enumerated 8 gaps spanning (a) `roasShopifyPlatform` extreme-value sort regression (the HIGH-6 fix's exact failure mode), (b) `others` array ordering JSDoc-vs-impl drift, (c) reference-identity violation between `result.current` and `result.rankedAll[currentRank-1]` — they are constructed via separate spreads and thus NOT the same reference, silently breaking consumer mutation patterns, (d) NaN/Infinity in ROAS maps making the sort comparator non-deterministic (operator-visible rank chip flicker). Codex critique additionally flagged orders-axis shrinkage labeling and weighted-score precedence drift. The Phase 10 cohort-panel HIGH-6 fix is regression-untested.
- **Suggested fixture:** Multi-cohort fixture asserting:
  1. Extreme-value (>1000) `roasShopifyPlatform` ranking pin — verify the HIGH-6 fix.
  2. `expect(result.current).toBe(result.rankedAll[currentRank - 1])` — reference identity.
  3. `others` ordering pin: array is sorted by ranking desc.
  4. NaN/Infinity guard: inject NaN ROAS in map, assert deterministic sort (or filtered out).
  5. Tie-break stability across renders with identical productMap insertion order.
- **Flagged by:** `lib_algorithm_multiMappingCohort.json` (8 gaps), `lib_algorithm_multiMappingCohort.codex.json` (4 gaps)

---

## High priority (HP-NN)

Gaps on load-bearing paths with documented recent bugs or operator-critical contracts.

### HP-01: `lib/notifications/summary.ts` (buildStoreSummary) — entire file uncovered
- **Surface:** `dashboard-web/src/lib/notifications/summary.ts`
- **Why:** WhatsApp daily-summary content depends on this. Operator-confirmed in `resolutions.json`: "buildStoreSummary returns null on empty data_daily but downstream templateParams handles null cleanly. Risk not materialized. Test gap → 12-tests-needed.md." 5 distinct contracts uncovered: empty-data null return, CPM blended vs per-store math, `tiktok-paid` bucket (Phase 05.7.5 fix), `campaigns_daily` soft-fail CPM=0 fallback, per-store + totals shape.
- **Suggested fixture:** Mock Supabase client with canned `data_daily` + `orders_attribution` + `campaigns_daily`; one test per contract above.
- **Flagged by:** `lib_services_summary.json`

### HP-02: Cron-live retry idempotency — `step.run` SELECT-then-UPSERT (INN-10)
- **Surface:** `dashboard-web/src/inngest/functions/cronLive.ts`, `persist-rolling-3day` step
- **Why:** Inngest default retry policy is 4× exponential per D-B6. The current `makeStepStub` at `cronLive.test.ts:58-67` executes each callback exactly once, so the SELECT-of-prior-state + UPSERT pattern is never exercised under retry. A regression that drops idempotency keys would silently corrupt data on production retries.
- **Suggested fixture:** Custom step stub simulating one retry: `step.run = async (id, cb) => { try { return await cb(); } catch (e) { return await cb(); } }`. Assert final database state matches single-execution.
- **Flagged by:** `inngest_cronLive.json`

### HP-03: Cron-live Shopify-failed + ad-platform-succeeded path (INN-07 / CR-02)
- **Surface:** `dashboard-web/src/inngest/functions/cronLive.ts`
- **Why:** Existing tests cover "all Shopify fail" (Test 6 → revenue=0) but NOT the per-date partial failure mode where Shopify throws for `dates[1]` only while Meta/Google/TikTok succeed for all 3 dates. This is the exact failure mode CR-02 was supposed to fix — current Shopify-coupled gating partially undoes the integrity guarantee.
- **Suggested fixture:** Mock `fetchShopifyDayRows` to throw only for `dates[1]`; Meta/Google/TikTok succeed for all 3 dates. Pin: `data_daily` UPSERT for `dates[1]` should have fresh `fb/ga/tt_spend_cad` values.
- **Flagged by:** `inngest_cronLive.json`

### HP-04: cronWhatsapp date+title routing (3 trigger branches)
- **Surface:** `dashboard-web/src/inngest/functions/cronWhatsapp.ts:136-146` (`eventWhatsappSendNow` handler trigger switch)
- **Why:** Operator's "Send test" button is the live verification path. If the operator clicks "send test (eod)" but the handler runs noon logic, the operator's verification is meaningless. The 3 branches (noon / evening / eod) each compute a different `(dateStr, title)` tuple; cronWhatsapp.test.ts pins cron expressions + function IDs but NOT the handler body's date computation.
- **Suggested fixture:** Mock `sendDailySummary`; invoke handler with each of the 3 trigger values; assert the `(dateStr, title)` tuple matches `yesterdayJerusalem()`+`titleEod` for EOD vs `todayJerusalem()`+`titleNoon`/`titleEvening` for noon/evening. Plus: trigger undefined → defaults to noon.
- **Flagged by:** `inngest_cronWhatsapp.json` (3 gaps), `lib_services_sendDailySummary.json`

### HP-05: AI Report TikTok status taxonomy (ALG-01)
- **Surface:** `dashboard-web/src/lib/aiReport.ts:1101-1109` (Health Score `isStatusOff`) + `1289-1297` (Currently-Off `isOff`)
- **Why:** Hard-coded `ADGROUP_STATUS_DELIVERY_OK` allowlist mis-classifies every other TikTok status (BUDGET_EXCEED / AUDIT / REVIEWING / NOT_START) as off, driving wrong scale/pause guidance + spurious -30 Health Score penalty. Cross-references `lib_state_postgresReaders.json` per-platform status matrix gap.
- **Suggested fixture:** Three TikTok campaigns with `effectiveStatus ∈ {ADGROUP_STATUS_DELIVERY_OK, BUDGET_EXCEED, ADGROUP_STATUS_DISABLE}`; assert which appear in "קמפיינים כבויים כעת" and which trigger the Health Score -30 penalty.
- **Flagged by:** `lib_algorithm_aiReport.json`, `lib_state_postgresReaders.json`

### HP-06: cronDaily roas equivalence (return value ↔ persisted row)
- **Surface:** `dashboard-web/src/inngest/functions/cronDaily.ts:437-440` (return) vs `1121-1122` (persisted)
- **Why:** Operator-console jobs table renders the return value as a "what just got written" summary. If return-roas drifts from `data_daily.roas`, the operator sees a 5.2 in the jobs row but a 4.8 on the dashboard — would suggest a sync issue and would have caught the INN-01 mismatch (which operator already resolved 🔴).
- **Suggested fixture:** Set `tiktokSpendResult.spend > 0`; assert `result.roas === dataDailyUpsertedRow.roas` (within FP epsilon).
- **Flagged by:** `inngest_cronDaily.json`

### HP-07: getCogsRateForStore env-var parsing edge cases
- **Surface:** `dashboard-web/src/inngest/functions/cronDaily.ts:113-118`
- **Why:** Operator misconfiguration is the leading source of COGS drift bugs. Typos like `UZOSHOP_COGS_RATE='abc'`/`'-0.5'`/`'1.5'`/`''`/`'25'` (missing decimal point) should all fall back to 0.25 with a console.warn. Operator-relevant: each store's net profit math depends on this.
- **Suggested fixture:** Parameterized test over `['abc','-0.5','1.5','','25']` → all fall back to 0.25 with warn.
- **Flagged by:** `inngest_cronDaily.json`

### HP-08: Refund-row propagation (negative net) — multiple surfaces
- **Surface:** `lib/algorithm/cannibalizationDetection.ts` zero-to-negative net (lateRev<0); `lib/services/useCampaignTrueRevenue.ts` CR-02; `lib/state/shopifyRevenueRefunds.ts` D-D3 no-clamping; `lib/state/lineItems.ts` mixed-order share
- **Why:** Refund-heavy windows are explicitly allowed by input types but multiple downstream consumers were silently dropping them pre-Phase-10. Without regression tests, the fix is reversible by any future contributor who "cleans up" the negative-value guards.
- **Suggested fixture:** Cross-file fixture: `products=[{net:-50,units:0},{net:100,units:1}]` flows through allocator + detector + revenue split, assert all 4 consumers handle correctly.
- **Flagged by:** `lib_algorithm_cannibalizationDetection.json`, `lib_algorithm_cannibalizationDetection.codex.json`, `lib_services_useCampaignTrueRevenue.json`, `lib_state_shopifyRevenueRefunds.json`, `lib_state_lineItems.json`

### HP-09: TikTok fetcher multi-page pagination + advertiser_ids JSON-quoted encoding
- **Surface:** `dashboard-web/src/lib/fetchers/tiktok.ts`
- **Why:** Phase 05.7.8 fix for the unquoted-numeric-precision bug was the root cause of TikTok showing 0 for weeks. A regression that drops the quoted encoding silently reverts that bug. Plus pagination logic is the only untested loop — a regression could silently limit results to page 1.
- **Suggested fixture:** Two tests: (1) Mock `/adgroup/get/` → `/report` (`page_info.total_page=2`) → page 2 (`total_page=2`); assert rows aggregated. (2) Assert `/advertiser/info/` URL contains `advertiser_ids=%5B%227012345678901234567%22%5D` (quoted string in JSON array).
- **Flagged by:** `lib_services_tiktok.json` (6 gaps)

### HP-10: Meta + Google fetchers — multi-page pagination + token-leak invariant
- **Surface:** `dashboard-web/src/lib/fetchers/meta.ts`, `googleAds.ts`, `shopifyAuth.ts`
- **Why:** All 3 fetchers have pagination logic uncovered (potential silent page-1-only regression). Token leakage in error messages is a security boundary uncovered for all 3 — a thrown error containing `client_secret` or `access_token` would leak to operator-visible jobs table.
- **Suggested fixture:** Per fetcher: (1) Mock multi-page response (nextPageToken or cursor), assert rows aggregated. (2) Mock 401/500 error response containing token-shaped strings; assert thrown error message does NOT contain `client_secret`/`access_token`/`refresh_token`.
- **Flagged by:** `lib_services_meta.json`, `lib_services_googleAds.json`, `lib_services_shopify.json`, `lib_services_shopifyAuth.json`

### HP-11: tokenFailures throttle window (6h boundary)
- **Surface:** `dashboard-web/src/lib/notifications/tokenFailures.ts`
- **Why:** 6h throttle is the load-bearing rate limit preventing alert flood. Regression could cause +972524809540 to receive 100+ alerts/hour during a token outage.
- **Suggested fixture:** Mock existing row with `last_alert_sent_at=5h ago` → assert throttled=true. Then 7h ago → assert throttled=false. Plus pin `ALERT_PHONE === '+972524809540'`.
- **Flagged by:** `lib_services_tokenFailures.json`

### HP-12: sanitizeForWhatsApp edge cases (Meta 132018)
- **Surface:** `dashboard-web/src/lib/notifications/tokenFailures.ts` + `templateParams.ts`
- **Why:** Meta error 132018 rejects entire send on `\n` / `\t` / 5+ spaces / 500+ chars. Sanitization is the only protection. A regression silently drops the operator's WhatsApp pipeline.
- **Suggested fixture:** Test `sanitize('a\n\nb')==='a b'`; `sanitize('a     b')==='a b'`; `sanitize('x'.repeat(600)).length===500`. Plus: no `\n`/`\t`/5+space sequences in any `templateParams.ts` output.
- **Flagged by:** `lib_services_tokenFailures.json`, `lib_services_templateParams.json`

### HP-13: Cloud-sync immediate flag + retry cancellation (CC-01 + WR2-01)
- **Surface:** `dashboard-web/src/lib/state/cloudSync.ts`
- **Why:** Phase 10 fixes (CC-01 immediate flag, WR2-01 pendingRetries cancellation) are documented in comments only — no test pins. Annotations + billing both depend on the immediate-flag path for "save NOW" semantics.
- **Suggested fixture:** (1) `immediate:true` debounce-bypass path: call `pushKey(K, V, {immediate:true})`; assert single fetch fires within `<10ms`. (2) Mount → start retry timer → unmount → assert `pendingRetries` cleared and no further fetch fires.
- **Flagged by:** `lib_state_cloudSync.json`, `lib_state_annotations.json`, `lib_state_campaignsColumnPrefs.json`

### HP-14: Wave-G Component zero-coverage — AdSetTable (~144 LOC)
- **Surface:** `dashboard-web/src/components/AdSetTable.tsx`
- **Why:** Six distinct contracts uncovered: trust chip ladder, `canDrillToAds` boolean-coerce (UI-SPEC §IN-06 — would render `disabled='123'`), tight-budget threshold, sticky thead, attributionByAdSet key fallback, sort header aria-sort. Zero test files.
- **Suggested fixture:** React Testing Library suite: render with synthetic adSet fixtures covering high/medium/unknown/fallback trust, `canDrillToAds=true/false`, spend>budget*0.95, empty `adSetId`. Assert aria-sort + DOM order.
- **Flagged by:** `comp_AdSetTable.json` (6 gaps)

### HP-15: Wave-G Component zero-coverage — DetailTable (~144 LOC)
- **Surface:** `dashboard-web/src/components/DetailTable.tsx`
- **Why:** Seven gaps: `roasCellStyle` 4-quadrant pin (CMB-15), TikTok column visibility (renders iff `ttSpend>0`), COGS column visibility, 100-row slice cap, ISO-date lex-sort assumption, empty-rows Hebrew message.
- **Suggested fixture:** RTL suite: 4 ROAS quadrant fixtures, ttSpend=0 vs >0 stores, 150-row fixture (assert cap), empty array (assert empty-state).
- **Flagged by:** `comp_DetailTable.json` (7 gaps)

### HP-16: Wave-G Component zero-coverage — HealthScorePanel (~265 LOC including 65-LOC buildRecommendations)
- **Surface:** `dashboard-web/src/components/HealthScorePanel.tsx`
- **Why:** `buildRecommendations` has 8 weakest-component × sub-case branches. `COMPONENT_ORDER` bar rendering, operator-adjustment row (positive/negative/zero), insufficient short-circuit, score-formula footer all uncovered.
- **Suggested fixture:** RTL suite covering all 8 weakest-component branches + 3 operator-adjustment sign variants + insufficient short-circuit + footer text.
- **Flagged by:** `comp_HealthScorePanel.json` (6 gaps)

### HP-17: Wave-G Component zero-coverage — InsightsPanel (~94 LOC)
- **Surface:** `dashboard-web/src/components/InsightsPanel.tsx`
- **Why:** Best-day calculation (CMB-21 tie-break + zero-spend skip), top/bottom (CMB-22 invariant + bottom `roas>0` filter), `bottom===top` suppression, no-data short-circuit, `InsightRow` props.
- **Suggested fixture:** RTL suite: tie-break with 2 days both highest ROAS, single-store with `bottom===top`, empty `storeAggs`, full multi-store fixture pinning icon+primary+secondary in InsightRow.
- **Flagged by:** `comp_InsightsPanel.json` (6 gaps)

### HP-18: Wave-G Component zero-coverage — PerStoreCards (~185 LOC)
- **Surface:** `dashboard-web/src/components/PerStoreCards.tsx`
- **Why:** Top/risky derivation (CMB-24 invariant + 2.0 risky threshold), `withRoas.length >= 2` gate (single-store should NOT get trophy), color/isTop/isRisky/orderCount combinations, `storeHasTikTok` integration (CMB-26), risky badge when `!isTop && isRisky`, FIND-05 `orderCount` loading-vs-zero distinction.
- **Suggested fixture:** RTL suite covering: single-store (no trophy), 5-color cycling, all four (isTop, isRisky) quadrants, undefined `orderCount` (loading) vs `=== 0` (zero).
- **Flagged by:** `comp_PerStoreCards.json` (7 gaps)

### HP-19: useBilling* hooks — zero direct test for self-bounce + event propagation
- **Surface:** `dashboard-web/src/lib/services/useBillingOneTime.ts` + `useBillingRecurring.ts` (52 + 79 LOC)
- **Why:** Operator-confirmed thin wrappers but the load-bearing mechanisms (selfWritePending ref preventing WR-03 double-render, shared `roas-billing-changed` event, removeEventListener cleanup) have zero coverage. An inverted check or renamed event constant silently desyncs both hooks. Plus `totalMonthly` with NaN/inactive entries — UI shows `$NaN` if regression hits.
- **Suggested fixture:** `renderHook` suite with mocked `readOneTime/writeOneTime` (and recurring variants): mount calls read; persist calls write+setState once (self-bounce); cross-component write fires event → other hook re-reads; unmount removes listener; `totalMonthly` with `[{active:true,monthlyCAD:NaN}]` returns finite; `[{active:false,monthlyCAD:100},{active:true,monthlyCAD:50}]` returns 50.
- **Flagged by:** `lib_services_useBillingOneTime.json` (5 gaps), `lib_services_useBillingRecurring.json` (5 gaps)

### HP-20: campaignsAggregator — latest-date effectiveStatus + non-null budget gates
- **Surface:** `dashboard-web/src/lib/algorithm/campaignsAggregator.ts`
- **Why:** Off-chip in CampaignsTableRow depends on `aggregate().effectiveStatus`. Same-day duplicate rows (ACTIVE/PAUSED) could silently flip UI status. The latest-NON-NULL budget gate at lines 136-142 (newer null must NOT clobber older non-null) is uncovered. ABO/CBO normalization (FIX-06) untested for `budgetType=''` (paused / lifetime-only / Google) — preserves both campaign+adset budgets only when neither CBO nor ABO.
- **Suggested fixture:** Three fixtures: (1) duplicate-date ACTIVE/PAUSED rows — assert tie policy. (2) Latest row has `campaignBudgetCad=null` + older has 50 → assert aggregated budget=50. (3) `budgetType=''` row preserves both budgets after FIX-06 pass.
- **Flagged by:** `lib_algorithm_campaignsAggregator.json` (6 gaps)

### HP-21: Productcentric allocator — zero-spend cohort + stale-mapping (ALG-02/04/05/06/07)
- **Surface:** `dashboard-web/src/lib/algorithm/productCentricView.ts`
- **Why:** Member-level `allocatedRevenueEstimate` sum-conservation is unasserted (operator sees CAD 0 rows under a CAD 500 platform header). Allocator never tested with stale-mapped campaign (no aggregated row) — ALG-02 revenue leak undetected. `productUnits` omission silently corrupts. Real production cohorts WILL contain stale mappings (operator tagged months ago, later paused).
- **Suggested fixture:** 4 fixtures: (1) Zero-spend cohort with 2 members, assert each member's `allocatedRevenueEstimate` sums to `intraAllocatedRevenue`. (2) Cohort with one active + one stale-mapped campaign, assert allocator handles. (3) `productUnits` omitted, assert downgraded but no NaN. (4) Cross-product independence: same campaigns mapped to two products, assert no double-count.
- **Flagged by:** `lib_algorithm_productCentricView.json` (7 gaps)

### HP-22: Operator API routes — zero coverage on 8 endpoints
- **Surface:** `api/operator/syncNow`, `notificationsSend`, `jobs`, `manualOverrides` (POST/PATCH), `reset` POST handler, `tokenFailures` GET + error path, plus `api/data` `fetchTodayFx`, `api/health` GET handler, `api/oauth/tiktokCallback`
- **Why:** Operator-facing surface, manual-trigger paths. Each route's status_code branches (200/202/400/500) and request-validation branches uncovered. Would have caught API-37 (Supabase error path).
- **Suggested fixture:** Per route: minimum 3 tests — happy path with shape pin, validation 400, mocked Supabase error → handler error path. For `tokenFailures`: GET success + error + POST invalid action.
- **Flagged by:** `api_operator_syncNow.json`, `api_operator_notificationsSend.json`, `api_operator_jobs.json`, `api_operator_manualOverrides.json`, `api_operator_reset.json`, `api_operator_tokenFailures.json` (5 gaps), `api_data.json`, `api_health.json`, `api_oauth_tiktokCallback.json`

### HP-23: api/dashboard_state prototype-pollution + size-limit
- **Surface:** `dashboard-web/src/app/api/dashboard_state/route.ts`
- **Why:** Documented prototype-pollution defense (`key='__proto__'` → 400) is unverified. A regression that bypasses this is a security boundary fail. Plus `VALUE_MAX_BYTES` boundary uncovered.
- **Suggested fixture:** POST `{key:'__proto__',value:...}` → 400; POST with value exactly `VALUE_MAX_BYTES` bytes succeeds; `+1` byte fails; GET error path returns all 4 fields (kv:{}, updatedAtByKey:{}, lastUpdated, error).
- **Flagged by:** `api_dashboard_state.json` (3 gaps)

### HP-24: eventBackfill DST transitions + catch-and-continue
- **Surface:** `dashboard-web/src/inngest/functions/events.ts` (`runDailyForBackfill`)
- **Why:** `dateRange` uses UTC arithmetic — drifts from Asia/Jerusalem calendar at DST transitions (Oct/Mar each year). A backfill spanning the boundary silently misses or duplicates a day. Plus `runDailyForStore` throw mid-backfill (INN-16) was supposed to be caught-and-continue but Test 5 only exercises happy path.
- **Suggested fixture:** (1) `dateRange('2026-10-23','2026-10-31')` (IL autumn DST) → exactly 9 distinct IL calendar days, no skips/dupes. (2) Mock `runDailyForStore` to throw on pair index 2 of 6 → `successCount===5`, `failureCount===1`. (3) `from===to` single-date backfill → exactly 1 call.
- **Flagged by:** `inngest_eventBackfill.json` (4 gaps)

---

## Medium priority (MP-NN)

Gaps on documented invariants without recent regressions, or on contracts already partially covered by transitive integration tests.

- **MP-01** AI Report — campaign momentum (h1↔h2 ROAS), day-of-week, Pixel-vs-Shopify matching, creative cutoffs (`lib/aiReport.ts`) — multi-section golden fixture with snapshot pinning.
- **MP-02** AI Report — synthetic trueRevenueInfo type compatibility (ALG-08), `lib/aiReport.ts:1163-1174` — remove casts in stub builder; field-by-field comparison vs real hook.
- **MP-03** AI Report — anomaly gate uses `byDate.size` not `daily.length` (ALG-10), `lib/aiReport.ts:443` — single-day multi-store fixture.
- **MP-04** AI Report — `יוצר` field uses Asia/Jerusalem timezone (ALG-11), `lib/aiReport.ts:152` — mock Date to UTC 23:30 (Jerusalem 02:30 next day).
- **MP-05** attributionAnalysis — `pearson()` + `pearsonWithLag()` zero direct coverage (`lib/algorithm/attributionAnalysis.ts:178,214`) — hand-computed oracle fixtures.
- **MP-06** attributionAnalysis — COVERAGE_WARNING_THRESHOLD=2 cap (`lib/algorithm/attributionAnalysis.ts:663`).
- **MP-07** attributionAnalysis — Bayesian CI math (1.96 multiplier) (`lib/algorithm/attributionAnalysis.ts:364`) — N-sweep fixture n=1..50.
- **MP-08** cpmRoasAnalysis — FLAT/UP, FLAT/DOWN ±5% boundary + empty-prev branch.
- **MP-09** cpmRoasAnalysis — non-finite (NaN/Infinity) guards.
- **MP-10** campaignHealthScore — explicit grade boundary table (75/60/45/30) — parameterized test pinning A/B/C/D/F at each boundary.
- **MP-11** campaignHealthScore — unknown-platform DEFAULT_ROAS_PIVOT + DEFAULT_FALLBACK_TRUST.
- **MP-12** cannibalizationDetection — `revenueGrowthPct=null` UI/sort consumer contract (`components/CohortComparisonPanel.tsx`).
- **MP-13** campaignProductMap — read/write/dispatchEvent + setMappedProducts dedupe.
- **MP-14** insights — projectedNet when MTD COGS/fee mix differs from last week (`forecastMonthEnd`).
- **MP-15** insights — detectAnomalies + generateRecommendations + cloud-synced goal writes uncovered.
- **MP-16** analytics — `filterRows()` (range from>to), `deltaPct()` (cur=0/prev=-200), `roasLabel()` boundaries (0/2/2.7/3).
- **MP-17** ordersAttribution — `parseLineItems` malformed JSON + non-array variants.
- **MP-18** Shopify fetcher — October DST transition (IDT→IST, +03:00→+02:00) day grouping.
- **MP-19** Shopify fetcher — note_attributes UTM key collision with `__proto__`/`hasOwnProperty`.
- **MP-20** Shopify fetcher — `safeDecode` URIError on malformed percent-escapes (bot traffic).
- **MP-21** shopifyAuth — singleflight concurrency + expiry-driven re-exchange.
- **MP-22** fx — zero/negative rate from Frankfurter + network rejection (timeout/DNS).
- **MP-23** manualOverrides — null/undefined spend + non-CAD Google FX-conversion + Frankfurter outage.
- **MP-24** useCampaignAttribution — `dailyMetaByAdSet` bucket + memo recomputation + cross-hook TikTok.
- **MP-25** sendDailySummary — `loadActiveMetacloudConfig` null/empty-templateName/empty-recipients skip paths.
- **MP-26** tokenFailures — `resolveTokenFailure` payload + soft-fail on missing env vars (notifier MUST NEVER throw).
- **MP-27** postgresReaders — totalSpend stored-0 vs missing semantics (STA-06) + parseLineItems malformed.
- **MP-28** postgresReaders — per-platform `isCurrentlyActive` matrix (Meta/Google/TikTok × statuses). Only 2 of 7 statuses tested today.
- **MP-29** cloudSync — `lastPushAt` + `HYDRATE_GRACE_MS` interaction across reloads (2026-05-23 fix).
- **MP-30** useDashboardRefresh — 90s watchdog + inFlight guard + POST body.
- **MP-31** dateRange — parseRangeParams direct (only route-tested today) + `parseDate` 4-format coverage.
- **MP-32** urlState — readDashboardState round-trip idempotency + STA-21 (selectAll/None) + STA-22 (preset normalization).
- **MP-33** drawerStack — nested drawer (the stated motivation per WR-01) + cleanup order.
- **MP-34** products.ts (Sheets reader) — STA-46 DMY 31/02 bypass + STA-47 filter asymmetry vs Postgres (operator-confirmed 🔴 backlog).
- **MP-35** shopifyRevenueRefunds — mixed success/failure transactions (STA-29) + customItemRefundCad bucket (D-C3) + negative-net (D-D3).
- **MP-36** billing — `normalizeDate` ambiguity warning + Shopify CSV regional fixtures (US/EU/CAD).
- **MP-37** lineItems — mixed orders (real product + custom item) share denominator + round2 half-cent.
- **MP-38** api routes (data/products/ads/campaigns/storeMeta/productCatalog/ordersAttribution) — 400 RangeParamError + 200 degraded path + Cache-Control:no-store pin.
- **MP-39** api/inngest — env-var assertion (INNGEST_SIGNING_KEY) + registered-functions match file system.

---

## Low priority (LP-NN)

Edge cases, perf assertions, style-of-coverage gaps, or already conventionally guarded.

- **LP-01** `inngest.id === 'roas-dashboard'` literal pin (`inngest/client.ts`).
- **LP-02** eventSyncNow — invalid storeId + missing storeId + date format validation (defense-in-depth).
- **LP-03** Meta-budgets effective_status fallback chain (adset → campaign → null) (`inngest/functions/cronDaily.ts:670-676`).
- **LP-04** api/operator/backfill — empty storeIds array + mixed-type elements + unknown store + 202 shape.
- **LP-05** api/operator/manualOverrides — spend validation + upsert semantics + PATCH partial update.
- **LP-06** api/debug/shopifyFetch — no-token-leak invariant smoke test.
- **LP-07** api/oauth/tiktokCallback — CSP/nosniff/Referrer-Policy + htmlEscape attribute-context test.
- **LP-08** supabase + supabaseAdmin — lazy throw on missing env (not module-load throw) + cache stability.
- **LP-09** dateValidation — year > 9999 + negative-year edges.
- **LP-10** rangeClamp — null `today` param defensive.
- **LP-11** apiErrors — 5 matcher branches + never-include-raw-input invariant.
- **LP-12** costs — buildPnLBreakdown + per-store TX_FEES_RATE override (STA-48).
- **LP-13** format/utils — `fixMinus` (U+002D → U+2212), `storeColor`/`storeBg` 5-color cycle, formatNumber/Date/Pct.
- **LP-14** dashboardStateKeys parity with `cloudSync.STATE_KEYS` (STA-12).
- **LP-15** drillFilter — happy path + inclusive boundary (date === rangeFrom/To).
- **LP-16** platformsByStore — `storeHasTikTok` + STORE_NAMES tuple matches backend ingestion.
- **LP-17** sparklineGeometry — empty values + single value + negative values.
- **LP-18** campaignsLinks — deep-link builders + `hasAccountAwareLink` predicate.
- **LP-19** campaignsColumnPrefs — CC-01 immediate-flag (STA-41) + annotations.ts STA-49 race + STA-50 empty-store global treatment.
- **LP-20** Misc per-file cosmetic + paging-cap warning false-positives + component-level loose ends (~30 different `comp_*` and `lib_state_*` raw-returns).

---

## Cross-cutting tooling gaps

These are not single-file fixtures but recurring patterns that warrant shared infrastructure or repo-wide tests.

### CC-01: Cross-fetcher contract test
- **Why:** Meta / Google / TikTok / Shopify fetchers each independently lack: (a) multi-page pagination tests, (b) token-leak-in-error tests, (c) paging-cap warning false-positive tests (warn fires at exactly `page === 50` even when 50 = last page).
- **Suggested:** Shared `fetcherContract.test.ts` parameterized over the 4 fetchers asserting (a) common pagination loop terminates correctly, (b) error messages NEVER contain `access_token`/`refresh_token`/`client_secret` substrings (regex assertion), (c) warning logic checks `currentPage < totalPages` not `currentPage <= totalPages`.

### CC-02: Single-chokepoint repository-grep test
- **Why:** HR-05 WhatsApp boundary (TG-01) is the canonical case but applies elsewhere: every `graph.facebook.com/.../messages` call goes through `whatsapp.ts`; every Supabase admin client comes from `supabaseAdmin.ts`; every Frankfurter call goes through `fx.ts`. A grep-based static test in CI would catch regressions where a future contributor adds a duplicate call site.
- **Suggested:** Vitest `topology.test.ts` running `execSync('git grep ...')` for ~4 known chokepoints; assert each matches exactly one expected file.

### CC-03: Asia/Jerusalem DST regression suite
- **Why:** 15 distinct gaps across `cronWhatsapp`, `cronDaily`, `cronLive`, `eventBackfill`, `shopify`, `aiReport`, `dateRange`, `presets`, `urlState`, `comp_HeroOverview`, `comp_WhatsWorking` all touch TZ math. A shared parameterized test running each TZ-sensitive function across both DST transition days would catch all.
- **Suggested:** `dstRegression.test.ts` with `vi.setSystemTime` to 4 known UTC instants (one before, one after each transition) and a callback registry of TZ-sensitive functions; assert each returns expected IL calendar day.

### CC-04: Integration test for cron-live × Supabase (multi-step end-to-end)
- **Why:** Existing cronLive.test.ts uses `makeStepStub` that runs each step exactly once. Production runs include retry, partial-failure, and concurrent-step paths. An in-memory Supabase mock that records ALL writes across all steps would catch INN-10 idempotency drift, INN-07 partial-failure attribution, and the step-count exec-budget invariant.
- **Suggested:** `cronLiveIntegration.test.ts` with custom step stub that simulates retry + an in-memory Supabase that records writes; assertions on final database state.

### CC-05: TypeScript-only structural contract tests (no runtime)
- **Why:** ALG-08 (synthetic `trueRevenueInfo` bypassing TS via `as unknown as ... as never`), `lib_state_types.ts` DailyRow optional-field drift, `aiReport.ts:1490` `cKey` dead conditional — all are caught by stricter TS but not by current configuration.
- **Suggested:** Add type-only test files (`*.type.test.ts`) using `expectTypeOf` or `tsd`; enable `noUnusedLocals` + `noImplicitAny` repo-wide.

### CC-06: Component test infrastructure (RTL setup)
- **Why:** Five Wave-G components (HP-14..18) + ~30 components flagged in MP/LP have zero RTL tests. Existing component test infra (`comp_FreshnessChip.test.ts` is the only one) doesn't scale. A shared `componentSetup.ts` providing canonical fixtures + render helpers would unblock all.
- **Suggested:** `src/components/__tests__/setup.ts` exporting `renderWithProviders()`, `mockCloudSync()`, `synthCampaigns()`, etc. Add to vitest config.

### CC-07: Cross-store collision golden fixture (operator's default `storeName='All'` view)
- **Why:** ALG-04/05/06 in `aiReport.ts`, `lib_algorithm_multiMappingCohort`, `comp_WhatsWorking` (TikTok CMP-33), `comp_CommandPalette` (store canonicalization CMP-11A), `comp_HeroOverview` (CMP-17 range-passing) — all break in `storeName='All'` mode when stores share campaign IDs / UTM names. A shared golden fixture (`twoStoreCollision.fixture.ts`) feeding each consumer would surface every downstream silent mis-attribution.

### CC-08: Phase 10/11 fix regression pins (audit-back-reference)
- **Why:** Many ✅ Verified verdicts in Phase 12 rest on "the audit comment in source confirms the fix" (e.g. CC-01 immediate flag, WR2-01 pendingRetries cancellation, FIX-06 ABO/CBO normalization, IN-05/IN-06 platform exclusions). Each is documented in code comments only — no test asserts the fix's behavior. A regression pin per Phase 10/11 fix would harden the audit baseline.

### CC-09: Operator-checkpoint test fixture catalog
- **Why:** The 17 ⚠️ Uncertain entries that operator triage resolved (per `resolutions.json`) each correspond to a contract that should be regression-pinned. Examples: `STA-46 inline parseDate bypasses WR-04`, `STA-47 filter asymmetry vs Postgres reader`, `INN-01 return-roas vs persisted-roas TikTok mismatch`. These should land as a dedicated test catalog tied 1:1 to the resolutions log.

### CC-10: Inngest free-tier execution budget invariant test
- **Why:** Comments at `cronLive.ts:18-25` document 25.9K execs/month from cron-live. The current `cronLive.test.ts:273-274` asserts `labels.length` is in `[1,5]` but doesn't pin the exact decomposition. A future refactor that adds a 6th step pushes execs/month past 30K — still under 50K cap but eats half the safety margin. Same concern in `eventBackfill` (inner step count per pair).
- **Suggested:** Per cron handler, `expect(labels).toEqual([... pinned list ...])`.

---

*Generated 2026-05-24 by Plan-agent task 12.H2 from 144 raw-return JSON files. Phase 12 cross-cutting deliverable per SPEC requirement + CONTEXT.md decision D-16.*
