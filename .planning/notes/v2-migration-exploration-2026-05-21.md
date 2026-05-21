---
title: v2.0 Migration Exploration — Apps Script + Sheets → Supabase + Inngest + Vercel
date: 2026-05-21
context: post Phase 05.2.3.0; operator-facing pain triggered by 6-min Apps Script cap, Sheets-API quota tetris, clasp push friction
status: decisions-locked
related_phases: [05.5-v2-supabase-foundation, 05.6-v2-ts-port-inngest-operator-console, 05.7-v2-cutover-decommission]
---

# v2.0 Migration Exploration — Decision Record

## Why this exploration happened

After Phase 05.2.3.0 shipped (10 plans across 4 waves; gap-closure for a structural double-deduction bug), three operational frictions came together at the same time:

1. **Sheets API short-window quota.** The 15-min live trigger × 3 stores × rolling-3-day backfill plus the manual auto-chain (`startMayBackfillAuto`) competed for the same 5-minute Sheets-API quota — multiple chunks timed out in production despite atomic chunk sizing.
2. **6-min Apps Script execution cap.** Every backfill / cleanup operation had to be artificially chunked to fit under the cap. The "auto-chain via PropertiesService queue + self-rescheduling triggers" pattern in `DailyUpdate.gs` (21 chunks × 3-day windows) is a workaround for this limit, not a solution.
3. **`clasp push` for every code change.** Apps Script logic is in `.gs` files. Iteration cycle = edit + git push + CI deploy + manually reload editor. The dashboard side (Next.js / Vercel) has a 10× faster iteration loop. The asymmetry slows everything.

The operator asked: "how do I get to a system without query limits, no clasp push, syncs triggered directly from the dashboard?"

## Decisions (7 questions, 7 decisions)

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Maximum acceptable dashboard staleness during cut-over | **Zero downtime** via feature flag (read from Sheets OR Postgres) | Single-operator; can't tolerate a window where numbers are wrong or missing |
| 2 | Same-tables migration vs rebuild-from-APIs | **Rebuild from upstream APIs** (Shopify Admin / Meta Marketing / Google Ads / FX) | Source of truth is the platforms, not Sheets. Algorithm corrections from Phase 05.2.3.0 propagate to history automatically. No Sheets verification harness needed. |
| 3 | History scope to backfill into Postgres | **From 2026-05-01 forward** | System only started collecting data May 1; ~3-7 weeks at migration time = trivial backfill (<2 hours of Inngest jobs). |
| 4 | Manual overrides (`manual-spend` tab, 38 rows) handling | **Load-bearing entity** → table `manual_overrides` in Supabase + CRUD UI in dashboard + one-off importer of 38 rows | Confirmed by operator: rows fill spend data for uzoshop May 1-8 when the original ad account was disabled — Meta API will never return these. Without import, the historical analysis tab breaks. |
| 5 | Dashboard ambition level | **(b) Operator console** — sync now button + jobs table + backfill range picker + manual_overrides CRUD | Higher than viewer-only (a); lower than multi-user-ready (c). Matches single-user reality. |
| 6 | Architecture stack | **Supabase Postgres + Inngest cloud + Vercel + Next.js** | Postgres = no query limits; Inngest = no execution caps + retries + concurrency + step functions; Vercel = already in use; TS-only = ends clasp push |
| 7 | Auth / access | **Stay URL-obscurity, single-user** | Defer Supabase Auth + RLS to future phase. Operator confirmed no plans for multi-user in 3-6 months. |

## Architecture diagram (post-migration)

```
                    ┌────────────────────────────────┐
                    │  Vercel — Next.js dashboard    │
                    │                                │
                    │  - /api/data (reads Postgres)  │
                    │  - /api/trigger-sync (event)   │
                    │  - /api/manual-overrides (CRUD)│
                    │  - Operator console tab        │
                    └─────────┬──────────────────────┘
                              │
                              │ REST / supabase-js
                              ▼
                    ┌────────────────────────────────┐
                    │  Supabase Postgres             │
                    │                                │
                    │  - data_daily                  │
                    │  - products_daily              │
                    │  - campaigns_daily             │
                    │  - ads_daily                   │
                    │  - manual_overrides            │
                    │  - stores (config)             │
                    │  - notification_config         │
                    └─────────▲──────────────────────┘
                              │
                              │ writes
                              │
                    ┌─────────┴──────────────────────┐
                    │  Inngest cloud jobs            │
                    │                                │
                    │  cron: 0 5 * * * (daily 00:05) │
                    │  cron: */15 * * * * (live)     │
                    │  event: operator/sync-now      │
                    │  event: operator/backfill      │
                    └─────────┬──────────────────────┘
                              │
                              │ HTTPS
                              ▼
                    ┌────────────────────────────────┐
                    │  Upstream APIs (sources of     │
                    │  truth)                        │
                    │                                │
                    │  Shopify Admin REST 2024-10    │
                    │  Meta Marketing Graph API      │
                    │  Google Ads API                │
                    │  Open Exchange Rates           │
                    └────────────────────────────────┘

DECOMMISSIONED:
   - Apps Script project (no more .gs files)
   - clasp CI workflow
   - All Sheets tabs except a frozen archive snapshot kept read-only
   - PropertiesService (replaced by Vercel env vars + Supabase `stores` table)
```

## Migration phasing (3 phases)

### Phase 05.5 — v2.0 Supabase Foundation + PROPS-MAP
**Goal:** Stand up Supabase + classify all 40 env properties + verify connectivity. No fetcher work yet — this is the runway.

**Approx scope (~1 week):**
- Create Supabase project (free tier) + database schema (initial: `stores`, `manual_overrides`, `data_daily`, `products_daily`, `campaigns_daily`, `ads_daily`)
- Classify all 40 properties from `.env` → SECRET / CONFIG / DATA per the table at the bottom of `.env`
- Seed Vercel env vars (SECRET + CONFIG); seed `stores` + `notification_config` tables (DATA)
- Write `docs/PROPS-MAP.md` — operator checklist mapping each property to its destination + `seeded?` status
- Add Supabase client to `dashboard-web` (read-only at first); verify a trivial query works end-to-end
- No Inngest yet; no fetcher rewrite; Apps Script keeps running unchanged

**Exit criteria:** PROPS-MAP.md fully populated with `[x]` for every property; dashboard's "Sync OK" indicator extended to ALSO check Supabase connectivity; no production behavior change.

### Phase 05.6 — v2.0 TS Port + Inngest + Operator Console
**Goal:** Port the 5 fetchers from Apps Script to TS, run Inngest jobs that write to Supabase, build operator console in dashboard. Apps Script keeps running in parallel writing to Sheets (no dual-write — the two systems are independent, both reading from upstream APIs).

**Approx scope (~1-2 weeks):**
- TS ports under `dashboard-web/src/lib/fetchers/`:
  - `shopify.ts` (mirror of Shopify.gs:getShopifyRevenue + getShopifyProductSalesForDay + getShopifyRefundsForDay_ + getShopifyOrdersAttribution)
  - `meta.ts` (mirror of MetaAds.gs)
  - `googleAds.ts` (mirror of GoogleAds.gs)
  - `fx.ts` (mirror of FX.gs)
  - `manualOverrides.ts` (mirror of ManualOverrides.gs — applies overrides post-fetch)
- Inngest setup (cloud free tier; cron + event functions)
  - `cron-daily-{store}` for each store (mirrors current 00:05 daily)
  - `cron-live-{store}` for each store every 15min (mirrors current live trigger)
  - `event/sync-now` triggered from dashboard
  - `event/backfill` for range backfills triggered from operator console
- New dashboard tab "ניהול" (Operator Console):
  - Jobs table (Inngest UI embedded via iframe OR custom view via Inngest REST)
  - Backfill range picker (from / to / store(s) → triggers `event/backfill`)
  - Manual overrides CRUD UI (table view + add/edit/delete rows, writes to Supabase `manual_overrides`)
  - "Sync now" button per-store + global
- One-off importer for the 38 manual_spend rows (a deferred plan inside this phase)
- Dashboard feature flag `READ_FROM=sheets|postgres` controlling all `/api/*` routes — defaults to `sheets`

**Exit criteria:** All 5 fetchers ported; Inngest jobs running daily + live + on-demand; operator console functional; manual_overrides imported; dashboard can read from Postgres when flag is flipped (but defaults to Sheets); no production behavior change.

### Phase 05.7 — v2.0 Cut-over + Apps Script Decommission
**Goal:** Flip feature flag to Postgres, verify, decommission Apps Script.

**Approx scope (~3-5 days):**
- Verification harness: a TS script that compares dashboard numbers (Sheets vs Postgres) for the last 14 days, day-by-day, per-store, per-metric. Acceptable delta: 0 modulo the Phase 05.2.3.0 algorithm-correction delta (Sheets has old algorithm; Postgres has corrected algorithm — diff is the correction).
- Flip dashboard feature flag default to `READ_FROM=postgres`
- Monitor production for 7 days (operator daily-check)
- Disable (but do not delete) the Apps Script triggers — `removeDailyTrigger` + `removeLiveTrigger` from Apps Script editor; keep the project + code as an archive
- Update CLAUDE.md / SYSTEM_OVERVIEW.md to reflect the new architecture (Apps Script removed from active stack)
- Decommission `clasp` CI workflow (delete from `.github/workflows/`)
- Final: archive Sheets to a read-only snapshot (export as a backup .xlsx + freeze the spreadsheet)

**Exit criteria:** Apps Script triggers OFF for 7 days with no operator-reported anomalies. clasp workflow deleted. Dashboard reads exclusively from Postgres. Sheets archived.

## What was deferred / out of scope for v2.0

- **Supabase Auth + RLS.** Stays URL-obscurity for now (per decision #7). Future phase will add real auth when multi-user becomes a real concern.
- **Webhooks instead of polling.** Shopify, Meta, and Google Ads all support webhooks for some events (Shopify orders/refunds especially). Current architecture polls every 15min. Future phase could move to webhook-driven for sub-second latency.
- **Real-time dashboard via Supabase Realtime.** The dashboard currently polls `/api/data` every 30s. Could subscribe to Postgres changes via Supabase Realtime for instant updates. Defer.
- **Postgres partitioning.** Single `data_daily` table for now. If volume crosses ~10M rows in 2-3 years, revisit declarative partitioning by month. Far future.
- **Phase 6 rescope.** Current Phase 6 (Security & Cloud-Sync) was designed for Sheets-based architecture (service-account split + audit log + adaptive polling on Sheets). Post-migration, Phase 6 needs a rewrite or merge into v2.0-01's setup work. Plan to revisit when migration completes.

## Risks tracked

| Risk | Mitigation |
|------|------------|
| Inngest free tier insufficient | Estimated load: ~96 cron runs/day × 3 stores + ~50 events/day = well under free tier (50k executions/month). If exceeded, $20/month tier. |
| Supabase free tier 500MB exhausted | Estimated: ~5k orders/month × 3 stores × ~2KB per row = ~30MB/month. 500MB = ~16 months. Plenty for 1-2 years. |
| Meta API key rotation during migration | The 3 store-level Meta access tokens are long-lived (60-day expiry on regular tokens; system tokens are non-expiring). PROPS-MAP includes rotation playbook. |
| Operator can't deploy mid-migration | TS-only stack uses Vercel CI/CD — `git push` deploys automatically. No `clasp` needed once we cross Phase 05.6's halfway point. |
| Verification harness misses a subtle bug | Phase 05.7's harness is the gate. If diff is non-zero in unexpected ways, do not cut over. Roll back the flag flip; investigate; re-verify. |

## Related artifacts

- `.env` — canonical 40-property inventory at project root (gitignored)
- `docs/PROPS-MAP.md` — will be created in Phase 05.5
- `.planning/phases/05.5-*` / `05.6-*` / `05.7-*` — phase directories (will be created when planning starts)
- `.planning/phases/05.2.3.0-shopify-revenue-refunds-bug-fix/` — the last bug-fix that made the migration urgent (rolling-3-day backfill stress-tested the Sheets quota)
