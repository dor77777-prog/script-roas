# Triple-Whale-tier gap analysis — ROAS dashboard

**Date:** 2026-06-02
**Method:** 14-agent research workflow — 6 live web-research agents (Triple Whale + Northbeam/Polar/Lifetimely/Peel/Daasity + attribution methodology) × 6 codebase-audit agents (evidence-based, file:line) → gap analysis → adversarial "what to skip" critique.
**Context:** Internal tool, **single operator**, 3 Shopify stores (uzoshop/zolplus/usmile360), Hebrew RTL, CAD-normalized. Data = platform-reported (Meta/Google/TikTok APIs) + Shopify orders/refunds + a Custom-Pixel add-to-cart beacon + sale/refund webhooks. **No** Triple-Pixel-style first-party identity graph.

---

## TL;DR

The gap to Triple Whale is **almost entirely attribution depth** (Triple Pixel + multi-touch model zoo + Sonar/CAPI) — and that is precisely the part this operator should **NOT** build: it's XL effort, needs a proprietary pixel, leaves a 15-30% Direct bucket anyway, and produces the *contradictory conclusions* the operator explicitly fears.

The dashboard is already strong on fundamentals (full P&L, deterministic order-level attribution via click-IDs/UTMs, per-creative "true" ROAS, real-time activity, freshness tracking). The **one real unlock** is per-order **new-vs-returning customer** classification (pure Shopify, no pixel) — it gates 5 metrics at once (NC-ROAS, nCAC, repeat-rate, LTV, cohorts). Everything else worth doing is small framing/labeling work on data that already exists.

**The 5 numbers that drive ~90% of daily budget decisions here:**
1. **Blended MER** (Shopify net revenue ÷ total ad spend, business + per-store) — the "are we profitable today" authority.
2. **Contribution margin % / break-even ROAS per store** (= 1 ÷ CM%) — the concrete go/no-go line.
3. **NC-ROAS / aMER** (new-customer revenue ÷ spend) — judge prospecting on real acquisition, not repeat-flattered blended numbers.
4. **Total + per-platform ad spend, vs-yesterday delta (+ CPM pacing)** — catch runaway/stalled spend intraday.
5. **Per-store True Net Profit (CAD)** — the cash-at-end-of-day confirmation.

---

## What the dashboard ALREADY has (audit, evidence-based)

**Strong / present:**
- Blended ROAS = MER-equivalent (just not labeled MER); per-platform ROAS in drill-downs.
- Full P&L cascade: revenue (actual) − ad spend (actual, 3 platforms, CAD) − COGS (editable %, estimate) − tx fees (flat 6.5% estimate) − fixed costs (actual) → True Net Profit. Refunds netted at source. Internally well-audited.
- **Deterministic order-level attribution** (own, first-party-ish): last-non-direct-click via Shopify `landing_site`; UTM (all 6) + click-ID presence (fbclid/gclid/ttclid) captured per order; ID-level matching via `utm_content={{ad.id}}`.
- **Reconciliation** between platform-claimed and deterministic (coverage %, modeled residual, 95% ROAS CI, multi-window) — analytically the richest part.
- **Per-creative "true" ROAS** chip (Meta+TikTok) with trust score in AdsDrawer.
- CPM (most complete metric: blended + per-store-per-platform + per-campaign), CPA/CAC, CTR, CPC (campaign-level), AOV (per-store), orders, ad spend.
- Real-time: Shopify webhooks (sale/refund) + add-to-cart beacon → `store_events` → live Activity feed (12s) + paginated Activity tab. Batch: ~10-min crons for platform spend. `data_freshness` staleness tracker. Central `cacheConfig`.

**Absent (the real gaps):**
- New-vs-returning customer classification, customer_id in stored data → therefore **no NC-ROAS, no LTV, no customer cohorts, no repeat-rate**. (Shopify fetch uses a field allowlist that omits customer fields — deliberate.)
- Contribution margin as a named metric; break-even ROAS line.
- Tax backed out of revenue (Shopify `total_price` is tax-inclusive → revenue/net/CM/break-even all slightly **overstated** for taxed CAD orders).
- Cross-channel/multi-touch path attribution; first-click-vs-last-click creative view; assisted/first-touch contribution. (One last-click source per order; no journey.)
- Cross-platform side-by-side creative; cross-ad-set ad roll-up; Google excluded at ad level (PMax exposes no ad rows).

---

## Gap table (20 capabilities) — verdicts after adversarial review

### BUILD NOW (quick wins — mostly labeling/framing on existing data)
| Capability | State | Effort | Note |
|---|---|---|---|
| **Label blended ROAS as MER**, demote per-platform ROAS to "directional" | have | S | Pure label/altitude change (`analytics.ts:175` already computes it). Kills "summing double-counted platform revenue". |
| **Back tax out of revenue** (`total_tax` → fetch allowlist) | missing | S | Corrects the denominator under MER/CM/break-even. Bundle in same fetch-layer PR as customer_id. |
| **Contribution margin % + per-store break-even ROAS** (= 1/CM%), recolor ROAS bands against the margin floor | partial | S | Every input exists; CM3 = operatingProfit − txFees relabeled. **Do NOT** build a new variable-cost editor. Highest decision-value-per-effort. |
| **Post-purchase "How did you hear about us?" survey** → `survey_channel` via existing `note_attributes` parser | missing | M | Zero new pipeline; only Shopify checkout config. Recovers the Direct/unattributed bucket no pixel can see. Do early so responses accrue. |
| **customer_id + first-order flag** (derive first-order from `min(created_at)` per customer, NOT point-in-time `orders_count`) | missing | M | The ONE unlock for NC-ROAS/nCAC/repeat/LTV/cohorts. |
| **NC-ROAS / aMER + business nCAC** on top of the flag | missing | S | Trivial aggregation once the flag lands. |
| **Break-even flag in existing WhatsApp digest** ("store Z below break-even today") | partial | S | A flag, not a recommendation engine — reuses `cronWhatsapp.ts`. |
| **Cross-ad-set ad roll-up in AdsDrawer** (keep as drill-down, not Tier-1) | have→S | S | Judge a creative on aggregate across ad sets. Google stays excluded (PMax). |

### BUILD LATER (gate behind a concrete need)
- **LTV + 30/60/90 cohort curves + CAC payback** (L) — strategic monthly lens the daily loop never reads. Build *only if* the operator is holding back budget they can't justify; otherwise use a rule-of-thumb allowable-CAC multiplier.

### SKIP (impressive, wrong investment here — directly answers "too many algorithms")
- **Triple Pixel / first-party identity graph** (XL) — every daily-decision metric is API-derivable without it.
- **Multi-touch / configurable first/last/linear/position model zoo** (XL) — *the literal source of "too many conflicting conclusions"*; a free pause/holdout test proves causation better than any model.
- **First-touch-vs-last-click per creative** via Shopify `CustomerJourneySummary` (L) — fragile, produces contradictory conclusions; NC-ROAS-per-creative + the survey recover ~80% of the decision for far less.
- **Sonar / CAPI server-side enrichment** (L) — an ad-platform *optimization* feature, not a reporting tool's job.
- **Willy/Moby NL chat over the warehouse** (L) — a conclusion-generator + wrong-SQL risk; operator already has Claude for ad-hoc questions.
- **Product affinity / FBT merchandising analytics; full Klaviyo/Postscript integration; repeat-rate as its own scheduled metric** — fail the "would this change today's ad budget?" test (MER already captures owned-channel revenue in total).

---

## Recommended roadmap (ordered, highest leverage first)

1. **[S]** Relabel blended ratio as **MER**; demote per-platform/campaign ROAS to a "directional — in-platform optimization only" badge.
2. **[S]** Add `total_tax` to both Shopify fetch allowlists; back tax out of revenue. (Same PR as #5.)
3. **[S]** Surface **CM% + per-store break-even ROAS** on the existing P&L; recolor ROAS bands against the margin floor. No new editor.
4. **[M]** Ship the **1-question post-purchase survey** on all 3 checkouts → `survey_channel`.
5. **[M]** Add **customer_id** + first-order flag (derive yourself from `min(created_at)`).
6. **[S]** Compute **NC-ROAS/aMER + nCAC** on the flag.
7. **[S]** Add a **break-even flag** to the WhatsApp digest.
8. **[S]** Add the **cross-ad-set ad roll-up** to AdsDrawer (drill-down only).
9. **[L]** *Only if needed:* LTV + cohorts + CAC payback.

Steps 1-3 are ~1 day total and deliver most of the daily-decision value. Steps 4-6 are the one genuine "feature" build (new-customer economics). 7-8 are cheap polish. 9 is gated.

---

## Sources (selected)
MER/break-even/NC-ROAS: triplewhale readme (mer / nc-roas / blended-roas), northbeam MER, shopify MER blog, thehqdigital break-even, upcounting NC-ROAS, visionlabs nCAC. Attribution methodology & critique: triplewhale total-impact + pixel KB + clicks-and-deterministic-views, logarithmic "measurement paralysis crisis", sagum "attribution paradox", searchengineland incrementality, ruleranalytics conversion duplication, polaranalytics "why your ROAS is wrong", layerfive shopify-limitations. New-vs-returning from Shopify: elevar, littledata. Survey: fairing HDYHAU, triplewhale PPS KB. CM: sarasanalytics, conjura, attnagency. Competitors: northbeam.io, polaranalytics.com, useamp.com, peelinsights.com, daasity.com. KPI-overload/simplicity: nfkdigital, intrafocus "focus on less", codyplof "attribution for 7-figure and below". Shopify journey API: shopify.dev CustomerJourneySummary/CustomerVisit.
(Full URL list in workflow output.)
