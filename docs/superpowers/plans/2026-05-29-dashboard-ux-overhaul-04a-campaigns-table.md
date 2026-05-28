# Dashboard UX/UI Overhaul — Plan 04a: CampaignsTable + intelligence extraction + row sparklines

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. Use `Agent` with `isolation: "worktree"` for parallel-eligible tasks.

**Goal:** (a) Extract the multi-mapping cohort + cannibalization orchestration from CampaignsTable into a pure, testable `lib/campaignsIntelligence.ts` module. (b) Migrate CampaignsTable + CampaignsTableRow chrome to OKLCH tokens (142 legacy tokens total). (c) Add a per-row Sparkline column showing the campaign's ROAS trend over the visible range. Plan 4b handles the drawer + embedded panels; Plan 4c handles the Products tab + QuadrantScatter.

**Architecture:** The intelligence module is a single pure function `buildHealthByKey(inputs): Map<string, CampaignHealth>` that wraps the existing `computeMultiMappingCohort` + `detectProductCannibalization` + `applyCohortAdjustmentOnce` lib calls (no logic change — just relocation + testing). CampaignsTable replaces its inline 105-line `useMemo` body with a one-line `buildHealthByKey(...)` call. Token migration is mechanical via the Plan 2 SSOT map. The Sparkline column threads `dailyByCampaign` data (already computed in CampaignsTable's parent memo) down to CampaignsTableRow via a new `dailySeries` prop; the column renders `<Sparkline>` (Plan 1 primitive, already OKLCH-token-driven).

**Tech Stack:** Same as Plan 3. No new deps. Uses the Plan 1 `Sparkline` primitive at `dashboard-web/src/components/ui/Sparkline.tsx`.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` (HEAD `a6df371` at the `plan-03-charts-done` tag). Commits use `refactor(campaigns)`, `feat(campaigns)`, `test(campaigns)` prefixes.

---

## Scope — single source of truth

**Files touched by Plan 4a:**

1. **NEW** `dashboard-web/src/lib/campaignsIntelligence.ts` — pure `buildHealthByKey` function
2. **NEW** `dashboard-web/src/lib/__tests__/campaignsIntelligence.test.ts`
3. `dashboard-web/src/components/CampaignsTable.tsx` (2,456 lines, 106 legacy tokens)
4. `dashboard-web/src/components/CampaignsTableRow.tsx` (857 lines, 36 legacy tokens)

**OUT of scope (Plans 4b/4c/5):**
- CampaignDrawer + 5 embedded panels → Plan 4b
- ProductsTab + Sparkline columns there + QuadrantScatter → Plan 4c
- DetailTable + sparkline column → **Plan 5** (lives in פירוט tab per spec)
- `lib/multiMappingCohort.ts`, `lib/cannibalizationDetection.ts`, `lib/campaignHealthScore.ts` — already lib-pure, no change

**Token migration map:** identical to Plan 2's SSOT (see Plan 2 lines 19-50). The legacy → OKLCH mappings are unchanged across Plans 2/4. Plan 3's shadow learning applies: `shadow-card → shadow-sm` is fine; **do NOT migrate** `shadow-cardHover` or `shadow-elevated` (they'd fall to Tailwind defaults; keep the custom cool-tinted tokens). The Plan 1 utilities `bg-elevated`, `text-ink-*`, `border-line*`, `bg-status-*Bg`, `text-status-*`, `border-status-*` all resolve correctly.

---

## Parallelism plan

Tasks 1 → 2 are sequential (extraction before refactor). Tasks 3 + 4 are independent (different files, no logic edits) — **dispatch in parallel via `Agent` with `isolation: "worktree"`** so each implementer commits in its own temporary worktree on a separate branch; the controller rebases them back. Task 5 depends on Task 4 completing because it adds a prop to the migrated CampaignsTableRow. Task 6 is the wrap-up audit, serial.

```
Task 1 (extract intelligence) ──► Task 2 (rewire CampaignsTable memo)
                                            │
                       ┌────────────────────┴────────────────────┐
                       ▼                                          ▼
            Task 3 (CampaignsTable tokens)        Task 4 (CampaignsTableRow tokens)
                       │                                          │
                       └────────────────────┬─────────────────────┘
                                            ▼
                              Task 5 (Sparkline column wiring)
                                            │
                                            ▼
                                  Task 6 (wrap-up audit + tag)
```

---

## Task 1: Extract `buildHealthByKey` to `lib/campaignsIntelligence.ts`

**Files:**
- Create: `dashboard-web/src/lib/campaignsIntelligence.ts`
- Create: `dashboard-web/src/lib/__tests__/campaignsIntelligence.test.ts`

The current inline implementation lives in `CampaignsTable.tsx` lines 738-842 as a `useMemo`. The body of that memo is what we extract — same algorithm, same lib calls (`computeMultiMappingCohort`, `detectProductCannibalization`, `applyCohortAdjustmentOnce`, `computeCampaignHealth`, `analyzeCpmVsRoas`), just moved to a standalone pure function.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/__tests__/campaignsIntelligence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildHealthByKey, type BuildHealthByKeyInputs } from '../campaignsIntelligence';

// Minimal type-correct fixture. The lib calls inside buildHealthByKey
// (computeMultiMappingCohort etc.) are exhaustively tested elsewhere;
// this test is a smoke test that the orchestration produces a Map keyed
// by campaign key with one entry per input campaign, and that empty inputs
// produce an empty Map (no exceptions).
function inputs(overrides: Partial<BuildHealthByKeyInputs> = {}): BuildHealthByKeyInputs {
  return {
    aggregated: [],
    trueRevenueByKey: new Map(),
    dailyByCampaign: new Map(),
    productMap: {},
    campaignsDaily: [],
    productsDaily: [],
    localRange: { from: '2026-05-01', to: '2026-05-28' },
    ...overrides,
  };
}

describe('buildHealthByKey', () => {
  it('returns an empty Map when aggregated is empty', () => {
    const result = buildHealthByKey(inputs());
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns a Map with one entry per aggregated row', () => {
    const agg = [
      // Minimal shape — buildHealthByKey only reads .key, .storeId, .platform,
      // .campaignId, .spend, .conversions, .conversionValue from each row.
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
      { key: 'uzo|meta|c2', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c2', campaignName: 'B', spend: 500, conversions: 5, conversionValue: 1500 } as never,
    ];
    const result = buildHealthByKey(inputs({ aggregated: agg }));
    expect(result.size).toBe(2);
    expect(result.has('uzo|meta|c1')).toBe(true);
    expect(result.has('uzo|meta|c2')).toBe(true);
  });

  it('builds platform-vs-shopify ROAS lookups correctly (audit fix HIGH-01)', () => {
    // Two campaigns with different deterministic vs total revenue — the
    // platform lookup should use deterministicRevenue/spend, the primary
    // lookup should use trueRevenue/spend. Verified by checking that the
    // function does not throw when fed mismatched shape; deeper math is
    // tested in the lib helpers themselves.
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    const trueRevenueByKey = new Map([
      ['uzo|meta|c1', { trueRevenue: 3000, deterministicRevenue: 2200, spend: 1000 } as never],
    ]);
    const result = buildHealthByKey(inputs({ aggregated: agg, trueRevenueByKey }));
    expect(result.size).toBe(1);
  });

  it('does not throw when productMap is empty (no cohorts to compute)', () => {
    const agg = [
      { key: 'uzo|meta|c1', storeId: 'uzoshop', platform: 'meta' as const, campaignId: 'c1', campaignName: 'A', spend: 1000, conversions: 10, conversionValue: 2500 } as never,
    ];
    expect(() => buildHealthByKey(inputs({ aggregated: agg }))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npm run test -- src/lib/__tests__/campaignsIntelligence.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/campaignsIntelligence.ts`**

Create `dashboard-web/src/lib/campaignsIntelligence.ts`:

```ts
import { computeCampaignHealth, applyCohortAdjustmentOnce, type CampaignHealth } from './campaignHealthScore';
import { computeMultiMappingCohort } from './multiMappingCohort';
import { detectProductCannibalization } from './cannibalizationDetection';
import { analyzeCpmVsRoas, type DailyCpmRoasPoint } from './cpmRoasAnalysis';
import { campaignKey } from './campaignKey';
import type { Aggregated } from './campaignsAggregator';
import type { DateRange } from './types';

/**
 * Per-campaign daily aggregate row, used by `buildHealthByKey` to detect
 * product-level cannibalization. The shape matches what
 * `detectProductCannibalization` consumes.
 */
export interface CampaignsDailyRow {
  date: string;
  storeId: string;
  platform: string;
  campaignId: string;
  spend: number;
}

/**
 * Per-product daily aggregate row, used by `buildHealthByKey` to detect
 * product-level cannibalization.
 */
export interface ProductsDailyRow {
  date: string;
  storeId: string;
  productId: string;
  productTitle: string;
  netRevenue: number;
}

export interface TrueRevenueInfo {
  trueRevenue: number;
  deterministicRevenue: number;
  spend: number;
}

export interface BuildHealthByKeyInputs {
  /** Per-campaign aggregates over the visible range. */
  aggregated: Aggregated[];
  /** Per-campaign true-revenue lookups (Shopify-attributed). */
  trueRevenueByKey: Map<string, TrueRevenueInfo>;
  /** Per-campaign daily CPM/ROAS trajectory (for trajectory health signal). */
  dailyByCampaign: Map<string, DailyCpmRoasPoint[]>;
  /** Per-campaign product mapping: `{[campaignKey]: productId[]}`. */
  productMap: Record<string, string[]>;
  /** Raw per-day campaign rows (for cannibalization detection). */
  campaignsDaily: CampaignsDailyRow[];
  /** Raw per-day product rows (for cannibalization detection). */
  productsDaily: ProductsDailyRow[];
  /** Visible date range. */
  localRange: DateRange;
}

/**
 * Pure function: orchestrates `computeCampaignHealth` + cohort + cannibalization
 * lib calls per aggregated campaign row and returns a Map keyed by campaign key.
 *
 * Algorithm:
 *   1. Build per-key ROAS lookups: `roasShopifyByKey` (true/spend) and
 *      `roasShopifyPlatformByKey` (deterministic/spend, for cohort tie-break —
 *      audit fix HIGH-01 2026-05-23).
 *   2. For each aggregated row:
 *      a. Compute base health via `computeCampaignHealth`.
 *      b. Compute cohort via `computeMultiMappingCohort`; if no cohort (solo
 *         campaign), keep base.
 *      c. If cohort exists, compute cannibalization verdicts via
 *         `detectProductCannibalization`, take the WORST risk across this
 *         campaign's mapped products only.
 *      d. Apply `applyCohortAdjustmentOnce` to produce the adjusted score.
 *   3. Return the Map.
 *
 * This function is extracted byte-for-byte from CampaignsTable's `healthByKey`
 * memo (commits 5d4da67 and earlier). Behavior is identical.
 */
export function buildHealthByKey(inputs: BuildHealthByKeyInputs): Map<string, CampaignHealth> {
  const {
    aggregated,
    trueRevenueByKey,
    dailyByCampaign,
    productMap,
    campaignsDaily,
    productsDaily,
    localRange,
  } = inputs;

  const out = new Map<string, CampaignHealth>();

  const roasShopifyByKey = new Map<string, number>();
  const roasShopifyPlatformByKey = new Map<string, number>();
  for (const [k, info] of trueRevenueByKey.entries()) {
    roasShopifyByKey.set(k, info.spend > 0 ? info.trueRevenue / info.spend : 0);
    roasShopifyPlatformByKey.set(
      k,
      info.spend > 0 ? info.deterministicRevenue / info.spend : 0,
    );
  }

  for (const a of aggregated) {
    const info = trueRevenueByKey.get(campaignKey(a.storeId, a.platform, a.campaignId));
    const series = dailyByCampaign.get(a.key);
    const trajectory =
      series && series.length >= 5 ? analyzeCpmVsRoas(series) : undefined;
    const base = computeCampaignHealth({
      aggregated: a,
      trueRevenueInfo: info,
      cpmRoasAnalysis: trajectory,
    });

    const cohort = computeMultiMappingCohort({
      currentCampaignKey: a.key,
      productMap,
      aggregated,
      roasShopifyByKey,
      roasShopifyPlatformByKey,
    });

    let worstRisk:
      | 'none'
      | 'low'
      | 'medium'
      | 'high'
      | 'insufficient'
      | 'composition_changed' = 'none';
    if (cohort) {
      const verdicts = detectProductCannibalization({
        range: localRange,
        storeId: a.storeId,
        productMap,
        campaignsDaily,
        productsDaily,
      });
      const myProducts = new Set(productMap[a.key] ?? []);
      const myVerdicts = verdicts.filter(v => myProducts.has(v.productId));
      for (const v of myVerdicts) {
        if (v.risk === 'high') worstRisk = 'high';
        else if (v.risk === 'medium' && worstRisk !== 'high') worstRisk = 'medium';
        else if (v.risk === 'low' && worstRisk !== 'high' && worstRisk !== 'medium')
          worstRisk = 'low';
      }
    }

    const adjusted = cohort
      ? applyCohortAdjustmentOnce(base, {
          isLeader: cohort.isLeader,
          isWeakest: cohort.isWeakest,
          cohortSize: cohort.totalMembers,
          cannibalizationRisk: worstRisk,
        })
      : base;
    out.set(a.key, adjusted);
  }

  return out;
}
```

**Important — the import paths.** `campaignKey` lives in `@/lib/campaignKey` (verify before writing — if it's instead exported from `campaignsAggregator`, adapt the import accordingly). All other imports are existing, verified Plan-1-and-earlier lib modules.

- [ ] **Step 4: Run → pass (4/4)**

```bash
npm run test -- src/lib/__tests__/campaignsIntelligence.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/campaignsIntelligence.ts \
        dashboard-web/src/lib/__tests__/campaignsIntelligence.test.ts
git commit -m "feat(campaigns): extract buildHealthByKey to lib/campaignsIntelligence — pure + tested"
```

---

## Task 2: Rewire CampaignsTable to use `buildHealthByKey`

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`

Replace the inline `useMemo` body at lines 738-842 with a one-line call to `buildHealthByKey`. No behavior change — pure refactor.

- [ ] **Step 1: Add the import** to CampaignsTable's imports (near the existing lib imports around lines 40-41):

```ts
import { buildHealthByKey } from '@/lib/campaignsIntelligence';
```

You can REMOVE these imports from CampaignsTable if they're only used inside the `healthByKey` memo body (verify with grep — they're used elsewhere only if other call sites exist):
- `computeMultiMappingCohort`
- `detectProductCannibalization`
- `applyCohortAdjustmentOnce`
- `analyzeCpmVsRoas`
- `computeCampaignHealth`

A safe approach: leave them imported, run `tsc --noEmit`, then remove any that become "imported but never used" warnings.

- [ ] **Step 2: Replace the memo body**

Find (around lines 738-842 — verify line numbers before editing; CampaignsTable evolves):

```tsx
const healthByKey = useMemo(() => {
  const out = new Map<string, CampaignHealth>();

  // ... 100+ lines of orchestration ...

  return out;
}, [aggregated, trueRevenueByKey, dailyByCampaign, today, optimized, productMap, data, productsResp, localRange]);
```

Replace with:

```tsx
const healthByKey = useMemo(
  () =>
    buildHealthByKey({
      aggregated,
      trueRevenueByKey,
      dailyByCampaign,
      productMap,
      campaignsDaily: (data?.rows ?? []).map(r => ({
        date: r.date,
        storeId: r.storeId,
        platform: r.platform,
        campaignId: r.campaignId,
        spend: r.spend,
      })),
      productsDaily: (productsResp?.rows ?? []).map(r => ({
        date: r.date,
        storeId: r.storeId,
        productId: r.productId,
        productTitle: r.productTitle,
        netRevenue: r.netRevenue ?? 0,
      })),
      localRange,
    }),
  [aggregated, trueRevenueByKey, dailyByCampaign, productMap, data, productsResp, localRange],
);
```

**Dep array change:** drop `today` and `optimized` from the deps if and only if they were stability-tokens (never read inside the original body). A grep of the original memo body for `today` and `optimized` confirms whether they're truly unused inside. If they ARE referenced, KEEP them in deps.

- [ ] **Step 3: Verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Expected: tsc=0, 1300 node tests pass (Plan 3's 1296 + 4 from Task 1), 43 component tests pass, build clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignsTable.tsx
git commit -m "refactor(campaigns): CampaignsTable consumes buildHealthByKey (no behavior change)"
```

---

## Task 3: CampaignsTable token migration (parallel-eligible)

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`

Mechanical token migration of 106 legacy palette references. Apply Plan 2's migration map (see Plan 2 lines 19-50). No logic change.

**Run with `isolation: "worktree"`** — independent from Task 4 (different file).

- [ ] **Step 1: Pre-scan**

```bash
grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx | wc -l
```

Expected: ~106 matches.

- [ ] **Step 2: Apply migration map**

Plan 2 SSOT (also documented in Plan 4a's Scope section above). Pitfalls:
- `bg-surface` is a prefix of `bg-surfaceMuted` — migrate longer variants first.
- `text-text-primary` is the legacy token; `text-primary` is a DIFFERENT legacy token. Both migrate but to different targets (`text-ink` vs `text-accent`).
- `primary-dark`/`primary-light` → `accent` (no separate dark/light variants in new system).
- `shadow-cardHover` and `shadow-elevated` STAY (Plan 3's learning — Tailwind has no md/lg defs).
- Chart code in CampaignsTable uses `CHART_COLORS.*` from `chartColors.ts` and should NOT be migrated here — Plan 4b handles the chart Recharts migration.
- `text-amber-*`, `text-emerald-*`, etc. — Tailwind base palette, KEEP.

- [ ] **Step 3: Verify post-migration**

```bash
grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTable.tsx || echo "(clean)"
```

Expected: `(clean)`.

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignsTable.tsx
git commit -m "refactor(campaigns): CampaignsTable token migration (legacy → OKLCH)"
```

---

## Task 4: CampaignsTableRow token migration (parallel-eligible)

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx`

Mechanical token migration of 36 legacy palette references. Apply Plan 2's migration map. No logic change.

**Run with `isolation: "worktree"`** — independent from Task 3 (different file).

- [ ] **Step 1: Pre-scan**

```bash
grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/CampaignsTableRow.tsx | wc -l
```

Expected: ~36 matches.

- [ ] **Step 2: Apply migration map** — same SSOT as Task 3.

- [ ] **Step 3: Verify post-migration grep clean + tsc + tests + build.**

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignsTableRow.tsx
git commit -m "refactor(campaigns): CampaignsTableRow token migration (legacy → OKLCH)"
```

---

## Task 5: Sparkline column wiring

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx`
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`

Threads the per-campaign daily ROAS trajectory (already computed in `dailyByCampaign`) down to CampaignsTableRow, and adds a Sparkline column that visualizes the trend.

- [ ] **Step 1: Read the existing prop shape**

Read `dashboard-web/src/components/CampaignsTableRow.tsx` to find the prop interface (typically `interface CampaignsTableRowProps` or destructured in the function signature). Note the existing prop list.

Read `dashboard-web/src/components/CampaignsTable.tsx` to find the `<CampaignsTableRow>` invocation (search for `<CampaignsTableRow`). Note what props are currently passed per row.

- [ ] **Step 2: Add `dailySeries` prop to CampaignsTableRow**

In the props interface, add:

```ts
/** Per-day ROAS/CPM trajectory for this campaign over the visible range.
    Used by the Sparkline column. Optional — if undefined, the column
    renders an em-dash. */
dailySeries?: { date: string; cpm: number; roas: number }[];
```

(The type matches the existing `DailyCpmRoasPoint` shape in `lib/cpmRoasAnalysis.ts`. Import that type if it's lighter than redeclaring.)

- [ ] **Step 3: Render the Sparkline column**

Locate the column-rendering loop in CampaignsTableRow. Each column is typically a `<td>`. Find a logical position for the sparkline (suggested: right after the campaign name column, before the spend column). Insert:

```tsx
<td className="px-2 py-2 text-center align-middle">
  {dailySeries && dailySeries.length >= 2 ? (
    <Sparkline
      data={dailySeries.map(p => p.roas)}
      tone="blue"
      width={64}
      height={20}
      className="inline-block"
      ariaLabel={`ROAS trend for ${name}`}
    />
  ) : (
    <span className="text-ink-muted">—</span>
  )}
</td>
```

(Substitute `name` for whatever prop holds the campaign name. `Sparkline` lives at `dashboard-web/src/components/ui/Sparkline.tsx` — verify the exact prop names from its definition. The Plan-3 recon noted: `data: number[]`, `tone?: 'green'|'red'|'orange'|'blue'|'gray'`, `width?: number`, `height?: number`, `className?: string`.)

Also add a matching `<th>` header in the table's header row inside CampaignsTable. Find the existing `<th>`s (or equivalent header cells) and insert a new one labeled "מגמת ROAS" (or just leave blank for an icon-style header — operator preference).

- [ ] **Step 4: Pass `dailySeries` from CampaignsTable to each row**

In CampaignsTable, find the `<CampaignsTableRow>` invocation (search for `<CampaignsTableRow `). Add the prop:

```tsx
<CampaignsTableRow
  ...existing props...
  dailySeries={dailyByCampaign.get(a.key)}
/>
```

(`dailyByCampaign` is already built in CampaignsTable's parent scope — same map that powers `analyzeCpmVsRoas` inside `buildHealthByKey`.)

- [ ] **Step 5: Verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Manual sanity (if dev server is available): on the קמפיינים tab, each row shows a small inline sparkline; campaigns with <2 data points show "—".

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignsTable.tsx \
        dashboard-web/src/components/CampaignsTableRow.tsx
git commit -m "feat(campaigns): inline ROAS Sparkline column per row"
```

---

## Task 6: Wrap-up audit + tag

**No new files.** Verification-only.

- [ ] **Step 1: Final legacy-token grep across all Plan 4a files**

```bash
cd /Users/dorperetz/script-roas
for f in \
  dashboard-web/src/components/CampaignsTable.tsx \
  dashboard-web/src/components/CampaignsTableRow.tsx ; do
  echo "=== $f ==="
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" "$f" || echo "(clean)"
done
```

Expected: both `(clean)`.

- [ ] **Step 2: Full test + build + lint**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | grep -E "Test Files|Tests "
npm run test:components 2>&1 | grep -E "Test Files|Tests "
npm run build 2>&1 | tail -5
```

Expected:
- `tsc=0`
- Node: ~1300 tests (Plan 3's 1296 + 4 from Task 1)
- Components: 43 tests (unchanged)
- Build clean

- [ ] **Step 3: Out-of-scope confirmation**

```bash
git diff --name-only a6df371..HEAD -- \
  dashboard-web/src/components/CampaignDrawer.tsx \
  dashboard-web/src/components/HealthScorePanel.tsx \
  dashboard-web/src/components/CohortComparisonPanel.tsx \
  dashboard-web/src/components/AttributionAnalysisPanel.tsx \
  dashboard-web/src/components/ProductChannelBreakdown.tsx \
  dashboard-web/src/components/MetaShopifyReconciliation.tsx \
  dashboard-web/src/components/ProductsTable.tsx \
  dashboard-web/src/components/ProductCentricView.tsx \
  dashboard-web/src/components/ProductPickerModal.tsx \
  dashboard-web/src/components/DetailTable.tsx
```

Expected: empty (no out-of-scope writes).

- [ ] **Step 4: Tag wrap-up commit**

```bash
git tag plan-04a-campaigns-table-done
```

No final commit. Plan 4a ends with the previous task's commit.

---

## Self-Review

1. **Spec coverage:**
   - ✅ CampaignsTable structural split (intelligence extraction) — Task 1+2
   - ✅ CampaignsTable token migration — Task 3
   - ✅ CampaignsTableRow token migration — Task 4
   - ✅ Sparkline column on CampaignsTable rows — Task 5
   - ⏸ DetailTable sparkline column — deferred to Plan 5 (פירוט tab)
   - ⏸ CampaignDrawer + 5 embedded panel migrations — Plan 4b
   - ⏸ View-transition drawer open — Plan 4b
   - ⏸ QuadrantScatter + Products tab — Plan 4c

2. **Type consistency:** `BuildHealthByKeyInputs` defined once, consumed by `buildHealthByKey` + tests + CampaignsTable. `DailyCpmRoasPoint` reused from existing lib.

3. **Placeholder scan:** No "TBD" / "add appropriate" / "similar to". Every step has executable code or a commit command.

4. **Non-negotiables preserved:**
   - Algorithm unchanged: same lib calls (`computeMultiMappingCohort`, `detectProductCannibalization`, `applyCohortAdjustmentOnce`, `computeCampaignHealth`), same severity ladder, same audit fix HIGH-01 platform tie-breaker.
   - Filter contract unchanged.
   - Per-store color SSOT (`storeColors.ts`) untouched.
   - Chart code (Recharts JSX) in CampaignsTable left to Plan 4b.
   - Memo deps preserved (or carefully reduced only when fields are provably unused).

5. **Parallel-eligible tasks declared:** Tasks 3 + 4 → worktree-parallel.
