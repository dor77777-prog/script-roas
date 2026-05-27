# End-to-End Data-Consistency & Algorithm-Correctness Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove every dashboard component, the operator console, and the cron pipeline show correct, mutually-consistent, anomaly-free numbers in production — and that every decision/action algorithm does what it claims — then fix every confirmed bug.

**Architecture:** Hybrid. (1) A reusable live **reconciliation harness** (vitest test gated by `AUDIT_LIVE`, hits prod) + pure invariant helpers (ordinary unit tests). (2) **Property/golden test suites** (`fast-check`) over the pure decision algorithms, running in normal CI/pre-push. (3) **10 parallel domain agents** that read code AND pull live prod data, each emitting a findings file. (4) Consolidate → triage → **fix confirmed P0/P1 TDD-style** → re-verify live.

**Tech Stack:** Next.js 15, TypeScript, vitest ^2.1, fast-check (added), Node global `fetch`, Supabase (read via prod API only), Inngest. Spec: `docs/superpowers/specs/2026-05-27-data-consistency-audit-design.md`.

**Branch:** `audit/data-consistency-2026-05-27` (already created; spec already committed there).

**Production base URL:** `https://roas-dashboard-smoky.vercel.app` (confirmed `/api/health` → 200). All live verification hits prod — never localhost (memory rule `feedback_no_localhost_checks`).

**API param contract (verified):** `/api/data` uses `?from=YYYY-MM-DD&to=YYYY-MM-DD`. `/api/campaigns`, `/api/products`, `/api/orders-attribution` use `?range.from=...&range.to=...&store=All|<storeName>`.

**Tolerances (locked):** same-source agreement (L1) → exact within float epsilon `1e-6 * max(|a|,|b|)` or `≤$0.01`. Cross-source (L2) → `≤1%` OR `≤$1` per day/store, whichever is more lenient.

**Seed observations (feed to agents, not pre-judged):**
- S1: `GET /api/data?from=2026-05-01&to=2026-05-26` returned an empty body in one probe, while a malformed `?range.from=...` returned default rows dated outside any requested range. Investigate param parsing / silent default / whether the DB filter is actually applied (A1 + A5).
- S2: `STORE_COLORS` defined twice with different hex per store (`PerStoreCards.tsx:10`, `TodayLive.tsx:139`) per the 2026-05-24 audit — verify it does not cause a store being visually mislabeled across components (A1/A6).

---

## File structure

**Created:**
- `dashboard-web/src/lib/audit/reconcile.ts` — pure invariant helpers (tolerance + reconciliation over raw API rows). One responsibility: given raw rows, return a list of violations. No I/O.
- `dashboard-web/src/lib/audit/__tests__/reconcile.test.ts` — golden/edge unit tests for the pure helpers.
- `dashboard-web/src/lib/audit/__tests__/reconcile.live.test.ts` — live harness: `describe.skipIf(!process.env.AUDIT_LIVE)`, fetches prod, runs reconciliation over (range × store) combos, prints a pass/fail table, asserts zero violations.
- `dashboard-web/src/lib/__tests__/*.property.test.ts` — one property/golden suite per Level-6 algorithm.
- `.planning/audit-2026-05-27-data-consistency/` — `MASTER-REPORT.md` + `A1..A10` domain findings files + `AUDIT-PLAN.md`.

**Modified:**
- `dashboard-web/package.json` — add `fast-check` devDep + `audit:reconcile` script.
- Per-finding: whichever `src/lib/*.ts` / `src/components/*.tsx` / `src/inngest/**` files own the confirmed bug (unknown until Phase 1).

---

## Phase 0 — Scaffolding (concrete, TDD)

### Task 0.1: Add fast-check + audit script

**Files:**
- Modify: `dashboard-web/package.json`

- [ ] **Step 1: Install fast-check as a dev dependency**

Run (from `dashboard-web/`):
```bash
npm install -D fast-check@^3.23.0
```
Expected: `package.json` devDependencies now lists `fast-check`. `npm test` still green.

- [ ] **Step 2: Add the audit:reconcile script**

In `dashboard-web/package.json` `"scripts"`, add:
```json
"audit:reconcile": "AUDIT_LIVE=1 vitest run src/lib/audit/__tests__/reconcile.live.test.ts"
```

- [ ] **Step 3: Verify the script is wired (no live test yet → passes with no matching active tests)**

Run: `cd dashboard-web && npm test -- src/lib/audit 2>&1 | tail -5`
Expected: exits 0 (no audit tests yet; `--passWithNoTests` is the default `test` flag, but here we just confirm vitest resolves the path without error).

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/package.json dashboard-web/package-lock.json
git commit -m "chore(audit): add fast-check + audit:reconcile script"
```

---

### Task 0.2: Pure reconciliation helpers (tolerance + same-source agreement)

**Files:**
- Create: `dashboard-web/src/lib/audit/reconcile.ts`
- Test: `dashboard-web/src/lib/audit/__tests__/reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { withinTolerance, agree, type Violation } from '../reconcile';

describe('withinTolerance (cross-source L2: ≤1% OR ≤$1)', () => {
  it('passes when absolute diff ≤ $1 even if pct large', () => {
    expect(withinTolerance(0.5, 1.4)).toBe(true); // diff 0.9 ≤ $1
  });
  it('passes when pct diff ≤ 1% even if absolute large', () => {
    expect(withinTolerance(10000, 10090)).toBe(true); // 0.9% ≤ 1%
  });
  it('fails when both pct > 1% and abs > $1', () => {
    expect(withinTolerance(100, 110)).toBe(false); // 10% and $10
  });
  it('treats two zeros as equal', () => {
    expect(withinTolerance(0, 0)).toBe(true);
  });
});

describe('agree (same-source L1: exact within epsilon)', () => {
  it('passes for floats within epsilon', () => {
    expect(agree([6736.19, 6736.1900001, 6736.19]).length).toBe(0);
  });
  it('returns a violation when one source diverges', () => {
    const v: Violation[] = agree([100, 100, 137], { label: 'revenue' });
    expect(v.length).toBe(1);
    expect(v[0].label).toBe('revenue');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/audit/__tests__/reconcile.test.ts`
Expected: FAIL — cannot resolve `../reconcile`.

- [ ] **Step 3: Implement the helpers**

```ts
// reconcile.ts
export interface Violation {
  label: string;
  detail: string;
  values?: Record<string, number>;
}

/** Cross-source (L2): agree if within 1% OR within $1, whichever is more lenient. */
export function withinTolerance(
  a: number,
  b: number,
  { pctTol = 0.01, absTol = 1 }: { pctTol?: number; absTol?: number } = {},
): boolean {
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return diff === 0;
  return diff / denom <= pctTol;
}

/** Same-source (L1): every value must match within float epsilon. */
export function agree(
  values: number[],
  { label = 'value', eps = 0.01 }: { label?: string; eps?: number } = {},
): Violation[] {
  if (values.length < 2) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const tol = Math.max(eps, 1e-6 * Math.abs(max));
  if (max - min <= tol) return [];
  return [{ label, detail: `spread ${(max - min).toFixed(4)} > tol ${tol.toFixed(4)}`, values: Object.fromEntries(values.map((v, i) => [`src${i}`, v])) }];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/audit/__tests__/reconcile.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/audit/reconcile.ts dashboard-web/src/lib/audit/__tests__/reconcile.test.ts
git commit -m "feat(audit): pure reconciliation tolerance helpers + tests"
```

---

### Task 0.3: Reconciliation over raw API rows (the L1/L2 engine)

**Files:**
- Modify: `dashboard-web/src/lib/audit/reconcile.ts`
- Test: `dashboard-web/src/lib/audit/__tests__/reconcile.test.ts`

This function takes the four raw prod payloads for one (range, store) and returns all L1/L2 violations. It does NOT fetch — the live test does that and passes rows in.

- [ ] **Step 1: Write the failing test**

```ts
// append to reconcile.test.ts
import { reconcileWindow } from '../reconcile';

const dataRows = [
  { date: '2026-05-02', storeName: 'uzoshop', fbSpend: 1972, gaSpend: 150, ttSpend: 0, totalSpend: 2122, revenue: 6736.19, roas: 3.1745 },
];
const productRows = [
  { date: '2026-05-02', storeName: 'uzoshop', revenue: 6736.19, netRevenue: 6736.19, orders: 12 },
];
const campaignRows = [
  { date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 1972 },
  { date: '2026-05-02', storeName: 'uzoshop', platform: 'Google', spend: 150 },
];
const ordersRows = [{ date: '2026-05-02', storeName: 'uzoshop', totalCad: 6736.19 }];

describe('reconcileWindow', () => {
  it('reports no violations for a self-consistent window', () => {
    const v = reconcileWindow({ dataRows, productRows, campaignRows, ordersRows });
    expect(v).toEqual([]);
  });
  it('flags ROAS that disagrees with revenue/spend (INV-3)', () => {
    const bad = [{ ...dataRows[0], roas: 99 }];
    const v = reconcileWindow({ dataRows: bad, productRows, campaignRows, ordersRows });
    expect(v.some(x => x.label.includes('ROAS'))).toBe(true);
  });
  it('flags campaigns_daily Meta spend off by >1% and >$1 vs data_daily (INV-7)', () => {
    const badCamp = [{ date: '2026-05-02', storeName: 'uzoshop', platform: 'Meta', spend: 3000 }, campaignRows[1]];
    const v = reconcileWindow({ dataRows, productRows, campaignRows: badCamp, ordersRows });
    expect(v.some(x => x.label.includes('Meta spend'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/audit/__tests__/reconcile.test.ts`
Expected: FAIL — `reconcileWindow` not exported.

- [ ] **Step 3: Implement reconcileWindow**

```ts
// append to reconcile.ts
interface DataRow { date: string; storeName: string; fbSpend: number; gaSpend: number; ttSpend: number; totalSpend: number; revenue: number; roas: number; }
interface ProductRow { date: string; storeName: string; revenue: number; netRevenue: number; orders: number; }
interface CampaignRow { date: string; storeName: string; platform: string; spend: number; }
interface OrderRow { date: string; storeName: string; totalCad: number; }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function reconcileWindow(input: {
  dataRows: DataRow[]; productRows: ProductRow[]; campaignRows: CampaignRow[]; ordersRows: OrderRow[];
}): Violation[] {
  const { dataRows, productRows, campaignRows, ordersRows } = input;
  const out: Violation[] = [];

  // INV-3: per-row ROAS == revenue/totalSpend
  for (const r of dataRows) {
    const expected = r.totalSpend > 0 ? r.revenue / r.totalSpend : 0;
    out.push(...agree([r.roas, expected], { label: `ROAS ${r.date}/${r.storeName}` }));
    // INV-6: totalSpend == fb+ga+tt
    out.push(...agree([r.totalSpend, r.fbSpend + r.gaSpend + r.ttSpend], { label: `platform-sum ${r.date}/${r.storeName}` }));
  }

  // INV-7: Σ campaigns_daily spend per platform ≈ data_daily platform column (cross-source)
  const dataMeta = sum(dataRows.map(r => r.fbSpend));
  const dataGoogle = sum(dataRows.map(r => r.gaSpend));
  const dataTikTok = sum(dataRows.map(r => r.ttSpend));
  const campMeta = sum(campaignRows.filter(c => c.platform === 'Meta').map(c => c.spend));
  const campGoogle = sum(campaignRows.filter(c => c.platform === 'Google').map(c => c.spend));
  const campTikTok = sum(campaignRows.filter(c => c.platform === 'TikTok').map(c => c.spend));
  if (!withinTolerance(dataMeta, campMeta)) out.push({ label: 'INV-7 Meta spend', detail: `data_daily ${dataMeta} vs campaigns_daily ${campMeta}` });
  if (!withinTolerance(dataGoogle, campGoogle)) out.push({ label: 'INV-7 Google spend', detail: `data_daily ${dataGoogle} vs campaigns_daily ${campGoogle}` });
  if (!withinTolerance(dataTikTok, campTikTok)) out.push({ label: 'INV-7 TikTok spend', detail: `data_daily ${dataTikTok} vs campaigns_daily ${campTikTok}` });

  // INV-9: Σ products revenue ≈ data_daily revenue (cross-source)
  const dataRev = sum(dataRows.map(r => r.revenue));
  const prodRev = sum(productRows.map(p => p.revenue));
  if (!withinTolerance(dataRev, prodRev)) out.push({ label: 'INV-9 product vs data revenue', detail: `data_daily ${dataRev} vs products_daily ${prodRev}` });

  // INV-10: Σ orders_attribution total ≈ data_daily revenue (cross-source)
  const orderRev = sum(ordersRows.map(o => o.totalCad));
  if (!withinTolerance(dataRev, orderRev)) out.push({ label: 'INV-10 orders vs data revenue', detail: `data_daily ${dataRev} vs orders_attribution ${orderRev}` });

  // INV-14: no NaN/Infinity anywhere in dataRows numeric fields
  for (const r of dataRows) {
    for (const [k, val] of Object.entries(r)) {
      if (typeof val === 'number' && !Number.isFinite(val)) out.push({ label: `INV-14 non-finite ${k}`, detail: `${r.date}/${r.storeName} = ${val}` });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/audit/__tests__/reconcile.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/audit/reconcile.ts dashboard-web/src/lib/audit/__tests__/reconcile.test.ts
git commit -m "feat(audit): reconcileWindow engine for L1/L2 invariants + tests"
```

---

### Task 0.4: Live harness against production

**Files:**
- Create: `dashboard-web/src/lib/audit/__tests__/reconcile.live.test.ts`

- [ ] **Step 1: Write the live harness (no separate failing-test step — it is the verification tool)**

```ts
// reconcile.live.test.ts
import { describe, it, expect } from 'vitest';
import { reconcileWindow, type Violation } from '../reconcile';

const BASE = process.env.AUDIT_BASE_URL ?? 'https://roas-dashboard-smoky.vercel.app';
const WINDOWS = [
  { from: '2026-05-01', to: '2026-05-26' },
  { from: '2026-05-20', to: '2026-05-26' },
];
const STORES = ['All', 'uzoshop', 'zolplus', 'usmile360'];

async function getJson(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

// AUDIT_LIVE gates this so normal `npm test` / pre-push never hit prod.
describe.skipIf(!process.env.AUDIT_LIVE)('LIVE reconciliation against production', () => {
  it('every (window × store) is self-consistent', { timeout: 120_000 }, async () => {
    const allViolations: Array<{ window: string; store: string; v: Violation[] }> = [];
    for (const w of WINDOWS) {
      for (const store of STORES) {
        const storeQ = store === 'All' ? '' : `&store=${encodeURIComponent(store)}`;
        const [data, campaigns, products, orders] = await Promise.all([
          getJson(`/api/data?from=${w.from}&to=${w.to}`),
          getJson(`/api/campaigns?range.from=${w.from}&range.to=${w.to}${storeQ || '&store=All'}`),
          getJson(`/api/products?range.from=${w.from}&range.to=${w.to}${storeQ || '&store=All'}`),
          getJson(`/api/orders-attribution?range.from=${w.from}&range.to=${w.to}${storeQ || '&store=All'}`),
        ]);
        const filt = (rows: any[]) => store === 'All' ? rows : rows.filter((r: any) => r.storeName === store);
        const v = reconcileWindow({
          dataRows: filt(data.rows ?? []),
          productRows: filt(products.rows ?? []),
          campaignRows: filt(campaigns.rows ?? []),
          ordersRows: (filt(orders.rows ?? [])).map((o: any) => ({ date: o.date, storeName: o.storeName, totalCad: o.totalCad })),
        });
        if (v.length) allViolations.push({ window: `${w.from}..${w.to}`, store, v });
      }
    }
    // Print a readable table regardless of pass/fail.
    for (const { window, store, v } of allViolations) {
      console.error(`\n[${window}] [${store}] ${v.length} violation(s):`);
      for (const x of v) console.error(`  - ${x.label}: ${x.detail}`);
    }
    expect(allViolations.flatMap(a => a.v)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the live harness against prod**

Run: `cd dashboard-web && npm run audit:reconcile 2>&1 | tail -40`
Expected: either PASS (no violations) or a printed table of violations. **Record the output** — every violation is a candidate finding for Phase 1/2. (This is verification, not a test that must pass yet; a failing harness here is a real signal, not a plan error.)

- [ ] **Step 3: Confirm the gate stays off in normal test runs**

Run: `cd dashboard-web && npm test -- src/lib/audit/__tests__/reconcile.live.test.ts 2>&1 | tail -5`
Expected: the live suite is **skipped** (no `AUDIT_LIVE`), exit 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/audit/__tests__/reconcile.live.test.ts
git commit -m "feat(audit): live production reconciliation harness (AUDIT_LIVE-gated)"
```

---

### Task 0.5: Create the audit report skeleton

**Files:**
- Create: `.planning/audit-2026-05-27-data-consistency/AUDIT-PLAN.md`

- [ ] **Step 1: Write the audit plan file**

Content: a short header (date, method, prod URL, tolerances) + the 10-agent table (A1..A10 with their invariant ownership from the spec) + the severity model + a "Seed observations" section listing S1, S2 and any violations printed by Task 0.4.

- [ ] **Step 2: Commit**

```bash
git add .planning/audit-2026-05-27-data-consistency/AUDIT-PLAN.md
git commit -m "docs(audit): audit plan + agent ownership table"
```

---

## Phase 1 — Audit investigation (10 parallel agents)

Use `superpowers:dispatching-parallel-agents`. Dispatch all 10 in one message (subagent_type `general-purpose`). Each agent writes its own findings file `.planning/audit-2026-05-27-data-consistency/A<n>-<name>.md` and returns a summary. **Every agent prompt MUST include this shared preamble:**

> Repo: `/Users/dorperetz/script-roas`, dashboard in `dashboard-web/`. Production: `https://roas-dashboard-smoky.vercel.app` (live verification ONLY against this URL, never localhost). API params: `/api/data?from=&to=`; others `?range.from=&range.to=&store=All|<name>`. Tolerances: same-source exact within $0.01; cross-source ≤1% OR ≤$1/day/store. For EACH finding output: `ID | severity (P0/P1/P2) | INV-id | file:line | live evidence (actual numbers from prod) | why it is wrong | suggested fix`. You MUST pull live numbers with curl/fetch to confirm — code-only suspicions are P2 "unconfirmed". Write findings to `.planning/audit-2026-05-27-data-consistency/A<n>-<name>.md`. Do not fix anything.

- [ ] **Step 1: Dispatch A1–A10** (one message, 10 `Agent` calls)

| Agent | Domain | Invariants | Must verify live |
|-------|--------|-----------|------------------|
| A1 | Revenue/Spend/ROAS/Orders cross-component | INV-1..6 | Pull `/api/data` + recompute what KpiCards/HeroOverview/PerStoreCards/DetailTable/PnL each render; confirm equality. Investigate seed S1. |
| A2 | Profit & P&L deep | INV-5 | COGS rate, tx fees, fixed costs, percent-of-revenue, forecast inputs; KpiCards.netProfit vs PnL.trueNetProfit. |
| A3 | Campaigns & Ads rollup + Health wiring | INV-7,8 | `Σ ads_daily` → `campaigns_daily` → `data_daily` platform spend. |
| A4 | Products & cohort/attribution | INV-9,10,16 | products revenue vs data revenue; multi-mapping no double-count. |
| A5 | Filters & reactivity + URL state | INV-11,12,13 | Toggle store/range/preset live; confirm each component recomputes or correctly ignores. Investigate seed S1. |
| A6 | Anomaly & edge-math sweep | INV-14..18 | Find any NaN/∞/negative/double-FX/timezone drift across all components. Seed S2. |
| A7 | Live freshness + pipeline write-correctness | INV-19..22 | TodayLive/CPM/Campaigns-today present; cron-daily vs cron-live vs cron-live-heavy non-clobber. |
| A8 | Operator console | (functional) | sync/jobs/backfill/overrides/token-failures/reset behave correctly; overrides actually merge. |
| A9 | Decision algorithms (Level 6) | INV-L6 | Health Score, cannibalization, stability, insights, badges, ROAS banding — contract vs behavior. |
| A10 | Projection algorithms (Level 6) | INV-L6 | forecast/projection, GoalTracker pacing, cohort attribution math, AI-report math. |

- [ ] **Step 2: Collect all 10 findings files; confirm each exists and has the required per-finding columns.**

- [ ] **Step 3: Commit the raw findings**

```bash
git add .planning/audit-2026-05-27-data-consistency/A*.md
git commit -m "docs(audit): raw findings from 10 parallel domain agents"
```

---

## Phase 2 — Consolidate & triage

### Task 2.1: Write MASTER-REPORT

**Files:**
- Create: `.planning/audit-2026-05-27-data-consistency/MASTER-REPORT.md`

- [ ] **Step 1:** Dedupe cross-agent findings (same root flagged by ≥2 agents = high-confidence). Assign final severity. Build a dependency-ordered fix punch list (P0 first). Mirror the 2026-05-24 MASTER-REPORT layout (Executive summary, P0 table, P1 table, P2 bullets, cross-track convergence, stats).
- [ ] **Step 2:** For each confirmed P0/P1, add a one-line "repro" pointer (which window+store reproduces it live, or which algorithm input violates the contract) so Phase 3 can write the failing test fast.
- [ ] **Step 3: Commit**

```bash
git add .planning/audit-2026-05-27-data-consistency/MASTER-REPORT.md
git commit -m "docs(audit): master report — consolidated, triaged, dependency-ordered"
```

- [ ] **Step 4: Checkpoint with the user.** Present the P0/P1 list and confirm fix order before touching code. (Some "findings" may be intentional behavior — e.g. cross-source gaps that are legitimately explained; the user confirms which to fix vs document.)

---

## Phase 3 — Fix confirmed P0/P1 (repeating TDD loop)

For EACH confirmed P0/P1 from the punch list, in dependency order, run this exact loop. This is the per-finding procedure — repeat it once per finding. Use `superpowers:systematic-debugging` first if the root cause is not already pinned by the agent.

**Reconciliation bug loop (L1–L5):**
- [ ] **Step A: Write a failing unit test** in the file that owns the math (e.g. `src/lib/__tests__/<owner>.test.ts`), using the representative numbers from the finding's repro pointer. The test asserts the corrected invariant (e.g. `aggregate(rows).netProfit` equals the PnL formula result).
- [ ] **Step B: Run it, confirm it FAILS** for the documented reason: `cd dashboard-web && npx vitest run src/lib/__tests__/<owner>.test.ts`.
- [ ] **Step C: Implement the minimal fix** in the owning `src/lib/*.ts` / component / inngest file.
- [ ] **Step D: Run the test, confirm PASS**, then run the full suite `npm test` to confirm no regression.
- [ ] **Step E: Re-verify live** — `npm run audit:reconcile` and confirm the specific violation is gone from the printed table.
- [ ] **Step F: Commit** `git commit -m "fix(<area>): <finding-id> — <one line>"`.

**Algorithm bug loop (L6):**
- [ ] **Step A: Write a failing property/golden test** in `src/lib/__tests__/<algo>.property.test.ts` encoding the violated contract. Example shape (Health Score monotonicity):
```ts
import fc from 'fast-check';
import { computeCampaignHealth } from '../campaignHealthScore';
it('grade is monotonic in profitability, all else equal', () => {
  fc.assert(fc.property(fc.record({ roas: fc.double({ min: 0, max: 10 }), spend: fc.double({ min: 1, max: 5000 }) }), (base) => {
    const lo = computeCampaignHealth({ ...base, roas: base.roas });
    const hi = computeCampaignHealth({ ...base, roas: base.roas + 1 });
    expect(hi.score).toBeGreaterThanOrEqual(lo.score);
  }));
});
```
  (Replace `computeCampaignHealth`'s real signature/fields with the ones found in Phase 1; do not invent fields.)
- [ ] **Step B–F:** identical to the reconciliation loop, except Step E re-runs the property suite (`npx vitest run src/lib/__tests__/<algo>.property.test.ts`) instead of the live harness.

**Doc-currency gate (per finding that changes behavior):** if the fix changes a user-visible number/label → update `docs/ROAS-Dashboard-User-Manual.md`; if it changes pipeline/algorithm behavior → update `docs/ARCHITECTURE.md` (memory rule `feedback_keep_user_manual_current`). Include the doc edit in the same commit as the fix.

---

## Phase 4 — Final verification & handoff

### Task 4.1: Full re-verification

- [ ] **Step 1:** `cd dashboard-web && npm test` → all suites green (includes new property suites).
- [ ] **Step 2:** `cd dashboard-web && npx tsc --noEmit` → no type errors.
- [ ] **Step 3:** `cd dashboard-web && npm run audit:reconcile` → zero live violations (or only the explicitly-documented-as-intentional ones, listed in MASTER-REPORT).
- [ ] **Step 4:** Browser pass (use the `run` skill) over Home, P&L, Campaigns tabs against prod data: eyeball that the corrected numbers render and agree across cards/charts.

### Task 4.2: Close out

- [ ] **Step 1:** Update MASTER-REPORT with a "Resolved" column (commit per finding) and final stats.
- [ ] **Step 2:** Update memory: add/refresh a `project` memory pointing at `.planning/audit-2026-05-27-data-consistency/MASTER-REPORT.md` and the new `npm run audit:reconcile` gate.
- [ ] **Step 3:** Use `superpowers:finishing-a-development-branch` to choose merge/PR/cleanup for `audit/data-consistency-2026-05-27`.

---

## Self-review (completed)

- **Spec coverage:** L1→A1; L2→A1/A3/A4; L3→A5; L4→A6; L5→A7; L6→A9/A10; operator→A8; harness→Task 0.2-0.4; property tests→Phase 3 L6 loop + Task 0.1 dep; tolerance decision→Task 0.2; manual-gate decision→Task 0.4 (`AUDIT_LIVE`) + Task 0.1 (script, not in pre-push); report→Phase 2; fixes→Phase 3; docs rule→Phase 3 gate. No uncovered spec section.
- **Placeholder scan:** Phase 3 is a deliberately repeating procedure (findings unknown until Phase 1) — the loop steps contain concrete commands and a concrete test example, not "TODO". The one intentional unknown is *which* files each fix touches, which is a property of an audit and is resolved by Phase 1 output.
- **Type consistency:** `withinTolerance`, `agree`, `reconcileWindow`, `Violation` names are consistent across Tasks 0.2–0.4 and the live harness. `computeCampaignHealth` in the L6 example is flagged as "replace with the real signature found in Phase 1."
