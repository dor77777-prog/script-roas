# ROAS Dashboard — MASTER plan (code findings + strategic improvements, unified)

**Date:** 2026-06-02
**What this is:** the single, ordered, complete plan. It merges the **evidence-based codebase map** (`specs/2026-06-02-dashboard-codebase-map.md`) and the **stress-tested improvement plan** (`plans/2026-06-02-dashboard-improvement-plan.md`) into one sequence, ordered by **leverage ÷ risk ÷ dependency**.

**Health baseline (from the map):** 138 implemented · 6 partial · **0 missing-major · 0 P0/P1 bugs** · 8 dead helpers · a handful of MED/LOW fixes. The codebase is healthy — so the plan is *additive + cleanup*, not rescue.

## Locked principles (apply to every phase)
- **ONE source of truth (MER), ONE added lens (first-click).** Per-platform ROAS demoted to "directional", never deleted. No model-zoo selector.
- **READ-ONLY toward ad platforms — absolute.** Never send events to pixels/CAPI; the 3 stores' CAPI apps + `event_id` dedup are untouched. New paths write ONLY to our Supabase or into Shopify cart attributes (read back from `note_attributes`).
- **Locked ROAS bands** `<2x` red / `2–2.7x` orange / `3x` green target — never recolor/re-anchor. **VAT=0** → no tax work. No separate break-even/CM metric.
- **New-vs-returning** from `MIN(order_created_at) PARTITION BY (store_id, customer_id)`, never `orders_count`.
- **First-touch keys namespaced `ft_*`**; dual-write to BOTH cron maps + the reader SELECT in the same commit.
- New UI built to the **2026-06-01 readability standard** from the start.
- **PRESERVE THE MAPPING (locked, non-negotiable):** the existing **campaign (any ad platform) ↔ store ↔ product** mapping must not be broken. This includes the **TikTok shared-account** case: one TikTok advertiser, default-tagged `uzoshop`, but **any campaign can be remapped to any store**. Every per-store number (spend, ROAS, NC-ROAS, first-click) MUST consume the **mapping-aware aggregates** — `data_daily` built from `campaigns_daily` via `agg_data_daily_for_date` + `lib/campaignStoreMap.ts` / `lib/inngest/campaignStoreMap.ts` — **never raw platform-account totals** (a TikTok campaign mapped to `zolplus` credits `zolplus`, not `uzoshop`). Product attribution flows through `productCentricView.ts` / `campaignProductMap` / `multiMappingCohort.ts`. **Regression guard:** the existing mapping suites (`campaignStoreMap*.test`, `tiktokFetcherStoreMapping.test`, `backfill/tiktokMapping.test`, `productCentricViewSumConservation.test`, `cannibalizationDetection.test`, `campaignProductMap.test`) must stay green through every phase — they are the hermetic proof the mapping is preserved.

---

## PHASE 0 — Housekeeping (effort S · zero-risk · do first)
Pure cleanup; no behavior change; clears noise before the real work and de-risks P1/P2.
| Task | Files | Note |
|---|---|---|
| Delete 8 dead helpers | `format.ts:126,132,180,194,220` (5 fmt*), `costs.ts:40` (EMAIL_COST), `utils.ts:44` (formatPct) | confirmed zero importers |
| Remove unused `safeDecode`+TODO (verify-first) | `utils.ts:74,53` | used only by its own test; prod uses `shopify.ts:810` |
| Consolidate 4 inline fetchers → shared helper | `AiReportButton.tsx:19`, `SyncIndicator.tsx:27`, `CommandPalette.tsx:67`, `InsightsBoard.tsx:44` | add `fetchJsonOrNull` to `lib/fetchJson.ts`; preserves their null-on-error semantics |
| **Dual-write key-set guard (vitest)** + reader SELECT-string test | `cronDaily.ts:1419`, `cronLive.ts:682`, `postgresReaders.ts:1051` | **prerequisite for P1/P2** — catches column drift before it bites |
**CAPI:** none touched. **TDD:** deletions guarded by full suite; guard tasks are themselves tests.

## PHASE 1 — Correctness & operator-unblock fixes (effort S–M · high trust value)
The map's real fixes — none are P0/P1 bugs, but they protect trust and unblock you.
| Task | Sev | Files | Why |
|---|---|---|---|
| **Fix hardcoded "25% COGS / 6.5% fees" prose** → read actual per-store rates | MED | `PnLBreakdown.tsx:27,224`, `aiReport.ts:1311` | COGS is now editable (UM 2.17.0) — static prose can misstate the real rate and undermine the P&L narrative |
| **Unblock TikTok manual-override** (validator + UI) | MED | `operatorManualOverrides.ts:19,59` + operator UI | DB + pipeline already accept `tiktok`; today you can't correct TikTok spend when the account errors |
| **Sync MonthlyTables store dropdown** to global filter | MED | `MonthlyTables.tsx:22-67` | Archive can show a different store than the global filter → confusion |
| **Leader/Risk badge guard** — no trophy on a <2x "leader" | LOW | `multiMappingCohort.ts:387` | misleading trophy on a money-losing cohort |
| Mobile tooltip clipping (portal/Floating-UI) | LOW | `CampaignsTable.tsx:~2533` | UX-only; optional |
| Logout UI button · operator store display-names | LOW | `/api/logout` exists; `STORE_ID_TO_NAME` exists | tiny gaps found by the map |
**CAPI:** none touched (all read/display or operator-DB writes). **TDD:** each fix gets a failing test first.
**Mapping preservation:** the leader/risk-badge fix is **display-only** in `multiMappingCohort.ts:387` — it must NOT alter cohort membership or the campaign↔product↔store mapping math (keep `cannibalizationDetection.test` + `cohortComparison*` green). The TikTok manual-override unblock must route through the **same mapping-aware merge** as the agg (a TikTok override for store X applies to X's mapped campaigns), never the raw shared account (keep `tiktokFetcherStoreMapping.test` + `campaignStoreMap*.test` green).

## PHASE 2 — Framing wins  *(= strategic P0)*  (effort M · copy-only · reversible)
Pre-empts "which number is right?" with framing, not math.
- **Relabel hero ROAS → "MER"** (+ tooltip). Value unchanged (`analytics.ts:175`); bands untouched. `CommandCenterHero.tsx:765,736`.
- **Demote per-platform ROAS → "מכוון בלבד"**; promote the deterministic "ROAS Shopify" columns. `CampaignsTable.tsx:1907-1942`, `AdsDrawer.tsx:512-516`.
- **Align P&L vocabulary** ad-spend note `ROAS→MER` — *fold in with the Phase-1 prose fix*. `PnLBreakdown.tsx:258`.
- **Honest "Direct/unknown" bucket + ONE coverage %** from existing `orders_attribution` fields; per-store chip (usmile expected-divergent); tooltip names legit causes. Channels+unknown=100%, never redistributed. `home/adapters.ts:102,305`, `Dashboard.tsx:299-314`. *(v1 = bucket + single %; defer the tri-band + 7-cause taxonomy.)*
- **Caveat:** framing only — can't reduce the ~15-30% unattributable floor; coverage here = LAST-click.
**CAPI:** UI/copy + pure read. Zero network.

## PHASE 3 — New-vs-returning → NC-ROAS / nCAC  *(= strategic P1)*  (effort L · pure Shopify · CAPI-safe)
The highest-leverage NEW metric: flips scale/cut/hold (4x blended but <1.5x NC-ROAS = retargeting your base, not acquiring). Needs Phase-0 dual-write guard.
1. Fetch `customer`+`created_at` on the **attribution** fetch only (`shopify.ts:1019` allowlist; **NOT** `:404`). 
2. Additive migration: `customer_id, order_created_at, is_first_order` (nullable) + index `(store_id,customer_id)`.
3. Write `customer_id`+`order_created_at` in BOTH cron maps (`cronDaily.ts:1419`, `cronLive.ts:682`).
4. Idempotent RPC `recompute_first_order_flags` = `MIN(order_created_at) PARTITION BY (store_id,customer_id)`, unfiltered full history; `NULL` customer → NULL.
5. Read back in `postgresReaders.ts:1051` SELECT + map + `OrderAttributionRow` type.
6. Surface — **home number budget:** MER = only $-headline; **NC-ROAS = subordinate ratio tile** (own band, muted, "different question" in Hebrew); **nCAC = hover/drawer**, not a hero tile. Never a 2nd $-revenue figure beside MER.
- **Caveats:** "first since boundary" (not first-ever) until a full history import; guest checkout → NULL (surfaced); NC denominator uses MER spend. **Per-store identity only — no cross-store stitching.**
**CAPI:** additive READ of Shopify Admin + DB-only writes. No pixel.
**Mapping preservation:** NC-ROAS denominator = per-store **mapping-aware** ad spend (`agg.spend` = `data_daily` built via `agg_data_daily_for_date` + `campaignStoreMap`), so a TikTok campaign remapped to `zolplus` already credits `zolplus` — NC-ROAS inherits the mapping for free. New-customer revenue is store-keyed in `orders_attribution`. **Do NOT** introduce a parallel raw-account spend path. Keep `campaignsAggregator.test` + `campaignStoreMap*.test` green.

## PHASE 4 — First-click lens  *(= strategic P2)* — **GATED**, effort XL
**Gate:** do NOT start until Phases 2+3 soak AND you confirm new-customer numbers reconcile. The only piece with store-side JS outside the repo + no CI + an undocumented cart→order SLA.
- **In-repo first (CI-covered):** extend `classifyOrderAttribution` to read `ft_*` keys (trimmed chain, no `source_name`/`referring_site`); additive `first_*` columns; dual-write; reader. `shopify.ts:818-943`, `attributionAnalysis.ts` sibling matcher.
- **Store-side capture last (fragile):**
  - **Themed (uzoshop, zolplus):** Custom Pixel + theme-JS → first-party cookie write-once → `/cart/update.js {_ft_*}` on add-to-cart. Zero `fbq/gtag/ttq`.
  - **Headless usmile (Lovable):** **prefer the proven `/api/events/cart` beacon pattern** (POST first-touch keyed by cart-id/checkout-token, JOIN at read time) over cart-attribute passthrough — sidesteps the cart→order SLA.
- **Surface:** first-click value side-by-side with last-click; headline the **delta** (progressive disclosure, ~60-70% prominence). Separate first-click coverage chip.
- **Caveats (surface in UI):** **first-click is Google-BLIND** (matcher excludes Google — `attributionAnalysis.ts:264`); coverage ≤ last-click (a directional floor); ITP 24h / ad-blockers / express-checkout; usmile is most fragile — trust only after the data-layer `note_attributes` check.
**CAPI:** snippets contain zero ad-platform SDKs; only first-party writes. Run the CAPI checklist + Events-Manager check before trusting numbers.
**Mapping preservation:** the first-click sibling matcher resolves order→campaign (via `ft_utm_id`/`ft_utm_content`) and then **credits the store through the existing `campaignStoreMap`** (incl. TikTok per-campaign overrides) — never the platform-default store. It reuses the same campaign↔store↔product resolution as last-click; no parallel mapping. Keep `campaignStoreMap*.test`, `tiktokFetcherStoreMapping.test`, `productCentricViewSumConservation.test` green. (First-click stays Google-blind by the existing matcher rule — a mapping limitation, surfaced in the tooltip.)

---

## CAPI-safety checklist (gate for any capture work — Phase 4)
Zero `fbq/_fbq/gtag/ttq/snaptr` in snippets · only outbound = Shopify `/cart/update.js` or our `/api/events/*` · no server-side conversion sender · first-click read-only via `note_attributes` · our idempotency keys never echo CAPI `event_id` · NC-ROAS pure-Shopify · post-install: NO new events in Meta/Google/TikTok Events Managers · data-layer verify `_ft_*` keys · existing CAPI/`theme.liquid` untouched.

## Top risks → mitigations
Dual-write drift → key-set vitest (Phase 0) · `orders_count` trap → `MIN(created_at)` RPC unfiltered · `ft_*` collision/overwrite → namespacing + write-once · headless timing → beacon arch / set-before-checkout + verify · accidental outbound event → grep guard + Events-Manager check · two-revenue-basis distrust → MER stays only $-headline, NC-ROAS as a ratio.

## Out of scope (forever / not now)
Outbound Sonar/CAPI/EC/Events-API · multi-touch model zoo · cross-store identity graph · NL chat · post-purchase survey · WhatsApp break-even flag · recolor 2x/3x bands · tax-out-of-revenue · re-touch COGS/freshness · customer fields on the revenue/refund fetcher · one-time full customer-history import (unless asked) · guest→account email unification · new usmile upper-funnel pixel.

## Recommended sequence & sizing
1. **Phase 0** (S, ~½ day) — safe cleanup, can ship anytime.
2. **Phase 1** (S–M, ~1-2 days) — trust fixes + TikTok unblock.
3. **Phase 2 / P0** (M, ~1-2 days) — MER framing + honest coverage. *(Phase 1 prose fix folds in.)*
4. **Phase 3 / P1** (L, ~3-5 days) — NC-ROAS, the real new capability.
5. **Phase 4 / P2** (XL, gated) — first-click, only after 2+3 soak.

Phases 0-3 are all **CAPI-safe by construction** and reuse existing data/infra. Phase 4 is the only one needing store-side work + a gate.
