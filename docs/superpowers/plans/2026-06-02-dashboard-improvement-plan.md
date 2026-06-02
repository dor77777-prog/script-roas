# ROAS Dashboard — improvement plan (stress-tested)

**Date:** 2026-06-02
**Method:** 14-agent research workflow (7 web + 5 codebase → architect plan → adversarial skeptic). Skeptic verdict was **revise-first**; this doc is the **revised** plan with every critique change folded in.
**Companion docs:** current-state map → `docs/superpowers/specs/2026-06-02-dashboard-codebase-map.md`; strategy → `docs/superpowers/specs/2026-06-02-triple-whale-gap-analysis.md`.

## Guiding principles (locked)
1. **ONE source of truth, ONE added lens.** MER (blended revenue ÷ spend) is the authoritative business number; deterministic **last-click** (already shipped) is the campaign lens; **first-click** is the single permitted *additional* lens. No first/last/linear/position selector, ever. Per-platform ROAS is **demoted to "directional"**, not deleted.
2. **READ-ONLY toward ad platforms is absolute.** Every new path writes ONLY to our Supabase or into Shopify cart attributes (read back from `order.note_attributes`). Zero `fbq/gtag/ttq/snaptr/_fbq`; zero outbound Meta CAPI / Google Enhanced Conversions / TikTok Events API. The 3 stores' existing CAPI apps + their `event_id` dedup are never touched.
3. **Honor the locked ROAS bands.** `<2x` red, `2x–2.7x` orange, `3x` green = target — business-wide AND per-store. NC-ROAS gets its **own, subordinate** band (a *different question*, not 3x); coverage % is an *additive* transparency signal that never recolors the existing bands. No separate break-even/contribution-margin metric; **VAT = 0** (no tax-out-of-revenue).
4. **Correctness for new-vs-returning:** derive first-order from `MIN(order_created_at) PARTITION BY (store_id, customer_id)`, **never** `customer.orders_count` (point-in-time, mislabels backfill). Idempotent recompute over FULL history; `NULL customer_id` stays NULL (surfaced, never silently "returning").
5. **First-touch keys MUST be namespaced `ft_*`** (cart attr `_ft_*`) so they never collide with last-click keys (the parser folds `note_attributes` only when the key is absent — a bare `fbclid` first-touch key would be silently clobbered).
6. **Dual-write discipline:** `orders_attribution` is upserted in BOTH `cronDaily.ts` and `cronLive.ts` (separate map literals). Every new column goes into BOTH in the same commit + the `postgresReaders` SELECT string, or rows silently diverge / columns are persisted-but-invisible.
7. **Honesty about coverage.** First-click coverage ≤ last-click coverage (cookie cleared / ITP-capped / cross-device-lost). The "Direct/unknown" bucket is a literal residual (channels + unknown = 100%), never redistributed.
8. **Build new UI to the locked 2026-06-01 readability standard from the start** (`<Money>`/`<Metric>`, on-band/scrim tokens, light+dark, passes the hermetic guards).

## Ship gate (per skeptic) — split into committed vs gated
- **COMMITTED:** **P0** (copy-only framing) + **P1** (pure-Shopify NC-ROAS). Most of the decision value at near-zero risk; fully CAPI-safe by construction.
- **GATED FOLLOW-UP:** **P2** (first-click) does NOT start until P0+P1 have soaked AND the operator confirms the new-customer numbers reconcile. P2 is the only piece with store-side JS outside this repo, no CI coverage, and a dependency on an undocumented Shopify cart→order passthrough SLA.

---

## P0 — Framing wins (effort M, copy-only, reversible, zero migration)
**Goal:** pre-empt "which number is right?" with framing, not new math.
- **Relabel hero ROAS → "MER"** (eyebrow + tooltip "MER = total revenue ÷ total ad spend, reconciles to Shopify revenue"). Value unchanged (`analytics.ts:175`). Bands untouched. — `CommandCenterHero.tsx:765` (label), `:736` (tooltip).
- **Demote per-platform ROAS to "מכוון בלבד" (directional)** sub-label + de-emphasis; promote the existing deterministic "ROAS Shopify" columns as primary. — `CampaignsTable.tsx:1907-1942`, `AdsDrawer.tsx:512-516`.
- **Align P&L vocabulary** ad-spend line note `ROAS → MER`. — `PnLBreakdown.tsx:258`.
- **Honest "Direct/unknown" bucket + single coverage %** from EXISTING `orders_attribution` fields (`source∈{'',direct}` & no click-id/UTM → unknown; coverage% = orders with any click-id/UTM ÷ total). Small chip beside MER (hero + per-store), tooltip naming the legit causes (typed/bookmark, dark social, untagged, privacy-stripped, express-checkout, **expected headless draft/subscription on usmile**). Channels + unknown = 100%, never redistributed. — `home/adapters.ts:102,305`, tally in `Dashboard.tsx:299-314`, render via `<Metric>`.
  - **Per-store chip is essential:** usmile360 (headless) is *expected* to diverge (express/draft orders) — per-store visibility distinguishes expected-headless from broken-tagging.
  - **Right-sized (per skeptic):** v1 = honest bucket + ONE coverage %. Defer the 3-stage 20/30 health band + 7-cause taxonomy to v2 once real numbers are seen.
- **Caveats:** P0 is framing/transparency only — it cannot reduce the real ~15-30% unattributable floor (ITP/ad-blockers/cross-device). Coverage here = LAST-click coverage (label it; first-click coverage arrives in P2).
- **CAPI safety:** UI/copy + a pure read of already-ingested rows. Zero network, zero platform call.

## P1 — New-vs-returning → NC-ROAS / nCAC (effort L, pure Shopify, CAPI-safe by construction)
**Goal:** the highest-leverage NEW metric — flips a scale/cut/hold call (e.g. 4x blended but <1.5x NC-ROAS = you're retargeting your base, not acquiring).
1. **Fetch `customer` + `created_at`** on the **attribution** fetch only (append to allowlist `shopify.ts:1019-1021`; add to `ShopifyOrderPayload` `:793-808`, `ShopifyOrderRow` `:209-225`, push loop `:1053-1077`, docstring `:78-83`). **Do NOT touch the revenue/refund allowlist at `:404`** (load-bearing refund algo). `customer.id` exists for all 3 stores incl. headless usmile (Shopify is its checkout). **Per-store identity only — no cross-store stitching.**
2. **Additive migration** (`repo-root/supabase/migrations/`, numbered after `20260601120000`): `ALTER TABLE orders_attribution ADD COLUMN IF NOT EXISTS customer_id TEXT, order_created_at TIMESTAMPTZ, is_first_order BOOLEAN` (nullable, no default) + index `(store_id, customer_id)`.
3. **Write `customer_id` + `order_created_at` in BOTH** upsert maps (`cronDaily.ts:1419-1435` + `cronLive.ts:682-698`); do NOT set `is_first_order` in the writer.
4. **Idempotent RPC `recompute_first_order_flags(p_store_id)`** = `is_first_order = (order_created_at = MIN(...) OVER (PARTITION BY store_id, customer_id))` with deterministic `order_id` tiebreak; `NULL` where `customer_id IS NULL`. Run **UNFILTERED over full per-store history** (not the run window). Call at end of `runDailyForStore` + `cronLive` persist.
5. **Read back:** add the 3 columns to `postgresReaders.ts:1051-1054` SELECT + map `:1074-1094` + `OrderAttributionRow` type (`ordersAttribution.ts:31-57`). (Silent-failure seam.)
6. **Compute + surface:** NC-ROAS = new-customer revenue ÷ MER spend; nCAC = MER spend ÷ new-customer order count. **Home number budget (per skeptic):**
   - MER stays the **only dollar-revenue headline**.
   - **NC-ROAS = subordinate ratio tile** (smaller, muted, its OWN band — NOT the hero gradient), labeled in Hebrew as a *different question* ("האם אנחנו רוכשים ברווח?").
   - **nCAC = hover/expand or per-store drawer**, not a top-line hero tile.
   - Never place NC revenue (`total_price` basis) as a second $-figure beside MER revenue (`data_daily` basis).
- **Caveats:** `is_first_order` = "first since the history boundary" — a customer whose true first order predates it is mislabeled new for early weeks (a one-time full customer-history import is the only fix; out of scope unless requested). Guest checkout → `customer NULL` → unclassifiable, surfaced as a data-quality share. NC-ROAS denominator uses **MER spend** (not per-platform) to avoid model ambiguity.
- **CAPI safety:** pure additive READ of the Shopify Admin object we already request + DB-only writes. No pixel, no platform event.

## P2 — First-click lens (effort XL) — GATED FOLLOW-UP, do not start until P0+P1 soak
**Goal:** the single permitted FIRST-click lens, shown SIDE-BY-SIDE with last-click; headline the **delta** (first-click ≫ last-click = undervalued top-of-funnel). Progressive disclosure, ~60-70% prominence vs MER.
- **Order-side parsing (in-repo, safe):** extend `classifyOrderAttribution` to read `ft_*` keys from the same params bag, over a **trimmed source chain (ft_* only — NO `source_name`/`referring_site`)**. New fields `first_touch_source`, `first_{fbclid,gclid,ttclid}_present`, `first_utm_*`, `first_seen_at`. Reuse the `OrderSource` union (keeps `orderSourceContract.test.ts` green). — `shopify.ts:818-943,209-225,1060-1076`.
- **Persist (in-repo):** additive migration for the `first_*` columns (nullable; pre-migration rows = "no first-click signal", NOT "direct"); write in BOTH upsert maps; add to reader SELECT + map + type.
- **Capture — store-side, OUTSIDE this repo (the fragile part):**
  - **Themed (uzoshop, zolplus):** Shopify **Custom Pixel** + small **theme-JS** (top-frame; the sandboxed pixel can't read storefront cookies). On landing: parse click-ids/UTM → first-party cookie **write-once-if-absent** (~400d). On **add-to-cart** (not only checkout — beats ITP 24h cap + express-checkout UTM drop): `POST /cart/update.js {attributes:{_ft_*}}` **only if absent**. Single leading underscore (hidden at checkout, still on order). **Zero `fbq/gtag/ttq`.**
  - **Headless usmile (Lovable):** capture in the Lovable frontend (cross-domain cookie is dead at the Shopify checkout). **Preferred architecture (per skeptic): reuse the proven `/api/events/cart` beacon pattern** — POST first-touch to a first-party endpoint keyed by cart-id/checkout-token, JOIN to the order at read time. This **sidesteps the undocumented cart→order passthrough SLA**. (Cart-attribute passthrough via `cartCreate`/`cartAttributesUpdate` is the *themed-store* mechanism; if used for headless, attributes MUST be set BEFORE checkout opens + re-query-guard, or ~100% lost.)
- **Surface:** sibling first-click analyzer parallel to `orderMatchesCampaign` (`attributionAnalysis.ts:246,309,834`) matching `firstUtmId/firstUtmCampaign` (campaign) + `firstUtmContent===adId` (ad) — **no model-toggle param**. Second value beside the last-click "ROAS Shopify" in `CampaignsTable.tsx:1921-1990` + `AdsDrawer.tsx:585-623`; headline = delta annotation on hover. Separate first-click coverage % chip.
- **Caveats (must surface in UI):**
  - **First-click is Google-BLIND:** the matcher excludes Google (`attributionAnalysis.ts:264`, PMax UTM unreliable). Low Google first-click coverage is a *known matcher limit*, not a broken snippet — say so in the tooltip.
  - First-click coverage **strictly ≤** last-click; present as a directional **floor** (strong signal trustworthy; weak signal ambiguous, not proof of zero).
  - Safari ITP 24h JS-cookie cap; ad-blockers ~15-30%; express-checkout may skip cart attributes (line-item-property fallback only if coverage proves low — **do not build both up front**). usmile is the most fragile path — trust its first-click numbers only after the data-layer `note_attributes` check passes.
- **CAPI safety:** snippets contain ZERO ad-platform SDKs; only outbound is Shopify's own `/cart/update.js` (themed) / Storefront mutation or our `/api/events/*` beacon (headless) — first-party data writes, never conversion events.

---

## CAPI-safety checklist (run before trusting any new capture)
- [ ] Capture snippets contain ZERO `fbq/_fbq/gtag/ttq/snaptr` — grep the snippet text before install.
- [ ] Only outbound from capture code = Shopify `/cart/update.js` (themed) or Storefront cart mutation / our `/api/events/*` (headless). No Meta CAPI `/events`, Google EC, TikTok Events API anywhere.
- [ ] No server-side outbound conversion sender added; all new server code writes ONLY to our Supabase.
- [ ] First-click flows in via `note_attributes` (data we already fetch); parsed read-only.
- [ ] Our idempotency keys never echo the stores' CAPI `event_id`/checkout-token outward.
- [ ] NC-ROAS/nCAC derived purely from Shopify customer + `created_at`.
- [ ] **Post-install:** open Meta/Google/TikTok Events Managers per store → confirm NO new events appear.
- [ ] **Data-layer verify** (Pixel Helper fails on headless): query orders' `note_attributes` for populated `_ft_*` keys → compute coverage.
- [ ] Existing CAPI apps, `event_id` dedup, `theme.liquid`, CAPI settings NOT modified.

## Top risks → mitigations
- **Dual-write drift** → add every column to BOTH maps same commit; vitest asserting both upsert builders emit the SAME key set + reader SELECT-string test. (Right-sized: no shared-constant refactor.)
- **`orders_count` trap** → never read it; `MIN(created_at)` RPC, unfiltered.
- **`ft_*` key collision / first-touch overwrite** → namespacing + write-once-if-absent (cookie + attribute) + test that a 2nd landing doesn't overwrite.
- **Headless timing** → set before checkout + re-query guard + data-layer verify (or use the beacon arch).
- **Accidental outbound event** → hard rule + comment + grep guard + Events-Manager check.
- **Operator distrust (two revenue bases)** → keep MER the only $-headline; NC-ROAS as a ratio, never a second $-revenue figure.

## Out of scope (forever / not now)
Outbound Sonar/CAPI/EC/Events-API · multi-touch model zoo · cross-store identity graph · NL chat · post-purchase survey · WhatsApp break-even flag · recolor/re-anchor the 2x/3x bands · tax-out-of-revenue (VAT=0) · re-touch COGS/freshness (already shipped) · customer fields on the revenue/refund fetcher · extend `agg_data_daily_for_date` for first-click · one-time full customer-history import (unless requested) · email-based guest→account unification · new usmile upper-funnel pixel (Customer Events unsupported on non-Hydrogen headless).

## Recommended sequence
1. **P0** (≈1-2 days, copy-only) → ship.
2. **P1** (≈3-5 days, pure-Shopify) → ship, soak, confirm new-customer numbers reconcile.
3. **P2** (gated) → only after P0+P1 soak; build order-side parsing + persistence in-repo first (CI-covered), then the store-side capture (themed first, headless usmile last via the beacon arch), gated behind the data-layer coverage check.
