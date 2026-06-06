# Ads-Off State (per store × platform) — Design

**Date:** 2026-06-06 · **Project:** script-roas (single-tenant prod) · **Deploy:** `git push origin main`

## Goal

Give the operator a clean, explicit way to mark a store's advertising on a given
platform as **OFF** for a period, so the whole pipeline behaves accordingly:
**don't report/alert on ad spend** for an off (store, platform), but **keep
reporting revenue** (organic sales still happen), and stop wasting ad-API calls.
When everything is ON, behavior is **identical to today** (purely additive).

## Locked decisions (from brainstorming 2026-06-06)

1. **Granularity:** per **(store, platform)**.
2. **State model:** **live toggle** (current on/off). No date ranges — history is
   interpreted by the actual stored spend (spend=0 ⇒ was off).
3. **Off behaviors (all four):** (a) stop ad-fetch for that platform, (b) suppress
   its ad alerts, (c) display "פרסום כבוי / אורגני", (d) reflect in the WhatsApp report.
4. **Display / ROAS coloring — extends the EXISTING band legend (verified live in
   the "טבלאות אופטימיזציה" tab):** red <2 · orange 2–2.7 · green 2.7–3 ·
   **blue >3** · **black = "0" = spend-but-no-sale**. When ad spend = 0 (off):
   - revenue > 0 → **BLUE** ("אורגני") — no ad cost + revenue = infinite/best ROAS; reuses the existing blue=best tier.
   - revenue = 0 → **0, NEUTRAL** (NOT black — black means "wasted spend"; you didn't spend).
   - revenue < 0 (net old refunds) → **NEGATIVE**, colored like today's zero/negative day — no special off-treatment.
   - **Blue everywhere** (comparative table + monthly tables + WhatsApp).
   - distinct from "—" (spend=0 while flag ON = possible missing data).
   - When ON → unchanged bands.
5. **Toggle UX:** matrix in **/operator** (store × platform).
6. **Business-wide MER / revenue:** off-store revenue **IS counted** (it is real
   organic revenue; MER = total revenue ÷ total ad spend is the honest picture).
   "Off" affects per-store display + fetch + alerts only — it never hides real revenue.
7. **Not all stores have all platforms** — the matrix only exposes applicable combos.
8. **TikTok is one shared ad account** (uzoshop's) split per-store via `campaignStoreMap`.
9. **ALL optimization / insight surfaces are off-aware:** (a) the insight engine —
   "פעולות דחופות"/InsightsBoard, creative-fatigue, campaign-died, campaign
   health-score, AI report — emits **no** "optimize me"/"campaign died" for an off
   (store,platform); (b) the **Campaigns / Ads tables** show an off platform's rows
   as "⏻ כבוי" (not broken/zero metrics); (c) **registries + `data_freshness`** do
   not flag an off platform as stale/problem.
10. **"טבלאות אופטימיזציה" (monthly tables) tab:** an off store → the ad-spend
    columns (פייסבוק / טיקטוק / יצא סה״כ) are **0 always**, while revenue (נכנס) is
    summed **normally** (can be **+ / 0 / −** from old refunds) and flows into the
    monthly rollups, per-store + "סיכום כללי" + the month/year filter. The ROAS cell
    follows the off color rules (#4).
11. **No redesign — additive only.** Same tables, columns, order, charts as today
    (verified against the live dashboard: the per-store data lives in the "ניתוח
    השוואתי" table; the optimization tab is "טבלאות חודשיות"). For an off store ONLY:
    ad-spend → 0, the ROAS cell color/value, a small "⏻ פרסום כבוי" badge — plus the
    new /operator panel. Nothing moves or is removed.

### Current per-store platform config (derived, do not hardcode)

| store | Meta | Google | TikTok |
|-------|------|--------|--------|
| uzoshop | ✓ | ✓ | ✓ (owns shared account) |
| zolplus | ✓ | — | — |
| usmile360 | ✓ | — | ✓ (via shared account) |

Applicability is **derived** at runtime from existing config:
- **Meta:** `stores.meta_ad_account_id` non-empty.
- **Google:** `stores.has_google_ads = TRUE` OR `stores.google_ads_customer_id` non-empty.
- **TikTok:** store participates in the TikTok shared account (has a row in the
  TikTok campaign→store map / `campaigns_daily` tiktok rows). `isTikTokConfiguredForStore`
  + the campaign-store map already encode this.

## A. Data model

New additive migration `supabase/migrations/<ts>_store_ad_state.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.store_ad_state (
  store_id    TEXT NOT NULL,
  platform    TEXT NOT NULL,              -- 'meta' | 'google' | 'tiktok'
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform)
);
COMMENT ON TABLE public.store_ad_state IS
  'Operator toggle: is advertising ON for a (store, platform). Missing row = ON (default). 2026-06-06.';
```

- **Missing row OR `enabled=TRUE` ⇒ ON** — so the table is empty by default and the
  whole system behaves exactly as today until the operator turns something off.
- Only applicable (store, platform) combos ever get rows (the /operator UI writes them).
- Additive, nullable-safe → no writer/reader breaks. Apply via the supervised
  migration procedure (hide root `.env`, move the 2 gap files, `db push`, restore).

## B. Central helpers — single source of truth

`dashboard-web/src/lib/adState.ts`:

```ts
export type AdPlatform = 'meta' | 'google' | 'tiktok';

/** Map of `${storeId}:${platform}` → enabled. Built from store_ad_state;
 *  any missing key defaults to ON (true). */
export type AdStateMap = Record<string, boolean>;

export function isAdsEnabled(map: AdStateMap, storeId: string, platform: AdPlatform): boolean;

/** Platforms a store actually advertises on, derived from store config +
 *  the TikTok shared-account map (NOT hardcoded). */
export function applicablePlatforms(store: StoreMetaRow, tiktokStores: Set<string>): AdPlatform[];
```

- A reader `fetchAdStateFromPostgres()` in `postgresReaders.ts` loads `store_ad_state`
  into an `AdStateMap` (paginated like the others, ORDER BY the PK — per the
  deterministic-pagination rule). Cached via the existing `CACHE_CONFIG` pattern.
- **Every** consumer (crons, readers, UI, alerts, WhatsApp) reads through these
  helpers — no path re-implements the rule.

## C. Fetch-gate (cost saving)

Gate at the **dispatch point** of each cron (not inside individual fetchers):

- **Meta / Google (per-store accounts):** before enqueuing a store's Meta/Google
  ad fetch, check `isAdsEnabled(map, store, platform)`. Off ⇒ skip the dispatch
  (no API call). The Shopify/revenue fetch is untouched → `data_daily` keeps
  updating (revenue present, that platform's spend = 0).
- **TikTok (shared account):** the account is fetched ONCE (uzoshop's worker) and
  split per-store via `campaignStoreMap`. So:
  - Skip the **account fetch** ONLY if TikTok is off for **every** store on the
    shared account (uzoshop AND usmile360). Helper: `tiktokAccountFetchEnabled(map)`.
  - If off for only some stores → still fetch (for the on-stores). The off store's
    TikTok is handled at display/alerts; its campaigns are paused so its split
    spend is already 0.
- Dispatch points to gate: `cronDaily`, `cronLive`, the Phase-C tick orchestrator
  (`cron-tick-orchestrator` store×platform×scope fan-out), and the status / hot-metrics
  workers' enrolment. Each gets one `isAdsEnabled` / `tiktokAccountFetchEnabled` check.

## D. Display + ROAS bands

A shared classifier `adDisplayState({spend, revenue, anyApplicableOff})` (pure)
returns one of `'normal' | 'organic' | 'off-empty' | 'off-negative' | 'unknown'`,
mapping onto the EXISTING band colors (red/orange/green/blue/black) — no new palette:

- `spend > 0` → `normal` (existing band logic untouched: red<2 / orange2–2.7 / green2.7–3 / blue>3 / black="0").
- `spend === 0` AND the store's applicable ad platforms are all OFF:
  - `revenue > 0` → `organic` → **BLUE** "אורגני" + "⏻ פרסום כבוי" badge.
  - `revenue === 0` → `off-empty` → **0**, NEUTRAL (NOT black) + badge.
  - `revenue < 0` → `off-negative` → NEGATIVE value, today's zero/negative color (black) + badge.
- `spend === 0` AND not flagged off → `unknown` → today's "—" (possible missing data).

Consumers (faithful to the live layout — nothing moves):
- **Home "ניתוח השוואתי"** comparative table — the ROAS column cell.
- **"טבלאות חודשיות"** (optimization tab) — the ROAS column per day/rollup (§E3).
- **hero band** (if a scope resolves to an all-off store).
- **Campaigns / Ads tables** — off rows show "⏻ כבוי" (§E2).

The `blue`/`black` colors ALREADY exist in the band system; `off-empty` adds one
NEUTRAL token. Token-driven, light + dark, RTL, WCAG-AA. Faithful mockup:
`docs/superpowers/mockups/2026-06-06-ads-off-faithful/`.

> Per-store ROAS for a partially-off store (e.g. Meta on, Google off) stays NORMAL —
> its spend>0 from the on-platform drives the band; the off platform simply contributes
> no spend (and no chip/alert for that platform).

## E. Alerts suppression

Token-failure, freshness/`data_freshness`, no-spend, and creative-fatigue alerts
check `isAdsEnabled(map, store, platform)` and **skip** an off (store, platform).
This prevents "no spend"/stale/token/fatigue alerts firing for an intentionally-off platform.

## E2. Optimization / insight surfaces (off-aware)

Every optimization/insight surface routes through `isAdsEnabled` and excludes off
(store, platform) — so an off store never gets "optimize me" noise:
- **Insight engine** — "פעולות דחופות" / InsightsBoard, `campaignDied`, `adFatigue`
  (creative-fatigue), campaign **health-score**, and the **AI report**: skip off
  (store,platform); an off store is labelled "פרסום כבוי", not flagged as
  underperforming / "campaign died".
- **Campaigns / Ads tables** — off-platform rows render an "⏻ כבוי" chip instead of
  broken/zero metrics.
- **Registries (`campaign/adset/ad_registry`) + `data_freshness`** — an off platform
  is not flagged stale/problem (its status simply isn't refreshed while off).
- Enumerate every emitter in the Phase-4 plan so none is missed (see Risks).

## E3. "טבלאות אופטימיזציה" — monthly tables tab (`MonthlyTables`)

The optimization tab renders **"טבלאות חודשיות"** — one table per month, a row per
day, columns: `תאריך · פייסבוק · טיקטוק · יצא סה״כ · נכנס · ROAS`, with per-store /
"סיכום כללי" toggle and a year+month filter. Off-state behavior:
- For an off (store, platform): its **ad-spend columns (פייסבוק / טיקטוק / יצא סה״כ)
  = 0**, while **נכנס (revenue) is summed NORMALLY** — it can be **positive, 0, or
  negative** (old refunds) — and flows unchanged into the day rows, the monthly
  totals, the "סיכום כללי" rollup, and the month/year filter.
- The **ROAS cell** uses the off color rules (§D / decision #4): rev>0 → BLUE
  "אורגני"; rev=0 → NEUTRAL "0" (not black); rev<0 → NEGATIVE (today's color).
- The summation logic is **unchanged** — only the ROAS cell's color/label branches
  on the off-state. No column/row is added or removed.

## F. WhatsApp daily report

`buildStoreSummary` + the v2 param builder reflect off-state:
- Store with total ad spend 0 AND applicable platforms off:
  - revenue > 0 → header "⏻ *{store} · אורגני*" (green dot), revenue line shown, spend line "פרסום כבוי".
  - revenue = 0 → existing "ללא מכירות" path.
- Integrates with the v2 template work (band emoji + header logic). No new Meta
  template needed beyond v2 (the value strings just change).

## G. /operator toggle UI

New panel "מצב פרסום" (component under `src/components/operator/`):
- Matrix: rows = stores, columns = Meta / Google / TikTok.
- Each **applicable** cell = a toggle bound to `store_ad_state.enabled`; **non-applicable**
  cells render "לא רלוונטי" (grayed, no control), driven by `applicablePlatforms`.
- Writes via a new route `POST /api/operator/ad-state` (service-role, behind the
  operator auth gate + isDashboardAuthAllowlisted as needed). Optimistic UI + refetch.
- Shows `updated_at` ("כובה לפני X").

## H. No-regression guarantee

When `store_ad_state` is empty (every combo ON): crons fetch as today, bands show
as today, alerts fire as today, WhatsApp identical. A guard test asserts
"all-on ⇒ outputs identical to pre-feature" for the band classifier + the fetch-gate.

## I. Testing (TDD)

- `adState`: `isAdsEnabled` (missing key = ON), `applicablePlatforms` (per the 3
  real configs), `tiktokAccountFetchEnabled` (all-off vs some-off).
- `adDisplayState`: normal / organic (off+rev→blue) / off-empty (off+0→neutral) /
  off-negative (off+rev<0→today-color) / unknown (spend0 but flag on).
- Fetch-gate: Meta/Google skip when off; TikTok account fetch skipped only when all
  shared-account stores off; Shopify/revenue + `data_daily` unaffected.
- Alerts + insights: suppressed for off (store, platform) across ALL emitters
  (token/freshness/no-spend/fatigue/campaignDied/health-score/AI/InsightsBoard); fire normally when on.
- **MonthlyTables (§E3):** off store → spend cols 0, revenue summed normally (+/0/−),
  monthly + "סיכום כללי" rollups correct; ROAS cell blue/neutral/negative per state.
- WhatsApp: off+revenue → "אורגני" header; on → unchanged.
- DOM: the comparative table + monthly table ROAS cell render all off states with the
  right colors, both themes, RTL; Campaigns row shows "⏻ כבוי".
- Regression guard (§H).

## J. Phasing (each phase additive + shippable)

1. **Control:** migration + `adState` helpers (`isAdsEnabled`, `applicablePlatforms`,
   `tiktokAccountFetchEnabled`) + `fetchAdStateFromPostgres` reader + `/operator`
   matrix + `POST /api/operator/ad-state`. (Operator can toggle; nothing else reacts yet.)
2. **Display:** `adDisplayState` (incl. `off-negative`) + the NEUTRAL token; wire into
   the **"ניתוח השוואתי"** comparative table, the **"טבלאות חודשיות"** monthly tab
   (§E3), the hero band, and the **Campaigns/Ads** tables.
3. **Fetch-gate:** Meta/Google per-store skip + TikTok account-level rule.
4. **Alerts + insights + WhatsApp:** alert suppression (§E) + ALL optimization/insight
   surfaces off-aware (§E2) + WhatsApp report reflection (§F).

## K. Non-goals / risks

- **Non-goals:** date-ranged off-periods; auto-pausing the actual platform campaigns
  (the operator still pauses campaigns on the platform; this flag is dashboard intent);
  hiding real revenue from any total.
- **Risks:** (1) every alert AND insight emitter (token/freshness/no-spend/fatigue/
  campaignDied/health-score/AI/InsightsBoard) must route through `isAdsEnabled` —
  enumerate them ALL in Phase 4 so none is missed. (2) The TikTok account-fetch rule
  must check ALL shared-account stores, or one off-store would wrongly kill the
  other's TikTok data. (3) `applicablePlatforms` must derive from live config so a
  future config change (e.g. a store adds Google) auto-appears in the matrix.
  (4) The MonthlyTables/comparative-table change must touch ONLY the ROAS cell's
  color/label branch — the summation + columns stay byte-identical (no-redesign).

## Gates / docs

`tsc` · vitest (node+DOM) · lint · User Manual bump (new /operator panel + the
off-state display) · ARCHITECTURE note (store_ad_state + adState helpers + fetch-gate
+ TikTok rule) · supervised migration → single push per phase.

---

## Phase 2 — locked implementation semantics (2026-06-06)

**Off-gate:** `adDisplayState` returns a non-normal state **only when `off && spend===0`**. The current toggle is a plain boolean with no history; the `spend===0` guard ensures that historical rows that recorded real spend before the operator turned the flag off are **never retroactively rewritten** — their spend columns and ROAS values remain exactly as stored.

**Display rules (operator-locked, immutable):**
- `off && spend===0 && revenue > 0` → **blue "אורגני"** (reuses existing best-tier blue).
- `off && spend===0 && revenue ≤ 0` → **neutral "0"** (NOT black — black means "wasted spend"; you didn't spend). Off-negative folds into neutral; it is NOT colored red.
- `spend > 0` (any row with real spend) → normal band logic, untouched.

**Store-level "all off":** `isStoreFullyOff(storeId, map, applicablePlatforms)` returns true **only when every applicable platform for that store is toggled off**. A partially-off store (e.g. Meta on, Google off) stays in normal mode — the on-platform's spend still drives the band.

**Business-wide summary / hero:** `CommandCenterHero`, `RoasTargetChart`, and `GoalTracker` are **not touched** — they are business-wide aggregates and remain unchanged regardless of per-store off state.

**Call sites wired in Phase 2:** `roasCell` (backward-compatible `off=false` default), `PerStoreRow`, `StoreDetailModal`, `StoreCompareGrid` RoasPill, `MonthlyTables`, and `DetailTable`.

**Deferred to later phases:** Campaigns/Ads tables (`"⏻ כבוי"` chip) and fetch-gate (Phase 3), alert/WhatsApp suppression (Phase 4).

**Off-state visual (Playwright) snapshots deferred:** no store is actually off in production yet, so end-to-end visual snapshots cannot be taken against real data. The rendering contract is fully locked by the DOM-level unit tests (`adDisplayState` + `roasCell` + component render tests); the Playwright gap is documented and not silent.

---

## Phase 3 — locked fetch-gate semantics (2026-06-06)

**Gate placement — worker + cron-daily (NOT orchestrator):** the fetch-gate is implemented at two levels — each platform worker, and `runDailyForStoreInner` inside cron-daily — but intentionally NOT at the Inngest orchestrator (`buildEvents` / tick fan-out). Rationale: gating at the orchestrator would suppress the `data_freshness` write entirely, causing the Health tab to show false-red (stale/missing) for an intentionally-off platform. By gating at the worker level, the worker still runs, records `data_freshness` as `success` (the row is written first, before any API call), and then returns early without touching the platform API. No false-red; no wasted quota.

**Meta / Google (per-store gate):** each platform's worker checks `isAdsEnabled(adStateMap, storeId, platform)`. When the result is `false`, the worker records `data_freshness` success for that (store, platform, scope) combination and returns before making any API call. Both scopes (status + hot_metrics) are gated independently — each worker call is a separate Inngest function; neither fires the API when the store's platform is off.

**TikTok (account-level gate — never per-store):** TikTok uses a single shared ad account (uzoshop's), split per-store via `campaignStoreMap`. Gating at the per-store level would be wrong — turning off usmile360's TikTok would kill uzoshop's data too. Instead, `tiktokAccountFetchEnabled(adStateMap)` is the gate: it returns `false` only when TikTok is off for **all** stores on the shared account (uzoshop AND usmile360). If either store is on, the account fetch proceeds and the campaign-store split handles per-store attribution normally.

**cron-daily gate (`runDailyForStoreInner`):** loads `adStateMap` as its first step and gates its three ad-fetch steps:
- Meta fetch: `isAdsEnabled(adStateMap, storeId, 'meta')`.
- Google fetch: `isAdsEnabled(adStateMap, storeId, 'google')`.
- TikTok fetch: `!STORES_WITH_TIKTOK.has(storeId) || !tiktokAccountFetchEnabled(adStateMap)` — i.e. the store must be a TikTok store AND account-level enabled.

**Inheritance via `runDailyForStore`:** cron-yesterday-refresh, the "Refresh All" (`eventSyncNow`), and backfill all invoke `runDailyForStore`, which delegates to `runDailyForStoreInner` — so the gate applies uniformly to all daily-fetch paths without duplication.

**cron-live: no gate.** cron-live is Shopify-only (revenue polling); it has no ad-platform fetch calls and therefore needs no gate.

**Freshness recorded `success` on skip:** skipping the API call is NOT an error or a stale state. The worker records `data_freshness` as `success` before returning, so no Health-tab false-red, no alert, no monitoring noise.

**What is NOT gated:** Shopify/revenue fetches are never gated (organic revenue still flows); persist and aggregation RPCs (`upsert_data_daily`, `agg_data_daily_for_date`, etc.) are not gated; registry enrollment (campaign/adset/ad registries) is not gated; the reconcile harness is not gated.

**Default (empty `store_ad_state` table) ⇒ all-ON ⇒ pipeline unchanged.** `isAdsEnabled` and `tiktokAccountFetchEnabled` both default to `true` for any missing key — an empty table is byte-identical to today's behavior.

**Deferred: `off_gated` freshness status.** A distinct `off_gated` freshness status (separate from `success`) would allow the Health tab to show a differentiated "gated/off" indicator. This was deferred because it requires a DB enum extension + UI rendering branch; the current `success`-on-skip approach is correct and operationally safe. Can be added in a future phase if operator monitoring needs the distinction.

---

## Phase 4 — locked alert/insight/WhatsApp semantics (2026-06-06)

### Suppression rule

Two guard functions determine whether an (insight / alert / report section) is suppressed:

- **`isAdsEnabled(map, storeId, platform)`** — per-(store, platform). Returns `true` (on, emit normally) when the `AdStateMap` key is absent or `enabled=TRUE`. Returns `false` (off, suppress) for a specific platform of a specific store.
- **`isStoreFullyOff(storeId, map, applicablePlatforms)`** — per-store. Returns `true` only when **every applicable platform** for that store is toggled off. A partially-off store (e.g. Meta on, Google off) is NOT fully off and is not wholesale-suppressed.
- **`isInsightSuppressedByAdState(insight, adStateMap, storeApplicablePlatforms)`** — post-filter applied in `buildAllInsights` after all detectors run. Uses `isAdsEnabled` per-platform and `isStoreFullyOff` per-store to drop any insight whose (store, platform) pair is off.

### In-app insights + action list

`buildAllInsights` applies `isInsightSuppressedByAdState` as a final post-filter over the full insight list. Individual detectors also carry inline guards:

- **`campaignDied`** — skips campaigns whose (store, platform) is off.
- **`adFatigue` (creative-fatigue CTR + CPM legs, early-warning)** — skips (store, platform) that is off.
- **Anomaly / scale / pause / zero / rebalance / underperformance recommendations** — excluded by the post-filter.

`InsightsBoard` is threaded `data.adStateMap` and `data.storeApplicablePlatforms` (from `/api/data`; degrade to empty = all-ON). The "פעולות דחופות כרגע" action list above the board inherits the same filtered list — no separate gate needed.

### Health score

In `buildHealthByKey`: a campaign whose (store, platform) is off AND whose `spend === 0` renders the existing **"insufficient/unknown" (⏳) state** instead of a misleading letter grade. The `spend===0` guard is critical: a row that recorded real spend before the flag was toggled keeps its real grade (historical data is never retroactively rewritten).

### AI report

All ad-performance sections of the AI report filter out off (store, platform) pairs:

- Top campaigns table, CPM table, momentum analysis, health score summary, drainers, ad drill-down, TikTok deep-dive, pixel↔Shopify coverage — each section checks `isAdsEnabled` and skips the (store, platform).
- For a fully-off store (`isStoreFullyOff` = true) the entire ad commentary block is skipped.
- Revenue / product / cohort sections are **not filtered** — organic revenue always flows through.
- **Off + spend > 0 (historical):** if a store had real spend in the query window while the flag was already set off, those rows are rendered normally in the AI report (the `spend===0` guard in the health-score + display layer ensures no retroactive rewrite; the AI report respects the same invariant).

### WhatsApp daily report (v1 live + v2 pending)

`buildStoreSummary` and the v2 parameter builder apply off-state framing:

- **Fully-off store + revenue > 0** → store line reads "⏻ *{store} · אורגני*" (green dot, revenue shown, spend line "פרסום כבוי"). No ROAS fraction shown (spend = 0 = meaningless denominator).
- **Fully-off store + revenue = 0** → existing "ללא מכירות" path (neutral, no ROAS).
- **Off store + spend > 0 in window (historical)** → rendered with its real ROAS normally. The toggle records current intent; it does not rewrite past spend that was legitimately incurred before the flag was set.
- **Totals / summary line:** off-store ad spend is **excluded** from the business-wide spend total (it is 0 by the off-state invariant); off-store organic revenue IS included (it is real revenue). MER = total revenue ÷ on-stores spend only.

### Deliberate NON-changes

- **Token-failure alerts** (`meta-token-failure`, etc.): these are infrastructure alerts, not ad-performance alerts. A dead token must surface even when the platform is off (the operator still needs to know the credential is broken, e.g. to re-enable the platform later). The reactive dead-token alerts are already moot while the platform is off (Phase-3 fetch-gate prevents the failing call), but the cron-daily credential check is left intact.
- **`cronLiveHeavy`**: this function is decommissioned (empty array, not registered in `serve()`). No suppression logic needed; it is a dead code path.
- **Freshness/status-pill/activity-feed**: these are system-health surfaces, not ad-performance surfaces. They remain off-aware only to the extent Phase 3 already made them (freshness records `success` on skip); no additional suppression is applied in Phase 4.

### Feature status: COMPLETE

The ads-off feature is **complete** across all four phases:

1. **Phase 1 — Control:** `store_ad_state` table + `adState.ts` helpers + `/operator` matrix UI + `POST /api/operator/ad-state`.
2. **Phase 2 — Display:** `adDisplayState` classifier + ROAS band wiring (comparative table, monthly tables, hero band, Campaigns/Ads tables).
3. **Phase 3 — Fetch-gate:** per-store Meta/Google worker gate + TikTok account-level gate + `runDailyForStoreInner` daily-fetch gate.
4. **Phase 4 — Alerts/insights/WhatsApp suppression:** `isInsightSuppressedByAdState` post-filter + per-detector guards + AI-report section filtering + WhatsApp "אורגני"/neutral framing.
