# Editable COGS / inventory-% (per-month, retroactive) — design

**Date:** 2026-06-01
**Status:** approved (mockup signed off by operator)
**Mockup:** `docs/superpowers/mockups/2026-06-01-cogs-editor/mockup.html`

## Goal

Let the operator edit the inventory-cost % ("הוצאות מלאי" / COGS) from the
dashboard — today hard-wired to a flat **25%**. The % is:
- **One global mode**: business-level (one % for all stores) OR per-store (a % per
  store), switchable anytime.
- **Per-month** with a **25% default** for any month never set.
- **Retroactive + dynamic**: editing a past month's % instantly changes that
  month's COGS in **every** dashboard computation.
- Edited via an **apply-scope** selector: current month · a specific month · all
  previous months · everything (past + current + future).

## Current state (from exploration — exact refs)

- COGS is **computed server-side at write time**: `cogs_cad = revenue_cad ×
  getCogsRateForStore(storeId)` and stored in `data_daily.cogs_cad`
  (`src/inngest/functions/cronDaily.ts:667-671,794`; mirrored in `cronLive.ts`).
  Default rate `0.25` lives in 3 places (`cronDaily.ts:103`, `cronLive.ts:165`,
  `src/lib/analytics.ts:17` `COGS_RATE_OF_REVENUE`). Per-store rates exist ONLY via
  env vars (`${STORE}_COGS_RATE`) through 3 duplicate `getCogsRateForStore()`
  impls (cronDaily, cronLive, analytics) — **no UI**.
- Client **reads the precomputed value**: `postgresReaders.ts:313-316` sets
  `DailyRow.cogs` from `cogs_cad` (back-fills `revenue × 0.25` for legacy null
  rows); `analytics.ts:165-168` sums `r.hasCogs ? r.cogs : r.revenue ×
  getCogsRateForStore(r.storeId)` in `aggregate()`.
- **Consumers of cogs** (all read a precomputed `cogs`, none re-apply a % except
  the legacy back-fill): hero featured/inventory card (`lib/home/adapters.ts:102-117`
  `operatingProfit = revenue − spend − cogs`; `CommandCenterHero.tsx` inventory
  tile), per-store cards (`StoreAgg.cogs` via `aggregate()`), P&L
  (`PnLBreakdown.tsx:122,147`), Detail (`DetailTable.tsx` `r.cogs`/`r.hasCogs`),
  GoalTracker forecast (`insights.ts:560,598-599,651` sums `last7Cogs`/`mtdCogs`
  from rows), monthly tables (`DailyRow.cogs`/`netProfit`), AI report, campaigns
  true-net (`campaignsAggregator` / `campaignHealthScore` — operate on
  `CampaignRow`, NOT `DailyRow`; compute their own cogs from revenue × rate).
- **BillingSettings** is the persistence pattern to mirror: `src/lib/billing.ts`
  reads/writes localStorage (`roas-dashboard:billing-recurring` / `-onetime`) and
  cloud-syncs via `pushCloudKey()`; hydration via `isHydrated()`. It does NOT
  manage COGS today.
- Tests/guards to keep green: `forecastMonthEndProjectionCogs.test.ts`,
  `forecastMonthEnd*` baseline tests, `billing*` tests,
  `CommandCenterHero.dom.test.tsx` (cogs tile), `aggregate()` tests.

## Architecture decision

**Client-side override + read-time recompute** (NOT a DB migration). The stored
`data_daily.cogs_cad` is left untouched; the dashboard recomputes the EFFECTIVE
cogs from a client settings object at read time — instant, fully retroactive, no
backfill. This mirrors how **transaction fees** already work (read-time client
compute, `analytics.ts:169`) and the BillingSettings persistence pattern. Chosen
over a DB override table (migration + postgresReaders join + cloud-sync of a
server table) because the requirement is operator-facing, must be retroactive
across all history immediately, and the data already round-trips through the
client.

## 1. Data model + persistence

New module `src/lib/cogsSettings.ts` (mirrors `src/lib/campaignsColumnPrefs.ts` /
`billing.ts` patterns):

```ts
export const DEFAULT_COGS_PCT = 25; // percent, operator-facing
export const COGS_SETTINGS_KEY = 'roas-dashboard:cogs-settings';

export interface CogsScopeSettings {
  /** Base % applied to any month without an explicit byMonth entry. */
  default: number;
  /** Explicit per-month overrides, key = 'YYYY-MM' → percent. */
  byMonth: Record<string, number>;
}
export interface CogsSettings {
  v: number;                       // schema version (start 1)
  mode: 'business' | 'per-store';
  business: CogsScopeSettings;     // { default: 25, byMonth: {} }
  perStore: Record<string, CogsScopeSettings>; // keyed by storeName
}
```

- `readCogsSettings()` → parsed settings or the all-25% default
  (`{ v:1, mode:'business', business:{default:25,byMonth:{}}, perStore:{} }`).
  SSR-safe (returns default when `typeof window === 'undefined'`).
- `writeCogsSettings(s)` → `localStorage.setItem` + dispatch a
  `'roas-cogs-settings-changed'` CustomEvent + `pushCloudKey(COGS_SETTINGS_KEY, s)`
  (cloud sync), exactly like `writeCampaignsColumnPrefs`.
- `useCogsSettings()` hook (`src/lib/hooks/useCogsSettings.ts`) — reads on mount,
  re-reads on the change event + on the cloud-sync hydrate event, so edits
  re-render the whole dashboard reactively.

**Effective percent** (the single source of truth, pure + unit-tested):
```ts
export function effectiveCogsPct(
  s: CogsSettings, storeName: string, month: string /* 'YYYY-MM' */,
): number {
  const scope = s.mode === 'per-store'
    ? (s.perStore[storeName] ?? { default: DEFAULT_COGS_PCT, byMonth: {} })
    : s.business;
  return (scope.byMonth[month] ?? scope.default ?? DEFAULT_COGS_PCT) / 100;
}
```

## 2. Recompute injection (the core)

Two read paths consume cogs; both route through `effectiveCogsPct`:

**(a) DailyRow path** — a pure helper:
```ts
// src/lib/cogsSettings.ts
export function applyCogsToRows(rows: DailyRow[], s: CogsSettings): DailyRow[] {
  return rows.map((r) => {
    const pct = effectiveCogsPct(s, r.storeName, r.date.slice(0, 7));
    const cogs = r.revenue * pct;
    return { ...r, cogs, hasCogs: true, netProfit: r.revenue - r.totalSpend - cogs };
    // grossProfit is NOT cogs-derived (gross = revenue − adSpend); leave as-is —
    // implementer verifies grossProfit's formula and recomputes only if it
    // subtracts cogs.
  });
}
```
Applied (reactively, `useMemo([rawRows, cogsSettings])`) at EVERY `/api/data`
rows-entry point so `r.cogs` is already effective everywhere downstream
(`aggregate()`, `dailySeries()`, MonthlyTables, DetailTable, GoalTracker forecast
all read `r.cogs`/sum it and need no further change):
- `Dashboard.tsx` — the main `data.rows` (Home/hero/per-store).
- `MonthlyTables.tsx` — its own `/api/data` rows.
- `GoalTracker.tsx` — its wide-window forecast fetch rows.
- `DetailTable` / Detail tab rows.
- `PnLBreakdown` rows.
- Trends tab rows (chart series).
A short shared hook `useCogsAdjustedRows(rawRows)` = `useMemo(() =>
applyCogsToRows(rawRows, settings), [rawRows, settings])` keeps each call site one
line, and a test asserts the transform is present where rows enter.

**(b) Campaign path** — campaigns compute true-net from `CampaignRow` (revenue ×
rate), not `DailyRow`. Their cogs computation (`campaignsAggregator` /
`campaignHealthScore` true-net) must call the SAME `effectiveCogsPct(settings,
storeName, monthOfRange)` instead of a hardcoded 0.25. For a campaign aggregated
over a date range, use the range's month (range.from month) — campaigns are
viewed per selected range; document this choice. The campaigns components read
`useCogsSettings()` and pass the pct in.

With **default settings** (all 25%, no overrides), `applyCogsToRows` reproduces
today's numbers for 25%-stored rows, so there is **no behavior change until the
operator edits**.

## 3. Apply-scopes (editor writes)

The editor's "החל על" selector maps to mutations on the active scope
(`business` or each selected store's `perStore` entry):
- **Current month** → `byMonth[currentMonth] = pct`.
- **Specific month** (month picker) → `byMonth[chosenMonth] = pct`.
- **All previous months** → `byMonth[m] = pct` for every month `m < currentMonth`
  present in the loaded data (so the timeline shows them explicit).
- **Everything (past + current + future)** → `default = pct` AND delete all
  `byMonth` entries for that scope (clean slate → every month inherits the new
  default, including future).

Per-store mode: the editor edits all stores' fields; "apply" writes each store's
chosen pct to its `perStore[store]` scope with the same apply-scope.

## 4. Display

- **Business / general surfaces** (hero inventory tile, P&L, "מלאי ~X% מהמחזור"
  captions) show the **weighted-average %** = `totalCogs ÷ totalRevenue` for the
  visible range — which already falls out of the recomputed aggregate, no special
  code. (Correct across multi-month ranges + per-store mode automatically.)
- **Per-store surfaces** (per-store cards, store-detail modal) show that store's
  effective % for the range = its `storeCogs ÷ storeRevenue`.
- The editor's **timeline table** lists effective % per month (per-store columns +
  weighted-avg), marking edited vs default months.

## 5. UI

New `src/components/CogsSettings.tsx` panel (sibling of `BillingSettings`,
rendered in the same settings location — implementer confirms where BillingSettings
mounts, e.g. P&L tab / a settings drawer — and places CogsSettings adjacent):
- Mode segmented control (רמת עסק / רמת חנות) → `mode`.
- % input(s): one ("כל העסק") in business mode; one per store in per-store mode.
- Apply-scope radio group (4 options) + a month `<select>` shown when "specific
  month" is chosen.
- "החל שינוי" button → writes via the apply-scope mapping.
- Timeline table (effective % per month, edited/default badges).
- Token-driven, light+dark, RTL, AA — must pass the existing guards (no raw
  hex/oklch in the .tsx; use existing primitives Button/Card/NativeSelect/Money).

## Files

- **Create:** `src/lib/cogsSettings.ts` (model, read/write, `effectiveCogsPct`,
  `applyCogsToRows`), `src/lib/hooks/useCogsSettings.ts`, `src/components/CogsSettings.tsx`.
- **Modify (wire `useCogsAdjustedRows`):** `Dashboard.tsx`, `MonthlyTables.tsx`,
  `GoalTracker.tsx`, `DetailTable`/Detail tab, `PnLBreakdown.tsx`, Trends tab.
- **Modify (campaign cogs):** `campaignsAggregator` / `campaignHealthScore`
  true-net path to use `effectiveCogsPct`.
- **Mount:** wherever `BillingSettings` renders, add `CogsSettings`.
- **Tests:** `src/lib/__tests__/cogsSettings.test.ts` (effectiveCogsPct, applyCogsToRows,
  apply-scope writes, default=25, per-store, byMonth precedence, version/migration);
  a DOM test for `CogsSettings.tsx`; targeted assertions that aggregate()/forecast/
  hero reflect an override.

## Testing (key cases)

1. `effectiveCogsPct`: default 25; business byMonth precedence; per-store default +
   byMonth; unknown store → 25; mode switch.
2. `applyCogsToRows`: recomputes `cogs` + `netProfit`; `hasCogs=true`; each row uses
   its own month + store; default settings reproduce input for 25%-stored rows.
3. Apply-scopes: current/specific/all-previous/everything produce the right
   `byMonth`/`default` mutations (everything → default set + byMonth cleared).
4. Weighted-average display: per-store mode, a 2-store range → business surface
   shows `Σcogs/Σrevenue`, per-store shows each store's pct.
5. Forecast: an override on the current month flows into `forecastMonthEnd` (cogs
   adjusted rows feed `mtdCogs`/`last7Cogs`).
6. Persistence: write → localStorage + change event + cloud push; read back; SSR
   default; version migration (absent `v` → defaults).

## Edge cases / non-goals

- **Env-var COGS rates are superseded** for dashboard display: the client recompute
  uses the new settings (default 25%), so a store that today relies on a non-25%
  `${STORE}_COGS_RATE` env var will read 25% until the operator sets its per-store
  default in the UI. Implementer verifies whether any store actually sets a non-25%
  env rate; if so, seed that store's `perStore[].default` to match on first run.
  (cron still writes `cogs_cad`; the dashboard simply recomputes over it.)
- **No DB / cron changes.** `data_daily.cogs_cad` stays; we recompute client-side.
- **No per-month MODE** (mode is global, per the decision); only values are per-month.
- **`grossProfit`** is recomputed only if it subtracts cogs (verify; gross = revenue
  − ad-spend in most defs → unaffected).
- Multi-month ranges work via per-row month resolution (each row uses its month).
