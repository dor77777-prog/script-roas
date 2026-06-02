# ROAS Dashboard improvements — approved design (brainstorming output)

**Date:** 2026-06-02
**Status:** APPROVED by operator (pending spec review). Produced via the superpowers brainstorming flow on top of 3 research workflows (37 agents).
**Companion docs:** current-state map `specs/2026-06-02-dashboard-codebase-map.md` · strategy `specs/2026-06-02-triple-whale-gap-analysis.md` · earlier MASTER plan `plans/2026-06-02-dashboard-MASTER-plan.md` (superseded by this design where they differ — this doc reflects the operator's locked decisions).
**Visual reference (operator-APPROVED 2026-06-02):** `docs/superpowers/mockups/2026-06-02-dashboard-additions/mockup.html` — the faithful light+dark mockup of all changed surfaces. The visual "mockup → approval → UI code" gate is SATISFIED for the surfaces shown there; UI tasks in Plans A/B/C must match it.

## Goal
Make the dashboard's numbers more trustworthy and add the few metrics that actually flip daily budget decisions — **without** breaking what works, without sending anything to ad platforms, and without "too many contradictory conclusions."

## Locked constraints (non-negotiable)
- **READ-ONLY toward ad platforms.** Active CAPI apps in all 3 stores; never send/write events to pixels/CAPI; never touch their `event_id` dedup. New paths write only to our Supabase or into Shopify cart attributes (read back from `note_attributes`).
- **Per-store Home cards + ROAS-band gradients = UNTOUCHED** (structure + data + gradient). Operator-loved; locked.
- **ROAS bands locked:** `<2x` red / `2–2.7x` orange / `3x` green target — never recolor/re-anchor; no separate break-even/CM metric. **VAT = 0** (no tax work).
- **Preserve the campaign↔store↔product mapping**, incl. the **TikTok shared-account** per-campaign override (default `uzoshop`, remappable). Every per-store number consumes the mapping-aware aggregates (`data_daily` via `agg_data_daily_for_date` + `campaignStoreMap`), never raw account totals. Regression-guarded by the existing mapping test suites.
- **Privacy:** store only Shopify `customer_id` (opaque numeric) — never name/email/phone. The webhook's `maskCustomerLabel` masking stays.
- **One source of truth (MER), at most one added lens (first-click).** No model-zoo selector.

## Scope — 4 areas, 5 phases

### Phase 0 — Housekeeping (S, zero-risk)
Delete 8 confirmed-dead helpers (`format.ts` ×5, `costs.ts:40` EMAIL_COST, `utils.ts:44` formatPct, `utils.ts:74` safeDecode). Add the dual-write key-set vitest guard + reader SELECT-string test (prerequisite for P3/P4). No behavior change.

### Phase 1 — Correctness & operator-unblock fixes (S–M)
- **TikTok manual-override**: unblock the client validator + UI (`operatorManualOverrides.ts:19,59`); route through the **mapping-aware** merge (override for store X → X's mapped campaigns), never the raw shared account.
- **Hardcoded "25% COGS / 6.5%" prose → actual per-store rates** (`PnLBreakdown.tsx:27,224`, `aiReport.ts:1311`).
- Leader/Risk badge guard (display-only, no mapping-math change, `multiMappingCohort.ts:387`); mobile tooltip portal; logout button.
- ~~MonthlyTables store-dropdown sync~~ — **DROPPED** per operator: the in-Archive store dropdown is independent of the global filter **by design** and works well; not a bug.

### Phase 2 — Framing / trust (M, copy-only, reversible)
- **Label hero ROAS → "MER"** (`CommandCenterHero.tsx:765` + tooltip). Value/band/gradient unchanged.
- **Demote per-platform ROAS → "directional / מכוון"** (`CampaignsTable.tsx:1907-1942`, AdsDrawer); promote the deterministic "ROAS Shopify" columns.
- **Honest coverage % chip** from existing `orders_attribution` fields, **on the hero only** (NOT per-store cards), **quiet — visually prominent only when bad (>30% unknown)**. Channels + unknown = 100%, never redistributed. Tooltip names legit causes (express checkout, headless drafts, untagged, privacy-stripped). v1 = bucket + single coverage %; defer tri-band taxonomy.

### Phase 3 — New-vs-returning → NC-ROAS / nCAC (L, pure-Shopify, CAPI-safe)
- **Definition: first-order-EVER** (accurate from day one).
- **Forward path (no extra API calls):** add `customer` + `created_at` to the **attribution** fetch's field allowlist (`shopify.ts:1019`) — same orders already fetched daily, +1 field. (NOT the revenue/refund allowlist `:404`.)
- **Historical backfill (40k+ orders, "no 40k calls"):** one-time **Shopify Bulk Operations** job (new minimal GraphQL helper — none exists today) exporting `{order.id, createdAt, customer.id}` per store → compute `MIN(createdAt)` per `(store_id, customer_id)` → set `is_first_order`. *(Fallback if we'd rather not build GraphQL infra: a one-time rate-limited REST script — slower; default = Bulk Operations.)*
- **Storage:** additive migration `customer_id, order_created_at, is_first_order` on `orders_attribution` (nullable) + index `(store_id, customer_id)`; write `customer_id`+`order_created_at` in BOTH cron maps (`cronDaily:1419`, `cronLive:682`); idempotent RPC `recompute_first_order_flags` over **full per-store history**; read back in `postgresReaders:1051`.
- **Surface:** NC-ROAS = new-customer revenue ÷ MER spend (mapping-aware); nCAC = MER spend ÷ new-customer orders. **In the hero (subordinate tile, its OWN band, "different question" label) + in the existing StoreDetailModal on click. Per-store cards themselves UNTOUCHED.**
- Guest checkout → `customer NULL` → unclassifiable, surfaced as a data-quality share (never silently "returning"). Per-store identity only — no cross-store stitching.

### Phase 4 — First-click lens (XL) — GATED, after Phases 0–3 soak
- **In-repo first (CI-covered, safe):** extend `classifyOrderAttribution` to read `ft_*` keys (already arrive via `note_attributes`; trimmed chain, no `source_name`/`referring_site`) + `first_*` columns + dual-write + reader.
- **Store-side capture last (fragile, outside-repo):** **uzoshop+zolplus** (theme-JS Custom Pixel → first-party cookie write-once → `/cart/update.js {_ft_*}`) FIRST; **usmile (Lovable headless) LAST** via the proven `/api/events/cart` beacon pattern (keyed by cart/checkout token, JOIN at read time) to sidestep the cart→order SLA.
- **Surface:** first-click value side-by-side with last-click in CampaignsTable/AdsDrawer; **headline the delta** (progressive disclosure, ~60-70% prominence vs MER). Separate first-click coverage chip.
- **Surfaced caveats:** Google-blind (matcher excludes Google); coverage ≤ last-click (a directional floor); ITP/ad-blocker/cross-device gaps; usmile most fragile — trust only after the data-layer `_ft_*` check.

## Preserved / deleted / irrelevant
- **Preserved (unchanged):** per-store cards + gradients, ROAS bands, the full mapping (incl. TikTok shared account), MER math, COGS/freshness work, all existing tabs/cards (no info loss).
- **Deleted:** the 8 dead helpers (Phase 0) — the entire deletion list. Everything else is additive.
- **Made irrelevant by the new work:** nothing — the codebase is healthy; no existing feature is superseded (per-platform ROAS is demoted, not removed).

## CAPI-safety gate (Phase 4 capture)
Zero `fbq/gtag/ttq/_fbq/snaptr` in snippets · only outbound = Shopify `/cart/update.js` or our `/api/events/*` · no server-side conversion sender · post-install: NO new events in Meta/Google/TikTok Events Managers · data-layer verify `_ft_*`.

## Risks → mitigations
Dual-write drift → Phase-0 key-set guard · `orders_count` trap → `MIN(created_at)` RPC, never orders_count · `ft_*` key collision/overwrite → namespacing + write-once · headless timing → beacon arch + data-layer verify · accidental outbound event → grep guard + Events-Manager check · two-revenue-basis distrust → MER stays the only $-headline, NC-ROAS as a ratio.

## Out of scope (forever / not now)
Outbound Sonar/CAPI/EC/Events-API · multi-touch model zoo · cross-store identity graph · NL chat · post-purchase survey · WhatsApp break-even flag · recolor 2x/3x bands · tax-out-of-revenue · touching per-store cards/gradients · email-based guest→account unification · new usmile upper-funnel pixel.

## Build discipline (every phase)
TDD red→green; new UI to the 2026-06-01 readability standard; the mapping test suites (`campaignStoreMap*`, `tiktokFetcherStoreMapping`, `productCentricViewSumConservation`, `cannibalizationDetection`, `campaignProductMap`, `campaignsAggregator`) must stay green as the hermetic mapping-preservation proof.
