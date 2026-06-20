# Reliability + Correctness Audit — 2026-06-20

**Method:** 10-dimension multi-agent audit (5 correctness + 5 reliability), each finding adversarially verified by an independent refuter. **44 candidates → 37 confirmed** (≥0.6 confidence). 7 false-positives rejected.

**Severity counts (original):** 1 CRIT · 7 HIGH · 11 MED · 18 LOW.

## ⚠️ RECALIBRATION (2026-06-20, after operator pushback + prod verification)

The original audit read code **worst-case** and missed the 2026-06-10 `override_guards` migration and Phase E1.7 self-heal. After re-verifying every finding against current code + prod data (read-only):

- **5 DISMISSED** (false-positive / already-fixed): **#1 (the CRIT)**, **#3 (HIGH)**, #12, #9, #16. The CRIT Google double-count does NOT fire (uzoshop = campaign-level PMax/Shopping → same-key overwrite; prod `data_daily.ga_spend_cad` == clean campaigns SUM). Overrides honored (RPC override-aware since 2026-06-10). #9/#16 self-heal via E1.7 3-day re-derivation.
- **4 CONFIRMED LIVE** (firing now, all MED/LOW, NONE touching headline MER/ROAS/profit): **#13** (per-campaign drawer ROAS gross-of-refunds), **#20** (usmile360 zero-spend days → sparkline plots roas=0 as a dip; the "stores advertise daily" memory is now stale), **#27** (clampPct → 25% on blank apply), **#35** (stale costs.ts comment).
- **~26 CONFIRMED LATENT** (real in code, condition-gated — worth defensive fixes, especially the reliability cluster #2/#4/#5/#8/#10/#11/#17/#18 which would corrupt/hide data during an outage).
- **Prod-check resolutions:** #6 no negative-net rows in 45d → latent (cheap fix kept); #20 → LIVE; #26 raw gbraid not stored → latent/unmeasurable (cheap fix kept); #28 TZ not queryable → latent/low.

**Scope (operator, 2026-06-20):** fix ALL 30 survivors + guard tests + CI guards. The CRIT/HIGH severity labels below reflect *severity-if-fired*, not *firing-now* — read each finding's recalibrated verdict.

**Scope decision (operator, 2026-06-20):** fix ALL 35 prioritized items + guard tests + CI guards. no-drip, single deploy at the end (deploy only when asked). Work via superpowers waves + TDD + systematic-debugging, directly on `main`.

---

## Executive summary

The pipeline is broadly sound — the FX-failure "preserve prior, never zero" doctrine is correctly applied on the TikTok leg, and per-store revenue/refund math is mostly right. But there is **one true CRIT and a cluster of HIGHs** that corrupt headline numbers or hide a broken pipeline.

- **Biggest correctness risk (CORRECTED 2026-06-20):** the headline CRIT (Google spend double-count) was a **false positive for current production** — see #1. uzoshop runs only campaign-level PMax/Shopping Google campaigns, so nightly + worker write the same key (overwrite, no coexistence); prod `data_daily.ga_spend_cad` equals the clean campaigns SUM exactly, and no other store runs Google. The real correctness risk that remains is the cronDaily soft-fail family (#2/#9/#16) writing real `0`s for Meta/Google spend+impressions instead of preserving the prior value, **inflating ROAS on any fetch outage or past-day re-run** — a latent bug whose blast radius depends on outage frequency (verify before treating as live).
- **Biggest reliability risk:** false-green freshness. The main-dashboard "LIVE / fresh" chip and per-store desaturation read `data_daily.updated_at`, which cron-live bumps every 10 min on the Shopify-only write. If every ad-spend worker silently stops, the operator sees full-saturation green cards over hours-stale ROAS/profit/MER **with zero warning**.

**Systemic root:** the codebase repeatedly conflates "no data this tick" with "a real 0", and "last write succeeded" with "currently fresh". Fixes are concentrated and mostly small.

---

## The 6 systemic themes (root causes)

### T1. "No data this tick" silently encoded as a real 0 (preserve-prior contract bypassed)
The FX-failure doctrine (return null → persist OMITs the column → `ON CONFLICT` preserves prior) is correct on the TikTok leg, but three other paths return a zero sentinel that survives `spendToCad` (`0*rate = 0`, non-null) and is written: Meta/Google fetch failure (#2), Meta BUC budget-skip (#9), impressions facet (#16). Same corruption every time: spend → 0, ROAS spikes a band, profit inflates, 2-hourly past-day refresh overwrites correct history.
**Fix:** one explicit no-data sentinel (null / `{failed:true}`) from EVERY soft-fail/defer path + a shared persist helper gating each column on non-null like `tt_spend_cad`. One contract test closes #2, #9, #16, #31.

### T2. `agg_data_daily_for_date` is override-unaware and double-counts on granularity mismatch
The single re-aggregation RPC underpins #1, #3, #10, #12. It (a) SUMs all `campaigns_daily` rows with no granularity check → Google double-count (#1 CRIT); (b) re-derives from `campaigns_daily`, clobbering operator manual overrides that live only in `data_daily` (#3/#12); (c) is UPDATE-only → drops spend when no `data_daily` row exists yet (#10).
**Fix at the DB layer so every caller is safe by construction:** enforce one row-granularity per (store,platform,date); COALESCE manual_overrides over the derived value; INSERT `data_daily` skeleton ON CONFLICT DO NOTHING before the UPDATE. Pin with `audit:reconcile` assertions.

### T3. "Last write succeeded" conflated with "currently fresh" — no liveness/heartbeat
#4, #5, #11, #18 share this. Chip reads `data_daily.updated_at` (cron-live bumps every 10 min); `sourceStatusRollup`/health-summary treat any `success` as healthy regardless of age; freshness panel sorts by frozen `lag_minutes=0`. A worker that stops being invoked shows green everywhere. `recordFreshness` ignoring its own write/read errors compounds it.
**Fix:** one age-based liveness gate from `data_freshness.last_success_at` vs injected `now`, routed through ALL freshness surfaces (chip/desaturation per-platform, sourceStatusRollup, health-summary freshness_pct) with per-scope SLAs. Compute lag live at read time. Destructure `{ error }` in recordFreshness.

### T4. Same-day/boundary refunds & gross-vs-net mixing → inconsistent profitability
Correct at store level, inconsistent below it: per-product net double-subtracts same-day refunds (#6 HIGH), per-campaign deterministic ROAS is gross-of-refunds while headline MER is net-adjusted (#13), stale comment advertises removed `current_total_price` model (#35), all-stores cohort applies one store's COGS to all revenue (#14).
**Fix:** make refund/COGS adjustment idempotent and single-sourced per dimension; cross-surface reconciliation tests.

### T5. Silent catch-and-continue makes failures look like success
`metaStatus/metaHotMetrics asArray` returns `[]` on parse failure → false-green (#17); tiktokWorker swallows post-upsert agg failure and records success → divergence (#8); recordFreshness drops DB errors (#11, #18); token-failure notifier only console.warns a dead-WhatsApp send (#34). Meta/Google workers already re-throw → the asymmetry is the tell.
**Fix:** one rule — a soft-fail may return a degraded value ONLY if it also records `transient_error` (or re-throws for Inngest retry); never imply success. CI grep guard.

### T6. Inconsistent timezone handling (FX lookup / ad-account reporting / display)
App standardizes on Asia/Jerusalem, but edges leak other TZs: worker FX adapters look up rate by UTC date while writing IL-dated rows (#19); TikTok windows sent as IL dates interpreted in account TZ (#28); FreshnessChip >24h fallback renders in browser-local TZ (#32).
**Fix:** thread `getTodayInIsraelTz` through every date-sensitive boundary; CI lint for `new Date().toISOString().slice(0,10)` + local `getHours/getDate`.

---

## Prioritized findings

### ~~🔴 CRIT~~ → 🟢 LOW (latent) — **DOWNGRADED 2026-06-20 after empirical verification**

**#1 — Google spend double-count is LATENT, not firing in production (M, defensive)** · correctness
**VERDICT: the CRIT was a FALSE POSITIVE for current production.** Operator pushback ("uzoshop Google spend looks correct in the optimization tables") was correct. Prod evidence (read-only PostgREST query 2026-06-20): for uzoshop Google, **every `campaigns_daily` row has `ad_set_id == campaign_id`** (campaign-level PMax/Shopping; no ad-group rows), and `data_daily.ga_spend_cad` equals the clean (non-doubled) campaigns SUM exactly — 06/20 44.95==44.9528, 06/19 232.90==232.8992, 06/18 124.39==124.3909, 06/17 152.58==152.5759. Also **only uzoshop runs Google** (usmile360/zolplus have 0 Google rows).
Why no double-count: for a campaign-level (PMax/Shopping) campaign the NIGHTLY writer falls back to a campaign-level row (`googleAds.ts:601-609`, `ad_set_id = campaign_id`) — the SAME PK the worker writes — so the UPSERT overwrites; rows do not coexist. The double-count mechanism is real in code but only fires for a **non-PMax Google campaign with ad-group-level activity that is ALSO in the hot-set** — a combination no store currently has.
Real residual: a latent landmine if uzoshop (or a new store) ever runs Google Search/Display with ad-groups. Worth a defensive fix + a guard, but it is NOT corrupting any number today.
Files: `src/lib/fetchers/googleHotMetrics.ts:82,130-138` · `src/lib/fetchers/googleAds.ts:601-609` · `src/inngest/functions/googleWorker.ts:632` (PK incl. ad_set_id) · `supabase/migrations/20260610120000...sql:104-118`
Fix (defensive, LOW priority): make hot-metrics writer agree with nightly granularity (query FROM ad_group for non-PMax; campaign-level only for genuine PMax/no-adgroup), OR add a delete-stale step keyed by (date,store,platform,campaign_id) before the worker upsert. Add a **recent-window** (today/yesterday) `campaigns_daily-SUM == data_daily.ga_spend_cad` assertion to `audit:reconcile` — the existing harness only checks May windows, so it never exercised the hot path.

**Lesson for the rest of this report:** the audit agents read code, not production data, so their CRIT/HIGH labels reflect *severity-if-fired*, not *firing-now*. Every empirically-checkable finding below must be verified against prod (as #1 was) before being treated as an active defect vs a latent landmine.

### 🟠 HIGH

**#2 — cronDaily zeroes fb/ga spend+impressions on fetch failure / past-day re-run (S)** · correctness
Soft-fail catch returns `{spend:0, impressions:0}`; `spendToCad` returns `0*rate=0` (not null, FX healthy) → `if (merged.fbSpendCad !== null)` gate writes `fb_spend_cad=0` AND `fb_impressions=0`; derived total/roas/gross/net recomputed off deflated spend. ROAS spikes fake-high, profit overstated. `cronYesterdayRefresh` re-runs finalized past days every 2h → a single transient error overwrites a correct day; older dates stay zeroed permanently. Impressions zeroing breaks CPM.
Files: `cronDaily.ts:700-727,758-775,1094-1101,1122-1127` · `manualOverrides.ts:102-114` · `cronYesterdayRefresh.ts:84-85`
Fix: soft-fail catch signals 'unknown' not 0 (null/`{failed:true}`); gate column writes on non-null so `ON CONFLICT` preserves; do NOT stamp `is_finalized=true` for a day whose spend couldn't be fetched. Mirror the `tt_spend_cad` path.

**#3 — ~~workers clobber overrides~~ → FALSE POSITIVE, already fixed (DOWNGRADED 2026-06-20)** · correctness
**VERDICT: already fixed by the 2026-06-10 migration; the audit agent missed it.** `agg_data_daily_for_date` (migration `20260610120000_override_guards_meta_google_tiktok.sql`, Pass 2a/2b/2c) already guards every spend column with `AND NOT EXISTS (SELECT 1 FROM manual_overrides mo WHERE mo.date=d AND mo.store_id=dd.store_id AND mo.platform='meta'|'google'|'tiktok')` — i.e. the RPC is override-aware **for all three platforms at the DB layer**, exactly the "cleanest single fix" this finding proposed. So every caller (cronDaily, metaWorker, googleWorker, tiktokWorker, cronLive) is safe by construction. The agent only inspected the app-level cronDaily TikTok guard and concluded the live callers were unprotected — but they invoke the now-guarded RPC.
Prod evidence (2026-06-20): all 16 active overrides (uzoshop Meta+Google, May 1-8) are honored exactly in `data_daily` — ga_spend_cad=150 == override 150; fb_spend_cad = 2339/1972/2706/2485/2356/2302/2200/591 == the Meta override values. No clobbering.
No fix needed. (#12 is the same root → also resolved.)

**#4 — Main chip + desaturation read `data_daily.updated_at` (cron-live bumps every 10 min) → false-green (M)** · reliability
If workers stop while cron-live keeps writing Shopify revenue, the green LIVE chip and full-saturation cards keep claiming live data while fb/ga/tt_spend_cad (→ ROAS/profit/MER) are silently hours old. Signal derived from single global `data_daily.updated_at` (max), mutated unconditionally every ~10 min. `computeStaleness` supports per-platform form but prod passes only the global string.
Files: `cronLive.ts:377-391,594-612` · `postgresReaders.ts:318-342` · `app/api/data/route.ts:73,92` · `components/FreshnessChip.tsx:39,93-99` · `lib/home/adapters.ts:413` · `components/home/PerStoreRow.tsx:352`
Fix: drive chip + desaturation off `data_freshness(scope='campaign_metrics').last_success_at` age, not `updated_at`; or pass per-platform freshness map into per-platform `computeStaleness`. Playwright/unit guard.

**#5 — sourceStatusRollup + freshness panel never downgrade a stale-but-last-success source (M)** · reliability
Home "sources healthy?" badge + operator health-summary treat any `success`/`budget_skip` row as healthy regardless of age; freshness panel sorts by write-time-frozen `lag_minutes` (pinned 0 on success). A paused/failed-fan-out worker: badge stays green, freshness_pct stays 100%, dead worker sorts as "freshest". No liveness check flips an aged success unhealthy. (Orchestrator's re-enqueue staleness still works — this is the alarm/visibility layer.)
Files: `lib/freshness/sourceStatus.ts:79-101` · `lib/inngest/freshness.ts:88-102,142-147` · `app/api/freshness-summary/route.ts:30-31` · `app/api/operator/health-summary/route.ts:75-78` · `components/operator/FreshnessPanel.tsx:175`
Fix: age gate off `last_success_at` vs injected `now`, per-scope SLA (>60 min campaign_metrics/status, >7d cohort_monthly), in sourceStatusRollup AND freshness_pct. Compute live lag at read time. Unit test.

**#6 — Per-product net revenue double-subtracts same-day refunds (S)** · correctness
For a product whose order is created AND refunded same Israel-TZ day, `products_daily.net_revenue_cad` understated (net = gross − refund − refund): same-day branch subtracts per-product, then unconditional refund-day branch subtracts again. ProductsTable per-product net, margin/refund-% (1 − net/gross), AI-report product totals read ~2× refund rate. Store revenue/net/COGS unaffected (storeRefundDeduction incremented once).
Files: `lib/shopifyRevenueRefunds.ts:340-352,359-395` · `lib/fetchers/shopify.ts:654-657` · `components/ProductsTable.tsx:643,652-654`
Fix: in refund-day loop skip per-product `bumpByProduct(pid,-amt)` when `isSameDayOrder && processedDay === dateStr`, KEEP storeRefundDeduction. Update `same-day-001` fixture (prod-Z net = 30.00).

**#7 — Hero MER tile: "spent money, zero sales" renders neutral '—', never RED (S)** · correctness
When visible scope has spend>0 and revenue===0, headline MER tile shows neutral '—' (≡ benign no-data) while ad money burns. Violates operator-LOCKED rule (`be268db`) honored everywhere else. Root: `adapters.ts:115` nulls roas when not >0 → no band → CountUp '—'.
Files: `lib/home/adapters.ts:115` · `components/home/CommandCenterHero.tsx:448-451,756-757` · `components/ui/Widget.tsx:157-160,170` · `lib/home/roasBands.ts:51-68` · contrast `PerStoreRow.tsx:343,472-474`
Fix: plumb `spentNoSales = isSpendNoSales({spend,revenue})` + `isSpendAlarm` to hero; give Widget explicit `band` prop to force red + render `0.00x`. Band×state snapshot test.

### 🟡 MED

**#8 — tiktokWorker swallows post-upsert agg RPC failure + records SUCCESS (S)** · correctness
Post-upsert `agg_data_daily_for_date` wrapped in try/catch, console.warn'd, then freshness `success`. If RPC fails persistently: `campaigns_daily` fresh but `data_daily.tt_spend_cad` stale → invariant broken, panel GREEN. meta/google re-throw here; TikTok is the lone offender.
Files: `tiktokWorker.ts:737-747` · contrast `metaWorker.ts:644-646`, `googleWorker.ts:531-533`
Fix: drop the try/catch on step-5 post-upsert agg → re-throw → `transient_error` + retry. Keep step-1 pre-fetch soft-fail. Test.

**#9 — Meta BUC budget-skip writes fb_spend_cad=0 (S)** · correctness
BUC ≥80% within 15 min should DEFER + preserve, but nightly overwrites `fb_spend_cad`/`fb_impressions` with 0 (same `0*rate` mechanism). total/roas/gross/net recomputed off zero. Self-heals when BUC decays + 2-hourly refresh, window can span hours.
Files: `cronDaily.ts:673-680,850,1094-1097,1122-1126` · `manualOverrides.ts:102-115,159-161`
Fix: same as #2 — budget-skip sentinel = 'no data this tick' (null) so gate omits → preserve. Shares root with #2.

**#10 — `agg_data_daily_for_date` is UPDATE-only → workers before the row exists drop spend (M)** · reliability
Every pass is `UPDATE ... WHERE date/store` with no INSERT. Worker running before cron-live created today's `data_daily` row → UPDATE matches 0 rows → spend silently dropped; home shows 0/stale while Campaigns tab (reads `campaigns_daily`) shows real spend. Self-heals next cron-live tick (≤10 min); persists if Shopify keeps failing.
Files: `supabase/migrations/20260610120000...sql:88-134` · workers · `cronTickOrchestrator.ts:71` · `cronLive.ts:663-674`
Fix: INSERT skeleton `data_daily` ON CONFLICT DO NOTHING at top of RPC, or each worker upserts a minimal row before agg.

**#11 — recordFreshness ignores upsert error → false-green after failed write (S)** · reliability
`data_freshness` upsert + prior-row read never destructure `{ error }`; supabase-js doesn't reject without `.throwOnError()` → DB errors (RLS/constraint/type) resolve silently. The mechanism designed to surface breakage can itself fail silently.
Files: `lib/inngest/freshness.ts:73,112-131`
Fix: destructure `{ error }` on read+upsert; console.warn + surface (Sentry/re-throw).

**#12 — Meta/Google overrides for TODAY unprotected from worker re-derivation (S)** · correctness
Same root as #3, Meta/Google blast radius. Resolved by override-aware RPC.
Files: `cronDaily.ts:1725-1733` · `metaWorker.ts:785-790` · `googleWorker.ts:666-671` · `cronLive.ts:444-450`

**#13 — Per-campaign deterministic revenue is gross-of-refunds (M)** · correctness
`analyzeAttribution` documents a signed-refund-row contract, but the only writer records gross `total_price` (never negative refund rows) → deterministicRevenue / "ROAS אמיתי לפי click-id" is gross-of-refunds. A refunded campaign can show inflated ROAS and hit the "אמין → grow budget 20-40%" branch on refunded revenue, while headline net MER is net-adjusted → the two disagree.
Files: `attributionAnalysis.ts:487-491,651-673,722-727` · `shopify.ts:868-870,954` · `revenueBasis.ts:14` · `useCampaignTrueRevenue.ts:547` · `campaign-drawer/index.tsx:687`
Fix: apply blended `netAdjustFactor` to matchedOrders totals before reduce (same as NC-ROAS), OR relabel as gross-of-refunds + prune dead negative-coverage branches.

**#14 — All-stores cohort applies only stores[0]'s COGS to every cohort (M)** · correctness
Per-store COGS mode on "all stores": `lookupStore` collapses to `stores[0]` → one store's COGS on all stores' revenue. Divergent COGS (18% vs 30%) → wrong cohort profit/LTV/ltvToNcac/payback, can flip verdict. Default business-mode unaffected.
Files: `components/CustomerValueTab.tsx:193-200` · `lib/cogsSettings.ts:29-34` · `lib/home/customerValue.ts:182-189,200-231`
Fix: revenue-weighted blended COGS per cohort month, or per-store rate per cell.

**#15 — Shopify bills CSV importer reads whole-bill Total for every line item (S)** · correctness
Amount-column detector matches bare `total` before `line item amount` → grand total written into every cost row. Fixed costs in P&L inflated ~N×, understating True Net Profit. Gated by human preview but one-click confirm persists.
Files: `lib/billing.ts:468` · BillingCsvImport 133,144
Fix: prefer 'line item amount'/'item amount', then 'amount', bare 'total' last. Fixture where Total ≠ line amounts.

**#16 — Impressions reset to 0 on soft Meta/Google fetch failure (S)** · reliability
Impressions facet of #2; fixed by #2's null-preserve change.
Files: `cronDaily.ts:722,771,1094-1101` · `postgresReaders.ts:440-450`

**#17 — metaStatus/metaHotMetrics asArray swallows JSON.parse failures, returns [] (S)** · reliability
Corrupt-but-200 batch body parse-fails → `catch { return [] }` → worker upserts zero rows yet records `success`, marks status green. Newly-active adsets silently disappear; hot-metrics spend stops with no retry.
Files: `lib/fetchers/metaStatus.ts:119-132` · `lib/fetchers/metaHotMetrics.ts:144-157`
Fix: throw on parse failure → worker catch → transient_error → retry. Test for 200 + unparseable body.

**#18 — recordFreshness ignores prior-row read error → read blip wipes last_success_at (S)** · reliability
On a non-success tick where the SELECT blips, `last_success_at` overwritten to NULL → panel flips to "never succeeded". Self-heals on next success. Folds into #11.
Files: `lib/inngest/freshness.ts:73-103,119`

### 🟢 LOW

**#19 — Worker FX adapters look up rate for UTC date while rows written under IL date (S)** · correctness
00:00-03:00 IL: 10-min worker converts today's IL spend using previous UTC day's FX rate, writes under IL date. Usually identical; on a business-day/holiday boundary mis-converts early-morning Meta(ILS)/TikTok(USD). Self-heals after ~03:00.
Files: `lib/fetchers/metaAccountConfig.ts:124` · `lib/fetchers/tiktokAccountConfig.ts:187`
Fix: pass IL date into adapter factory `getFxCadAdapterForStore(storeId, getTodayInIsraelTz(nowIso))`.

**#20 — Per-store ROAS sparkline/StoreDetail plots stored roas 0 as a real dip (M)** · correctness
No-spend day → per-store ROAS is a real 0 → sparkline/StoreDetail line plots a 0 dip ≡ catastrophic "spent, earned nothing". Day-level chart is spend-gated; per-store byStore cells are read ungated.
Files: `lib/analytics.ts:423,451-452` · `lib/home/adapters.ts:373-381` · `lib/home/storeDetail.ts:206-209`
Fix: gate per-store cell by that store's spend (null gap when spend=0). Requires per-store spend in DailySeries.byStore.

**#21 — RoasTargetChart KPI tile/TLDR mis-band organic periods as RED '0.00x' (S)** · correctness
No-spend/organic window: KPI tile/TLDR show '0.00x' RED "דורש בחינה" while chart line renders gray "organic". Surfaces disagree.
Files: `components/home/RoasTargetChart.tsx:359,584-593,541` · contrast bandForPeriod 368-371
Fix: band KPI tile from spend-aware `bandForPeriod({roas,spend})`; render '—'/'אורגני' when isOrganic.

**#22 — Hero operating-profit % delta uses unstable denominator floored at 1 (S)** · correctness
`pct = delta / Math.max(1, |current − delta|)` → for prev magnitude <$1 or sign-crossing, denominator floored to 1 → bogus percent (e.g. '+30000%'). Only the parenthetical %; dollar delta correct. All 3 stores hover near break-even → realistic.
Files: `components/home/CommandCenterHero.tsx:714-721` · contrast `analytics.ts:472-488`, `storeDetail.ts:148-151,198`
Fix: compute % from actual prevOperatingProfit with `|prev|` denominator + null-when-prev≈0.

**#23 — Hero ROAS delta from raw agg.roas (0) while tile value is null (S)** · correctness
Spent-no-sales + compare baseline: MER tile '—' yet sub-line shows concrete '▾ −2.00'. Internally inconsistent.
Files: `lib/home/adapters.ts:145` vs 115 · `CommandCenterHero.tsx:756-763`
Fix: in toHeroDelta treat cur.roas≤0 as null delta. Folds into #7.

**#24 — Display rounding crosses band thresholds ('2.70x'/'3.00x' in lower band's color) (S)** · correctness
Boundary slivers [2.695,2.70) and [2.995,3.00): rounded digits read as higher band while band classified from unrounded → painted in lower band's color. Cosmetic; undermines "read state from color alone".
Files: `CommandCenterHero.tsx:282-285,756-757` · `Widget.tsx:158-159` · `RoasTargetChart.tsx:359,584` · `PerStoreRow.tsx:474` · `roasBands.ts:34-39`
Fix: classify band from displayed rounded value `bandForRoas(Number(roas.toFixed(2)))` everywhere.

**#25 — Activity-feed SALE badge omits created_at → _fbc fresh-click Meta orders show non-Meta badge (S)** · correctness
`classifyOrderSource` doesn't pass created_at → `fbcIsFreshClick` false → order whose only Meta signal is a fresh _fbc cookie gets direct/other badge in live feed, while canonical pipeline classifies meta-paid. Affects feed CHIP only. (First-touch-gate half refuted.)
Files: `lib/webhooks/normalizeShopifyEvent.ts:212-217` · `lib/attribution/classifyOrderSource.ts:463-475,337` · contrast `shopify.ts:955-957`
Fix: thread created_at/conversionAt into classifyOrderSource (normalizeShopifyEvent already has occurred_at).

**#26 — Google iOS/display click IDs (gbraid/wbraid/dclid) not recognized → misclassify as 'direct' (S)** · correctness
`classifyOrderAttribution` only checks gclid → Google iOS conversions with gbraid/wbraid bucket as 'direct'; under-attributes Google paid in coverage/NC-ROAS/unknown-bucket/AI-report. Mitigated when ValueTrack also stamps utm_source=google.
Files: `lib/attribution/classifyOrderSource.ts:338,369-426` · mirror in `app/api/events/cart/route.ts:144-155`
Fix: `gclid = !!gclid||!!gbraid||!!wbraid||!!dclid` → google-paid. Mirror in ft_* branch + cart-beacon FIRST_TOUCH_KEYS.

**#27 — clampPct silently substitutes 25% default when COGS field blank/invalid on apply (S)** · correctness
Operator clears a per-store/per-month COGS field + Apply → persists explicit 25% override instead of reset/cancel → mis-states COGS/net/True Net retroactively. Requires operator error.
Files: `components/CogsSettings.tsx:207-211,74,81,137`
Fix: validate each active input on apply; inline error + abort write (mirror GoalTracker.commitEdit) instead of DEFAULT_COGS_PCT.

**#28 — TikTok daily window sent in IL date but TikTok interprets in account TZ (M)** · correctness
`fetchTikTokAdvertiserInfo` reads `info.timezone` but never uses it; start/end passed as IL dates, bucketed in (likely NA) account TZ → edge-of-day spend smears across IL Shopify boundary. Full-day totals stable.
Files: `lib/fetchers/tiktok.ts:44,280,320-321,546-547`
Fix: use `info.timezone` to convert IL day → account-TZ date (or ±1 day + re-bucket by stat_time_day). At minimum assert `info.timezone === 'Asia/Jerusalem'` and warn.

**#29 — cronLive persists 3 rolling dates with separate non-transactional agg RPCs (M)** · reliability
`persistDayForStore` commits revenue before its agg RPC, non-transactional per-date loop. Mid-loop failure → fresh revenue but stale roas/net for ≤1 tick. ON CONFLICT idempotency prevents corruption (transient only); double self-heals.
Files: `cronLive.ts:655-683,444-450`
Fix: wrap per-date persist+agg in a transaction, or run agg in a resilient finally/separate pass. Low priority.

**#30 — Duplicate migration timestamp 20260530300000 blocks `supabase db push` (S)** · reliability
Two files share version prefix → `db push` collides. Prod fine only because operator manually moves files aside (documented workaround); a fresh env gets a hard failure.
Files: `supabase/migrations/20260530300000_recompute_data_daily_derived.sql` vs `..._phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql`
Fix: rename cleanup to unique later version; verify both versions recorded in schema_migrations.

**#31 — cronDaily soft-fail writes no freshness transient_error for data_daily/kpi_daily (S)** · reliability
Nightly platform fetch failure → catch only `captureCronFetchError` + returns zero sentinel, no transient_error row, day still `is_finalized`. Combined with #2 zeroing, a bad ROAS day looks correct AND reconciled.
Files: `cronDaily.ts:700-727,758-775,812-828,474,1083-1085`
Fix: each platform catch also `recordFreshness('transient_error')` for the scope; do not stamp is_finalized. Folds into #2/#5.

**#32 — FreshnessChip >24h absolute-timestamp fallback renders in browser-local TZ (S)** · correctness
Data >24h from non-IL browser: "last updated" uses local getDate/getHours, off by TZ offset (can roll wrong day), contradicting the IL tooltip on the same chip. Operator IL-based so dominant path matches.
Files: `components/FreshnessChip.tsx:100-105` (vs IL tooltip 59)
Fix: render via `Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',...})`.

**#33 — CampaignFreshnessChip treats future last_live_tick_at (clock skew) as fresh-green with negative-minute label (S)** · reliability
No `Math.max(0,…)` clamp → skewed/future tick → negative minutes → <15min green → '-2 דק׳'. Stale JSDoc disagrees with code. Cosmetic.
Files: `components/CampaignFreshnessChip.tsx:13-22` · contrast `lib/freshness/useStaleness.ts:64-69`
Fix: add `Math.max(0,…)` + fix JSDoc.

**#34 — Stale 'pending template' comment in tokenFailures.ts + no non-WhatsApp fallback when WhatsApp is the dead dependency (S)** · reliability
Comments claim token_failure_alert template unapproved (approved 2026-05-24) → a future 'fix' could revert alerting. When WhatsApp token itself died (when alert most needed), send throws, only console.warn'd → operator learns nothing real-time (only /operator DB row).
Files: `lib/notifications/tokenFailures.ts:231-273`
Fix: correct comments; add non-WhatsApp fallback (email/Sentry rule) for whatsapp/dead-token send error.

**#35 — Stale contract comment in costs.ts claims revenue uses current_total_price (S)** · correctness
`costs.ts:4-5` documents summing `current_total_price` (the removed CR-01 double-deduction model). No runtime effect (only TRANSACTION_FEES_RATE consumed) but a maintainer trusting it could regress revenue math.
Files: `lib/costs.ts:4-5`
Fix: correct comment to the immutable `total_price − refund_line_items[].subtotal` model.

---

## Test gaps / guardrails to add

1. **`audit:reconcile`** — per (store,platform,date): `SUM(campaigns_daily.spend_cad) == data_daily.{fb,ga,tt}_spend_cad`. Catches #1 (CRIT) + #8.
2. **vitest cronDaily** — Meta/Google fetcher THROWS while FX succeeds → fb/ga spend+impressions OMITTED (prior preserved), `is_finalized` not stamped, transient_error written. Parametrize for BUC budget-skip. Covers #2, #9, #16, #31. (`cronDailyFxFailure.test.ts` only fails FX.)
3. **vitest agg RPC / callers** — (a) active override survives a worker AND cron-live tick (#3, #12); (b) worker before the day's row exists doesn't drop spend (#10).
4. **vitest tiktokWorker** — fresh rows written + post-upsert agg throws → transient_error not success (#8).
5. **vitest freshness liveness** — sourceStatusRollup + health-summary flip an aged success/budget_skip unhealthy past per-scope SLA (injected `now`); getFreshness computes live lag at read time (#5). recordFreshness failed upsert/read surfaces error (#11, #18).
6. **playwright/jsdom freshness chip** — stale campaign_metrics scope (workers dead, cron-live bumping updated_at) forces chip out of green/LIVE + desaturates cards (#4).
7. **vitest band×state snapshots** — hero MER spent-no-sales RED '0.00x' not '—' (#7); RoasTargetChart organic gray not RED (#21); per-store sparkline/StoreDetail null-gap on no-spend (#20); displayed digits + band agree at exactly 2.70 & 3.00 (#24).
8. **vitest shopifyRevenueRefunds** — same-day order+refund with concrete product_id → per-product net = gross − refund (single) AND store net unchanged (#6). Fix same-day-001 (prod-Z = 30.00).
9. **vitest billing CSV** — bill Total ≠ per-line amounts → each cost row gets its own line amount (#15).
10. **vitest attribution classifier** — gbraid/wbraid/dclid → google-paid (#26); _fbc fresh-click order gets same source from classifyOrderSource as pipeline (#25). Mirror in cart-beacon FIRST_TOUCH_KEYS.
11. **vitest cohort COGS** — all-stores per-store mode (18% vs 30%) → revenue-weighted blended, not stores[0] (#14).
12. **CI lint/grep guards** — (a) flag `catch { return [] }` / warn-only catches in fetchers/worker steps (#8/#17); (b) flag `new Date().toISOString().slice(0,10)` + local getHours/getDate/getMonth in date/display code (#19/#28/#32); (c) migration-filename uniqueness check (#30).

---

## Constraints (operator policy)
- Directly on `main`, no feature branch. Commit per wave.
- **No deploy until explicitly asked** — `git push origin main` is the only deploy trigger; no `vercel deploy`. no-drip (fix all, verify locally, one push).
- Migrations: write files, do NOT apply to prod (follow Supabase migration procedure when eventually applying).
- Verify locally with tsc + vitest + build; reconcile live harness hits prod read-only (no localhost).
- Pre-push doc gates: UX changes → User Manual; pipeline/architecture → Architecture Doc.
