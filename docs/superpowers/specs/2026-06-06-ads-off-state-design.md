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
