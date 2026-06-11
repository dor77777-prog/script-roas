# דוח אודיט-עומק מלא — ROAS Dashboard · 2026-06-10

> **מקור:** Workflow רב-סוכני — 23 סוכנים (12 יחידות-אודיט + אימות-יריב לכל ממצא חמור + סינתזה), ~3.8M tokens, 905 קריאות-כלים · בתוספת סריקת-UX חיה על הפרודקשן (chrome-devtools, שני מצבי-תצוגה + מובייל).
> **סטטוס:** READ-ONLY. שום תיקון לא בוצע. תוכנית-הביצוע: `docs/superpowers/plans/2026-06-10-production-readiness-fixes.md` — ממתינה לאישור המפעיל.

## פסק-דין כולל (Synthesis)

Honest verdict: the dashboard's financial core is in strong shape — the money math (billing split invariants, signed-refund attribution, allocator conservation, FX null-preserve doctrine in cron-daily, DST-safe date math), the auth stack, and all of the 2026-06-09/10 consistency fixes were independently re-verified as correct, and no wrong-number bug was found in today's primary aggregates. The production-readiness risk concentrates in four clusters instead: (1) a LIVE-VERIFIED data-loss timebomb — paginate()'s silent 50,000-row ceiling with the payments tab already at 46,773 rows and ~2,100 orders/month, so zolplus's newest payment data starts silently vanishing around August 2026 while the only tripwire (`rows.length > 50000`) is mathematically dead code; (2) pipeline regressions that quietly defeat shipped features — cron-yesterday-refresh's 2h cadence is fully inert via Inngest event-id dedupe, and Meta/Google (plus cross-store TikTok) manual overrides are clobbered within ≤10 minutes because the override guard was only built for TikTok in one of two RPCs; (3) a systemic error-swallowing pattern (~15 surfaces) where DB/HTTP failures render as plausible 'no data'/zero/all-clear states — the exact P0-9 class already fixed in AdsDrawer but never propagated, worst in the CampaignDrawer, Customers/Payments tabs, Home order KPIs, and the InsightsBoard alerting surface; (4) intelligence-layer honesty gaps — partial-day false CRITICALs every morning, 'scale 20-40%' advice during the exact pixel-outage signature that already happened in production, and a compare-baseline (prev_month/prev_year) that overlaps the active range on every month-end window. One refutation matters: the /api/store-events soft-fail is documented, test-pinned, Sentry-captured design — not a bug. For the single operator, the 4 P0s plus ~8 hurts-now P1s are the real punch list; the hardcoded 3-store parallel lists, registry reaper, and the a11y/touch shortlist are the gate for paying customers.

---

## P0 — קריטיים (4)

### P0-1 · paginate() silently truncates at exactly 50,000 rows — payments tab loses zolplus's newest months ~Aug 2026; all route-level >50000 warnings are dead code
- **אזור:** api-routes / postgresReaders.ts · **חומרה:** high · **רלוונטיות:** hurts-now
- **ראיות:** postgresReaders.ts:174-188 (MAX_CHUNKS=50×1000, exits silently — verified `MAX_CHUNKS = 50` at :176); readPaymentMethodsByMonth (:1502-1511) scans ALL of orders_attribution with no date bound, ordered store_id,order_id ASC. LIVE-VERIFIED against production /api/payment-methods: 46,773 orders across 37 months, ~2,100 orders/month trailing average → ceiling crossed in ~1.5-2.5 months; lexicographic order makes zolplus's NEWEST orders the truncated tail. fetchCurrentCampaignStatuses Query 2 (:1013-1017) and fetchLastKnownBudgetTypes (:1073-1079) are date-unbounded, ASC — truncation keeps OLDEST pages, drops newest statuses (partially acknowledged in a 'Known scale note' comment). Every `rows.length > 50000` guard (data:73, ads:45, campaigns:88, products:46, orders-attribution:58) is unreachable since paginate returns at most exactly 50000.
- **תיקון:** (1) paginate(): when the loop exits via MAX_CHUNKS with a full last page, console.error + Sentry truncation event (or throw). (2) Flip route guards to >= 50000. (3) Replace readPaymentMethodsByMonth's full scan with a SQL GROUP BY month/store/gateway RPC (eliminates the transfer entirely) or month-windowed reads. (4) Switch campaign-status Query 2 to adset_registry as its own comment prescribes; date-bound fetchLastKnownBudgetTypes (~120 days). Deadline-driven: do before August 2026.

### P0-2 · cron-yesterday-refresh is silently deduped to ONE run per day — the every-2h cadence shipped in Phase E1.5 is completely inert
- **אזור:** pipeline / Inngest scheduler→worker fold · **חומרה:** high · **רלוונטיות:** hurts-now
- **ראיות:** planStoreJobs.ts:94-97: yesterday-family event id = `cron-yesterday-{store}-{date}` with date as the SOLE discriminator (verified: 'Ignored when the family already carries a `date`' applies to tickId). cronYesterdayRefresh.ts:123-151 fires 12×/day, every fire emitting IDENTICAL event ids per store; Inngest event `id` is a 24h idempotency key (inngest types.d.ts:509-515), so fires 2-12 never invoke the worker. The live family deliberately rotates ids per 10-min bucket (cronLive.ts:878-881 comment proves the team relies on exactly this dedupe semantics). Regression introduced by the Phase 4b fold (commit bb55fcc); the registered route uses the fold, not the dedupe-free factory crons. Net: yesterday reconciles once at 00:15 — 10 min after cron-daily already did the same date — lagged spend restatements sit up to ~24h stale (the exact gap the operator rejected 2026-05-30), and a failed 00:15 run gets no intra-day re-fire.
- **תיקון:** Add a per-fire discriminator to the yesterday-family event id (e.g. hour-bucket or scheduler runId: `cron-yesterday-{store}-{date}-{tick}`), keeping `date` in the payload unchanged. Add a fold-guard test asserting two scheduler runs on the same date produce DIFFERENT event ids. One-line risk-free change; verify in the Inngest dashboard that the next 2h fire actually invokes the worker.

### P0-3 · Manual-override guards incomplete across the agg RPCs: Meta/Google overrides clobbered within ≤10 min; cross-store TikTok overrides clobbered by uzoshop's runs
- **אזור:** pipeline / supabase agg RPCs · **חומרה:** high · **רלוונטיות:** hurts-now
- **ראיות:** Leg A (HIGH, confirmed): migration 20260609180000 Pass 1 zeroes fb_spend_cad/ga_spend_cad UNCONDITIONALLY and Pass 2 re-sums from campaigns_daily; the NOT EXISTS manual_overrides guard covers platform='tiktok' ONLY (verified: every guard clause filters `mo.platform = 'tiktok'`). cron-live calls agg_data_daily_for_date every 10 min for the rolling 3-day window (cronLive.ts:444-450) + all 3 hot_metrics workers call it for today — a meta/google override (the exact May 1-8 platform-outage emergency flow, supported by the operator UI at manual-overrides/route.ts:167) is silently replaced by the wrong campaigns_daily-derived sum, flip-flops, and is permanently lost once the date exits the 3-day window. Leg B (MEDIUM, confirmed with corrected mechanism): agg_tiktok_spend_per_store_for_date (migration 20260530200000:29) zeroes tt_spend_cad date-globally for ALL stores with NO override awareness (verified: no NOT EXISTS in the file); a TikTok override typed for usmile360/zolplus is clobbered by UZOSHOP's nightly cron-daily + every-2h yesterday-refresh runs (the originally-claimed direction — usmile360 clobbering uzoshop — is impossible: STORES_WITH_TIKTOK={'uzoshop'} and the RPC call is gated on adRows.length>0).
- **תיקון:** One migration: mirror the 20260609180000 NOT-EXISTS pattern for platform='meta' on fb_spend_cad and platform='google' on ga_spend_cad in agg_data_daily_for_date, and add the same tiktok guard to agg_tiktok_spend_per_store_for_date's Pass 1a/1b (also covers scripts/backfillTikTokMapping.ts:192). All callers inherit it. Load-bearing SQL — verify with `npm run audit:reconcile` after applying.

### P0-4 · CampaignDrawer's 4 fetchers swallow ALL failures into fake-empty responses — the exact P0-9 class fixed in AdsDrawer on 2026-06-09, one level up
- **אזור:** client / campaign-drawer · **חומרה:** high · **רלוונטיות:** hurts-now
- **ראיות:** campaign-drawer/index.tsx:230-266 — all four SWR fetchers (campaigns, products, prev-campaigns, orders-attribution&lineItems) do `if (!r.ok) return { rows: [] }` and never call throwOnErrorBody; the resolved value is cached as success (no SWR error, no retry, revalidateOnFocus:false). /api/campaigns, /api/products, /api/orders-attribution all also degrade to 200+{rows:[],error}, which these fetchers treat as data. Zero `.error` reads in campaign-drawer/*.tsx. AdsDrawer.tsx:69-82's own Task 5.7 (P0-9) comment documents this exact failure mode ('operator stared at an empty list, blamed the data pipeline, re-ran the cron'); throwOnErrorBody is used in exactly one non-test component. Impact: a Supabase blip while the modal is open silently blanks the cohort/multi-mapping panel, reconciliation, deterministic Shopify-revenue figures, product-mapping context, and prev-period CPM — indistinguishable from real emptiness.
- **תיקון:** Replace the four inline fetchers with the shared fetchJson + throwOnErrorBody contract (or thread data?.error into an inline error strip in the drawer header), mirroring AdsDrawer's primary fetcher; keep the prev-period fetch soft only if documented like AdsDrawer's secondary fetch. Add the same DOM-test guard that pinned the AdsDrawer fix. Client-only, safe.

---

## P1 — חשובים (32)

### P1-1 · prev_month / prev_year compare windows roll over month-end dates and OVERLAP the active range
- **אזור:** analytics / presets.ts · medium · hurts-now
- **ראיות:** presets.ts:205-216 shiftDateBack uses Date.UTC(y,m-1,day) which rolls overflow forward; the doc comment claims clamping — actual: prev_month of full May → 2026-04-01..2026-05-01 (includes day 1 of the active range); full March → 3-day overlap; leap-day prev_year → Mar 1. Verified by live vitest repro; locked tests deliberately use only mid-month dates. Feeds every hero delta via Dashboard.tsx:1000-1031 — and 'last_month' ALWAYS ends month-end, so the baseline self-overlaps whenever those baselines are picked.
- **תיקון:** Clamp in shiftDateBack: day = min(day, daysInMonth(targetYear, targetMonth)) before Date.UTC; add month-end + leap regression tests asserting zero overlap. Pure function, safe.

### P1-2 · Customers + Payments tabs: DB failure (and initial load) renders as legitimate 'no data' business verdicts
- **אזור:** client / CustomerValueTab + PaymentMethodsTab · medium · hurts-now
- **ראיות:** Confirmed: /api/cohorts and /api/payment-methods soft-fail 200+{rows:[],error} with docs instructing consumers to treat as data-less; both fetchers throw only on !res.ok and neither component reads data.error or SWR error/isLoading (CustomerValueTab.tsx:79-85,169; PaymentMethodsTab.tsx:247-254,297-301). A Supabase blip shows LTV $0 / 'cohorts not mature' / 'הדאטה תופיע ברגע שהזמנות יסונכרנו' — wrong diagnosis on two financial tabs; every cold visit also flashes the false empty copy before data lands.
- **תיקון:** throwOnErrorBody in both fetchers + destructure error/isLoading; skeleton while loading, red error strip on error||data.error (ProductsTable pattern), empty copy only for settled-empty. Add DOM guards.

### P1-3 · Home order-derived KPIs: orders-attribution failures are fully silent AND loading shows 0 instead of the designed '—'
- **אזור:** client / Dashboard + home adapters · medium · hurts-now
- **ראיות:** Confirmed: Dashboard.tsx:240 destructures only data (no error read anywhere; route's degraded body error field has zero client consumers); WR-06 banner covers /api/data only. ordersByStore seeds 0 per store before the fetch settles (Dashboard.tsx:529-544) and adapters.ts:390 does `?? 0`, making PerStoreRow's '—'-for-null contract unreachable — contradicting the comment at :527-528 defining '—' as 'still loading'. During an outage: real revenue beside '0 הזמנות', vanished coverage chip, zeroed NC-ROAS/nCAC, no banner.
- **תיקון:** Pass null orders to adapters while ordersData===undefined; surface error||ordersData.error (and campaignsData.error) in the WR-06 banner; treat error-present responses as unknown (—), not 0.

### P1-4 · Systemic error-swallow sweep: ~10 more surfaces resolve failures to fake-empty/fake-loading/false-all-clear
- **אזור:** client / cross-cutting fetchers · medium · hurts-now
- **ראיות:** Same root cause, one fix pattern: ProductCentricView (null on !ok → INFINITE 'טוען…', :44-48,400-406; degraded-200 reads 'אין מיפויים פעילים'); AiReportButton (fetchJsonOrNull → perpetual spinner on products/campaigns failure, orders/ads not in dataReady → silently partial AI report, :70-81,185); InsightsBoard+ActionListPanel (failed feeds render the all-clear 'אין פעולות דחופות כרגע' — worst degradation for an alerting surface); ProductPickerModal (failure copy sends operator to debug the WRONG table, products-daily vs catalog); BillingSettings meta.error never read (defeats its own lastError design); GoalTracker wide-fetch error → $0 actuals for past months; MonthlyTables/AnalysisArchiveTab miss the data.error degraded body (archive-year key is outside the Dashboard banner); CampaignsTable localDailyResp returns {rows:[]} on !ok which DEFEATS the documented `?? dailyRows` fallback; useStoreAdAccounts; /api/operator/meta-buc-usage discards the supabase error so its own error contract is dead code.
- **תיקון:** One shared throwing fetcher (fetchJson + throwOnErrorBody) adopted across all listed sites; per-surface error branch (most have a sibling pattern to copy). For InsightsBoard specifically: a neutral 'לא ניתן לנתח כרגע' state when any required feed failed. Add a lint/test that flags `if (!r.ok) return {` in components.

### P1-5 · Six routes missing the WR-02 no-store header on degraded 200 responses — store-meta can pin an empty error body for 1 hour
- **אזור:** api-routes · medium · hurts-now
- **ראיות:** /api/store-meta (revalidate=3600, statically cacheable GET, error path :50 has no Cache-Control), /api/dashboard-state GET, /api/product-catalog, /api/ads, /api/home/activity-events, /api/operator/status-events — all contrast with the documented WR-02 pattern applied in /api/data:109-121 and 5 sibling routes. One Supabase blip during regeneration freezes the degraded body for the full revalidate window (1h of missing TikTok advertiser IDs / deep links / plan auto-detect).
- **תיקון:** Add Cache-Control: no-store to every 200-degraded catch path on the six routes; add a unit guard asserting every route with a revalidate also sets no-store on its catch path. Trivial, safe.

### P1-6 · Hardcoded 3-store parallel lists contradict the in-flight self-serve-stores foundation (the operator's own 'two unguarded parallel lists' failure class)
- **אזור:** cross-cutting / stores · medium · production-grade
- **ראיות:** (1) operatorManualOverrides.ts:18 VALID_STORES frozen trio; (2) token_failures CHECK constraint (migration 20260523080000:42) + never-throws soft-fail → a 4th store's auth failures silently produce ZERO WhatsApp alerts; (3) postgresReaders.ts:704-708 STORE_NAME_BY_ID id→display projection used by campaigns/ads/orders/cohorts/payments readers (re-arms the A1 2026-06-04 incident for store #4; a store RENAME via PATCH desyncs it); (4) /api/operator/ad-state accepts any storeId; (5) client name↔id maps in ActivityFeed.tsx:141-161, ActivityEventsTab:102-110, ActivityStatsTab:95-102 → a self-serve store's filtered feed/stats are silently EMPTY; (6) '3 חנויות' literals in ActivityFeed:397/419, TabFreshnessHeader:44, ResetData:303.
- **תיקון:** Derive everything from the DB stores table: loadActiveStoreIds() for validation, id↔name from fetchStoreMetaFromPostgres/useStores, migrate the token_failures CHECK to an FK or drop it, interpolate storeList.length in copy. Add a stateKeysParity-style test failing when any hardcoded store list diverges from the DB seed. Do before Phase 6b ships.

### P1-7 · Insights evaluate the partial current Israel day — false CRITICAL 'revenue crash' every morning + intra-day health-grade swings (A9-04 fixed only 1 of 4 rules)
- **אזור:** intelligence / insights.ts + campaignsIntelligence · medium · hurts-now
- **ראיות:** insights.ts:141-167: revenue z-score fires CRITICAL against a full-day baseline using the in-progress day (15% of typical revenue at 09:00 → |z|>>2.5, survives prioritizeInsights into the action list); :188-189 the 3-day ROAS streak counts today's lagged-attribution ROAS. Only the dead-day rule got the current-day guard (A9-04 comment documents the exact reasoning). Same class in the health pipeline: CampaignsTable.tsx:952-994 feeds today's understated ROAS into analyzeCpmVsRoas's recent half → trajectory 60→40/0, grade B↔C swings by time of day.
- **תיקון:** In detectMetricAnomalies, drop the last row when todayDate===getTodayInIsraelTz() for the z-score/streak rules (mirroring detectCampaignDied's today-1 anchor); exclude the current IL day from the health-trajectory dailyByCampaign input (chart display keeps today). Add sibling tests to insightsDeadDayCurrentDay.test.ts.

### P1-8 · Trust ladder rewards tracking outages: platform-claims-ZERO → 'אמין 90 + scale 20-40%'; coverage>2 shows pixel-broken alert AND scale advice in the same card
- **אזור:** intelligence / attributionAnalysis trust ladder · medium · hurts-now
- **ראיות:** attributionAnalysis.ts:587-600 + computeCoverage:226-232 (claim=0 && det>0 → coverage=1). Executed: metaClaim=0 with 2 real orders → high trust + scale-budget recommendation, NO warning — the signature of the TikTok conversions=0 outage that actually happened (fixed c8c38a9). At coverage 3.14: trust 100 + the SAME scale advice while AttributionAnalysisPanel renders the red 'בדוק את הפיקסל' banner above it. The claim=0→1 fallback is test-locked for the COVERAGE value only; nothing locks the resulting verdict.
- **תיקון:** (a) claim===0 && deterministicOrders>0 → distinct 'platform reports 0 — check the conversion tag' verdict instead of the halo branch; (b) when coverageExceedsClamp, cap trust at medium and swap the scale recommendation for the pixel-check action so the panel tells one story.

### P1-9 · Intelligence math trio: trends compares unequal half-SUMS; CPM-vs-ROAS reads a total collapse as 'flat'; health scorer punishes partial evidence below zero evidence
- **אזור:** intelligence / synthesis + cpmRoasAnalysis + campaignHealthScore · medium · hurts-now
- **ראיות:** (1) trends.ts:87-100: 7-day range splits 3v4 days → flat $100/day reads 'הוצאה עלתה 33.3%' (tests only cover even lengths). (2) cpmRoasAnalysis.ts:201-206 meanOrNull_ returns null when sum===0 → current all-zero-ROAS vs prev 3.0 categorizes 'flat'/'אין סיגנל לפעולה דחופה' — the worst campaign state described as stability (half-over-half path handles it correctly; asymmetry untested). (3) campaignHealthScore.ts:235-242: ONE tagged $100 order flips to the deterministic branch → grade F while an identical zero-evidence campaign keeps C — non-monotonic cliff that bites during the current Google ValueTrack ramp-up.
- **תיקון:** (1) Compare per-day MEANS in trends; odd-length flat regression test. (2) meanOrNull_ returns the real mean (incl. 0) for non-empty series; test prev 3.0 → current 0 = 'down'/negative. (3) Gate branch 1 on an evidence floor (deterministicOrders>=3 OR coverage>=0.2), falling through to the prior-based branch below it. All pure-lib + tests; check against locked suites.

### P1-10 · synthesis/roasChart private bandForRoas drifted: ROAS exactly 3.0 tints BLUE in the chart TL;DR — escapes the brand-new band-consistency CI guard
- **אזור:** intelligence / synthesis/roasChart.ts · low · hurts-now
- **ראיות:** roasChart.ts:90-96 `if (roas < 3.0) green; return blue` vs canonical useRoasBandGradient.ts:78 `roas <= 3.0 → green` (the 2026-06-09 Task 11 lock). The synth file's own doc claims 'Identical thresholds'. roasBandConsistency.guard.test.ts doesn't import it; band is also computed from the UNROUNDED average while the displayed anchor is rounded (3.04 shows '3.0' tinted blue next to a green KPI tile).
- **תיקון:** Delete the private function, band the ROUNDED anchor via the canonical helper, and extend the guard test to import synthesizeRoasChart with 3.0 in SAMPLES. Exactly the divergence class the operator just paid to close.

### P1-11 · FX-outage blast radius: hot-metrics write spend_cad=0; the nightly merge step THROWS pre-persist; /api/data has no FX timeout
- **אזור:** pipeline + api / FX doctrine · medium · hurts-now
- **ראיות:** Three violations of the canonical 'FX failure → null → omit column' doctrine (cadConvert.ts:10-15): (1) metaAccountConfig.ts:95-114 / tiktokAccountConfig.ts:171-190 adapters return 0 on Frankfurter failure → metaHotMetrics.ts:148/tiktokHotMetrics.ts:189-197 overwrite real intraday spend with $0 every 10-min tick → fake blue-band ROAS + detectors firing on fiction until cron-daily repairs it. (2) manualOverrides.ts:83-87 spendToCad throws on the no-override path (Meta is always ILS so it runs nightly) → the apply-overrides step at cronDaily.ts:823-831 fails the WHOLE nightly persist for that store (the CRIT-5 null-preserve lives one step later, inside persist-batch) — compounded by the inert yesterday-refresh, next auto-retry is ~24h. (3) data/route.ts:24-35 fetchTodayFx has no AbortSignal inside the Promise.all — a hung FX connection stalls the primary dashboard route to the platform ceiling.
- **תיקון:** (1) Change the adapter contract to null-on-failure and omit spend_cad/conversion_value_cad keys (ON CONFLICT preserves last good); keep the throttled notifyFxFailure. (2) Null-preserve at the merge layer (return flags + null CAD, let persist-batch omit columns); keep throwing only for operator overrideToCad as documented. (3) AbortSignal.timeout(~2500ms) → null. Load-bearing across 3 workers — verify with the reconcile harness.

### P1-12 · Meta worker failure visibility: inner batch-part errors swallowed → freshness records SUCCESS while nothing was written; status branch never records transient_error; prod credential errors swallowed
- **אזור:** pipeline / metaWorker + metaStatus/metaHotMetrics · medium · hurts-now
- **ראיות:** metaStatus.ts:106-114 + metaHotMetrics.ts:130-138 asArray returns [] when an inner batch part has code!==200 (a normal Meta failure mode: per-call throttling, transient 500s inside the envelope) → the worker upserts nothing and records status='success' (metaWorker.ts:399-408, :613) — false-green on the panel the whole Phase A freshness contract exists to keep honest; today's spend silently stops refreshing with no retry/alert. Plus: the status branch has no try/catch (no transient_error row, unlike google/tiktok siblings), and safeCredentials (:203-219) swallows credential errors unconditionally while siblings gate on VITEST.
- **תיקון:** asArray: throw on part.code!==200 (worker catch → transient_error → Inngest retry); wrap the status branch in the siblings' try/catch pattern; gate safeCredentials' swallow on process.env.VITEST.

### P1-13 · Google placeholder enrollment is dead code; registry soft-delete ('removed') was never implemented
- **אזור:** pipeline / googleWorker + registries · medium · hurts-now
- **ראיות:** (1) googleWorker.ts:348 filters effective_status==='ENABLED' but googleStatus.ts:219-237 builds Google ad-group rows with effective_status always null (the IMP-D comment documents ad_group has no serving_status; 'ENABLED' lives in configured_status/is_enabled) → newly-enabled zero-spend Google campaigns are invisible until they accrue spend, defeating the E1.5 design for one of three platforms. (2) diff.ts:26-27 documents missed_seen_count/is_removed reaping; repo-wide, NO writer ever bumps missed_seen_count or sets is_removed=true (upsert.ts:51-52 hardcodes 0/false) — hard-deleted entities are immortal in the hot set and enriched views; the Phase D soak's hand-written cleanup migrations are the symptom.
- **תיקון:** (1) Filter on a.is_enabled===true; unit test a googleStatus-shaped ENABLED ad-group produces a placeholder. (2) Implement the documented reaper after full-snapshot status fetches (Meta/TikTok); add a daily full-list sweep for delta-based Google (also fixes the >24h-outage status gap).

### P1-14 · Operator 'Refresh All' / sync-now marks TODAY is_finalized=true + source='daily_reconcile' mid-day — provenance layer lies for the rest of the day
- **אזור:** pipeline / cronDaily + eventSyncNow · medium · hurts-now
- **ראיות:** cronDaily.ts:1062-1064 unconditionally writes source:'daily_reconcile', is_finalized:true; eventSyncNow runs runDailyForStore for dates including today (Refresh All passes a 3-day window incl. today); cron-live's later writes omit those columns so the flag persists. Drives the UI provenance verdict (lib/freshness/provenance.ts:49-51).
- **תיקון:** is_finalized = (dateStr < getTodayInIsraelTz()); optionally source='manual_sync' for operator-triggered today-runs.

### P1-15 · Cohort/LTV pipeline: bulk exports include test+voided orders that every live path excludes — distorts LTV and can permanently flip a real first order to 'returning'
- **אזור:** customers / shopifyBulkCohort + shopifyBulkFirstOrder · medium · hurts-now
- **ראיות:** BULK_COHORT_QUERY (shopifyBulkCohort.ts:65-87) and BULK_FIRST_ORDER_QUERY (shopifyBulkFirstOrder.ts:30-50) have NO query filter and never fetch test/cancelledAt/financial status, while fetchShopifyOrdersAttribution (shopify.ts:951-952) and shopifyRevenueRefunds.ts:286-288 explicitly drop test + voided. Voided orders inflate cohort gross AND net; a test/voided earliest order seeds the ledger's first_order_id and the lower-only conflict guard (migration 20260602150000:79-82) means the live path can NEVER repair it → ncOrders undercounted, stable nCAC overstated.
- **תיקון:** Add `query: "test:false AND -status:cancelled"` (or fetch + filter the fields to mirror the REST rules) to both bulk queries; one-time re-run of the ledger seed + cohort backfill.

### P1-16 · Cohort refresh robustness: pollers never verify the bulk-operation id; full-replace has no omitted-line threshold and is non-transactional
- **אזור:** customers / cronCohortRefresh · medium · production-grade
- **ראיות:** checkBulkCohortStatus polls bare currentBulkOperation without comparing ids (shopifyBulkCohort.ts:182-210; runCohortRefreshStepped discards the started gid) — currentBulkOperation is shop+app-global and THREE producers run bulk ops on the same shops (weekly cron, backfillFirstOrderLedger, exportCustomersForFacebook), so an interleaved foreign export can be downloaded and full-replace the cohort table with garbage. Separately, the ingest step discards omittedFx (cronCohortRefresh.ts:344-349) and replaceCohortCells DELETE→INSERTs non-atomically — a mass FX failure (any future non-CAD store) silently wipes a store's cohort history for the week, violating 'stale > wrong' at the replace boundary.
- **תיקון:** Thread the gid and treat id-mismatch as 'superseded' (or query node(id:) directly) across all three pollers; abort the store when omittedFx/rows exceeds ~1%; make the replace atomic (staging-table swap or single-transaction RPC).

### P1-17 · recompute_first_order_flags rewrites every classified orders_attribution row (~46k+) on every ~10-min tick — millions of dead tuples/day since the deep backfill
- **אזור:** customers / migration 20260602150000 + cronLive · medium · hurts-now
- **ראיות:** STEP 2 (:91-97) UPDATEs all customer rows per store with no IS DISTINCT FROM guard and no date narrowing; STEP 3 (:102-105) rewrites every guest row unconditionally. cron-live calls it per store every tick (cronLive.ts:705-712), cron-daily again. Written for a ~1.2k-row rolling window; the table is now ~46.5k rows back to 2023. Postgres writes a new row version even for same-value updates → ~40k rows × ~144 ticks/day of dead tuples + WAL on Supabase, for a result that changes for a handful of rows per tick.
- **תיקון:** New migration (CREATE OR REPLACE): add `AND oa.is_first_order IS DISTINCT FROM (oa.order_id = l.first_order_id)` to STEP 2 and `AND is_first_order IS NOT NULL` to STEP 3; optionally narrow STEP 2 to customers touched in the current window. Safe, big win.

### P1-18 · hydrateFromCloud dispatches change events unconditionally every 30s — hidden refetch loops + full re-aggregate cascade, silently undoing the 120s cost-cut
- **אזור:** client / cloudSync · medium · hurts-now
- **ראיות:** cloudSync.ts:496-507 writeLocal+dispatchChange for EVERY cloud key with no value comparison, polled every 30s (CloudSync.tsx:23). Verified consequences: 'roas-billing-changed' ×2/poll → swrMutate(dataKey) = /api/data revalidation every 30s off-phase from the declared single 120s driver (Dashboard.tsx:374-382 vs 394-423); campaign-product-map event → /api/products + /api/orders-attribution refetches every 30s on the campaigns tab; all settings hooks setState a fresh object → applyCogsToRows + the whole `filtered` aggregate recompute ~2,880×/day per tab. Related: campaignsData/chartCampaigns/QuadrantScatter carry their own offset 120s refreshIntervals and ordersDataPrev polls a HISTORICAL window at 60s — two visible update waves, the exact non-uniformity the coordinated tick was built to fix.
- **תיקון:** Skip writeLocal+dispatchChange when the incoming cloud value equals the current local value (string-compare); same guard on the null-clear branch. Zero out the per-hook refreshIntervals (they ride the global tick). Test against cloudSyncHydrate suites.

### P1-19 · No IL-midnight rollover: 'today' preset + stableNcacRange stay pinned to the mount date for the whole session
- **אזור:** client / Dashboard · medium · hurts-now
- **ראיות:** Dashboard.tsx:195-203 computes filters.range once in the useState initializer; no timer re-derives presets — a session left open across IL midnight (the operator's documented pattern) shows YESTERDAY labeled 'היום' indefinitely with a green freshness chip, while the footer promises auto-update. stableNcacRange (:300-303) freezes `to` at mount with an empty-dep useMemo while its own comment claims it 'rolls at IL-midnight' — the Customers-tab nCAC window silently stops accruing days.
- **תיקון:** A shared useIlToday() (minute-interval or piggybacked on the auto-refresh tick + visibilitychange) that re-derives computePresetRange(filters.preset) for non-custom presets and feeds stableNcacRange's deps.

### P1-20 · 'Refresh All' completion probe always 400s — spinner runs the full 180s watchdog on every press
- **אזור:** client / useDashboardRefresh · medium · hurts-now
- **ראיות:** Confirmed: useDashboardRefresh.ts:92 polls /api/data with NO from/to; since P1-2 parseRangeParams throws → HTTP 400 on every iteration, backendDone never sets, the loop always runs MAX_WAIT_MS=180_000 with a false watchdog warning, and the final mutate fires at t+180s instead of when the backend finished (~30-60s). The unit test mocks the route as 200, masking the break; dateRange.ts:60's 'no legitimate caller omits both params' proves the probe was missed.
- **תיקון:** Probe a valid 1-day range (from=to=today-IL) or a lightweight lastWriteAt endpoint; add a test that the probe URL parses through parseRangeParams. Trivial.

### P1-21 · Flat-series sparklines render pinned to the BOTTOM — the documented c/HI-05 fix lives only in dead code
- **אזור:** charts / Sparkline + CommandCenterHero · medium · hurts-now
- **ראיות:** Sparkline.tsx:49-55 (range||1 then y=height−…) puts an all-equal series at y=height; sparklineGeometry.ts documents this EXACT pattern as the c/HI-05 bug ('constant 3.0 looked like trending toward zero') and centers it — but computeSparklineGeometry has ZERO production importers (only its test). Duplicated in NetSparkline (:390-396) and MiniSparkline (:518-525), where the comment claims midline rendering the code doesn't do. Consumers: per-campaign ROAS trend, DetailTable, PerStoreRow band cards, StoreDetailModal, hero sparks. The passing test gives false assurance.
- **תיקון:** Route all three through computeSparklineGeometry (or replicate the degenerate branch: max===min → vertical center); DOM regression test asserting flat-series path y≈height/2. Also swap MiniSparkline's area/line layering to match NetSparkline.

### P1-22 · RoasTargetChart clips every day above ROAS 4.0 to the top gridline — strong weeks render as a false plateau
- **אזור:** charts / RoasTargetChart · medium · hurts-now
- **ראיות:** RoasTargetChart.tsx:128-129 fixed Y_MAX=4; yForRoas (:169-174) clamps before mapping — every dot/line/today-marker drawn through it, while the שיא label (:804) and tooltip print the real value (e.g. 'שיא 6.2' with its dot ON the 4.0 line). >3 is the blue 'מעולה' band, so 4.5-6 days are plausible and exactly the days worth seeing; a 4.1 day and a 6.0 day are pixel-identical. No domain test.
- **תיקון:** Dynamic yMax = max(4, ceil(max roas)) with gridlines re-derived (keep the 3.0 target line fixed), or explicit off-scale markers; test asserting a 5.5 point sits above the 4.0 gridline.

### P1-23 · Campaigns search UX cluster: summary cards ignore the active search (FIND-01 violation); zero matches is a silent dead end; 'הצג עוד 0' no-op button
- **אזור:** client / CampaignsTable · medium · hurts-now
- **ראיות:** totals memo (:1035-1063) sums aggregatedFiltered while displaySearched (:1294-1306) filters the body — its own FIND-01 comment says 'summary cards must track what's actually rendered'; typing a search shows 2 rows of $1.2K under an $80K summary. No-results: empty state gated only on aggregated.length===0 (:2005-2011) → toolbar + full-scope summary + zero rows + no message. Footer gated on aggregated.length (:2484) while `remaining` derives from displaySearched → 'הצג עוד 0' renders and does nothing.
- **תיקון:** Totals from displaySearched while searching (or an explicit full-scope badge); explicit 'לא נמצאו קמפיינים תואמים — נקה חיפוש' state; gate the footer on displaySearched.length.

### P1-24 · Campaigns tab runs TWO independent store scopes — PageScope header/scatter follow the global filter while the table follows its own localStore, with zero divergence signal
- **אזור:** client / Dashboard + CampaignsTable · medium · hurts-now
- **ראיות:** Dashboard.tsx:1734-1740 (PageScope shows filters.store, scatter uses it) vs CampaignsTable.tsx:554-566 + 1496-1509 (URL-hydrated localStore + second store select in the toolbar). With global='All' and local='zolplus' the banner says 'כל החנויות' while every row, summary card and attribution panel below is zolplus-only; the mismatch persists across refreshes via c_store deep links.
- **תיקון:** Either write the table's store select through to the global filter, or render a visible scope chip when localStore≠globalStore and make PageScope reflect the effective table scope.

### P1-25 · Two surviving hardcoded-'Meta' copy sites — the exact bbadd3c class on Google/TikTok rows
- **אזור:** client / useCampaignTrueRevenue + ProductCentricView · medium · hurts-now
- **ראיות:** useCampaignTrueRevenue.ts:119/:122/:140/:551/:564 ('פער של X% מול Meta', 'הסכמה בין Meta ל-Shopify') rendered into the ROAS-Shopify tooltip for TikTok-mapped and unmapped-Google rows (CampaignsTableRow.tsx:615-629); git confirms the file was NOT in bbadd3c. ProductCentricView.tsx:138-156 pixelShopifyDelta returns 'Meta בלבד' regardless of platform — a Google PMax row labeled 'Meta only'.
- **תיקון:** Thread platform into computeConfidence/the reason strings (already in scope at both call sites) and into pixelShopifyDelta; extend the bbadd3c grep-guard to hooks/ + ProductCentricView.

### P1-26 · Operator-facing copy references decommissioned pipelines and wrong cadences — actively misleading during incident triage
- **אזור:** client / copy truth · medium · hurts-now
- **ראיות:** AdsDrawer.tsx:516-524 'ודא ש-runDailyUpdate רץ' (Apps Script, removed post-Phase-11; the string exists nowhere else in src/); campaign-drawer/index.tsx:721-767 'הסבב הבא של cron-live-heavy (עד 30 דק׳)' (disabled Phase E1); ProductsTable.tsx:542-545 'הסקריפט החי מרענן כל 15 דקות'; Dashboard.tsx:1917 footer 'מתעדכן כל דקה' (actual: 120s since the cost cut); TabFreshnessHeader: confirm says 60-120s while toast+tooltip say 30-60s (and the probe bug currently makes it 180s).
- **תיקון:** One copy sweep: current worker cadence (~10 דק׳) for the pipeline references, 'כל 2 דקות' footer, one duration constant shared by all three refresh strings.

### P1-27 · Operator console: AddStoreWizard edit-mode Meta/Google toggles are silently discarded; a failed archive/restore blanks the entire store list; 'full reset' blast radius drifted from 9+ newer tables
- **אזור:** operator console · medium · hurts-now
- **ראיות:** (1) AddStoreWizard.tsx:440-451 PATCH payload has no hasMeta/hasGoogle; server only ADDs newly-credentialed platforms — toggling OFF + save is a silent no-op (only hasTiktok round-trips). (2) StoresTab.tsx:99-117 lifecycle failures set the same `error` state that gates the whole list render (:206-220) → one failed POST destroys the working context. (3) operatorReset.ts:20-32 DATA_TABLES is the Phase 05.5 7-table list; store_events, customer_cohort_monthly, customer_first_order, 3 registries, status_events, data_freshness etc. survive a wipe while the modal claims 'כל נתוני הדשבורד' — breaking the verify-from-empty premise.
- **תיקון:** (1) Disable the off-direction with a hint or implement removal in PATCH; require creds when newly toggled ON. (2) Split loadError vs actionError (inline role=alert, keep the list). (3) Extend DATA_TABLES or list exactly what is/isn't wiped + a drift test against the migration table universe.

### P1-28 · /api/oauth/tiktok/callback missing from the auth allowlist — its two documented external audiences get a 401 instead of the auth_code page
- **אזור:** api-routes / middleware · medium · hurts-now
- **ראיות:** middlewareHelpers.ts:90-115 allowlist omits it; middleware returns 401 JSON for cookie-less /api/ requests. The route's own docs (oauth/tiktok/callback/route.ts:36-44) target TikTok App reviewers and fresh-browser re-auth — audiences that cannot have the dash_auth cookie. Same silent-401 incident class as the memorialized 2026-06-03 Inngest pinning.
- **תיקון:** Allowlist the exact path with a comment (page renders no secrets; auth_code is single-use/1h via TikTok redirect); extend the middleware allowlist guard test.

### P1-29 · mergeCustomerJourney gap-fill bypasses the 7-day first-touch freshness gate (dormant behind enable_customer_journey flag)
- **אזור:** attribution / customer journey · medium · production-grade
- **ראיות:** mergeCustomerJourney.ts:45-50 fills firstUtm* from Shopify's customerJourneySummary.firstVisit — which can be months old — including rows the classifier deliberately nulled (classifyOrderSource.ts:280-289, FIRST_TOUCH_WINDOW_DAYS=7); the GraphQL query never fetches occurredAt so no age check is possible, and firstTouchSource stays null while firstUtmId becomes non-null (first-click revenue credited while the coverage lens counts 'no signal'). Violates the documented invariant the gate exists for; silent the day the flag is enabled.
- **תיקון:** Fetch firstVisit{occurredAt}; skip the fill when older than FIRST_TOUCH_WINDOW_DAYS relative to row.createdAt; derive firstTouchSource for filled rows; freshness test in shopifyCustomerJourneyMerge.test.ts. Do BEFORE enabling the flag.

### P1-30 · Tier-2 name matching ignores the order's platform signal — one order double-counted into same-named campaigns across platforms
- **אזור:** attribution / orderMatchesCampaign · medium · production-grade
- **ראיות:** attributionAnalysis.ts:370-374 and :1099-1103: utm_campaign name match with no utmSource/source agreement check. Empirically verified: a tiktok-sourced 'Black Friday' order matches BOTH the Meta and the TikTok campaign of that name → the same totalCad lands in two deterministicRevenues, inflating coverage/trust on the wrong campaign. Tier-1 namesake protection is documented for the utm_id path only; no test covers the cross-platform case.
- **תיקון:** When the order carries a platform signal (detectAdPlatform(utmSource), source ∈ {meta/tiktok/google-paid}, click-ids), require agreement with campaign.platform before accepting the name match; keep name-only for signal-less orders. CI test mirroring attributionPlatformTagging.test.ts.

### P1-31 · Billing accuracy pair: /30 proration mis-states every non-30-day month; store-filtered views charge the full business-wide costs to one store
- **אזור:** analytics / billing + salaries scoping · medium · hurts-now
- **ראיות:** (1) billing.ts:204,268,300: monthlyCAD×days/30 → full May bills 103.33%, February 93.33%, a full year = 12.17 'months'; salariesForRange in the SAME trueNetProfit prorates by true days-in-month — two conventions in one number. (2) Dashboard.tsx:486-494: store-filtered aggregate passes no scopedStoreNames → billingForRange treats the universe as 1 store and charges the whole 'All' subscription; the same store reads fixedCosts ≈ $20 on the All-view per-store card but $60 when page-filtered — the truth-divergence class dabc87a hunts. Amount-mode salaries likewise bill in full to each filtered store (Σ across 3 filtered views = 3× payroll).
- **תיקון:** (1) Prorate per overlapped calendar month like salariesForRange; update billing.test.ts (full-May = exactly monthlyCAD, full-year = 12×). (2) Pass scopedStoreNames=data.stores + unfiltered revenueByStore into the filtered aggregate (the CRIT-1 machinery supports it), and scope/skip amount-mode salaries under a store filter with a note. Money-math + lock-tested — change tests deliberately.

### P1-32 · Bulk first-order/cohort + statuses: insertStatusEventsBatch aborts the whole batch on one duplicate; cronDaily budget-skip side effects replay per step
- **אזור:** pipeline / minor correctness pair · medium · production-grade
- **ראיות:** upsert.ts:73-88 uses plain .insert() treating 23505 as benign — Postgres aborts the ENTIRE multi-row INSERT on one unique violation, so a mixed dup+new batch silently drops the NEW transitions feeding the operator panel and campaign-died/fatigue detectors. cronDaily.ts:505-560: the Meta budget-skip block (4 freshness writes + notify) runs at function top level between steps → re-executed per Inngest step replay (~40 upserts, seen_count inflated ~10× per logical skip).
- **תיקון:** `.upsert(events, { onConflict: 'dedupe_key', ignoreDuplicates: true })`; move the skip side-effects into their own step.run.

---

## P2 — נמוכים/ליטוש (50)

1. attributionAnalysis buildAnalysis lacks the U-04 'mixed' stability branch — ad-set/ad grain silently swallows the σ 0.15-0.35 verdict the campaign grain surfaces (add the same reason branch + test)
2. detectOutlierDays is two-sided but labeled 'modeled spikes ABOVE the median' — crash-to-zero days are reported as platform spikes (split spike vs drop copy or make it one-sided)
3. roasInterval treats refund rows as AOV samples with a one-sided clamp — mid can fall outside [low,high] and low>high on refund-heavy windows (return null when deterministicRevenue<=0)
4. Ad-set/ad grain attribution uses raw row storeId while the campaign grain uses effectiveStoreId (3c510a1 P2 fix didn't reach the lower grains) — contradictory verdicts inside one drawer for remapped TikTok campaigns
5. Organic-referrer regexes unanchored over the full URL — 'zig.com' classifies as meta-organic (reuse hostOf() like the search-engine branch already does)
6. Two stale load-bearing doc comments contradict shipped fixes: computeCoverage docstring still claims the pre-U-05 clamp; OrderLineItem JSDoc claims current_total_price allocation vs the P0-2 total_price writer
7. synthesizePnl rounds margin before the target comparison — 34.6% reads 'מעל יעד 35%' (compare unrounded)
8. Creative-fatigue detectors have no recency gate — 'refresh creative' fires for ads paused weeks ago (skip groups whose max date is >3 days old)
9. Insight IDs not store-qualified (died-/rec-/fatigue-) — TikTok remap or stale dup rows yield duplicate React keys + shared done/ignore state across stores
10. detectCampaignDied fires weekly CRITICALs for recurring scheduled off-days (Shabbat exclusion pattern) — require 2 consecutive dark days when the prior window shows periodic zero-spend
11. RecurringCost has no start/end dates — deactivating a canceled subscription rewrites historical P&L retroactively (add optional startDate/endDate)
12. Per-store ${STORE}_TX_FEES_RATE/_COGS_RATE env calibration is inert in the browser where aggregate() runs — dynamic process.env lookups return undefined client-side (deliver rates via the data payload)
13. filtered.prevAgg is always the empty aggregate (computed from current-range rows filtered to the prev range), dead but exposed and actively lock-tested — delete it before someone wires a delta to a guaranteed-zero baseline
14. URL-hydrated custom range skips from<=to / real-date validation — a bad bookmark 400s every fetch into a dead dashboard instead of falling back to defaults
15. Empty-row ranges report fixedCosts=0/trueNet=0 although subscriptions accrue — outage windows read as break-even
16. Repeat-rate denominator includes days-old cohorts — '% חוזרים' structurally biased low during growth (gate to cohorts with ≥3 months observation or caption 'עד כה')
17. computeStableNcac bypasses the unclassifiable-share confidence gate the Home NC tile enforces — high guest share silently inflates the LTV:nCAC denominator with no badge
18. PaymentMethodsTab pre-backfill heuristic misfires for any store legitimately 100% 'other' tender — key the banner on null-gateway counts instead
19. Activity feeds filter by store/platform AFTER the global 50-row cap — a busy store crowds a quiet store's events out of its own filtered feed (push filters into the SELECT)
20. Middleware dot-extension heuristic exempts ANY path whose last segment contains a dot, including /api dynamic segments — scope it to non-/api paths
21. /api/operator/backfill accepts a future/unbounded `to` — a typo'd 2099 date enqueues ~27k dates of Inngest execs (cap at today-IL + ~92-day span)
22. Stale docblocks claim /api/operator/* paths for /api/reconcile and /api/tiktok-coverage — implies an operator-secret gate they don't have
23. cloudSync retry-vs-poll race: 8s hydrate grace < 15s/45s retry backoff — a failed push lets the 30s poll transiently revert the operator's edit on screen (skip hydrate for keys with pending retries)
24. 'roas-cloud-clear-conflict' event fires into the void — the documented d/CR-07-soft UI notification has no listener (wire SyncIndicator or delete the dispatch)
25. Hydration mismatch on deep-linked URLs: useState initializers read window.location while SSR rendered defaults — console hydration errors + default-view flash on every shared link
26. ?store= URL param unvalidated against data.stores — a renamed store or mangled link renders an all-zero dashboard with no hint (mirror the customersScope guard)
27. Dashboard degraded-200 + keepPreviousData: a transient /api/data blip REPLACES live numbers with zeros mid-session (a thrown error would have preserved them) — throw on body.error in the fetcher
28. Single-point RoasTargetChart: SVG anchors at x=40 while HTML overlays (היום label, pins) anchor at 50% — share one leftPct formula
29. Trends RoasChart x-axis keys on 'DD/MM' labels — >12-month ranges collapse duplicate categories onto one x position (use ISO date dataKey + tickFormatter like the CPM chart)
30. MonthlyTables/DetailTable show ROAS '0.00' for revenue>0/spend=0 days while charts honestly render a gap — add the organic/'—' branch in roasCell
31. Multiple annotation pins on one date stack at identical position — only the topmost is hoverable (group by date with a count badge)
32. RoasTargetChart: no point sampling + full SVG re-render on every pointermove — degrades on 90d/YTD/custom long ranges (hide dots above ~60 points, memoize the dot layer)
33. StoreDetailModal keeps a private BAND_TAG_LABEL copy that escaped the Task-10 unification — import the shared constant (one line)
34. AdsDrawer fetches ALL ads for all stores/campaigns in range and filters client-side — payload scales with total ad count at customer scale (add store/campaign/adSet params to /api/ads)
35. Saved-view delete and annotation delete are one-tap destructive with no confirm/undo (cloud-synced) while the cheaper 'רענן הכל' demands a confirm — inverted friction
36. Google ad-set rows show cursor-pointer + hover but clicking does nothing (apply the affordance only when canDrill, like AdSetTable already does)
37. CSV export emits 7 fixed columns with platform-claimed ROAS only — ignores visible columns including all Shopify-truth metrics the dashboard's thesis is built on
38. URL-restored ad-drill opens AdsDrawer with a blank title until /api/campaigns resolves (render the documented id fallback)
39. RoasChartDateRangePicker accepts future dates — page-level Filters clamps to today (HIGH-3) but the chart-own picker doesn't
40. OperatorSecretBanner: Enter on an empty input silently clears the stored operator secret (guard handleSave on empty)
41. AnalysisArchiveTab seeds year/month from the client's local timezone, not Asia/Jerusalem (reuse the d/HI-08 IL-parts pattern); Archive also renders silently blank when the selected period has no data, and its PageSynthesis/scope label ignore the local store picker
42. PnLBreakdown note 'X ימים מתוך 30' is nonsensical for >30-day ranges (math is fine; rephrase range-aware)
43. Credential-matrix 'חבר/החלף' opens the edit wizard on Step 1 instead of the documented focused credential field (jump to step 2 when focusPlatform is set)
44. adset_registry budget columns store raw ILS amounts labeled CAD (dormant — no UI consumer yet); the metaAccountConfig comment contradicts CRIT-E — fix before any budget-pacing feature reads them
45. Hot-set RPCs use UTC CURRENT_DATE against IL-dated campaigns_daily rows — 00:00-03:00 IL activity-branch skew (use now() AT TIME ZONE 'Asia/Jerusalem')
46. recordFreshness read-then-write race can regress last_success_at across concurrent writers (make it a GREATEST() upsert)
47. Google status discovery permanently misses transitions older than the 24h change_status window after a >24h outage (covered by the daily full-sweep in the P1 registry-reaper fix)
48. fetchMetaStatusForStore has no pagination — silent truncation at 500 campaigns/1000 adsets/2000 ads at customer scale
49. meta_buc_usage upsert error silently discarded in metaWorker (check error, warn or throw)
50. AnnotationsPanel kind-chip background concatenates '15' onto a CSS var — invalid CSS since the token migration, chips render transparent (use color-mix or paired -bg tokens)

---

## דוח UX (לפי נושא)

### State honesty (loading/empty/error) — the #1 UX theme, overlaps P0/P1
- CampaignDrawer, Customers, Payments, Home order-KPIs, InsightsBoard, ProductCentricView, AiReportButton, ProductPickerModal, GoalTracker, Archive: failures render as plausible 'no data'/zero/all-clear states (see P0-4, P1-2/3/4) — adopt the ProductsTable/ActivityStatsTab triad (skeleton / red error / honest empty) everywhere
- Campaign modal 'יומי' tab renders a completely blank pane on 1-day ranges ('היום' preset) — both sections null out with no fallback copy (CampaignDrawerDaily.tsx:95,187); add a 'הרחב את הטווח' placeholder
- Campaigns search dead-end: zero matches leaves full-scope summary cards over an empty table with no message + a 'הצג עוד 0' no-op button (P1)
- Archive: MonthlyTables returns null for empty periods and the default month is the CURRENT month of a past year — silent blank indistinguishable from a rendering failure

### Keyboard + screen reader
- Esc double-dismiss: drawerStack closes the topmost drawer on ANY Escape without checking e.defaultPrevented — Esc meant for an open HelpTooltip/popover inside the campaign modal closes BOTH (the WR-01 stack-collapse class reintroduced for the 2026-06-03 tooltip surfaces); bail on defaultPrevented + preventDefault in popover onEscapeKeyDown
- Campaign/ad-set row drilldown is mouse-only: bare <tr onClick>, no tabIndex/role/Enter handler — the core daily drilldown is unreachable by keyboard, and focus drops to <body> on modal close (the Card.tsx pattern exists, adopt it)
- Hand-rolled mobile sidebar: aria-modal dialog with no focus trap/Esc/focus move, and the CLOSED state is aria-hidden yet keyboard-focusable (ghost tab stops on every mobile page) — route through the Sheet primitive
- aria-sort sits on the inner <Button> instead of the <th> in all three sortable tables — invalid ARIA, sort state never announced (move to ColumnHeaderTh)
- Five hand-rolled role=tablist surfaces (incl. the main Sidebar nav) without tabpanel wiring or arrow keys — drop tab roles on the nav, migrate the rest to the Radix Tabs primitive
- Custom date-range Inputs unlabeled; desktop preset buttons lack aria-pressed (mobile pills have it); CommandPalette is aria-modal without a focus trap and its only English aria-label
- HelpTooltips on non-focusable blocks (hero cards, td/tr, name spans) are hover-only — the densest business-logic documentation is invisible to keyboard users (tabIndex on block triggers or desktop ⓘ affordance)

### Touch / mobile
- Row tap double-fires: HelpTooltip-wrapped <tr> with its own onClick opens the drawer AND an orphaned 'לחץ לפרטים מלאים' popover in one tap (Radix composes handlers); in-row ⓘ taps also bubble into the drill — suppress the row hint on touch + stopPropagation in Toggletip
- Rich column-header tooltips render TWO ⓘ buttons on touch — the operator's violet ⓘ is dead (its only handler is stopPropagation), a duplicate gray ⓘ opens the sheet (RichSheet phrasing branch); make the child the trigger
- Tooltip mode selection is width-based (max-width:767px), not pointer-based — coarse-pointer tablets ≥768px get hover-only tooltips they can never open, contradicting the documented pointer matrix; gate on (hover:none) and (pointer:coarse)
- TokenFailuresTable: 7 columns inside overflow-hidden with no horizontal scroll — the 'סמן כתוקן' action clips off-screen on the phone, exactly the alert-triage flow
- Switch thumb's unchecked inset isn't RTL-flipped — thumb overhangs the pill edge in every operator panel

### Chart/visual truth
- Flat sparklines glued to the bottom (reads 'crashed to zero') — P1, c/HI-05 fix unwired
- RoasTargetChart clips >4.0 to the top gridline while the שיא label prints the real value — P1
- 'Geist Mono' hardcoded in globals.css (.band-chip/.fresh-chip/.band-tag) never resolves — next/font registers a hashed family, so the home-screen chips render in the UA default font on any machine without a local install (use var(--font-geist-mono) + fallbacks)
- MiniSparkline draws the area fill ON TOP of its stroke on all 6 secondary hero cards — line washed out exactly where values peak
- AnnotationsPanel kind chips transparent (invalid CSS var+'15' concat); AdSetTable ad-set names missing the <bdi dir=ltr> isolation its two sibling cells have

### Copy truth + scope coherence
- Decommissioned-pipeline copy: 'runDailyUpdate', 'cron-live-heavy (עד 30 דק׳)', 'הסקריפט החי... כל 15 דקות', footer 'כל דקה', refresh duration 30-60 vs 60-120 vs actual 180s — one sweep (P1)
- '3 חנויות' literals in ActivityFeed/TabFreshnessHeader/ResetData lie the moment a store is added (and ActivityFeed already lies when filtered to one store)
- Two store scopes on the Campaigns tab can silently contradict (P1); Archive synthesis/scope chip ignores the local store picker
- 'Meta בלבד' / 'מול Meta' on Google/TikTok rows (P1, bbadd3c survivors)

### Destructive-action friction (inverted)
- Saved-view delete and annotation delete: one tap, no confirm, no undo, cloud-synced — while the recoverable 'רענן הכל' demands a confirm dialog
- Enter on an empty OperatorSecretBanner input silently clears the working secret
- 'Full reset' modal over-claims ('כל נתוני הדשבורד') while 9+ newer tables survive the wipe (P1)

### PRIORITIZED SHORTLIST
- 1. State-honesty sweep (shared throwing fetcher + per-surface error UI) — biggest trust win, covers P0-4 and P1-2/3/4
- 2. Esc double-dismiss fix in drawerStack (one guard + popover preventDefault) — daily-use friction
- 3. Touch double-ⓘ + row-tap double-fire (Toggletip/RichSheet trigger fixes) — operator phones daily
- 4. Flat-sparkline centering + RoasTargetChart dynamic yMax — home-screen visual truth
- 5. Copy sweep (dead pipelines, cadences, 3-stores, Meta-בלבד) — cheap, high embarrassment value
- 6. Keyboard row drilldown + aria-sort on th — the two highest-leverage a11y fixes
- 7. Geist Mono var fix + MiniSparkline layering + annotation chip bg — pure polish, minutes each
- 8. Mobile sidebar → Sheet primitive — closes the last hand-rolled dialog after the 2026-06-03 incident memo

---

## ממצאי הסריקה החיה (פרודקשן, 2026-06-10)

1. **[מובייל] טבלת קמפיינים** — עמודות-הערך (ROAS/הוצאה/המרות/ערך) מחוץ ל-viewport ללא רמז-גלילה/צל-קצה; צפיפות אייקוני ⓘ בשורות; כותרת שמאלית נחתכת. (חופף לנושא Touch/mobile לעיל)
2. **[לקוחות] גרף LTV** — הקופי מפנה ל"קו עלות-הגיוס" אבל הקו ($52) לא נראה: ציר-Y מסתיים ב-$49 — נחתך בדיוק במקרה ההפסדי שבו הוא הכי חשוב. (לאמת מימוש: y-domain לא כולל את ה-reference line)
3. **[קמפיינים] F(23) לצד ROAS מכוון 10.10** — ככל הנראה נכון-חישובית (trust נמוך, טווח-יום), אבל קורא-סותר; שקול רמז-inline. (חופף ל-P1-8/P1-9)
4. **[בית] AOV $70 עם ▴ ירוק** — הכלל הנעול: 50–70=ניטרלי; חשד לגבול >= או אי-התאמת עיגול-תצוגה (הערך מעוגל ל-$70 אך הצבע לפי הערך הגולמי).
5. **[בהיר] ה-sidebar נשאר כהה במצב בהיר** — לוודא אם by-design מהמוקאפ או פספוס.
6. **חיוביים שאומתו חי:** spend של היום מאוכלס; פס-התאמה 96%; עץ-a11y תקין; מובייל-בית מצוין (סיכום דביק + קרוסלה); light קריא; כל תיקוני 06-09 נראים חיים.

---

## ✓ אומת-תקין (הוכחת-כיסוי)

- ✓ Every fix in the 2026-06-09/10 batch (136a246..dabc87a) was independently re-verified present and correct: ValueTrack deterministic matching, platform-aware copy via platformTaggingGuide, pending 'updating/waiting' states across all four ad surfaces, TikTok override guard in agg_data_daily_for_date, AdsDrawer throwOnErrorBody, chart-own prev window, band lock-step + BAND_TAG_LABEL + CI guard at displayed surfaces
- ✓ Money math core: billingForRange d/CR-01 invariants (Σ byStore == total, 'All' counted once), percent-of-revenue weighted allocation with negative-revenue clamping, aggregateByStore CRIT-1 threading, deltaPct divide-guards, dailySeries null-gaps (outages render as gaps, never ROAS=0), cadConvert null-preserve ('stale > wrong'), DST-safe IL presets/previousRange — 92+ tests green
- ✓ Attribution engine integrity: signed-refund handling end-to-end (WR-03 clamps in both analyzers), NaN/Infinity hygiene at all four matched-order boundaries, allocateProductRevenue conservation incl. negative-net refund paths, no cross-platform double-credit in the allocator's classifyOrderToPlatform chain, Tier-1 utm_id namesake protection, Google campaign-grain-only scope contract held everywhere with googleBlind threaded
- ✓ Auth stack: fail-closed prod boot guards, constant-time compares, operator 404-posture, sanitizeNext open-redirect guard; Shopify webhook HMAC over raw bytes before parse with idempotent dedupe; cart beacon PII-free with sandboxed-origin handling; all three known external callers correctly allowlisted
- ✓ STATE_KEYS ↔ ALLOWED_STATE_KEYS parity hermetically guarded in both directions (the 2026-06-02 COGS incident class is closed for all 13 keys), and every pushCloudKey site uses a registered typed constant
- ✓ Inngest pipeline design: live-family tickId idempotency correct, cron-live genuinely Shopify-only and write-safe, cronDaily FX null-preserve across all three platforms' CAD columns, TikTok remap DELETE-then-UPSERT hygiene consistent across all three writers, BUC gating coherent end-to-end, per-store concurrency=1 everywhere, serve() registers exactly the fold (no double-execution from the kept revert levers)
- ✓ paginate() enforces a mandatory unique ORDER BY on every chunk — no page-overlap/skip race against concurrent cron upserts (the 50k ceiling is the only gap)
- ✓ Customers-tab math: 12-month maturity gating (partial months can never enter headline LTV), A6 distinct-repeat all-or-nothing gate, B3 profit-pinned verdict with rounding-edge floors, payback derived on the same curve as the ratio, ledger lower-only conflict guard with consistent tiebreaks across SQL and TS writers
- ✓ Health/insights guards: weight renormalization caps at exactly 100, A6 pivot floor, U-06 double-apply protection, prioritizeInsights determinism (criticals never cut), campaignDied's 7 documented gates, forecastMonthEnd's audited extrapolation chain, A9-04 dead-day suppression
- ✓ Charts/tables: sort comparators exhaustive and NaN-free with WR-05 unmapped-last grouping, FIND-01 totals track the multi-mapped filter, reconciliation range-coherence gate, useCountUp animate-once (flicker fix), Money/MoneyAnimated overflow contract (compact + exact in title/sr-only), MonthlyTables IL-month math (d/HI-08)
- ✓ Drawer/modal stack: everything except the mobile sidebar rides Radix Sheet (focus trap, scrim, nested z-layers), ProductPickerModal correctly nested (2026-06-03 inertness class closed and guarded), Esc routing via drawerStack is the documented WR-01 design
- ✓ A11y/RTL foundation: hermetic contrast/theme-parity/color-collision/token guards + Playwright axe gate in both themes with documented locked exceptions; lang=he dir=rtl with logical-property lint; comprehensive reduced-motion handling; bdi isolation systematic (one cell missed); pre-paint theme bootstrap (no FOUC)
- ✓ Exemplar state handling exists in-repo to copy from: ProductsTable, ActivityStatsTab, TokenFailuresTable, MonthlyTables (3 of 4 states), and the WR-02/WR-06 degraded-response contract is correctly implemented route-side on all 9 audited data routes — the gaps are consumer-side only
- ✓ GoalTracker is genuinely global and self-sufficient (month-anchored own fetch, honors the 'ignores filters' contract); customersScope A3 ownership validated; saved views re-derive relative ranges on apply
- ✓ First-touch freshness gate properly wired on both ingest paths; fbcIsFreshClick correctly distinguishes the 90-day cookie from Meta's 7-day click window — 8 freshness + 99 classifier tests green

## ✗ False alarms (נבדק ונדחה — לא לגעת)

- ✗ /api/store-events 200-soft-fail with no error field — REFUTED in adversarial verification: the route header (route.ts:20-23) explicitly documents DB errors soft-failing to a calm idle state with נותק reserved for transport errors, the client's state-machine docs AGREE, the behavior is test-pinned (route.test.ts asserts the soft-fail), and failures are Sentry-captured (captureRouteError). Documented-by-design, not a silent-failure bug. (The orphaned /api/home/activity-events twin route is mere dead-code housekeeping.)
- ✗ agg_tiktok cross-store clobber AS ORIGINALLY CLAIMED (usmile360's run wiping uzoshop's override) — IMPOSSIBLE: STORES_WITH_TIKTOK used by cronDaily is {'uzoshop'} only and the RPC call is gated on adRows.length>0, so usmile360 never calls it; uzoshop's own override is fully protected. The residual real bug is the mirrored direction (uzoshop's runs clobbering a hypothetical usmile360/zolplus override) — kept at medium inside P0-3's merged entry
- ✗ ProductsTable margin cell applying both orange and red classes — NOT a bug: cn() routes through tailwind-merge which resolves the conflict to the last class (red), as intended
- ✗ HelpTooltip wrapping <td>/<tr> — DOM-valid: desktop path is always asChild and the touch path's phrasing.ts NON_PHRASING_TAGS routes table-internal children to asChild (the separate double-fire/double-ⓘ behaviors ARE real and reported in the UX section)
- ✗ SourceHealthChip / ReconcileBanner / TikTokCoveragePanel degrade-to-hidden on fetch failure — explicitly documented per-component as appropriate for optional ambient chips
- ✗ operator/JobsTable having no res.ok guard — intentional, documented S-2 soft-fail proxy contract
- ✗ AdsDrawer's secondary orders-attribution fetch degrading silently — documented design (non-critical chip renders '—'); only its primary fetcher carries the strict contract
- ✗ Drawer onEscapeKeyDown preventDefault on the three Sheets — intentional WR-01 coordination (topmost-only close via drawerStack), not a missing Esc handler; the real defect is the popover interplay, reported separately
- ✗ composition_changed cannibalization verdict falling through to zero delta — documented abstention (a/WARN-6), not dead logic
- ✗ Inngest duplicate step IDs in eventSyncNow's multi-date loop — SDK v4 auto-resolves collisions (engine appends :N); the W6 comment's fear is handled
- ✗ 'MonthlyTables store desync' from the 2026-06-02 codebase map — no longer reproducible in code; store filter syncs from globalStore correctly
- ✗ Hardcoded IL '+03:00' offset on store_events windows — documented, accepted ≤1h off-DST skew
- ✗ The entire CORRECT-BY-DESIGN brief list was honored and re-confirmed where touched: two labeled profit levels, MER=blended ad-ROAS, three distinct campaign ROAS columns, Google no-ad-grain, GoalTracker global, dual nCAC windows, mature-cohort LTV, dual revenue bases (Payments vs P&L), client-side COGS recompute, simplified AI-report health, per-store gross AOV, sparkline-vs-chart null policies, password-gate trust model, public cart tokens, percent-chip rounding
- ✗ Severity downgrades from adversarial verification (confirmed real, but not high): prev_month/prev_year rollover high→medium (bounded to compare deltas on month-end ranges); 'Refresh All' probe high→medium (backend refresh still completes; damage is feedback-only); CustomerValue/Payments error swallow high→medium (transient-trigger, no-store self-heal, no wrong non-zero numbers); Home orders silent zeros high→medium (primary money metrics bannered elsewhere, 60s self-heal)

## סדר-תיקון מומלץ (מהסינתזה)

1. 1. SQL migration: extend the manual-override NOT-EXISTS guard to meta/google in agg_data_daily_for_date + add it to agg_tiktok_spend_per_store_for_date (P0-3). Load-bearing — mirrors the proven 20260609180000 pattern exactly; verify with `npm run audit:reconcile` + a manual override round-trip. Highest data-integrity value per line.
1. 2. cron-yesterday event-id discriminator in planStoreJobs (P0-2). One line + fold-guard test; zero risk; confirm in the Inngest dashboard that the next 2h fire invokes the worker.
1. 3. paginate() truncation tripwire + route guards >= 50000 + readPaymentMethodsByMonth → SQL GROUP BY RPC (P0-1). Reader change is safe; the RPC is a new migration (follow the documented Supabase migration procedure — hide root .env, move the two duplicate-timestamp files). Hard deadline ~Aug 2026; also date-bound the two campaigns_daily helpers.
1. 4. 'Refresh All' probe URL + WR-02 no-store on the six routes (P1). Both trivial and risk-free; do in the same commit as #3's route-guard flip.
1. 5. Shared throwing-fetcher sweep: CampaignDrawer first (P0-4), then Customers/Payments, Home orders, and the 10-surface family (P1-2/3/4). Client-only and safe, but LARGE surface — do as one audited wave with DOM guards per surface (the no-drip-deploy rule applies: fix all, verify locally both themes, one deploy).
1. 6. presets.ts shiftDateBack clamp (P1-1). Pure function + new month-end/leap tests; safe.
1. 7. Intelligence honesty batch: partial-day guards (insights + health trajectory), meanOrNull_ real-mean, trends per-day means, trust-ladder claim=0/coverage>2 gating, health-scorer evidence floor, bandForRoas dedupe + guard extension. All pure lib + tests — but several touch LOCK-TESTED suites (TEST-03, HR-01, A9-04): change tests deliberately, never loosen the locked contracts they encode.
1. 8. IL-midnight roll (useIlToday) + stableNcacRange deps + hydrateFromCloud equality guard + per-hook refreshInterval zeroing (P1). Touches the refresh/sync spine — run cloudSyncHydrate/RetrySchedule + autoRefreshKeepsView suites and soak one evening session across midnight.
1. 9. FX resilience batch (adapter null contract, merge-layer null-preserve, fetchTodayFx timeout) (P1). LOAD-BEARING across 3 workers and the nightly persist — the riskiest change in the list; ship behind the reconcile harness + one full nightly cycle verification before trusting.
1. 10. Pipeline visibility/correctness pair: Meta asArray throw-on-part-error + status-branch try/catch + safeCredentials VITEST gate; Google placeholder is_enabled filter; sync-now is_finalized gate; status-events upsert ignoreDuplicates; budget-skip into step.run. Each small and independent; batch into one pipeline commit with worker tests.
1. 11. recompute_first_order_flags IS DISTINCT FROM migration + cohort bulk test:false/-cancelled filters + one-time ledger re-seed & cohort re-backfill (P1). The re-seed is an explicit operator-visible data restatement — announce that LTV/repeat may shift slightly.
1. 12. Billing accuracy pair (per-month proration + store-filter scoping/salary semantics). MONEY MATH with locked tests — decide the intended semantics first (the store-filter case may warrant a UI note instead of reallocation), then update tests deliberately.
1. 13. Store-list dynamization + token_failures CHECK migration + ResetData blast-radius (P1). Gate for self-serve Phase 6b — do BEFORE shipping the add-store UI to real use; add the parity test so the class is closed hermetically.
1. 14. Operator console fixes (AddStoreWizard toggles, StoresTab error split, TikTok OAuth allowlist, OperatorSecretBanner Enter guard). Small, isolated, safe.
1. 15. UX shortlist waves (state-honesty already in #5; then Esc interplay, touch double-ⓘ/double-fire, sparkline centering + chart yMax, copy sweep, keyboard drilldown + aria-sort, font/layering polish). Per the no-drip-deploy rule: audit-all-fix-all-verify-both-themes, one deploy per wave.
1. 16. Backlog (P2 + production-grade): registry reaper + Google full sweep, cohort bulk-op id verification + atomic replace, Tier-2 platform gating, mergeCustomerJourney freshness (MUST land before enabling enable_customer_journey), AdsDrawer scoped fetch, RecurringCost dates, per-store env rates delivery.

## פערי-כיסוי (מה שלא ניתן לאמת סטטית)

- Inngest yesterday-family dedupe was confirmed from SDK types/docs + code, not observed in prod run logs — verify in the Inngest dashboard that intra-day fires currently show 'skipped/deduped' (and that the fix makes them invoke).
- Production performance actuals: Vercel function durations for /api/payment-methods (~47 sequential pages today), Supabase dead-tuple/bloat from recompute_first_order_flags, and the real cost of the 30s hydrate refetch loops — need prod metrics/pg_stat, not static reading.
- Whether any manual_overrides rows for meta/google (or TikTok for usmile360/zolplus) exist or will be typed during the next outage — determines how urgently P0-3 bites in practice; check the manual_overrides table.
- Frankfurter-outage paths (hot-metrics zero-writes, merge-step abort, /api/data hang) were code-traced only — a controlled simulation (block the FX host in staging or mock) is the only honest end-to-end test.
- Meta batch inner-part failures, >500-campaign pagination, and Google change_status >24h-gap behavior depend on live platform API responses that cannot be triggered statically.
- Visual claims need browser verification in BOTH themes on a non-dev machine: Geist Mono fallback (dev Macs may have it installed locally, masking the bug), flat-sparkline bottom-pinning, RoasTargetChart 4.0 clamp, MiniSparkline layering, AnnotationsPanel transparent chips, Switch RTL thumb.
- Touch behaviors (row-tap double-fire, double ⓘ, tablet hover-only tooltips) verified from Radix/source semantics — confirm on a real phone/tablet or chrome-devtools touch emulation; jsdom cannot catch them (per the ProductPickerModal incident lesson).
- Screen-reader/a11y findings (aria-sort, aria-modal traps, ghost tab stops) verified against ARIA specs — actual NVDA/VoiceOver behavior and the Esc-interplay fix need Playwright/manual AT passes; the existing axe gate doesn't cover aria-allowed-attr on these paths.
- WhatsApp token-failure alerting end-to-end for a hypothetical 4th store (the CHECK-constraint silent-drop) — provable only by inserting a test store or a staging row.
- Cross-midnight session behavior (preset pinning, stableNcacRange freeze) — confirmed from code; an overnight open-tab soak after the fix is the acceptance test.
- Multi-device cloudSync race (8s grace vs 15s/45s retry) is timing-dependent — needs a two-device repro or fake-timer integration test beyond the existing suites.
- Bulk-operation interleaving (cohort poller vs exportCustomersForFacebook) is probabilistic — cannot be reproduced statically; the id-verification fix is the only reliable closure.
- The audit did not re-run the full Playwright visual/contrast CI or the live coverage-parity harness — recommended as the final gate after fix waves land.
