# Wave 1 — Trust & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every revenue-derived metric agree with the headline net MER — re-base NC-ROAS revenue to net (blended refund-rate), make AOV a consistent gross÷orders, and add a two-stage NC-ROAS confidence gate.

**Architecture:** Reuse `data_daily`'s existing `gross_revenue_cad` + `revenue_cad` (net) — no migration, no new fetch. The data_daily reader already maps `grossRevenue` per day; we sum it into the `Aggregate`, derive a uniform per-store/period `net/gross` factor via a new pure helper, and apply it to absolute-$ revenue (NC-ROAS numerator, AI revenue-by-source). Coverage % is a ratio → basis-invariant → untouched. `total_cad` stays immutable gross.

**Tech Stack:** Next.js + TypeScript, Vitest (node `vitest.config.ts` + DOM `vitest.config.dom.ts`), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-06-03-wave1-trust-accuracy-design.md`

**Conventions:** per-task local commit (no push until all tasks done + final review, then ONE `git push origin main`). Run `npx tsc --noEmit`, `npx vitest run` (node) and `npx vitest run --config vitest.config.dom.ts` (DOM) as relevant. Hebrew UI strings, RTL. Keep mapping/readability guards green.

---

## File Structure

- `src/lib/analytics.ts` — add `grossRevenue` to `Aggregate` (and every constructor of it: `aggregate`, `aggregateByStore`). MODIFY.
- `src/lib/home/revenueBasis.ts` — NEW pure helper `netAdjustFactor`.
- `src/lib/home/newCustomerMetrics.ts` — apply factor to `ncRevenue`; add `confidence`. MODIFY.
- `src/lib/home/storeDetail.ts` — AOV → gross; pass net+gross into `computeNewCustomerMetrics`. MODIFY.
- `src/components/Dashboard.tsx:825` — pass net+gross into `computeNewCustomerMetrics`. MODIFY.
- `src/components/home/CommandCenterHero.tsx` — `confidence` field on `CommandCenterNewCustomer`; "net (refund-adj)" qualifier + gate states. MODIFY.
- `src/components/home/StoreDetailModal.tsx` — same `confidence` + label + gate states. MODIFY.
- `src/lib/aiReport.ts:~638` — net-adj the per-source absolute revenue (coverage % math untouched). MODIFY.
- `src/lib/audit/__tests__/reconcile.live.test.ts` — assert NC revenue uses net-adj basis. MODIFY.
- Test files alongside each.

---

## Task 1: `grossRevenue` on the Aggregate

**Files:**
- Modify: `src/lib/analytics.ts` (the `Aggregate` interface near line 71; `aggregate()` near line 115-272; `aggregateByStore()` near line 298)
- Test: `src/lib/__tests__/aggregateGrossRevenue.test.ts` (Create)

The data_daily reader already maps `grossRevenue` per day (`postgresReaders.ts:374`); `aggregate()` currently sums `revenue += r.revenue` (net) but never sums gross. Add it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/aggregateGrossRevenue.test.ts
import { describe, it, expect } from 'vitest';
import { aggregate } from '@/lib/analytics';

// Minimal DailyRow-shaped fixtures. grossRevenue > revenue (refunds happened).
const rows = [
  { date: '2026-06-01', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 90, grossRevenue: 100, spend: 30, cogs: 25, fbSpend: 30, gaSpend: 0, ttSpend: 0, impressions: 0, roas: 3 },
  { date: '2026-06-02', storeId: 'uzoshop', storeName: 'uzoshop', revenue: 180, grossRevenue: 200, spend: 60, cogs: 50, fbSpend: 60, gaSpend: 0, ttSpend: 0, impressions: 0, roas: 3 },
] as unknown as Parameters<typeof aggregate>[0];

describe('aggregate — grossRevenue', () => {
  it('sums gross_revenue_cad into Aggregate.grossRevenue alongside net revenue', () => {
    const agg = aggregate(rows);
    expect(agg.revenue).toBe(270);       // net unchanged
    expect(agg.grossRevenue).toBe(300);  // NEW: gross summed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/aggregateGrossRevenue.test.ts`
Expected: FAIL — `agg.grossRevenue` is `undefined` (property doesn't exist).

- [ ] **Step 3: Implement**

In `src/lib/analytics.ts`: add `grossRevenue: number;` to the `Aggregate` interface (next to `revenue`). In `aggregate()`, declare `let grossRevenue = 0;` with the other accumulators, add `grossRevenue += r.grossRevenue ?? 0;` inside the row loop (mirror `revenue += r.revenue`), and add `grossRevenue,` to the returned object. Do the SAME in `aggregateByStore()` (grep the file for every `return {` that builds an `Aggregate`/`StoreAgg` and add the field — `StoreAgg = Aggregate & {store}` so each constructor must set it). If a constructor has no per-row gross available, set `grossRevenue: revenue` (degrade to net = no adjustment later).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/aggregateGrossRevenue.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean (every `Aggregate` constructor now sets `grossRevenue`, else tsc errors — fix each).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/lib/__tests__/aggregateGrossRevenue.test.ts
git commit -m "feat(analytics): sum grossRevenue into Aggregate (net-adj basis groundwork)"
```

---

## Task 2: `netAdjustFactor` pure helper

**Files:**
- Create: `src/lib/home/revenueBasis.ts`
- Test: `src/lib/home/__tests__/revenueBasis.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/home/__tests__/revenueBasis.test.ts
import { describe, it, expect } from 'vitest';
import { netAdjustFactor } from '@/lib/home/revenueBasis';

describe('netAdjustFactor', () => {
  it('returns net/gross when both valid', () => {
    expect(netAdjustFactor(90, 100)).toEqual({ factor: 0.9, degraded: false });
  });
  it('gross <= 0 → factor 1, degraded', () => {
    expect(netAdjustFactor(0, 0)).toEqual({ factor: 1, degraded: true });
    expect(netAdjustFactor(50, 0)).toEqual({ factor: 1, degraded: true });
  });
  it('null/NaN gross or net → factor 1, degraded', () => {
    expect(netAdjustFactor(90, null as unknown as number)).toEqual({ factor: 1, degraded: true });
    expect(netAdjustFactor(NaN, 100)).toEqual({ factor: 1, degraded: true });
  });
  it('clamps to [0, 1.5] (guards bad data where net >> gross)', () => {
    expect(netAdjustFactor(300, 100).factor).toBe(1.5);
    expect(netAdjustFactor(-10, 100).factor).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/home/__tests__/revenueBasis.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/home/revenueBasis.ts
/**
 * Blended net/gross revenue factor for a store/period. Used to re-base
 * gross orders_attribution revenue (immutable total_price) onto the same NET
 * basis as the headline MER (data_daily.revenue_cad). The factor is uniform
 * per store/period, so ratios (e.g. coverage %) are basis-invariant and must
 * NOT be adjusted — only absolute $ (NC-ROAS revenue, revenue-by-source $).
 */
export interface NetAdjust {
  factor: number;
  degraded: boolean; // true when gross is missing/zero → no adjustment applied
}

export function netAdjustFactor(net: number, gross: number): NetAdjust {
  if (
    typeof net !== 'number' || typeof gross !== 'number' ||
    !Number.isFinite(net) || !Number.isFinite(gross) || gross <= 0
  ) {
    return { factor: 1, degraded: true };
  }
  const raw = net / gross;
  const factor = Math.min(1.5, Math.max(0, raw));
  return { factor, degraded: false };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/home/__tests__/revenueBasis.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/home/revenueBasis.ts src/lib/home/__tests__/revenueBasis.test.ts
git commit -m "feat(home): netAdjustFactor pure helper (gross->net re-basing)"
```

---

## Task 3: `computeNewCustomerMetrics` — net-adj revenue + confidence gate

**Files:**
- Modify: `src/lib/home/newCustomerMetrics.ts`
- Test: `src/lib/home/__tests__/newCustomerMetrics.test.ts` (extend existing)

Current signature: `computeNewCustomerMetrics(rows, merSpend, storeName?)` returns `{ ncRevenue, ncOrders, ncRoas, nCac, unclassifiableShare }`. Extend additively: add an optional `netAdjust` factor param and a `confidence` return field. `nCac`/`ncOrders` are count-based → unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// add to src/lib/home/__tests__/newCustomerMetrics.test.ts
import { computeNewCustomerMetrics } from '@/lib/home/newCustomerMetrics';

const newRow = (totalCad: number, isFirstOrder: boolean | null) => ({ storeName: 'uzoshop', totalCad, isFirstOrder });

describe('computeNewCustomerMetrics — net-adj + confidence', () => {
  it('applies the net-adjust factor to ncRevenue (and thus ncRoas)', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(50, false)];
    // gross new revenue = 200; factor 0.9 -> net new revenue 180; spend 60 -> ncRoas 3.0
    const m = computeNewCustomerMetrics(rows, 60, 'uzoshop', 0.9);
    expect(m.ncRevenue).toBeCloseTo(180);
    expect(m.ncRoas).toBeCloseTo(3.0);
    expect(m.nCac).toBeCloseTo(30); // 60 / 2 new orders — count-based, unaffected by factor
  });
  it('factor defaults to 1 when omitted (back-compat)', () => {
    const m = computeNewCustomerMetrics([newRow(100, true)], 50, 'uzoshop');
    expect(m.ncRevenue).toBe(100);
  });
  it('confidence: ok when unclassifiable <= 20%', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(100, true), newRow(100, true), newRow(100, null)]; // 20%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('ok');
  });
  it('confidence: low when 20% < share <= 40%', () => {
    const rows = [newRow(100, true), newRow(100, true), newRow(100, null)]; // 33%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('low');
  });
  it('confidence: suppressed when share > 40%', () => {
    const rows = [newRow(100, true), newRow(100, null)]; // 50%
    expect(computeNewCustomerMetrics(rows, 100, 'uzoshop', 1).confidence).toBe('suppressed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/home/__tests__/newCustomerMetrics.test.ts`
Expected: FAIL — 4th positional arg ignored / `confidence` undefined.

- [ ] **Step 3: Implement**

In `newCustomerMetrics.ts`: add named threshold consts at top:
```ts
export const NC_CONFIDENCE_LOW = 0.20;   // > this → low confidence
export const NC_CONFIDENCE_SUPPRESS = 0.40; // > this → suppress the ratio
export type NcConfidence = 'ok' | 'low' | 'suppressed';
```
Add `confidence: NcConfidence;` to the `NewCustomerMetrics` interface. Add a 4th param `netAdjust: number = 1` to `computeNewCustomerMetrics`. After computing `ncRevenue` (gross sum) and `unclassifiableShare`, apply:
```ts
const adjFactor = Number.isFinite(netAdjust) ? netAdjust : 1;
const ncRevenueNet = ncRevenue * adjFactor;
const ncRoas = spend > 0 && ncRevenueNet > 0 ? ncRevenueNet / spend : null;
const confidence: NcConfidence =
  unclassifiableShare > NC_CONFIDENCE_SUPPRESS ? 'suppressed'
  : unclassifiableShare > NC_CONFIDENCE_LOW ? 'low'
  : 'ok';
return { ncRevenue: ncRevenueNet, ncOrders, ncRoas, nCac, unclassifiableShare, confidence };
```
(`nCac` stays `spend / ncOrders`. Update the docstring to note ncRevenue is now net-adj.)

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/lib/home/__tests__/newCustomerMetrics.test.ts && npx tsc --noEmit`
Expected: PASS (existing + 5 new). tsc may flag the two call sites missing `confidence` consumers — fixed in Tasks 5-6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home/newCustomerMetrics.ts src/lib/home/__tests__/newCustomerMetrics.test.ts
git commit -m "feat(home): NC-ROAS net-adj revenue + two-stage confidence gate"
```

---

## Task 4: AOV → gross ÷ orders (consistent basis)

**Files:**
- Modify: `src/lib/home/storeDetail.ts:157`
- Test: `src/lib/home/__tests__/storeDetail.test.ts` (extend existing)

Current: `const aov = orders > 0 ? cur.revenue / orders : null;` — net ÷ orders. Change to gross ÷ orders using `cur.grossRevenue` (now on StoreAgg from Task 1), so numerator + denominator share basis; the AOV band no longer false-flips on refund days.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/lib/home/__tests__/storeDetail.test.ts
describe('buildStoreDetail — AOV uses gross ÷ orders', () => {
  it('AOV is gross revenue / orders (stable across a refund day, not net/orders)', () => {
    // cur with gross 1000, net 800 (refund day), 10 orders -> AOV 100 (gross), NOT 80 (net)
    const cur = makeStoreAgg({ revenue: 800, grossRevenue: 1000, spend: 200, cogs: 250 });
    const detail = buildStoreDetail({ /* ...existing required args..., */ cur, orders: 10, prev: null, firstOrderRows: [] } as any);
    expect(detail.kpis.aov).toBe(100);
  });
});
```
(Use the file's existing fixture helpers; add a `grossRevenue` field to the StoreAgg fixture factory if it has one. If there's no `makeStoreAgg` helper, construct the StoreAgg inline matching the `cur: StoreAgg` shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/home/__tests__/storeDetail.test.ts`
Expected: FAIL — AOV computes 80 (net/orders), expected 100.

- [ ] **Step 3: Implement**

In `storeDetail.ts:157` change to:
```ts
// AOV = gross order value at checkout ÷ order count (standard; stable on refund
// days). Both from the same StoreAgg basis — never net÷gross (Wave 1 fix).
const aov = orders > 0 ? cur.grossRevenue / orders : null;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/home/__tests__/storeDetail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home/storeDetail.ts src/lib/home/__tests__/storeDetail.test.ts
git commit -m "fix(home): AOV = gross/orders (consistent basis; no refund-day band flip)"
```

---

## Task 5: Wire the net-adjust factor into both call sites

**Files:**
- Modify: `src/components/Dashboard.tsx:~825`
- Modify: `src/lib/home/storeDetail.ts:~251`
- Test: covered by Task 3 + an integration assertion below

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/home/__tests__/storeDetailNetAdj.test.ts (Create)
import { describe, it, expect } from 'vitest';
import { buildStoreDetail } from '@/lib/home/storeDetail';

describe('buildStoreDetail — passes net-adj factor into NC-ROAS', () => {
  it('NC-ROAS revenue is re-based by cur net/gross', () => {
    const cur = { /* StoreAgg */ store: 'uzoshop', revenue: 900, grossRevenue: 1000, spend: 100, cogs: 250, roas: 9, grossProfit: 800, transactionFees: 0 } as any;
    const firstOrderRows = [{ storeName: 'uzoshop', totalCad: 100, isFirstOrder: true }];
    const d = buildStoreDetail({ storeId: 'uzoshop', storeName: 'uzoshop', cur, prev: null, series: [], campaignRows: [], range: { from: '2026-06-01', to: '2026-06-03' }, orders: 1, prevOrders: 0, updatedAt: null, firstOrderRows } as any);
    // gross nc revenue 100 * (900/1000)=0.9 -> 90 net; spend 100 -> ncRoas 0.9
    expect(d.newCustomer.ncRoas).toBeCloseTo(0.9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/home/__tests__/storeDetailNetAdj.test.ts`
Expected: FAIL — ncRoas is 1.0 (no factor applied yet).

- [ ] **Step 3: Implement**

In `storeDetail.ts:251`, replace:
```ts
const newCustomer = computeNewCustomerMetrics(firstOrderRows, cur.spend, storeName);
```
with:
```ts
import { netAdjustFactor } from '@/lib/home/revenueBasis'; // top of file
// ...
const { factor: ncNetAdj } = netAdjustFactor(cur.revenue, cur.grossRevenue);
const newCustomer = computeNewCustomerMetrics(firstOrderRows, cur.spend, storeName, ncNetAdj);
```
In `Dashboard.tsx:825`, replace:
```ts
return computeNewCustomerMetrics(firstOrderRows, filtered.curAgg.spend, scope);
```
with:
```ts
const { factor: ncNetAdj } = netAdjustFactor(filtered.curAgg.revenue, filtered.curAgg.grossRevenue);
return computeNewCustomerMetrics(firstOrderRows, filtered.curAgg.spend, scope, ncNetAdj);
```
(add `import { netAdjustFactor } from '@/lib/home/revenueBasis';` to Dashboard.tsx). Note: when `scope` is a single store, `filtered.curAgg` should be that store's agg; if `filtered.curAgg` is business-wide while `scope` filters rows per store, the blended factor is the business net/gross ratio — acceptable per the design (uniform blended factor). Verify `filtered.curAgg` carries `grossRevenue` (Task 1).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/lib/home/__tests__/storeDetailNetAdj.test.ts && npx tsc --noEmit`
Expected: PASS + tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.tsx src/lib/home/storeDetail.ts src/lib/home/__tests__/storeDetailNetAdj.test.ts
git commit -m "feat(home): thread net-adj factor into NC-ROAS at both call sites"
```

---

## Task 6: UI — "net (refund-adj)" label + confidence gate states

**Files:**
- Modify: `src/components/home/CommandCenterHero.tsx` (`CommandCenterNewCustomer` type ~175-181; render ~825-870)
- Modify: `src/components/home/StoreDetailModal.tsx` (render ~323-353)
- Test: `src/components/home/__tests__/CommandCenterHero.dom.test.tsx` + `StoreDetailModal.dom.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing DOM tests**

```tsx
// add to CommandCenterHero.dom.test.tsx
it('shows "net (refund-adj)" qualifier on the NC-ROAS tile', () => {
  render(<CommandCenterHero {...baseProps} newCustomer={{ ncRoas: 3, ncRevenue: 180, ncOrders: 2, nCac: 30, unclassifiableShare: 0.05, confidence: 'ok' }} />);
  expect(screen.getByText(/refund-adj|נטו/i)).toBeInTheDocument();
});
it('confidence=low → renders a low-confidence badge', () => {
  render(<CommandCenterHero {...baseProps} newCustomer={{ ncRoas: 3, ncRevenue: 180, ncOrders: 2, nCac: 30, unclassifiableShare: 0.3, confidence: 'low' }} />);
  expect(screen.getByText(/ביטחון נמוך/)).toBeInTheDocument();
});
it('confidence=suppressed → hides the ratio, shows not-enough-data', () => {
  render(<CommandCenterHero {...baseProps} newCustomer={{ ncRoas: 3, ncRevenue: 180, ncOrders: 2, nCac: 30, unclassifiableShare: 0.6, confidence: 'suppressed' }} />);
  expect(screen.queryByText('3.00')).not.toBeInTheDocument();
  expect(screen.getByText(/לא מספיק דאטה/)).toBeInTheDocument();
});
```
(Use the existing test's `baseProps`/render helper; mirror the same three tests in `StoreDetailModal.dom.test.tsx` against `data.newCustomer`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx`
Expected: FAIL — `confidence` not on type / badge + message not rendered.

- [ ] **Step 3: Implement**

1. Add `confidence: NcConfidence;` to `CommandCenterNewCustomer` (CommandCenterHero.tsx ~175) — import `NcConfidence` from `@/lib/home/newCustomerMetrics`. The `newCustomer` object the Dashboard builds already flows from `computeNewCustomerMetrics`, so `confidence` is present.
2. In the NC tile render (~825-870), wrap the `ncRoas` value:
   - `confidence === 'suppressed'`: render `<span>לא מספיק דאטה לסיווג</span>` instead of the `ncRoas`/`nCac` numbers (keep the share line).
   - else render the numbers; when `confidence === 'low'` add a small badge `<span className="...muted...">ביטחון נמוך</span>` (use an existing chip/badge primitive for token-driven styling + AA contrast).
   - Add the `net (refund-adj)` qualifier near the NC-ROAS label/tooltip (Hebrew: append "· נטו (מתואם refunds)" to the existing tile subtitle/tooltip at line ~833).
3. Mirror in StoreDetailModal.tsx (~323-353): same suppressed/low/label handling against `data.newCustomer.confidence`.
4. Keep all existing readability/token rules (no hardcoded colors; AA in both themes).

- [ ] **Step 4: Run DOM tests + tsc**

Run: `npx vitest run --config vitest.config.dom.ts src/components/home/__tests__/CommandCenterHero.dom.test.tsx src/components/home/__tests__/StoreDetailModal.dom.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/CommandCenterHero.tsx src/components/home/StoreDetailModal.tsx src/components/home/__tests__/CommandCenterHero.dom.test.tsx src/components/home/__tests__/StoreDetailModal.dom.test.tsx
git commit -m "feat(home): NC-ROAS net-adj label + two-stage confidence gate UI"
```

---

## Task 7: AI report revenue-by-source — net-adj absolute $ (coverage % untouched)

**Files:**
- Modify: `src/lib/aiReport.ts:~638`
- Test: `src/lib/__tests__/aiReportNetAdj.test.ts` (Create)

The per-source `revenue` totals are absolute gross $. Re-base them by the same blended factor. The deterministic **coverage %** is a ratio of revenues → factor cancels → leave its math UNCHANGED.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/aiReportNetAdj.test.ts
import { describe, it, expect } from 'vitest';
// import the function that builds the revenue-by-source section (e.g. buildAiReport / the section builder in aiReport.ts)
// Assert: with net/gross factor 0.9, a source with gross revenue 1000 reports 900,
// AND the coverage % is identical to the un-adjusted run (ratio invariant).
```
(Read `aiReport.ts` to find the exact exported builder + its inputs; write a concrete assertion that the per-source revenue is scaled by the factor and coverage % is unchanged. If the factor isn't currently an input, thread the store/period net+gross — available from the same agg/data_daily the report already consumes — into the builder.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/aiReportNetAdj.test.ts`
Expected: FAIL — revenue not scaled.

- [ ] **Step 3: Implement**

Thread the net-adj factor (via `netAdjustFactor(net, gross)` from `@/lib/home/revenueBasis`) into the revenue-by-source accumulation: multiply each `bySource[key].revenue` (and `grandTotal`) by the factor when producing the DISPLAYED $ figures. Do NOT change the coverage-% numerator/denominator ratio logic. Label the section's revenue as net-adj in the report prose.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/aiReportNetAdj.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiReport.ts src/lib/__tests__/aiReportNetAdj.test.ts
git commit -m "feat(aiReport): net-adj revenue-by-source $ (coverage % unchanged)"
```

---

## Task 8: Reconcile guard + final verification

**Files:**
- Modify: `src/lib/audit/__tests__/reconcile.live.test.ts`

- [ ] **Step 1: Add the basis assertion**

Read `reconcile.live.test.ts`. Add a live assertion (gated by `AUDIT_LIVE`): for each store/current-range, the NC-ROAS revenue derived via the dashboard path is `<=` the gross sum of first-order `total_cad` (i.e. the net-adj factor `<= 1` is applied, never gross-passed-through). Use the same Supabase reads the file already uses. Keep it a soft/clear assertion with a descriptive message so a future regression to gross fails loudly.

- [ ] **Step 2: Run the full gates**

```bash
npx tsc --noEmit
npx vitest run
npx vitest run --config vitest.config.dom.ts
npx eslint src/lib/home/revenueBasis.ts src/lib/home/newCustomerMetrics.ts src/lib/home/storeDetail.ts src/lib/analytics.ts src/components/home/CommandCenterHero.tsx src/components/home/StoreDetailModal.tsx src/lib/aiReport.ts
AUDIT_LIVE=1 npx vitest run src/lib/audit/__tests__/reconcile.live.test.ts   # if creds available
```
Expected: tsc 0, node + DOM green, lint 0, mapping guards green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit/__tests__/reconcile.live.test.ts
git commit -m "test(audit): reconcile guard asserts NC-ROAS uses net-adj basis"
```

---

## Final (after all tasks)

- [ ] Dispatch a final code-review subagent over the whole Wave-1 diff.
- [ ] Update docs per the pre-push gate: this touches `components/**` + `inngest`/fetchers? (No fetchers/inngest; components yes → bump **User Manual** with the NC-ROAS net-adj note + AOV-gross note + confidence states; ARCHITECTURE optional). Required for the docs-currency gate.
- [ ] ONE `git push origin main` (includes the 2 pending local commits: PnL comment `65c9680` + Wave-1 spec `ed9109b`). Vercel builds; Inngest unaffected (no cron/route changes).
- [ ] Post-deploy (prod URLs only): NC-ROAS magnitude reconciles in scale with MER; AOV stable; gate states reachable.
