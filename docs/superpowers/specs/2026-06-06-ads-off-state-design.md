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
4. **Display / ROAS coloring when total ad spend = 0 AND the store's applicable
   ad platforms are flagged off:**
   - revenue > 0 → **"אורגני"**, GREEN band (no ad cost + revenue = excellent).
   - revenue = 0 → **0**, NEUTRAL muted color (NOT black/dead — intentional, not an error).
   - distinct from today's "—" (which stays for spend=0 while the flag is ON = possible missing data).
   - When ON → unchanged ROAS bands (<2 red / 2–2.7 orange / 3+ green).
5. **Toggle UX:** matrix in **/operator** (store × platform).
6. **Business-wide MER / revenue:** off-store revenue **IS counted** (it is real
   organic revenue; MER = total revenue ÷ total ad spend is the honest picture).
   "Off" affects per-store display + fetch + alerts only — it never hides real revenue.
7. **Not all stores have all platforms** — the matrix only exposes applicable combos.
8. **TikTok is one shared ad account** (uzoshop's) split per-store via `campaignStoreMap`.

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

A shared classifier `adDisplayState(opts)` (pure) returns one of:
`'normal' | 'organic' | 'off-empty' | 'unknown'`:

- `spend > 0` → `normal` (existing band logic untouched).
- `spend === 0` AND store's applicable ad platforms all OFF:
  - `revenue > 0` → `organic` → render **"אורגני"**, GREEN band + "⏻ פרסום כבוי" badge.
  - `revenue === 0` → `off-empty` → render **0**, NEUTRAL muted color + "⏻ פרסום כבוי" badge.
- `spend === 0` AND not flagged off → `unknown` → today's "—" (possible missing data).

Consumers: per-store cards (`PerStoreRow` / store cards), the hero band, and the
Campaigns/per-platform views (an off platform shows a "כבוי" chip, no broken metrics).
Token-driven colors (new `--band-organic` / `--band-off` tokens), light + dark, RTL,
WCAG-AA (white/ink on the band per the on-band contrast standard). Mockup:
`docs/superpowers/mockups/2026-06-06-ads-off-state/`.

> Per-store ROAS for a partially-off store (e.g. Meta on, Google off) stays NORMAL —
> its spend>0 from the on-platform drives the band; the off platform simply contributes
> no spend (and no Google chip/alert).

## E. Alerts suppression

Token-failure, freshness/`data_freshness`, no-spend, and creative-fatigue alerts
check `isAdsEnabled(map, store, platform)` and **skip** an off (store, platform).
This prevents "no spend"/stale/token alerts firing for an intentionally-off platform.

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
- `adDisplayState`: normal / organic (off+rev) / off-empty (off+no-rev) / unknown
  (spend0 but flag on).
- Fetch-gate: Meta/Google skip when off; TikTok account fetch skipped only when all
  shared-account stores off; Shopify/revenue + `data_daily` unaffected.
- Alerts: suppressed for off (store, platform); fire normally when on.
- WhatsApp: off+revenue → "אורגני" header; on → unchanged.
- DOM: store card renders the 3 states with correct band tokens, both themes, RTL.
- Regression guard (§H).

## J. Phasing (each phase additive + shippable)

1. **Control:** migration + `adState` helpers + reader + `/operator` matrix + route.
   (Operator can toggle; nothing else reacts yet.)
2. **Display:** `adDisplayState` + band tokens + per-store cards/hero/Campaigns.
3. **Fetch-gate:** Meta/Google per-store skip + TikTok account-level rule.
4. **Alerts + WhatsApp:** suppression + report reflection.

## K. Non-goals / risks

- **Non-goals:** date-ranged off-periods; auto-pausing the actual platform campaigns
  (the operator still pauses campaigns on the platform; this flag is dashboard intent);
  hiding real revenue from any total.
- **Risks:** (1) every alert path must route through `isAdsEnabled` — enumerate them
  in Phase 4 so none is missed. (2) The TikTok account-fetch rule must check ALL
  shared-account stores, or one off-store would wrongly kill the other's TikTok data.
  (3) `applicablePlatforms` must derive from live config so a future config change
  (e.g. a store adds Google) auto-appears in the matrix.

## Gates / docs

`tsc` · vitest (node+DOM) · lint · User Manual bump (new /operator panel + the
off-state display) · ARCHITECTURE note (store_ad_state + adState helpers + fetch-gate
+ TikTok rule) · supervised migration → single push per phase.
