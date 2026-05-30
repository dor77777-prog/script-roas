---
title: Handoff — 2026-05-30 night session (Phase E1.7 + UI/UX audit pending)
date: 2026-05-30 ~21:17 IL
state_at_handoff: HEAD a994632 on origin/main
---

# Handoff — 2026-05-30 night

## TL;DR

A long evening of architectural cleanup of the data-update pipeline (Phase E1.6 → E1.6.1 → E1.6.2 → E1.7 + 4 hotfixes), followed by a paused UI/UX overhaul. The pipeline work is **mostly verified** in production; one open issue (Google `rows=0`) is being diagnosed via deployed `[gh-diag]` console logs. The UI/UX overhaul has a **research/audit doc + a 28-task implementation plan** ready to execute once the pipeline issues are closed.

## Resume prompt for next session

```
Read docs/superpowers/specs/2026-05-30-handoff-phase-e1-7-night.md. Resume from "Open items" — verify the next orchestrator tick wrote campaigns_daily.tiktok per the store-map, investigate Google rows=0, then if all green proceed to the UI/UX overhaul plan at docs/superpowers/plans/2026-05-30-ui-ux-design-system-overhaul.md.
```

---

## Production state at handoff

**HEAD on origin/main:** `a994632`

**Stack of commits landed tonight (most recent first):**

| Commit | Message |
|---|---|
| `a994632` | fix(phase-e1.7): TikTok DELETE-then-UPSERT for re-mapped campaigns |
| `18ec3f8` | diag(phase-e1.7): TikTok AD-level dimensions fix + Google broad-query diag |
| `5673635` | fix(phase-e1.7): TikTok dimensions must include campaign_id for store-map routing |
| `89d8a8c` | fix(phase-e1.7): Google hot_metrics — query account TZ + 2-day window |
| `08e29ed` | fix(phase-e1.7): TikTok filter_value must be JSON-stringified string |
| `329919c` | **feat(phase-e1.7): campaigns_daily as source of truth + unified agg_data_daily_for_date RPC** ← main refactor |
| `6a865ee` | fix(phase-e1.6.2): cron-live truly Shopify-only + recompute_data_daily_derived RPC |
| `181a5fb` | fix(phase-e1.6.2): cron-live stops writing platform spend columns |
| `4d523a9` | docs(ui-ux): fresh independent audit + research for design-system overhaul |
| `1da97d8` | docs(phase-e1.6.1): ARCHITECTURE §Phase E1.6.1 hotfixes |
| `a4c0d0e` | fix(phase-e1.6.1): surface hot-set RPC failures + correct TikTok per-store split |
| `cfd1903` | fix(phase-e1.6.1): account-aggregate spend write must run before empty-hot-set early-exit |

**Migrations applied to production:**

| Migration | What it does |
|---|---|
| `20260530300000_recompute_data_daily_derived.sql` | Derive-only RPC (superseded by E1.7) |
| `20260530310000_agg_data_daily_for_date.sql` | **Phase E1.7 unified agg RPC — 3-pass: zero, sum from campaigns_daily, derive total/roas/gross/net** |

Both deployed via `supabase db query --linked --file ...` + `NOTIFY pgrst, 'reload schema';` (the .env-rename dance because the project's .env uses dotted keys that break the Supabase CLI's parser).

**Files deleted in Phase E1.7** (no longer needed):
- `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts` (+ test) — partial-column UPSERT helper that silently failed on `store_name NOT NULL` for Day-3 dates.
- `dashboard-web/src/lib/fetchers/metaAccountSpend.ts` (+ test)
- `dashboard-web/src/lib/fetchers/googleAccountSpend.ts` (+ test)
- `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts` (+ test)

---

## Architecture ownership (post-Phase E1.7)

| Column(s) | Owner | Cadence |
|---|---|---|
| `data_daily.{revenue_cad, gross_revenue_cad, refund_deduction_cad, cogs_cad, store_name, last_live_tick_at}` | cron-live (Shopify-only) | 10 min |
| `campaigns_daily.spend_cad + impressions` (Meta) | metaWorker hot_metrics | ~10 min |
| `campaigns_daily.spend_cad + impressions` (Google) | googleWorker hot_metrics | ~10 min |
| `campaigns_daily.spend_cad + impressions` (TikTok) | tiktokWorker hot_metrics | ~10 min |
| `data_daily.{fb,ga,tt}_spend_cad + {fb,ga,tt}_impressions` | **derived** by `agg_data_daily_for_date` RPC | atomic per write |
| `data_daily.{total_spend_cad, roas, gross_profit_cad, net_profit_cad}` | **derived** by same RPC (Pass 3) | atomic per write |

`campaigns_daily` is the **single source of truth** for ad spend. `data_daily` is materialized from it.

The RPC is called from:
- `cronLive.persistDayForStore` (after Shopify UPSERT)
- `metaWorker hot_metrics` (before empty-hot-set early-exit AND after upsertCampaignsDaily)
- `googleWorker hot_metrics` (same)
- `tiktokWorker hot_metrics` (same)

---

## What we verified working

- **Meta** ✅ — verified at 20:40 tick: `data_daily.fb_spend_cad` for uzoshop moved from $543.62 (account-aggregate, pre-fix) → $588.56 (campaigns_daily SUM, post-fix). +$2.88 of fresh spend showed up in 5 min. Every subsequent tick should keep updating.
- **TikTok ADGROUP fetch** ✅ — `[tt-diag] AUCTION_ADGROUP store=uzoshop ids=9 rows=9 code=0`. The 4 stacked fixes (envelope check + JSON.stringify filter_value + campaign_id dimension + DELETE-stale) all in place.
- **cron-live** ✅ — truly Shopify-only. `grep -E "fb_|ga_|tt_" cronLive.ts | grep -v "//"` returns zero matches.
- **store_name NOT NULL silent failure** ✅ — gone (Day-3 writes no longer attempted directly).
- **Test suite** ✅ — 1559 pass / 0 fail / 9 skip locally.

---

## Open items (resume here)

### 1. Verify next orchestrator tick wrote TikTok correctly per the store-map

After commit `a994632` deploys (~21:18 IL), the tick at 21:20 should:
- Call fetchTikTokHotMetricsForStore with both ADGROUP + AD level dimensions correct
- Build adgroup→campaign map from ADGROUP response
- Enrich AD rows with campaign_id via the map
- DELETE-then-UPSERT campaigns_daily for re-map safety
- Call `agg_data_daily_for_date(today)` → data_daily.tt_spend_cad per store

**Verify with:**

```bash
mv .env .env.cli-blocked && supabase db query --linked --output table "
SELECT store_id, campaign_id, ad_set_id, ROUND(spend_cad::numeric,2) AS spend,
  to_char(last_live_tick_at AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI:SS') AS tick
FROM campaigns_daily
 WHERE date = '2026-05-30' AND platform = 'tiktok'
 ORDER BY last_live_tick_at DESC LIMIT 20;
" 2>&1 | tail -25; mv .env.cli-blocked .env
```

Expected: rows have `campaign_id` populated, `store_id` matches what the campaign-store-map says (user confirmed: all current TikTok campaigns map to usmile360 — should see those + zero rows attributed to uzoshop unless the map changed).

**Verify data_daily:**
```bash
mv .env .env.cli-blocked && supabase db query --linked --output table "SELECT store_id, ROUND(fb_spend_cad::numeric,2) AS fb, ROUND(ga_spend_cad::numeric,2) AS ga, ROUND(tt_spend_cad::numeric,2) AS tt, ROUND(total_spend_cad::numeric,2) AS total, ROUND(roas::numeric,4) AS roas FROM data_daily WHERE date = '2026-05-30' ORDER BY store_id;" 2>&1 | tail -10; mv .env.cli-blocked .env
```

### 2. Investigate Google `rows=0`

`[gh-diag]` log from 21:10 tick:
```
tz=Asia/Jerusalem todayInTz=2026-05-30 yesterdayInTz=2026-05-29 workerDateStr=2026-05-30
adgroup_query store=uzoshop tz=Asia/Jerusalem range=2026-05-29..2026-05-30 ids=3 rows=0 sample=null
```

TZ is correct (`Asia/Jerusalem`). 2-day window in place. Still 0 rows for the 3 hot adgroup IDs (23590447604, 22542818628, 179514240676).

**Strong suspicion**: 2 of 3 IDs have `ad_set_id == campaign_id` in `campaigns_daily.google` (`22542818628 / 22542818628`, `23590447604 / 23590447604`). These might be CAMPAIGN IDs stored in the wrong column by Phase B's status fetcher. Google's `WHERE ad_group.id IN (...)` then returns nothing.

The latest deploy includes a fallback BROAD query: when filtered returns 0, fire `SELECT ... FROM ad_group WHERE segments.date BETWEEN ... AND metrics.cost_micros > 0 LIMIT 20`. The `[gh-diag] BROAD ...` log should show the REAL ad_group IDs Google has spend for. Check after next tick.

**To verify after next tick:**
```bash
vercel logs --no-follow --since 15m --limit 300 --expand 2>&1 | grep "gh-diag.*BROAD" | head -3
```

If broad query returns real IDs that DON'T match adset_registry / campaigns_daily.google, the bug is in `fetchGoogleStatusForStore` writing wrong values into `ad_set_id`. Fix would be in that fetcher.

### 3. Final dashboard verification

Once both TikTok + Google produce fresh campaigns_daily rows:

```bash
# Compare campaigns_daily SUM vs data_daily for each store/platform
mv .env .env.cli-blocked && supabase db query --linked --output table "
SELECT cd.store_id, cd.platform,
  ROUND(SUM(cd.spend_cad)::numeric, 2) AS campaigns_sum,
  CASE cd.platform
    WHEN 'meta'   THEN ROUND(dd.fb_spend_cad::numeric, 2)
    WHEN 'google' THEN ROUND(dd.ga_spend_cad::numeric, 2)
    WHEN 'tiktok' THEN ROUND(dd.tt_spend_cad::numeric, 2)
  END AS data_daily_val,
  to_char(MAX(cd.last_live_tick_at) AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI:SS') AS cd_last_tick
FROM campaigns_daily cd
  JOIN data_daily dd ON dd.date = cd.date AND dd.store_id = cd.store_id
WHERE cd.date = '2026-05-30' AND cd.platform IN ('meta','google','tiktok')
GROUP BY cd.store_id, cd.platform, dd.fb_spend_cad, dd.ga_spend_cad, dd.tt_spend_cad
ORDER BY cd.store_id, cd.platform;" 2>&1 | tail -15; mv .env.cli-blocked .env
```

`campaigns_sum` should equal `data_daily_val` for every row (atomic via the agg RPC).

### 4. Remove diagnostic console.logs

Two files have `[gh-diag]` / `[tt-diag]` `console.log` calls deployed for debugging:
- `dashboard-web/src/lib/fetchers/googleHotMetrics.ts` — 2 console.log + 1 broad-query fallback
- `dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts` — 1 console.log

After Google is verified working, remove them. Single commit, single push, no functional change.

### 5. UI/UX overhaul (paused, ready to resume)

Comprehensive audit + plan saved:
- **Audit doc:** [docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md](docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md) (committed `4d523a9`) — 662 lines, covers all 11 of user's concerns (page overload, monthly tables UX, contrast, Home tab "always selected" bug root cause, Live gradient softening, RTL/bidi, unified graphical language, platform colors, store colors, button consistency, light+dark mode parity).
- **Implementation plan:** [docs/superpowers/plans/2026-05-30-ui-ux-design-system-overhaul.md](docs/superpowers/plans/2026-05-30-ui-ux-design-system-overhaul.md) — 28 tasks, single mega-PR.

**Scoping decisions captured 2026-05-30 evening (don't re-ask):**
- Store color canonical = chart palette (cyan / hot-pink / lime). Migrate format.ts to use the tokens.
- /operator restructure IN scope (4 sub-tabs: Sync / Health / Activity / Danger).
- Analysis tab split IN scope (Trends + Archive sub-tabs with own date pickers).
- Phasing = single mega-PR.
- Storybook setup OUT of scope.

**To resume the UI/UX work**, the user should say so explicitly. The next session would invoke `superpowers:executing-plans` (or `subagent-driven-development`) against the plan file. Branch name: `ui-ux/design-system-overhaul-2026-05-30`.

---

## Key memory notes (for the next agent)

- The project's `.env` uses dotted keys (`supabase.url = ...`, `supabase.service.role.key = ...`) which BREAKS the Supabase CLI's parser. Every CLI command must be sandwiched between `mv .env .env.cli-blocked` and `mv .env.cli-blocked .env`. This applies to `supabase db query`, `supabase db push`, etc.
- The Supabase CLI is logged in as `dor77777-3732` and linked to project `npegxufdupooqovrewyb` (script-roas, Central EU Frankfurt).
- Vercel CLI is logged in as `dor77777-3732`. Production deploys take 2-3 min. The orchestrator cron is `*/10 * * * *` — fires at every 10-min boundary (`*:00, *:10, *:20`).
- The TikTok ad account is shared (uzoshop's). Campaigns are routed to stores via per-ad pixel selection. The Phase A.5 v2 `campaign-store-map` (stored in `dashboard_state` table) is the source of truth for routing.
- Only `uzoshop` has its own Google Ads account. usmile360 + zolplus's `googleWorker` returns early at `checkGoogleConfigured` (correct behavior).
- All 3 stores have their own Meta ad account.

---

## Verification commands cheat sheet

**Latest 5 min of inngest worker activity:**
```bash
vercel logs --no-follow --since 5m --limit 200 --expand 2>&1 | grep -E "tt-diag|gh-diag|TikTok report|aggregateDataDaily|googleWorker|tiktokWorker|metaWorker" | head -30
```

**Errors in last 10 min:**
```bash
vercel logs --no-follow --since 10m --limit 100 --level error --expand 2>&1 | tail -20
```

**Force agg RPC for any date** (idempotent):
```bash
mv .env .env.cli-blocked && supabase db query --linked "SELECT public.agg_data_daily_for_date('2026-05-30'::date);" 2>&1 | tail -3; mv .env.cli-blocked .env
```

**Reload PostgREST schema cache** (after new RPC / function change):
```bash
mv .env .env.cli-blocked && supabase db query --linked "NOTIFY pgrst, 'reload schema';" 2>&1 | tail -3; mv .env.cli-blocked .env
```

**Hot-set IDs per platform per store:**
```bash
mv .env .env.cli-blocked && supabase db query --linked --output table "
SELECT 'campaign' AS entity,
  array_length(public.get_hot_campaign_ids('uzoshop', 'meta'), 1) AS uzoshop_meta,
  array_length(public.get_hot_campaign_ids('uzoshop', 'google'), 1) AS uzoshop_google,
  array_length(public.get_hot_campaign_ids('uzoshop', 'tiktok'), 1) AS uzoshop_tiktok;" 2>&1 | tail -10; mv .env.cli-blocked .env
```

---

## What we learned tonight (post-mortem)

Phase E1.6 (account-spend fetch moved from cron-live to workers) was a clean refactor on paper but had three latent issues that didn't surface until ~3 hours after deploy:

1. **Empty-hot-set early-exit** pre-empted the new write path → E1.6.1 fix
2. **store_name NOT NULL** silent failure on Day-3 partial-column UPSERT → E1.6.2 fix
3. **cron-live still wrote spend columns** from a stale priorSpend SELECT → race condition → E1.6.2 fix
4. **Meta lagged campaigns_daily** by ~$35 (account-level endpoint slower than per-campaign) → motivated Phase E1.7 single-source-of-truth refactor
5. **TikTok hot_metrics** had three latent Phase C bugs (silent envelope, filter_value type, missing campaign_id dimension) masked by cron-live-heavy until Phase E1 disabled it at 17:40 IL — surfaced when E1.6 made TikTok stop appearing on dashboard
6. **Google hot_metrics** has a TZ + (suspected) wrong-IDs issue still under investigation

The unified `agg_data_daily_for_date` RPC + the principle of **`campaigns_daily` as single source of truth** is the cleanest architecture we've had. Future pipelines should write per-campaign data and rely on the RPC for aggregation.

The UI/UX overhaul was untouched after the initial audit + plan (about 30% of the way through one evening's plan). The plan is intact and ready to execute when the pipeline is verified clean.
