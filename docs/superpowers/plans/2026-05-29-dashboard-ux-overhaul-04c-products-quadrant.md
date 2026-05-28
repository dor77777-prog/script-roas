# Dashboard UX/UI Overhaul — Plan 04c: Products tab + QuadrantScatter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Tasks 2-4 are worktree-parallel candidates.

**Goal:** Build the new `QuadrantScatter` component (ROAS × CAC scatter for the קמפיינים tab — a Northbeam-style quadrant card), migrate the 3 products-tab components to OKLCH tokens (ProductsTable, ProductCentricView, ProductPickerModal — 143 legacy tokens total), wire QuadrantScatter into Dashboard.tsx's `CampaignsTab`, and token-migrate the `ProductsTab` sub-tab nav in Dashboard.tsx.

**Architecture:** `QuadrantScatter` is a new `components/QuadrantScatter.tsx` component using Recharts v3 `ScatterChart` + the Plan 3 chart primitives. It receives `data: { name: string; roas: number; cac: number; spend: number }[]` and renders a 2-axis scatter with quadrant dividers (median lines). Per-campaign points colored by the dashboard's existing storeColors SSOT. The 3 token migrations are mechanical via Plan 2's SSOT map (identical to Plans 2, 4a, 4b).

**Tech Stack:** Uses Plan 3's `ChartContainer` + `ChartTooltip` primitives. No new deps.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` after Plan 4b's `plan-04b-drawer-panels-done` tag.

---

## Scope — single source of truth

**Files touched by Plan 4c:**

| File | Lines | Legacy tokens | New code? |
|------|-------|---------------|-----------|
| ProductsTable.tsx | 933 | 68 | no |
| ProductCentricView.tsx | 877 | 46 | no |
| ProductPickerModal.tsx | 410 | 29 | no |
| Dashboard.tsx (ProductsTab + CampaignsTab regions only) | (large file) | ~20 in those regions | wire QuadrantScatter into CampaignsTab |
| **NEW** QuadrantScatter.tsx | — | — | full new file |
| **NEW** `__tests__/QuadrantScatter.test.tsx` | — | — | full new file |

**OUT of scope (deferred):**
- DetailTable.tsx → Plan 5
- MonthlyTables → Plan 5
- PnLBreakdown → Plan 5
- Operator console → Plan 6
- `storeColors.ts` → Plan 7

**Token migration map:** Plan 2 SSOT (identical to Plans 2, 4a, 4b).

---

## Parallelism plan

```
                  Task 1 (QuadrantScatter primitive + tests)
                              │
                              ▼
                    ┌─ Worktree A: Task 2 (ProductsTable tokens)
                    ├─ Worktree B: Task 3 (ProductCentricView tokens)
PARALLEL ───────────┼─ Worktree C: Task 4 (ProductPickerModal tokens)
                    └─ Worktree D: Task 5 (Dashboard.tsx ProductsTab/CampaignsTab tokens)
                              │
                              ▼  (rebase all worktrees)
                       Task 6 (wire QuadrantScatter into CampaignsTab)
                              │
                              ▼
                       Task 7 (wrap-up audit + tag)
```

Task 1 must complete first because Task 6 imports `QuadrantScatter`. Tasks 2-5 are 4 independent files — true worktree-parallel. Task 5 (Dashboard.tsx tokens) must complete before Task 6 (Dashboard.tsx QuadrantScatter wiring) because both edit Dashboard.tsx.

---

## Task 1: QuadrantScatter component + tests

**Files:**
- Create: `dashboard-web/src/components/QuadrantScatter.tsx`
- Create: `dashboard-web/src/components/__tests__/QuadrantScatter.test.tsx`

The scatter renders campaign-level ROAS (x-axis) vs CAC (y-axis) points. Median ROAS + median CAC define the quadrant dividers, splitting visible campaigns into 4 archetypes: top-left (low ROAS, high CAC = "bleeding"), top-right (high ROAS, high CAC = "scaling expensive"), bottom-left (low ROAS, low CAC = "small underperformers"), bottom-right (high ROAS, low CAC = "stars").

### Step 1 — Write the failing test

Create `dashboard-web/src/components/__tests__/QuadrantScatter.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuadrantScatter, type QuadrantPoint } from '../QuadrantScatter';

const POINTS: QuadrantPoint[] = [
  { name: 'A', roas: 1.5, cac: 80, spend: 1000 },
  { name: 'B', roas: 3.2, cac: 25, spend: 1500 },
  { name: 'C', roas: 2.0, cac: 50, spend: 800 },
  { name: 'D', roas: 4.5, cac: 12, spend: 2200 },
];

describe('QuadrantScatter', () => {
  it('renders without crashing on empty data', () => {
    expect(() => render(<QuadrantScatter data={[]} />)).not.toThrow();
  });

  it('renders the title when one is provided', () => {
    render(<QuadrantScatter data={POINTS} title="ROAS × CAC" />);
    expect(screen.getByText('ROAS × CAC')).toBeInTheDocument();
  });

  it('renders an empty-state message when data is empty', () => {
    render(<QuadrantScatter data={[]} />);
    expect(screen.getByText(/אין נתונים|לא נמצאו קמפיינים/)).toBeInTheDocument();
  });

  it('accepts a custom height prop', () => {
    const { container } = render(<QuadrantScatter data={POINTS} height={300} />);
    // Recharts ResponsiveContainer renders inside; just ensure no crash + DOM present.
    expect(container.firstChild).not.toBeNull();
  });
});
```

### Step 2 — Run → fail

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npm run test:components -- QuadrantScatter.test.tsx
```

Expected: FAIL (module missing).

### Step 3 — Implement `QuadrantScatter.tsx`

Create `dashboard-web/src/components/QuadrantScatter.tsx`:

```tsx
import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
import { cn } from '@/lib/utils';

export interface QuadrantPoint {
  /** Campaign / item display name. */
  name: string;
  /** Return on ad spend (revenue / spend). */
  roas: number;
  /** Customer-acquisition cost (spend / conversions). */
  cac: number;
  /** Total spend in display currency (CAD). Used for point radius scaling. */
  spend: number;
}

/**
 * Northbeam-style ROAS × CAC quadrant scatter. Renders each campaign as a
 * point; median ROAS + median CAC define the quadrant dividers.
 *
 * Read this as four archetypes:
 *   - top-right (high ROAS, high CAC):     "scaling expensive"
 *   - bottom-right (high ROAS, low CAC):   "stars"
 *   - top-left (low ROAS, high CAC):        "bleeding"
 *   - bottom-left (low ROAS, low CAC):      "small underperformers"
 */
export function QuadrantScatter({
  data,
  title,
  className,
  height = 260,
}: {
  data: QuadrantPoint[];
  title?: string;
  className?: string;
  height?: number;
}) {
  const { medRoas, medCac } = useMemo(() => {
    if (data.length === 0) return { medRoas: 0, medCac: 0 };
    const roasSorted = [...data].map(d => d.roas).sort((a, b) => a - b);
    const cacSorted = [...data].map(d => d.cac).sort((a, b) => a - b);
    const med = (arr: number[]) => arr[Math.floor(arr.length / 2)];
    return { medRoas: med(roasSorted), medCac: med(cacSorted) };
  }, [data]);

  // Map point spend → radius (4-12px) so larger-spend campaigns visually
  // dominate without overwhelming the chart.
  const points = useMemo(
    () =>
      data.map(d => ({
        ...d,
        z: Math.max(4, Math.min(12, Math.sqrt(Math.max(d.spend, 0)) / 6)),
      })),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className={cn('rounded-xl bg-elevated border border-line p-5', className)}>
        {title && (
          <h3 className="text-sm sm:text-base font-semibold text-ink mb-2">{title}</h3>
        )}
        <div className="text-ink-muted text-sm text-center py-8">
          אין נתונים להצגה — בחר טווח עם קמפיינים פעילים.
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl bg-elevated border border-line p-3 sm:p-5', className)}>
      {title && (
        <h3 className="text-sm sm:text-base font-semibold text-ink mb-3">{title}</h3>
      )}
      <ChartContainer height={height}>
        <ScatterChart margin={{ top: 12, right: 24, left: 24, bottom: 24 }}>
          <CartesianGrid
            strokeDasharray="2 4"
            stroke="var(--chart-grid)"
            strokeOpacity={0.55}
          />
          <XAxis
            type="number"
            dataKey="roas"
            name="ROAS"
            tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
            label={{ value: 'ROAS →', position: 'insideBottom', offset: -10, fontSize: 10, fill: 'var(--chart-axis)' }}
          />
          <YAxis
            type="number"
            dataKey="cac"
            name="CAC"
            tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
            label={{ value: 'CAD CAC →', angle: -90, position: 'insideLeft', offset: 16, fontSize: 10, fill: 'var(--chart-axis)' }}
            reversed
          />
          <ReferenceLine
            x={medRoas}
            stroke="var(--chart-cursor)"
            strokeDasharray="3 5"
            strokeOpacity={0.55}
          />
          <ReferenceLine
            y={medCac}
            stroke="var(--chart-cursor)"
            strokeDasharray="3 5"
            strokeOpacity={0.55}
          />
          <Tooltip
            cursor={{ stroke: 'var(--chart-cursor)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as QuadrantPoint;
              return (
                <ChartTooltip>
                  <ChartTooltipLabel>{p.name}</ChartTooltipLabel>
                  <ChartTooltipRow color="var(--status-green)" label="ROAS">
                    <ChartTooltipValue>{p.roas.toFixed(2)}</ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--status-orange)" label="CAC">
                    <ChartTooltipValue>
                      CAD {Math.round(p.cac).toLocaleString('he-IL')}
                    </ChartTooltipValue>
                  </ChartTooltipRow>
                  <ChartTooltipRow color="var(--accent)" label="הוצאה">
                    <ChartTooltipValue>
                      CAD {Math.round(p.spend).toLocaleString('he-IL')}
                    </ChartTooltipValue>
                  </ChartTooltipRow>
                </ChartTooltip>
              );
            }}
          />
          <Scatter
            data={points}
            fill="var(--accent)"
            shape={(props: { cx?: number; cy?: number; payload?: QuadrantPoint & { z: number } }) => {
              const { cx, cy, payload } = props;
              if (cx == null || cy == null || !payload) return <g />;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={payload.z}
                  fill="var(--accent)"
                  fillOpacity={0.7}
                  stroke="var(--accent)"
                  strokeWidth={1}
                />
              );
            }}
          />
        </ScatterChart>
      </ChartContainer>
    </div>
  );
}
```

### Step 4 — Run → pass (4/4)

```bash
npm run test:components -- QuadrantScatter.test.tsx
```

### Step 5 — Verify tsc + commit

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
```

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/QuadrantScatter.tsx \
        dashboard-web/src/components/__tests__/QuadrantScatter.test.tsx
git commit -m "feat(campaigns): QuadrantScatter — ROAS × CAC quadrant card (Recharts v3 + Plan-3 primitives)"
```

---

## Task 2: ProductsTable token migration (worktree-parallel)

**File:** `dashboard-web/src/components/ProductsTable.tsx` (933 lines, 68 tokens).

Follow the shared migration template (see Plan 4b's "Shared task template" — identical mappings).

- [ ] Pre-scan → confirm 68 tokens.
- [ ] Apply Plan 2 SSOT map.
- [ ] Verify clean grep + tsc + tests.
- [ ] Commit:
```bash
git add dashboard-web/src/components/ProductsTable.tsx
git commit -m "refactor(products): ProductsTable token migration"
```

---

## Task 3: ProductCentricView token migration (worktree-parallel)

**File:** `dashboard-web/src/components/ProductCentricView.tsx` (877 lines, 46 tokens).

- [ ] Pre-scan → confirm 46 tokens.
- [ ] Apply Plan 2 SSOT map.
- [ ] Verify + commit:
```bash
git add dashboard-web/src/components/ProductCentricView.tsx
git commit -m "refactor(products): ProductCentricView token migration"
```

---

## Task 4: ProductPickerModal token migration (worktree-parallel)

**File:** `dashboard-web/src/components/ProductPickerModal.tsx` (410 lines, 29 tokens).

- [ ] Pre-scan → confirm 29 tokens.
- [ ] Apply Plan 2 SSOT map.
- [ ] Verify + commit:
```bash
git add dashboard-web/src/components/ProductPickerModal.tsx
git commit -m "refactor(products): ProductPickerModal token migration"
```

---

## Task 5: Dashboard.tsx ProductsTab + CampaignsTab region token migration (worktree-parallel with Tasks 2-4)

**File:** `dashboard-web/src/components/Dashboard.tsx` — ONLY the `CampaignsTab` function (lines 526-572) and the `ProductsTab` function + `PRODUCTS_SUBTABS` const (lines 559-630 or similar — verify line numbers before editing).

Other tabs in Dashboard.tsx are out of scope for this task. Plan 5 will own the remaining tabs (ניתוח, P&L, פירוט).

- [ ] **Step 1: Pre-scan THE TWO regions only**

```bash
sed -n '526,650p' /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx \
  | grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$"
```

- [ ] **Step 2: Apply migration map** only within these regions. Be careful: Dashboard.tsx has token-using tabs OUTSIDE Plan 4c scope. DO NOT migrate tokens in `PnLTab`, `AnalysisTab`, `DetailTab` — Plan 5 owns those.

- [ ] **Step 3: Verify grep on those regions only is clean. Full-file grep will still show OTHER tabs' tokens — that's expected.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx
git commit -m "refactor(home/campaigns/products): Dashboard.tsx CampaignsTab + ProductsTab token migration"
```

---

## Task 6: Wire QuadrantScatter into CampaignsTab

**File:** `dashboard-web/src/components/Dashboard.tsx` — CampaignsTab function.

After Task 5 lands, add the QuadrantScatter card to CampaignsTab. The card sits ABOVE the CampaignsTable (the operator wants the at-a-glance quadrant view first, then the detailed table below).

- [ ] **Step 1: Add the import** to Dashboard.tsx imports:

```tsx
import { QuadrantScatter, type QuadrantPoint } from './QuadrantScatter';
```

- [ ] **Step 2: Lift campaign data**

Read the CampaignsTab function. It currently passes `data: DashboardData` and `filters: F` to a single `<CampaignsTable>`. The aggregated campaign data lives INSIDE CampaignsTable's SWR. Two options:

**Option A (preferred — lightweight):** Have QuadrantScatter do its own SWR fetch (same key as CampaignsTable; SWR dedupes). This avoids restructuring CampaignsTable.

**Option B (heavier):** Lift the SWR fetch + `aggregated` computation up to CampaignsTab and pass `aggregated` down to both QuadrantScatter and CampaignsTable.

For Plan 4c, use **Option A** — it's smaller and doesn't risk breaking CampaignsTable's existing state. If a future plan rationalizes the data flow, Option B becomes natural.

- [ ] **Step 3: Inside CampaignsTab, render QuadrantScatter above CampaignsTable**

```tsx
function CampaignsTab({ data, filters, setFilters }: { ... }) {
  // ... existing code ...
  return (
    <div className="space-y-4 sm:space-y-5">
      {/* QuadrantScatter — ROAS × CAC quadrant view at-a-glance */}
      <QuadrantScatterCard data={data} filters={filters} />

      <CampaignsTable data={data} filters={filters} setFilters={setFilters} ... />
    </div>
  );
}
```

Implement `QuadrantScatterCard` as a small wrapper inside Dashboard.tsx (or a new tiny file `components/QuadrantScatterCard.tsx`) that:

1. Calls the same SWR endpoint CampaignsTable uses (search CampaignsTable for `useSWR(...campaigns...)` — copy the same key).
2. Aggregates the SWR rows the same way (most likely via the existing `aggregate(...)` helper from `@/lib/campaignsAggregator`).
3. Derives `QuadrantPoint[]` from the aggregated rows:
   - `name = a.campaignName`
   - `roas = a.spend > 0 ? a.conversionValue / a.spend : 0`
   - `cac = a.conversions > 0 ? a.spend / a.conversions : 0`
   - `spend = a.spend`
4. Filters out rows with `cac <= 0` or `roas <= 0` (can't plot meaningfully).
5. Passes to `<QuadrantScatter data={points} title="ROAS × CAC לקמפיינים פעילים" />`.

This wrapper is ~30-50 lines. If the CampaignsTable SWR key construction is intricate (e.g. involves localRange or a per-store key), the wrapper may need ~5 extra lines to mirror.

- [ ] **Step 4: Verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/Dashboard.tsx
# If QuadrantScatterCard.tsx was created as separate file:
# git add dashboard-web/src/components/QuadrantScatterCard.tsx
git commit -m "feat(campaigns): wire QuadrantScatter card above CampaignsTable on קמפיינים tab"
```

---

## Task 7: Wrap-up audit + tag

- [ ] **Step 1: Legacy-token grep on Plan 4c files**

```bash
cd /Users/dorperetz/script-roas
for f in \
  dashboard-web/src/components/ProductsTable.tsx \
  dashboard-web/src/components/ProductCentricView.tsx \
  dashboard-web/src/components/ProductPickerModal.tsx ; do
  echo "=== $f ==="
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" "$f" || echo "(clean)"
done
```

Each must print `(clean)`.

- [ ] **Step 2: Verify Dashboard.tsx ProductsTab + CampaignsTab regions are clean**

```bash
sed -n '526,650p' /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx \
  | grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$"
```

Expected: 0 within that range.

- [ ] **Step 3: Full test + build**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test:all 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

Expected: tsc=0, all tests pass (Plan 4a's lib tests + Plan 4c's QuadrantScatter tests added), build clean.

- [ ] **Step 4: Out-of-scope confirmation**

```bash
git diff --name-only plan-04b-drawer-panels-done..HEAD -- \
  dashboard-web/src/components/MonthlyTables.tsx \
  dashboard-web/src/components/DetailTable.tsx \
  dashboard-web/src/components/PnLBreakdown.tsx
```

Expected: empty (Plan 5 territory).

- [ ] **Step 5: Tag**

```bash
git tag plan-04c-products-quadrant-done
```

---

## Self-Review

1. **Spec coverage:**
   - ✅ QuadrantScatter NEW component — Task 1 + 6
   - ✅ ProductsTable token migration — Task 2
   - ✅ ProductCentricView token migration — Task 3
   - ✅ ProductPickerModal token migration — Task 4
   - ✅ ProductsTab sub-tab token migration — Task 5
   - ✅ CampaignsTab wiring for QuadrantScatter — Task 6

2. **Non-negotiables preserved:**
   - ProductCentricView's SWR fetching unchanged.
   - ProductsTable's filtering and sorting logic unchanged.
   - ProductPickerModal's onSave callback unchanged.
   - CampaignsTable's SWR data flow unchanged (QuadrantScatterCard does its own dedup-friendly fetch).
   - Per-store color SSOT (`storeColors.ts`) untouched.

3. **Type consistency:** `QuadrantPoint` defined once in QuadrantScatter.tsx, consumed by QuadrantScatterCard wrapper and the test.

4. **Placeholder scan:** No "TBD" / "similar to". Task 6's "implement QuadrantScatterCard" includes the 4 derivation steps + the field formulas inline.

5. **Parallelism declared:** Tasks 2-5 worktree-parallel. Tasks 1 + 6 + 7 sequential.

6. **Test count expectations:** +4 component tests from QuadrantScatter (Plan 3's 43 + Plan 4c's 4 = 47). Node tests stable.
