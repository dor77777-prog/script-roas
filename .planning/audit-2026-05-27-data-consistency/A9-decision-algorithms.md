# A9 — Decision Algorithms: Contract vs Behavior

Audit agent A9. Focus: does each decision algorithm honor its stated contract across known-answer, edge/degenerate, and property-invariant cases. REPORT only — no code modified. All probes run as scratch vitest/node in /tmp (not added to repo).

Format per finding: `ID | severity | algorithm | file:line | contract | violating input | why wrong | suggested fix`

---

## 1. Campaign Health Score — `dashboard-web/src/lib/campaignHealthScore.ts`

### Contract (from code + JSDoc)
- Grade A–F (+`unknown`); score bounded [0,100].
- Weights: profitability 0.40 / volume 0.15 / trajectory 0.25 / attribution 0.20, sum 1.0 (asserted at module load, line 108-112).
- Operator adj: +15 optimized, −30 off, applied after weighted sum, then clamp.
- Cohort adj applied once by `applyCohortAdjustmentOnce` (assert-on-reentry).
- Insufficient gate: spend<30, OR spend<100 & conversions===0 → `unknown`/⏳ Early.
- Properties: monotonic in profitability (all else equal), bounded [0,100], no NaN on missing component, cohort adj can't exit bounds.

### Case matrix reasoned through
- **Weights sum**: 0.40+0.15+0.25+0.20 = 1.0 ✓ (runtime assert present).
- **Monotonicity in ROAS** (probe `/tmp/probe_health.mjs`): for fixed pivot+trust, `((roas-1)/(pivot-1))*100` clamped [0,100] then ×trust is non-decreasing across roas∈[0,8], all pivots {2,3,3.5}, all trust {0.4,0.5,0.7,1.0}. ✓ Holds *within a source branch*. Across branches the trust modulator changes (deterministic vs trueRevenue vs platform), but that is not an "all else equal" comparison, so no contract violation.
- **Bounds**: weighted subtotal ≤ 100; renormalized no-trajectory path: max 100×1.0=100; +15 op adj clamped at line 449. cohort adj clamped at line 593. ✓ No path exceeds [0,100].
- **No-trajectory renormalize**: scaleFactor = 1/0.75 = 1.333; effective weights 0.533/0.20/0.267 sum 1.0 ✓.
- **NaN-safety**: spend≤0 → profitability 0; trajectory missing → 60 or renormalized-out; attribution missing → 50/30; `Aggregated` fields typed `number`. ✓ No NaN under normal inputs.
- **Cohort once-guard**: throws on non-zero `cohortAdjustment` re-entry ✓.

### Violations
- **A9-01 | P2 | Campaign Health Score | campaignHealthScore.ts:47-48 | JSDoc claims profitability is "45% weight" (and `components.profitability` comment "dominant signal (45% weight)") | n/a (doc-vs-code) | The actual `WEIGHTS.profitability` is 0.40 (line 101) and the module header (line 26) also says 40. The 45% comment is stale/contradictory — an operator reading the drilldown source would mis-trust the breakdown. | Fix comment to 40%.**

No P0/P1 correctness violations found in the health score itself. The algorithm is sound on monotonicity, bounds, totality, and NaN-safety.

---

## 2. Cannibalization detection — `dashboard-web/src/lib/cannibalizationDetection.ts`

### Contract
- `revenueGrowthPct = (lateRev − earlyRev) / |earlyRev|`; emits `null` when earlyRev===0 & lateRev>0 (undefined growth); 0 when both 0.
- Verdicts: HIGH (spend≥+25% & rev<+5%), MEDIUM (spend≥+15% & rev<spend/2), LOW (spend≥+20% & rev<spend×0.75 & Δspend≥$50), else NONE. composition_changed when cohort mix shifts. insufficient when <3 active days/half or earlySpend≤0.
- Property: true cannibalization flagged; benign cohort not; **sign of growth correct**.

### Case matrix (probe `/tmp/probe_cannib.mjs`)
| case | early/late rev | spend | verdict | correct? |
|------|------|------|---------|----------|
| healthy scale (1000→1600 rev, +50% spend) | +/+ | +50% | none(proportional) | ✓ |
| revenue dropped (1000→800), +30% spend | +/+ | +30% | HIGH | ✓ |
| both negative, worse (−100→−300), +50% | −/− | +50% | HIGH | ✓ |
| **neg-early recovers (−300→−100 still neg), +50%** | −/− | +50% | **none(proportional)** | ✗ see A9-02 |
| neg-early→pos-late (−100→+200), +50% | −/+ | +50% | none(proportional) | borderline-OK |

### Violations
- **A9-02 | P1 | Cannibalization `revenueGrowthPct` | cannibalizationDetection.ts:443,465 | The 2026-05-24 audit flagged that `/ Math.abs(earlyRev)` inflates positive growth when earlyRev is negative — VERIFIED STILL PRESENT (denominator is `Math.abs(earlyRev)`) | early half net revenue NEGATIVE (refund-heavy) while late half STILL NEGATIVE but less so, e.g. earlyRev=−300, lateRev=−100, spend +50% | Computes `(−100−(−300))/300 = +0.67` → reported as "+67% revenue growth, proportional, no cannibalization." But the product LOST money in BOTH halves and the operator scaled spend +50%. The `Math.abs` denominator masks that late revenue is still negative; the formula treats "loss got smaller" as positive growth that clears the cannibalization thresholds. A cohort bleeding money during a scale-up reads as healthy. | When `lateRev <= 0` (product net-negative in late half), do not emit a proportional/`none` verdict from the % comparison — gate on absolute late-half revenue sign (e.g. force at least MEDIUM, or a dedicated "loss-making" verdict) before applying the growth-ratio thresholds. At minimum, when `earlyRev < 0`, the growth% is not a meaningful incrementality signal and should be surfaced as `insufficient`/`composition_changed`-style abstain rather than `none`.**

Note: the `null`-on-(earlyRev===0, lateRev>0) JSON-serialization fix IS correctly in place (lines 444-448, 463-468, 493-499). The neg-early→pos-late case (−100→+200) lands `none` which is defensible (genuine recovery), so the core defect is specifically the **both-halves-negative** path.

---

## 3. Window stability / "volatile" verdict — `computeWindowStability` in `dashboard-web/src/lib/attributionAnalysis.ts:612`

(Note: the audit brief located this in `insights.ts`; it actually lives in `attributionAnalysis.ts`.)

### Contract
- Bucket range into 7-day windows; per-window coverage = matched/meta, **capped** at `COVERAGE_WARNING_THRESHOLD=2` so one outage window (10× coverage) doesn't force 'volatile'.
- σ of coverages → verdict: stable σ<0.15, mixed σ<0.35, else volatile.
- Property: refund-heavy weeks shouldn't fabricate 'volatile'.

### Case matrix (probe `/tmp/probe_stab.mjs`)
- 3 stable windows (1.30, 1.35, 1.28) → σ=0.029 → **stable** ✓.
- 2 stable + 1 refund window (matched=−150 → coverage **−1.5**) → σ=1.32 → **volatile** ✗.
- 2 stable + 1 big-refund window (coverage **−3.0**) → σ=2.02 → **volatile** ✗.

### Violations
- **A9-03 | P1 | Window stability coverage clamp | attributionAnalysis.ts:671-673 | Clamp comment promises bounded coverage so "stdDev stays representative of typical behavior" and one extreme window can't push 'volatile' | a single refund-heavy 7-day window where matched (net) revenue < 0 against a positive Meta claim → coverage = matched/meta is negative and UNBOUNDED below | The clamp is `Math.min(COVERAGE_WARNING_THRESHOLD, b.matched/b.meta)` — it only bounds the UPPER side. A negative coverage (−1.5, −3.0…) flows unclamped into the mean and variance, so two genuinely-stable weeks plus one refund week yield σ≫0.35 → false 'volatile'. This 2026-05-24 flag is CONFIRMED LIVE. Consequence: the trust panel downgrades 'high'→'medium' and tells the operator "period numbers unstable" purely because one week had net refunds, contradicting the algorithm's own design intent. | Two-sided clamp: `Math.max(0, Math.min(COVERAGE_WARNING_THRESHOLD, b.matched/b.meta))` (or a documented lower bound), OR drop windows whose matched ≤ 0 the same way meta≤0 windows are dropped. Verdict thresholds themselves (stable/mixed/volatile partition) are total and gap-free — no issue there.**

---

## 4. Insights engine — `dashboard-web/src/lib/insights.ts`

### Contract
- Anomalies via robust z (median/MAD) vs trailing 14d; recommendations via rules; severity ladder info<positive<opportunity<warning<critical.
- Property: thresholds don't double-classify the same condition contradictorily; no insight fires on empty/degenerate data with a misleading message.

### Case matrix
- `robustZScore`: returns 0 when series<8, baseline<7, or MAD===0 — degenerate/flat series cannot fire a false anomaly ✓.
- `detectMetricAnomalies` guarded by `rows.length < 8` ✓.
- "Dead day" (spend>50 & revenue===0) weight 98 — see A9-04.
- ROAS-streak: requires last3 all >0 & <2.0 AND baselineAvg>2.2 — the `>0` guard avoids firing on zero-data days ✓.
- Recommendations: scale needs spend≥200 & daysActive≥7 & roas≥3.5; pause spend≥150 & days≥5 & 0<roas<1.5; dead spend≥100 & conv===0 & days≥4. These are non-overlapping on the (spend, roas, conv) axes, so a single campaign can't simultaneously be SCALE and PAUSE (roas≥3.5 vs <1.5) ✓. A high-spend zero-conversion campaign can fire both PAUSE-adjacent? No — pause requires roas>0, dead requires conv===0 (roas=0) → mutually exclusive ✓.
- Forecast partition / pacing: `computePacing` status bands ahead(≥1.05×), on-pace([0.92,1.05)×), behind(<0.92×) — total, gap-free ✓. End-of-month daysRemaining=0 → projection=MTD ✓.

### Violations
- **A9-04 | P2 | Anomaly "dead day" | insights.ts:180 | "יום אבוד" (lost day): high spend with zero sales is a real wasted-spend signal | the CURRENT (still-loading) day during the day, before any orders have synced: `today.totalSpend > 50 && today.revenue === 0` | `detectAnomalies` sorts each store's rows ascending and treats `rows[rows.length-1]` as "today". Mid-day, spend has accrued but Shopify revenue for today may still be 0 (not yet attributed), firing a CRITICAL "lost day" with weight 98 — the top insight — on what is merely an incomplete current day. The other anomalies (z-score ones) inherently need the day's full series, but this one rule has no completeness guard. | Exclude the current Israel-day from the dead-day check, or require the day to be complete (compare against `todayInIsrael()` and skip if `today.date === todayInIsrael()`), mirroring how `forecastMonthEnd` excludes today from its 7-day baseline.**

No double-classification or severity-inversion bugs found. Severity weights are internally ordered and consistent.

---

## 5. ROAS banding — `roasLabel` in `dashboard-web/src/lib/analytics.ts:423`

### Contract (audit brief)
Bands: red<2.0, orange 2.0–2.7, green 2.7–3.0, blue>3.0 — a total, gap-free, non-overlapping partition of [0,∞); negative/zero handled.

### Case matrix (probe `/tmp/probe_roas.mjs`)
| roas | tone | partition-correct? |
|------|------|------|
| ≤0, NaN | gray | ✓ (degenerate handled) |
| 0.0001, 1.99 | red | ✓ |
| 2.0, 2.69 | orange | ✓ (2.0 boundary → orange) |
| 2.7, 2.99, 3.0 | green | ✓ (3.0 boundary → green) |
| 3.000001, 100 | blue | ✓ |

`roasLabel` itself is a correct total partition: red [tiny,2), orange [2,2.7), green [2.7,3.0], blue (3.0,∞). No gaps, no overlaps. ✓

### Violations
- **A9-05 | P1 | ROAS banding — TWO conflicting band definitions | analytics.ts:423-429 vs TodayLive.tsx:86-118 | Single source of truth for ROAS→color/verdict; TodayLive comment (line 49) explicitly claims "these bands match the same thresholds" | a store/day with ROAS in [2.5, 2.7), e.g. 2.6 | `roasLabel` (used by PerStoreCards, HeroOverview KPI chip, every table) bands 2.6 as **orange "סביר"**. `TodayLive`'s `roasBandTokens` bands the SAME 2.6 as **green "healthy"** (orange is only 2.0–2.5 there). Same ROAS number renders a different color and verdict in two places on the same dashboard. The TodayLive comment asserting parity is false. Additionally the blue boundary differs: roasLabel → 3.0 is green (blue is `>3`), TodayLive → 3.0 is blue (`>=3.0`). The User Manual documents the TodayLive 2.5/3.0 bands (lines 51-54, 321-322) but tables follow the 2.7 band — so the manual is also internally inconsistent. | Extract one shared band function (or constants) and have both `roasLabel` and `roasBandTokens` consume it; reconcile the 2.5-vs-2.7 green-start and the 3.0 boundary; update the User Manual to match.**

---

## 6. Leader / risk badge — `dashboard-web/src/components/PerStoreCards.tsx:42-49,108`

### Contract
- Leader (Trophy) = highest-ROAS store, only when ≥2 stores have positive ROAS.
- Risk (AlertTriangle "בחינה") = lowest-ROAS store when ≥2 positive stores AND lowest < 2.0.
- Property: ties deterministic; can't show leader+risk on same card contradictorily.

### Case matrix
- `data` arrives sorted DESC by ROAS from `aggregateByStore` (analytics.ts:319). `withRoas[0]` = highest ✓ — but only because of that upstream invariant (see A9-06).
- Leader/risk same store: `isRisky && !isTop` (line 108) suppresses risk when a card is also leader → no visual contradiction ✓.
- **All-equal tie** (e.g. two stores both ROAS 1.8): topStore = withRoas[0]; sortedAsc[0] (stable sort, ties preserve order) = withRoas[0] = same store → riskyStore===topStore → risk badge suppressed by `!isTop`. Result: the leader gets a Trophy on a 1.8-ROAS (red-zone) store and NO store shows the risk warning, even though every store is below 2.0. See A9-07.

### Violations
- **A9-06 | P2 | Leader badge depends on implicit upstream sort | PerStoreCards.tsx:46 | Comment says leader = "highest-ROAS"; code uses `withRoas[0]` (first element, not a max) | a future/alternate caller passing `data` not sorted descending by ROAS (e.g. sorted by name or revenue) | The leader is taken as `withRoas[0]` rather than computed via `Math.max`/reduce. It only happens to equal the highest because `aggregateByStore` sorts desc. The single caller (Dashboard.tsx:405) passes `filtered.storeAggs` which is so sorted today, so this is NOT a live bug — but it is a latent correctness hazard with no guard. | Compute leader as `withRoas.reduce((m,s)=>s.roas>m.roas?s:m)` (or reuse `sortedAsc[sortedAsc.length-1]`) so the badge is correct regardless of input order.**
- **A9-07 | P2 | Leader/risk on all-below-2.0 ties | PerStoreCards.tsx:46-49,108 | Leader should signal the best performer; risk should warn when lowest <2.0 | all stores tie at the same ROAS < 2.0 (e.g. both 1.8) | The top card gets a "מובילה" Trophy despite being in the red zone, and because riskyStore resolves to the same (tied) store and `!isTop` suppresses it, NO card shows the "בחינה" warning — so a portfolio where every store is unprofitable displays a celebratory trophy and zero risk flags. Misleading. | Either suppress the leader trophy when the leader's own ROAS < 2.0 (no "leader" in an all-losing field), or compute riskyStore independently of the leader so the warning still appears on a non-leader card; and break ROAS ties deterministically by a secondary key (spend/revenue) so leader≠risk under ties.**

---

## Cross-cutting note
A9-05 (two ROAS band definitions) overlaps S2 in the AUDIT-PLAN seed findings (duplicate `STORE_COLORS`) as a "same concept defined twice with drift" class — recommend MASTER-REPORT group these together as a single-source-of-truth hardening item.
