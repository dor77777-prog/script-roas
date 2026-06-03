# ROAS Dashboard → Triple-Whale Tier — Deep Research & Roadmap (2026-06-03)

> Verified against `HEAD 65c9680` (`65c9680 docs(pnl): correct stale header comment`). All `file:line` refs below are live in `dashboard-web/` at this commit unless marked otherwise. Locked operator constraints (CAPI read-only · VAT=0 · fixed 2x/2.7x/3x ROAS bands · single-user internal tool · no info loss) are respected by every recommendation.

---

## 1. Executive summary

This dashboard is **already at or above Triple-Whale's pixel-free tier** for a single 3-store DTC operator, and it is *more honest* than TW on the dimension operators distrust most: every number traces to a deterministic Shopify order, with an explicit unknown bucket and no black-box attribution model. Shipped and verified: MER labeling, NC-ROAS/nCAC (`newCustomerMetrics.ts`), an **honest attribution-coverage chip** (`adapters.ts:502` — the earlier "always 100%" bug is **fixed**, `'direct'`/`''` now correctly excluded), robust z-score anomaly detection (`insights.ts:217 detectAnomalies`), month-end forecast (`insights.ts:495 forecastMonthEnd`), a 3x/day WhatsApp digest (`sendDailySummary.ts`), editable per-store/per-month COGS% **and** salaries%, real-time activity feed, freshness desaturation, the premium glass+mesh redesign, Health Score, cohort/cannibalization (campaign-mapping), attribution-analysis, product-centric view, and Meta↔Shopify revenue reconciliation.

So the roadmap is **not** "add TW's headline features." It is three things: (a) ship the **one customer-economics layer NC-ROAS unlocks but does not deliver** — retention cohorts + LTV + CAC-payback; (b) fix **one systemic accuracy defect** — adjacent metrics silently sit on two revenue bases (net `data_daily` vs gross `orders_attribution`); (c) **leverage push over pull** by wiring the already-built anomaly engine into the already-built WhatsApp channel.

**Sequencing changed materially since the planning docs:** the `read_customers` scope blocker is **RESOLVED** (operator added it to all 3 apps 2026-06-02). The `customer_first_order` ledger is now populated in prod (**41,146 rows**; `orders_attribution.is_first_order` = 996 TRUE / 236 FALSE / **0 NULL**) and is auto-maintained by `recompute_first_order_flags` in `cronDaily.ts:1685`. This **unblocks the entire cohort/LTV layer today** and **downgrades** the NC-ROAS coverage-gate urgency (there is no large unclassified bucket in current prod). The cheapest competitive edge remains "numbers that always tie out" — out-trusting TW, not out-featuring it.

**Deliberately out of scope:** pixel/Sonar/CAPI sending (double-counts the operator's live server-side CAPI apps), multi-touch model zoo, NL chat, creative competitive intel, network-effect benchmarks (a 3-store tool can't replicate them), re-anchoring the locked ROAS bands, or a separate break-even/contribution-margin headline.

---

## 2. What "Triple-Whale tier" means for a solo 3-store operator

The KPIs that actually drive a **scale / hold / cut** decision for one operator with real cash across three stores — and where each lands here:

| KPI | The decision it drives | Status here |
|---|---|---|
| **MER** (blended ad spend ÷ total revenue) | "Is the whole business efficient today?" — the one $-revenue headline | ✅ shipped, labeled, headline |
| **NC-ROAS / nCAC** (new-customer rev ÷ spend; spend ÷ new orders) | "Is *acquisition* efficient, stripped of repeat halo?" | ✅ shipped, correctly demoted (`StoreDetailModal.tsx:321 bandStrength="muted"`, "שאלה אחרת") |
| **Retention cohorts + LTV** | "Do customers come back; is each cohort improving — does acquisition pay for itself over time?" | ❌ **the gap** — no customer cohort or LTV exists |
| **LTV:nCAC + CAC-payback (months)** | "How fast does spend recycle (working capital) and what's total return?" | ❌ not composed |
| **Net profit / P&L** | "After COGS, fees, salaries, fixed — am I actually making money?" | ✅ shipped (trueNetProfit), editable COGS%/salaries% |
| **Month-pacing vs goal + forecast** | "Will I hit the number?" | ✅ shipped (`forecastMonthEnd`, GoalTracker) |
| **Anomaly / push alerts** | "Tell me when something breaks so I don't have to stare at it" | ⚠️ engine exists in-app; **not pushed** to the channel the operator lives in |
| **New-vs-returning revenue mix / AOV** | "Is a high MER real growth or just repeat halo?" | ⚠️ flag exists; AOV split not surfaced |

Everything TW layers *above* this list (pixel multi-touch, creative library, benchmarks, NL chat) is either out-of-scope by constraint or low-leverage for one operator. The tier-defining gap is the **customer-economics** row.

---

## 3. Where we stand today (honest inventory)

| Capability | State | Evidence |
|---|---|---|
| MER labeling + headline | ✅ shipped | hero is the sole $-revenue headline |
| NC-ROAS / nCAC | ✅ shipped, demoted | `newCustomerMetrics.ts`; `StoreDetailModal.tsx:321,334,346` |
| First-order ledger + backfill | ✅ shipped + **seeded in prod** | `customer_first_order` (41,146 rows), `recompute_first_order_flags` `cronDaily.ts:1685`, `scripts/backfillFirstOrderLedger.ts` |
| Attribution-coverage chip (honest unknown bucket) | ✅ shipped, **bug fixed** | `adapters.ts:502-520,544` — `'direct'`/`''` excluded; prominent only when unknown>30% |
| First-click lens / click-id attribution | ✅ shipped (max possible depth) | `attributionAnalysis.ts` |
| Anomaly detection (robust z-score MAD) | ✅ shipped, **in-app only** | `insights.ts:217,105` |
| Month-end forecast + pacing | ✅ shipped | `insights.ts:495,719` |
| WhatsApp daily digest (3x/day) | ✅ shipped, **5-param fixed template** | `sendDailySummary.ts`, `templateParams.ts:1-62` |
| Editable COGS% (per-store/per-month) | ✅ shipped | `cogsSettings.ts:29 effectiveCogsPct` |
| Editable salaries% | ✅ shipped | `salarySettings.ts` |
| Cross-device state sync (incl. cogs-settings) | ✅ shipped, **parity bug fixed** | `dashboardStateKeys.ts:41` (added 2026-06-02 w/ parity comment) |
| Meta↔Shopify revenue reconciliation | ✅ shipped | reconcile harness `npm run audit:reconcile` |
| Health Score / cohort (campaign-mapping) / cannibalization | ✅ shipped | `multiMappingCohort.ts`, `cannibalizationDetection.ts` |
| Product-centric view | ✅ shipped, **no profit** | `productCentricView.ts` (campaign-mapping pivot) |
| **Customer retention cohort grid** | ❌ **net-new gap** | no LTV/payback/customer-cohort anywhere in `src` |
| **LTV / LTV:nCAC / CAC-payback** | ❌ net-new gap | not composed from existing nCAC + COGS |
| **Anomaly → WhatsApp push wiring** | ❌ partial (both halves ship, disconnected) | `detectAnomalies` never reaches `sendDailySummary` |
| Per-product contribution P&L | ⚠️ stubbed | ProductsTable "margin" = `netRevenue/revenue` (`ProductsTable.tsx:646`) — a discount/refund ratio, NOT COGS profit |
| Signed-row refund accounting (per-campaign) | ⚠️ **latent, not dead** | machinery live + tested (`attributionAnalysis.ts:164,146`); writer emits gross-only rows |
| Discount/promo-code leakage line | ❌ not captured | `shopifyRevenueRefunds.ts:304` "no total_discount visible in TS shape" |
| Refund-rate as watched trend/anomaly | ❌ per-day chip only | no refund-spike branch in `detectAnomalies` |

---

## 4. GAPS — what to ADD (buildable within constraints only)

| Capability | Why it matters | Data-feasibility | Effort | Leverage |
|---|---|---|---|---|
| **Customer retention cohort grid + cumulative margin-adjusted LTV** (first-order-month rows × months-since cols, cumulative toggle, 365-day default) | The single biggest remaining TW-tier gap. NC-ROAS = "is acquisition efficient *today*"; the cohort grid = "do customers come back and is each cohort improving" — the retention story that justifies acquisition spend. No customer cohort exists (`multiMappingCohort.ts` is a *campaign*-mapping cohort). | **Pure Shopify, no pixel.** Ledger now seeded (41,146 rows, 0 NULL). Group orders by customer first-order month; cell = cumulative contribution-margin via `effectiveCogsPct`. **Unblocked.** Label history boundary (rolling tables ~May-onward; full history via Bulk). | **L** | **High** |
| **LTV:nCAC ratio + CAC-payback period (months), margin-adjusted, per-cohort** | The working-capital levers for an operator with real cash: how fast spend recycles (payback) and total return (LTV:CAC). TW teaches 3:1 healthy / <6mo payback ideal. Dashboard has nCAC + COGS% but never composes them. | Pure Shopify + existing `effectiveCogsPct`. Falls out of the cohort grid with one composition step. Margin-weight LTV; compute per-cohort (a flat average masks bad cohorts). Recent cohorts are observation-censored — label maturity. | **M** | **High** |
| **Conditional anomaly push → WhatsApp** (fire `detectAnomalies` when a store drops a ROAS band or spend z-spikes) | TW's whole "push, don't pull" value is firing the *insight*, not the number. The z-score engine (`insights.ts:217`) and the channel (`cronWhatsapp.ts`) both ship but are **disconnected** — the anomalies never reach the operator who lives in WhatsApp. Highest convenience-per-effort win, 100% CAPI-safe. | No new data. Wire `detectAnomalies` output into a **separate conditional alert path via `cronWhatsapp`** (the standing digest is a fixed 5-param Meta template `templateParams.ts:59`). Reuse the existing 1/6h throttle. | **M** | **High** |
| **Refund-rate / return-rate as a watched trend + anomaly branch** | Refunds today are only a per-day chip + the gross/net formula; `detectAnomalies` has revenue/spend/ROAS branches but **no refund branch**. A refund-rate climb (defect/fulfillment/fraud) is exactly the "push the insight" signal — bundle into the WhatsApp wiring above. | Pure Shopify, near-zero infra. `data_daily` already carries `refund_deduction_cad` (`cronDaily.ts:996`). | **S** | **Medium** |
| **Discount / promo-code leakage P&L line + discount-rate watch** | An operator running discount codes has refunds netted out but **promo discounts are invisible** — `trueNetProfit` silently absorbs them. Real DTC money leak. (Flagged by completeness critic; missed by synthesis.) | Pure Shopify, CAPI-safe. **Requires a one-field fetcher add** — `total_discounts` is not captured today (`shopifyRevenueRefunds.ts:304`). One P&L line + a discount-rate trend. | **M** | **Medium** |
| **New-customer vs returning AOV split + new-customer-revenue %** | Returning AOV runs well above first-timers, so a blended-AOV move is often just mix-shift — and the locked AOV color bands ($>70 green/$<50 red) can mis-signal store health on mix alone. New-customer-rev% is the fragility check on a high MER (high MER + low NC-rev% = fragile growth propped by repeat). | Pure Shopify, drops out of the same `is_first_order` flag. Fold into the cohort layer (same data). | **S** | **Medium** |
| **Per-product contribution P&L (COGS-based) + product-level new-vs-returning** | ProductsTable "margin" is `netRevenue/revenue` (discount/refund ratio, `ProductsTable.tsx:646`); ProductCentricView has no profit. A true contribution view extends the load-bearing campaign↔store↔product mapping. | Pure Shopify + `effectiveCogsPct`, reuses `campaignProductMap`. **Caveat:** product COGS not calibrated per-SKU (global 25% default) → would be revenue × constant; **and** `total_discounts` not captured so SKU-level promo leakage can't net. Label when default applies. | **M** | **Low** |

---

## 5. ACCURACY fixes (P0/P1/P2)

| # | Issue | Fix | Severity | Refs |
|---|---|---|---|---|
| A1 | **Systemic revenue-basis mismatch.** `data_daily.revenue_cad` is **NET** of refunds (`revenue_cad = gross_revenue_cad − refund_deduction_cad`) and feeds MER/hero ROAS/per-store rev/AOV/P&L; `orders_attribution.total_cad` is **GROSS** immutable `total_price` and feeds NC-ROAS, coverage, the AI report's "revenue by source", and per-source AOV. Adjacent numbers silently disagree in any refund period; NC-ROAS sits beside net-basis MER on a gross numerator. | Pick ONE basis per metric pairing and **label it**. Compute the NC-ROAS numerator on the net basis of the MER beside it (or label NC-ROAS gross). Reconcile the AI-report headline (net) vs "revenue by source" total (gross) — annotate the delta as refunds. **Extend the existing `audit:reconcile` harness** with a two-anchor assertion (don't author a standalone test). | **P0** | `cronDaily.ts:951,994-996`; `shopify.ts:816,1184`; `aiReport.ts:638`; `newCustomerMetrics.ts:50` |
| A2 | **NC-ROAS/nCAC have no coverage gate** — `computeNewCustomerMetrics` returns a confident ratio regardless of `unclassifiableShare`; the tile band-colors it unconditionally. *Severity downgraded:* prod now has **0 NULL** is_first_order, and the share **is already surfaced** in UI (`StoreDetailModal.tsx:353`). So the real gap is a **degrade-to-low-confidence suppression state** above a coverage threshold, not a from-scratch warning. | Add a coverage-threshold suppression: when `unclassifiableShare` crosses a threshold, render a low-confidence state instead of a banded number (mirror the chip's "prominent only when >30%"). Mirror Shopify's First/Returning/N-A definition exactly. | **P1** (was P0; ledger seeded) | `newCustomerMetrics.ts:57-60`; `StoreDetailModal.tsx:321-353` |
| A3 | **Per-store AOV temporal/basis mismatch.** `aov = cur.revenue / orders` where `cur.revenue` is NET `data_daily` (refund lands on processed_at day) and `orders` is the GROSS `orders_attribution` count (creation day). On refund days these are temporally + definitionally misaligned and can **flip the locked AOV color band**. | Compute AOV with a consistent numerator+denominator (same source, same day-attribution). Keep the locked thresholds unchanged. Confirm the denominator is the Shopify order count, not Σ platform `conversions` (which can double-count across overlapping claims — `storeDetail.ts:54`). | **P1** | `storeDetail.ts:157` |
| A4 | **Per-campaign deterministic ROAS over-credits refunded campaigns** — `deterministicRevenue` is gross-only because the writer never emits negative/refund rows, so a heavily-refunded campaign still shows high ROAS/coverage/trust. | **Cheapest honest fix: label per-campaign deterministic ROAS "gross-of-refunds"** (one tooltip). Do **not** plumb refund rows (dedup/dual-write risk, not worth it for 3 stores). **This is the same decision as the "remove signed-row machinery" declutter item — resolve as ONE work item** (see §6, R3). | **P2** | `attributionAnalysis.ts:164,146`; `shopify.ts:1184` |
| A5 | **deltaPct near-zero baseline.** *Mostly already handled:* `analytics.ts:455` uses `Math.abs(prev)` + signed direction (negative/sign-cross OK); `fracDelta` (`storeDetail.ts:129`) returns null on `prev===0`. Residual gap is only **small-nonzero baselines** (e.g. prev=0.4 still divides by 0.4). | Narrow `|prev| < floor` suppression (show absolute delta). Fold into the §6 cleanup batch, don't track separately. | **P2** (narrower than first stated) | `analytics.ts:455`; `storeDetail.ts:129` |
| A6 | **Google numeric `utm_campaign === campaignId` match** OR's across `utm_id`/`utm_campaign` for the numeric Google id; a numeric collision could double-count an order into two platform deterministic buckets. | Require absence of a stronger Meta/TikTok signal before granting the Google numeric match. Add a cheap guard test: Σ(per-platform deterministic) ≤ real Shopify revenue. Verify reachability first (collisions are rare → insurance, not a live bug). | **P2** | `attributionAnalysis.ts:233,238,250-255` |
| A7 | **GoalTracker first-paint flash.** `monthRows` falls back to the store-FILTERED `data.rows` until business-wide `wideData` resolves, so global monthly pacing flashes one store's revenue vs the business-wide target ("23% → 78%") on the most decision-heavy panel (goal is business-wide per memory). | Render a loading state until `wideData` resolves; don't use the filtered fallback for a global metric. | **P2** | `GoalTracker.tsx:153-155` |
| A8 | **Silent TX-fee/salaries defaults.** COGS is now editable in-UI (`cogsSettings.ts`) so it's **not** silent — but `TRANSACTION_FEES_RATE = 0.065` (`costs.ts:37`, env-var) and salaries still default silently, so `trueNetProfit` can be confidently wrong with no surfaced signal. | Surface "default rate in use" vs a deliberate per-store value in PnLBreakdown — **scope to TX-fee/salaries only** (drop the COGS framing; it's editable now). Extend the existing AI-report rate disclosure for consistency. | **P2** | `costs.ts:37` |

*Dropped from earlier drafts:* the "always-100% coverage chip" bug (**fixed** at `adapters.ts:502`) and the "cogs-settings cross-device 400" bug (**fixed** at `dashboardStateKeys.ts:41`). Both were cited in memory but are no longer live.

---

## 6. DECLUTTER — remove / merge / demote (respecting no-info-loss)

| # | Item | Action | Why |
|---|---|---|---|
| R1 | **Home hero strip vs chart KPI strip** — Rev/ROAS/Spend/Profit/CPM rendered TWICE at two different ranges, producing two "profit" values (hero `trueNetProfit` vs chart `operatingProfitOf`, `storeDetail.ts:120,156`) that look inconsistent for the same period. | **Merge** | Make the chart strip the **click-to-expand period-comparison** of the hero tile (TW's most-copied scan pattern), not a parallel copy. Reorg, not deletion — every data point survives as tile / expansion / drill-down. **Mockup first** per operator UI rule; label STAYS/MOVES, never REMOVED. |
| R2 | **Profit naming overloaded** — one prop named `netProfit` means `trueNetProfit` on hero but `operatingProfit` on chart KPI + AI report. Values are individually correct; the shared label is a foot-gun. | **Rename** (pure correctness) | Rename to distinct fields (`trueNetProfit` vs `operatingProfit`) end-to-end. **Do this BEFORE/WITH R1** or the merged surface shows two same-labeled "profit" numbers in one place and looks like a bug. Low risk, high latent-bug value — ship independent of the layout change. |
| R3 | **Signed-row refund machinery in `attributionAnalysis`** (WR-03 clamps, signed-coverage, `det<0` guards). | **Keep — do NOT remove** | The synthesis's "remove dead code" is **wrong**: the machinery is **live + tested** (TEST-03 signed-revenue; `attributionAnalysis.ts:146,164,175`), only the *writer half* is dead (no negative rows emitted). Deleting it removes a tested refund-safety clamp and the only future path to refund-aware per-campaign ROAS. **Resolve via A4's label** ("gross-of-refunds") to kill the false comfort; leave or mark the code UNREACHABLE, don't delete. |
| R4 | **Campaign-drawer Overview** — 5 panels echo click-id ROAS twice and reconciliation twice. | **Merge** | Collapse to one Health accordion (the verdict) + one reconciliation panel + one deterministic-ROAS panel. No data lost — numbers still exist, just not echoed. |
| R5 | **NC-ROAS/nCAC hero prominence** | **Keep demoted (guardrail, no-op)** | Already a muted subordinate tile (`StoreDetailModal.tsx:321`, "שאלה אחרת"; nCAC drawer/hover only). **Do NOT promote to a co-equal headline** — especially while A1/A2 land. Listed as an explicit "do not do." MER stays the only $-revenue headline. |

---

## 7. UX / convenience wins

| Improvement | Rationale |
|---|---|
| **Click-a-tile-to-expand with inline previous-period comparison** | TW's single most-copied scan pattern. Keep one shared range governing Home (already present); make period-over-period a click reveal *on* the hero tile rather than a second chart strip. Collapses R1's duplication and fixes the two-"profit" inconsistency. |
| **Conditional anomaly + refund-spike push to WhatsApp** (= §4 item 3+4) | The one convenience win that changes *whether the operator opens the app*. Push the insight, not the snapshot. CAPI-safe (outbound template, not a pixel event). |
| **Annotate the ROAS-vs-target chart with "what changed when"** (spend changes, mapping changes) | Extends the existing annotation pins + Activity Feed — cause→effect investigation without a new surface. The operator reads a dip and immediately sees the action behind it. |
| **One Customer-Economics verdict, not 5 chips** | Surface one verdict ("acquisition healthy: LTV:nCAC 3.2:1, payback 4mo") with the cohort grid as drill-down — mirroring the deliberate "one verdict" Health Score choice. Quiet until it crosses a threshold (the chip already does this — prominent only when unknown>30%). |
| **Pinned-vitals row (optional) for the single operator** | Let the one user promote must-watch numbers to a top row, collapse the rest. *Lower-leverage than billed* — for a single-user tool the operator can curate the default hero; the click-to-expand pattern delivers most of the scan benefit with less state. Keep optional. |
| **Protect mobile speed as a differentiator** | TW's #1 review complaint is slow loads / freezing mobile. The 30%/30min stale-fade + live-tick already beats this; keep mobile genuinely fast (carousel + compact hero shipped), never a shrunk desktop. **Drop the PWA/installable-widget idea** — greenfield (no manifest/SW today) and risks caching numbers outside the URL-obscurity trust model. |

---

## 8. The prioritized roadmap (ranked by leverage ÷ effort)

Ranked spine, grouped into waves. Effort: S/M/L. Risk noted.

### Wave 1 — Trust & correctness (do first; cheap, high-trust)
| Rank | Item | Cat | Effort | Risk |
|---|---|---|---|---|
| 1 | **A1 gross-vs-net basis fix** + extend `audit:reconcile` with two-anchor assertion | fix | **M** | Must LABEL the chosen basis, never silently swap a headline. Ship with the guard test. |
| 2 | **R2 profit rename** (`trueNetProfit` vs `operatingProfit`) end-to-end | fix | **S** | Low; pure rename. Land before any Home merge. |
| 3 | **Cleanup batch:** A3 AOV basis · A5 deltaPct floor · A7 GoalTracker loading state · A8 default-rate badge (TX-fee/salaries) · A4 "gross-of-refunds" label (= R3 resolution) | fix | **S** | Low; pure reporting. Keep locked AOV/ROAS bands unchanged. |
| 4 | **A2 NC-ROAS coverage suppression state** | fix | **S** | Low (ledger seeded, share already shown). |

### Wave 2 — The customer-economics layer (the tier-defining add; now UNBLOCKED)
| Rank | Item | Cat | Effort | Risk |
|---|---|---|---|---|
| 5 | **Customer retention cohort grid + cumulative margin-adjusted LTV** | add | **L** | Label the history boundary (rolling ~May + Bulk history); margin-weight via `effectiveCogsPct`; define an FX-null policy for cohorts spanning an FX-failure day (preserve-prior, don't understate). |
| 6 | **LTV:nCAC + CAC-payback (months), per-cohort** — *sub-task of #5, same data* | add | **M** | Per-cohort not flat-average; label observation-censoring of recent cohorts. Compute NC-CAC separately from blended. NOT a break-even/CM headline (locked out). |
| 7 | **New-vs-returning AOV split + NC-revenue%** — fold into the cohort layer | add | **S** | Low; same `is_first_order` data. |

### Wave 3 — Push & polish (convenience that changes behavior)
| Rank | Item | Cat | Effort | Risk |
|---|---|---|---|---|
| 8 | **Conditional anomaly + refund-spike push to WhatsApp** (wire `detectAnomalies` → `cronWhatsapp`; add refund branch) | add | **M** | Standing digest is a fixed 5-param Meta template — use a separate conditional alert path, not the digest. Keep the 1/6h throttle to avoid fatigue. Do NOT push NC-ROAS until A1/A2 land. |
| 9 | **Home/drawer declutter** (R1 hero+chart merge with click-to-expand · R4 drawer Overview collapse) | simplify | **M** | No-info-loss: every number survives as tile/expansion/drill-down. **Mockup first**, ONE deploy (operator's no-drip-deploy rule). |
| 10 | **ROAS-chart "what changed when" annotations** | ux | **S** | Low; extends existing pins. |

### Wave 4 — Optional depth (lowest leverage; gate on calibration)
| Rank | Item | Cat | Effort | Risk |
|---|---|---|---|---|
| 11 | **Discount/promo-code leakage P&L line** | add | **M** | Needs a `total_discounts` fetcher add (`shopifyRevenueRefunds.ts:304`); real money-leak signal. |
| 12 | **Per-product contribution P&L + product new-vs-returning** | add | **M** | Product COGS not per-SKU calibrated (global 25%) → label heavily when default applies or it manufactures false precision. |
| 13 | **A6 Google numeric-match guard test** | fix | **S** | Insurance; verify reachability first. |

**The minimal high-conviction spine:** Wave 1 (trust) → Wave 2 (#5+#6: cohorts/LTV/payback) → Wave 3 #8 (push). Everything else is cheap cleanup or optional depth.

---

## 9. Explicitly OUT OF SCOPE (and why)

| Excluded | Why |
|---|---|
| **Pixel / Sonar-style multi-touch / server-side conversion sending** | The operator runs server-side CAPI apps in all 3 stores; sending events would double-count and break dedup. First-click via Shopify cart-attributes/note_attributes (shipped) is the MAX attribution depth possible. Hard skip. |
| **Break-even ROAS / contribution-margin headline + re-anchoring ROAS bands** | VAT=0 (cross-border) → no tax-out-of-revenue. Bands are locked (<2x red / 2-2.7x orange / 3x+ green). Do not add a separate break-even metric or re-anchor. (LTV:nCAC in §4 is a customer-economics ratio, **not** a per-period break-even headline.) |
| **Multi-tenant / per-user dashboards / role auth** | Single-user internal tool, URL-obscurity trust model, 3 stores. Not multi-tenant. |
| **Network-effect benchmarks (industry/peer comparison)** | A 3-store tool can't replicate TW's cross-account aggregation moat. |
| **NL chat / AI agent over the data** | Low leverage for one operator who already knows the business; adds surface + cost without changing a decision. |
| **Creative competitive intelligence / ad library** | Out of the reporting-only mandate; not pixel-free-buildable from owned data. |
| **PWA / installable home-screen widget** | Greenfield (no manifest/SW); risks caching numbers outside the URL-obscurity trust model. Revisit only if the operator asks. |

**The structural advantage to lean into:** self-hosted (no revenue-scaled SaaS fee), data-owned, deterministic. Frame every number as "traces to a Shopify order" — that is the one thing TW structurally cannot claim.

---

## 10. Open questions for the operator

1. **Revenue basis for headline pairings (A1):** when NC-ROAS sits beside MER, do you want the NC-ROAS numerator re-based to **net** (matches MER) or kept **gross** and explicitly labeled? (Affects whether the two ever tie out.)
2. **Cohort LTV definition:** **contribution-margin LTV** (revenue − COGS via `effectiveCogsPct`, recommended for apples-to-apples with CAC) or **gross-revenue LTV**? And default cohort horizon — 365 days?
3. **FX-null policy for cohorts:** cohort LTV/payback aggregate many historical orders across FX-rate days. Confirm "FX failure → preserve prior / exclude that day" so LTV doesn't silently understate — same rule as the daily columns?
4. **WhatsApp anomaly push:** which triggers fire a conditional alert — store drops a ROAS band? spend z>X? revenue drop z>X? refund-rate spike? — and what throttle (keep 1/6h)? Are you willing to submit a **new approved Meta template** if you later want MER/profit in the standing digest (currently 5-param fixed; TikTok already merged into "אחרים")?
5. **Per-product contribution P&L:** is per-SKU COGS calibration realistic across 3 stores, or should this stay deferred (global 25% would make it revenue × constant)? Same question gates capturing `total_discounts` for the leakage line.
6. **Home declutter:** do you want a mockup of the hero/chart click-to-expand merge before any code, per your no-drip-deploy / mockup-first rule?
7. **NC-ROAS coverage suppression threshold:** at what unclassified % should the NC tile degrade to a low-confidence state? (Prod is 0 NULL today, so this is forward-protection.)
