# First-Touch UTM Passthrough → Maximal Per-Campaign Attribution Certainty (design)

**Date:** 2026-06-08
**Status:** approved (design) — proceed to writing-plans
**Owner intent:** "הכי עמוק ועשיר שיש אבל שלא יפגע ב-CAPI שיש לי בחנויות" — maximize per-campaign / per-ad-set / per-ad attribution certainty across ALL stores, strictly reporting-only (never fire a pixel/CAPI event).

---

## 1. Problem (measured, not assumed)

Per-campaign first-party attribution is **already built and wired** (`lib/attributionAnalysis.ts`: `orderMatchesCampaign`, `analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd`, `analyzeFirstClick`, `computeCoverage`, `AttributionTrust`). It matches Shopify orders to a campaign/ad-set/ad via UTM ids and emits a 0–100 confidence (`trust`) + `coverage` ratio. The Campaign drawer, Ads drawer, and `AttributionAnalysisPanel` consume it.

The operator's ads ARE tagged. The gap is **capture-side**: the order writer reads UTM from Shopify's `landing_site` ([`fetchers/shopify.ts:892`](../../dashboard-web/src/lib/fetchers/shopify.ts)), which is **only the converting session's entry URL**. Measured over 30 days (2026-05-09..06-08), meta-paid = 685 orders:

| store | meta-paid | last-touch `utm_id` | first-touch `first_utm_id` | note |
|---|---|---|---|---|
| uzoshop (themed) | 582 | 327 (56%) | 69 | multi-session journeys drop the UTM |
| zolplus (themed) | 76 | 30 (39%) | 6 | same |
| usmile360 (headless/Lovable) | 27 | **0** | **0** | Shopify never sees the ad URL — only `referrer: 360usmile.com` |

301/328 null-`utm_id` meta-paid orders still carry `fbclid` → they ARE Meta clicks; the UTM just didn't survive to `landing_site`. Platform-level $ is correct (fbclid/gclid classification); **campaign-level** coverage is the lossy part.

**Root cause of the recoverable loss:** the generated storefront snippet captures the entry UTM into `localStorage._ft_attr` and POSTs it to the cart beacon (`/api/events/cart` → `store_events`), but it **never writes the `_ft_*` cart attributes onto the Shopify cart**, so they never reach the order's `note_attributes`. The order writer is ALREADY ready to read them ([`classifyOrderSource.ts:223-245`](../../dashboard-web/src/lib/attribution/classifyOrderSource.ts) folds `note_attributes` → `params`, normalizes `_ft_*` → `ft_*`, and populates `first_utm_id/campaign/term/content/...`). The missing link is purely the storefront write.

`analyzeFirstClick` and `analyzeAttributionForAd` exist but are **NOT wired** (`useCampaignAttribution.ts` notes them as DEFERRED).

---

## 2. Goal & success criteria

Recover the first-touch campaign/ad-set/ad ids that last-click `landing_site` drops, across all 3 stores, and feed them into the existing analyzers as a fallback — raising per-campaign coverage/trust — **without changing platform-level $ and without any pixel/CAPI event.**

Success criteria:
- usmile360 (headless) meta-paid `first_utm_id` coverage goes **0% → materially > 0** after the Lovable snippet is deployed (target: comparable to the themed stores).
- uzoshop/zolplus per-campaign **combined** coverage (last OR first utm_id) rises above the last-click-only baseline (389/685 → higher as first-touch fills gaps).
- Campaign drawer shows a single, de-duplicated KPI set, and the `trust`/`coverage` score reflects the combined (last+first) signal.
- A CI guard proves the generated snippets contain **no** `fbq`/`gtag`/`ttq`/`analytics.track`/CAPI calls.
- The live 3 stores' existing platform-level numbers are byte-identical (zero-regression).

---

## 3. Architecture — 3 layers + a UI de-dup, CAPI-safe by construction

### Layer 1 — First-touch → Shopify cart attributes (no new Shopify scope)
The storefront must persist the first-visit UTM/click-ids as Shopify **cart attributes** named `_ft_*` so they flow into the order's `note_attributes`. The canonical keys (matching `classifyOrderSource`'s `ft_*` lookups, with the Shopify-private single leading underscore):

```
_ft_utm_source, _ft_utm_medium, _ft_utm_campaign, _ft_utm_content,
_ft_utm_id, _ft_utm_term, _ft_fbclid, _ft_gclid, _ft_ttclid, _ft_set_at
```

Value source: parse `localStorage._ft_attr` (the persisted entry query string) into its params; `_ft_set_at` = the ISO timestamp first captured. Best-effort, never throws, never blocks checkout.

**1a. Themed stores (uzoshop, zolplus) — THEME snippet (NOT the Web Pixel).**
A Shopify Custom Pixel runs sandboxed and CANNOT set cart attributes. The `_ft_*` write must be a small theme JS snippet that calls the Cart AJAX API:
```js
fetch('/cart/update.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ attributes: { '_ft_utm_id': ..., '_ft_utm_campaign': ..., ... } })
})
```
Idempotent: only writes when `_ft_attr` exists AND the cart doesn't already carry `_ft_set_at` (don't overwrite an earlier first-touch). Fires once per session on first add-to-cart / page load. NO pixel/track calls.

**1b. Headless store (usmile360 / Lovable) — Storefront API cart attributes.**
Lovable owns the cart/checkout. It must set the same `_ft_*` attributes via the Storefront API `cartAttributesUpdate` (or `cartCreate` with `attributes`) at checkout, sourced from its own `localStorage._ft_attr` (the headless client snippet already captures it). Operator deploys this in Lovable.

**1c. Generator + docs:** extend `lib/storeSnippets.ts` to EMIT the new theme snippet (themed) and the Lovable cart-attribute snippet (headless) so NEW self-serve stores inherit them. Update `docs/storefront-snippets/first-touch-attribution.md` (the source of truth the generator copies verbatim) to add the cart-attribute section.

### Layer 2 — Analyzers use first-touch as a fallback
Per campaign/ad-set/ad, attribute an order by **last-click utm when present, else first-touch utm** (`first_utm_id` / `first_utm_campaign` / `first_utm_term` / `first_utm_content`). Last-click stays authoritative when it exists; first-touch only fills coverage gaps. Concretely:
- `orderMatchesCampaign`: add a first-touch fallback tier (after the last-click tiers) — match when `first_utm_id === campaignId` (or `first_utm_campaign === campaignName`).
- `analyzeAttribution` / `analyzeAttributionForAdSet` / `analyzeAttributionForAd`: accept the first-touch fields and apply the fallback; **wire `analyzeAttributionForAd`** (currently deferred) so ad-level shows up where `utm_content`/`first_utm_content` exist.
- `useCampaignAttribution.ts`: feed first-touch fields through; surface ad-level.
- The `trust`/`coverage`/`deterministicOrders` automatically reflect the larger matched set.

Guardrail: when last-click matches campaign A and first-touch matches campaign B, **last-click wins** (no double counting). Fallback applies ONLY when last-click yields no campaign id at all for that order.

### Layer 3 — Shopify `customerJourneySummary` (GraphQL) — the richest lever, PHASE 2, flagged
Read Shopify's own `Order.customerJourneySummary` (firstVisit/lastVisit UTM + moments) via Admin GraphQL — richer than the REST `landing_site` string; recovers UTM even when neither `landing_site` nor cart attributes carried it.
**Dependency:** Shopify gates `customerJourneySummary` behind **Protected Customer Data** approval (an operator/app-review step, analogous to the prior `read_customers` blocker). Therefore Layer 3 ships behind a feature flag and a capability check; Layers 1+2 do NOT wait on it. If the scope/approval isn't granted, Layer 3 stays dark and Layers 1+2 still deliver the bulk of the win.

### Layer 4 (UI cleanup) — de-duplicate the drawer KPI cards
`CampaignDrawerOverview.tsx` renders ROAS and ערך-המרות **twice** (scorecard rows 219/225 + KPI grid rows 257/264, identical values). Remove the duplicates from the KPI grid; the KPI grid becomes operational-only (`הוצאה · המרות · CTR · CPC · CPA`), the scorecard keeps the 4 headline glances (`ROAS · ערך המרות · אמינות attribution · ציון בריאות`). Every metric appears exactly once. No info loss.

---

## 4. Guardrails (non-negotiable, enforced by tests)

- **CAPI-safe:** a unit/lint guard scans every generated snippet (themed theme snippet, headless Lovable snippet, the `storeSnippets.ts` templates, and `docs/storefront-snippets/first-touch-attribution.md`) and FAILS if it finds `fbq(`, `gtag(`, `ttq(`, `analytics.track`, `dataLayer.push`, or any `/capi`/pixel event call. The snippets may ONLY touch `localStorage` + `/cart/update.js` attributes + the existing cart beacon POST.
- **Zero-regression on platform $:** the source classification (fbclid/gclid/ttclid → `*-paid`) is untouched. First-touch only ADDS `first_utm_*` population and fills campaign-level coverage gaps. A test asserts that adding first-touch fallback never CHANGES an order's `source` and never reassigns an order already matched by last-click.
- **New-store parity:** the generator-emitted snippet is asserted to contain the `_ft_*` cart-attribute write (so a future store isn't silently shipped without it). Mirrors the existing `storeSnippets.test.ts` pattern.
- **Idempotency:** the theme snippet writes `_ft_*` only once (guarded by `_ft_set_at`), proven by test.

---

## 5. Testing strategy

- **Pure analyzer tests** (node): `orderMatchesCampaign` first-touch fallback (last-present → first ignored; last-absent + first-present → matched via first; conflict → last wins). `analyzeAttributionForAd` wired + matches `utm_content`/`first_utm_content`. Coverage/trust reflect the larger set.
- **Writer tests** (node): an order whose `note_attributes` carry `_ft_utm_id`/`_ft_utm_campaign` populates `first_utm_id`/`first_utm_campaign` (already covered by `firstClickColumnsDualWrite.test.ts` — extend if needed).
- **Snippet tests** (node): the generator emits the `_ft_*` cart-attribute write for themed + the Storefront-API attribute write for headless; the CAPI-safe guard (no pixel calls) passes; idempotency guard.
- **DOM test** (jsdom): `CampaignDrawerOverview` renders ROAS and ערך-המרות exactly once each.
- **No live-DB test in CI** (the reconcile harness stays optional); a manual post-deploy coverage re-probe (the queries in §1) confirms `first_utm_id` climbs, especially usmile360 0→>0.

---

## 6. Phasing

- **Phase 1 (ships first, no Shopify scope):** Layer 1 (themed + headless snippets + generator + docs) · Layer 2 (analyzer first-touch fallback + wire ad-level) · Layer 4 (de-dup) · all guards.
- **Phase 2 (IN SCOPE per operator 2026-06-08; flag-gated, self-detecting):** Layer 3 (`customerJourneySummary` GraphQL reader + gap-fill merge). Built now, ships **flag-off** (`ENABLE_SHOPIFY_CUSTOMER_JOURNEY`) and auto-detects ACCESS_DENIED → no-op until the operator grants Shopify **Protected Customer Data** approval per custom app. `firstVisit.landingPage` carries `utm_id` (Shopify's `UTMParameters` lacks id) so the campaign id is parsed from the landing URL.
- Operator deploy (after Phase 1 build): paste the theme snippet into uzoshop + zolplus themes; add the Lovable cart-attribute write to usmile360. Exact, store-by-store instructions provided at hand-off.

---

## 7. Out of scope (explicit)
- Any pixel/CAPI event emission (hard constraint — the operator runs server-side CAPI in all stores).
- fbclid→campaign resolution via the Meta Ads/Conversions API (that's the attribution-depth/CAPI path the operator deliberately skips).
- Changing the dashboard's last-click primary model (first-touch is a FALLBACK + a lens, not a replacement).
- Multi-touch / fractional attribution.
