# Dashboard UX/UI Overhaul — Plan 03: Charts upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Recharts 2.15 → 3.x, introduce shadcn-style `ChartContainer` / `ChartTooltip` / `ChartLegend` primitives in `components/ui/chart/`, then migrate the two Plan-3-scope Recharts consumers — `HeroOverview.tsx` (area chart in the hero card) and `RoasChart.tsx` (multi-line trend chart in the ניתוח tab) — to use the new primitives AND the locked 2026 chart visual vocabulary (solid stroke + ≤15 % gradient fill, dashed gridlines at low opacity, live crosshair on hover with mono-font tooltip values).

**Architecture:** Three small presentational primitives. `ChartContainer` wraps `ResponsiveContainer` and applies the OKLCH chart-surface tokens via CSS vars on its wrapper `<div>`. `ChartTooltip` is a styled `<div>` consumers render INSIDE their Recharts `Tooltip`'s `content` function (keeps existing tooltip body code; only swaps the chrome and the value font to `font-mono`). `ChartLegend` is a flex container for swatch+label pairs — invoked by consumers that need a legend (`RoasChart` does; `HeroOverview`'s area chart does not). All three primitives are pure (no state, no I/O) and theme-aware via the OKLCH tokens introduced in Plan 1.

**Tech Stack:** `recharts` ^3.x (bump from ^2.15.0), React 19, TypeScript, Tailwind v3.x with the OKLCH token system from Plan 1, Vitest + @testing-library/react for tests, Next.js dev/build pipeline.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` (HEAD `acce545` at the `plan-02-bayit-tab-done` tag). Commits use `chore(charts)`, `feat(charts)`, `refactor(charts)`, `test(charts)` prefixes.

---

## Scope — single source of truth

**In scope for Plan 3 (5 production files touched):**

1. `dashboard-web/package.json` — bump recharts to ^3.x
2. `dashboard-web/src/components/ui/chart/ChartContainer.tsx` (NEW)
3. `dashboard-web/src/components/ui/chart/ChartTooltip.tsx` (NEW)
4. `dashboard-web/src/components/ui/chart/ChartLegend.tsx` (NEW)
5. `dashboard-web/src/components/HeroOverview.tsx` — chart JSX migration (lines 493–609)
6. `dashboard-web/src/components/RoasChart.tsx` — chart JSX migration (lines 77–202)

**Plus three new test files** under `dashboard-web/src/components/ui/chart/__tests__/`.

**Explicitly OUT of scope (defer):**
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx` — Plan 4 (lives inside CampaignDrawer; the surrounding panel migrates as one unit).
- `dashboard-web/src/components/CampaignDrawer.tsx` (2 embedded charts) — Plan 4.
- `dashboard-web/src/components/CampaignsTable.tsx` (CPM/ROAS chart in row expansion) — Plan 4 owns the CampaignsTable structural split.
- `dashboard-web/src/components/ui/Sparkline.tsx` and `dashboard-web/src/components/Sparkline.tsx` — both pure SVG, no Recharts, no migration needed.
- `dashboard-web/src/components/InsightsBoard.tsx`, `WhatsWorking.tsx`, `CohortComparisonPanel.tsx`, `AttributionAnalysisPanel.tsx` — surveyed and confirmed to contain ZERO Recharts imports today; the spec listed them prospectively. Nothing to migrate.
- `dashboard-web/src/lib/storeColors.ts` — spec locks "no change — already 120° hue-separated for accessibility". Leave hex values as-is.
- `dashboard-web/src/lib/chartColors.ts` — used by Plan-4-scope charts only; leave alone.

**Non-negotiables (verified against spec):**
- The dashed `ReferenceLine y={3}` (ROAS target) stays in `RoasChart` — visual signal that operators rely on.
- The `connectNulls={false}` behavior on both charts stays. Gaps are an honest signal.
- The annotation-pin `ReferenceLine`s on `HeroOverview` stay byte-for-byte (their grouping logic + emoji+N label).
- The amber refund-day dot ring on `RoasChart` stays (heavy-refund-day signal).
- Per-store colors continue to come from `storeColors.ts` — DO NOT migrate those hex values.
- Charts must render correctly in both light and dark themes — that's what the new primitives unlock.

---

## Chart-specific hex/rgba literal migration map

These literals are inside Recharts JSX (`stroke=`, `fill=`, `tick={{ fill: ... }}`, `<defs><stop stopColor=...>`) and CANNOT use Tailwind classes — Recharts wants raw colors on its SVG props. The Plan-1 OKLCH tokens are already exposed as CSS variables on `:root` and `[data-theme="dark"]`, so the migration is hex → `var(--token-name)`.

| Legacy literal | New token reference | Source |
|----------------|---------------------|--------|
| `#e5e7eb` (grid stroke) | `var(--border-subtle)` | RoasChart:81 |
| `#64748b` (axis tick fill) | `var(--text-muted)` | RoasChart:84, 90 |
| `#16a34a` (ROAS target ReferenceLine) | `var(--status-green)` | RoasChart:99 |
| `#94a3b8` (tooltip cursor stroke) | `var(--border-strong)` | RoasChart:105 |
| `rgb(245, 158, 11)` (amber refund ring) | KEEP — Tailwind's `amber-500` palette stays per Plan 2's non-negotiables. Recharts SVG needs a literal here. | RoasChart:184 |
| `#bfdbfe` (hero area gradient stops) | N/A — hero card is always dark navy; switch to `#ffffff` with `stopOpacity={0.15}` (Task 5 Step 4 handles this) | HeroOverview:503, 504 |
| `rgba(255,255,255,0.45)` (target line on dark hero card) | `rgba(255,255,255,0.45)` — KEEP. The hero card has its OWN dark navy background that does not theme-swap; white-on-navy ReferenceLine is correct in both themes. | HeroOverview:519 |
| `#ffffff` (line stroke + dot fill on dark hero) | `#ffffff` — KEEP for the same reason | HeroOverview:567, 569 |
| `#0d3680` (active-dot stroke on dark hero) | `var(--accent)` — Plan 1's `--accent` is the same navy | HeroOverview:570 |

**Pre-flight result (2026-05-29):** All CSS variables referenced in this map were verified against `dashboard-web/src/app/globals.css`. Plan 1's foundation defines:
- `--border-subtle` (light: `globals.css:28`, dark: `globals.css:74`)
- `--text-muted` (light: `globals.css:23`, dark: `globals.css:68`)
- `--status-green` (light: `globals.css:44`, dark: `globals.css:92`)
- `--border-strong` (light: `globals.css:29`, dark: `globals.css:76`)
- `--accent` (light: `globals.css:32`, dark: `globals.css:79`)

There is NO `--accent-soft` token — the hero gradient uses `#ffffff` with low alpha instead (see Task 5 Step 4).

**Naming convention reminder:** Tailwind utility class names (e.g. `bg-elevated`, `text-ink-muted`, `border-line`) use a different semantic vocabulary than the underlying CSS variables (e.g. `--surface-elevated-1`, `--text-muted`, `--border-default`). The Tailwind config maps utility names to CSS-var values. When writing Recharts SVG props (which need a literal CSS-var reference like `stroke="var(--border-subtle)"`), use the CSS-VAR name, NOT the Tailwind utility name. When writing Tailwind classes on HTML elements (className="border-line-subtle"), use the utility name.

**`bg-text-primary/95 shadow-elevated` in RoasChart's tooltip body** (RoasChart:112): this is a Tailwind class string, not a Recharts SVG color. The new `ChartTooltip` primitive owns the chrome (background, border, shadow), so this className disappears from RoasChart's tooltip body when we swap in `<ChartTooltip>` — no migration needed for the legacy `text-primary` token here.

---

## File structure

After Plan 3 lands, the new directory looks like this:

```
dashboard-web/src/components/ui/chart/
  ChartContainer.tsx         — wraps ResponsiveContainer; sets chart CSS vars
  ChartTooltip.tsx           — styled tooltip body wrapper (font-mono values)
  ChartLegend.tsx            — flex container for swatch+label pairs
  __tests__/
    ChartContainer.test.tsx  — 3-4 behavior tests
    ChartTooltip.test.tsx    — 4 behavior tests (incl. font-mono on values)
    ChartLegend.test.tsx     — 3 behavior tests
```

The three primitives are independent — no internal cross-references. Each owns one responsibility:
- `ChartContainer`: sizing + theme CSS vars.
- `ChartTooltip`: tooltip chrome (bg, border, padding, shadow, RTL, font-mono for numbers).
- `ChartLegend`: legend chrome (flex row, gap, swatch sizing, label typography).

---

## Task 1: Bump Recharts to v3 + compat audit

**Files:**
- Modify: `dashboard-web/package.json`
- Modify: `dashboard-web/package-lock.json` (auto-updated by npm)

The breaking changes between Recharts 2.15 and 3.x that we MUST handle in our charts:

1. **TypeScript strict types** — v3 tightens prop types. Our 5 existing chart files compile clean against v2; some prop signatures may complain on v3.
2. **`Tooltip content` signature** — the function form `content={({ active, payload }) => ...}` continues to work; types may be tighter (`payload` typed more strictly).
3. **`ResponsiveContainer`** — still required; no behavioral change for our use.
4. **`isAnimationActive` prop** — still respected; the default value flipped in some versions. Confirm our charts still animate the way they did.
5. **`activeDot` shape** — still object; types tighter.

We will discover any others by running `npx tsc --noEmit` and `npm run build` after the bump.

- [ ] **Step 1: Bump the version**

Edit `dashboard-web/package.json` — change the `recharts` line in `dependencies`:

```json
"recharts": "^3.0.0",
```

(Pre-flight check 2026-05-29 confirmed that `^3.0.0` resolves to the latest published `3.1.1`. This is expected — `package-lock.json` will show `3.1.1`.)

- [ ] **Step 2: Install + lockfile update**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npm install
```

Expected: `npm install` succeeds. If npm reports peer-dep conflicts (e.g. recharts 3 requires React 19+), confirm React version in `package.json` is already 19+ (it is — Plan 1 verified this). If a conflict appears anyway, report BLOCKED with the exact npm output.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit ; echo "tsc=$?"
```

If `tsc=0`, proceed. If errors appear, fix them in-place. Most likely errors and their fixes:

- **`Property 'payload' does not exist on type 'TooltipProps<...>'`** — typed differently in v3. The fix is to add explicit types to the destructured args:
  ```tsx
  content={({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: ChartRowType; dataKey: string; color: string }> }) => { ... }}
  ```
- **`Type 'string' is not assignable to type 'AxisDomainItem'`** for the `'auto'` literal in `<YAxis domain={[0, 'auto']}>`: cast to the right type:
  ```tsx
  <YAxis domain={[0, 'auto' as const]} ... />
  ```
- **Custom `dot={(props) => ...}` payload typing**: v3 may require `payload?: any` or a more precise type. Use whatever the implementer's IDE inspector reveals — keep it minimal.

If a fix is non-mechanical (requires re-thinking a chart's data flow), report `DONE_WITH_CONCERNS` and let the controller decide whether to defer.

- [ ] **Step 4: Build + tests**

```bash
npm run build 2>&1 | tail -10
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
```

Expected: build succeeds, 1296+ node tests pass, 32 component tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/package.json dashboard-web/package-lock.json
# If tsc fixes were applied, add the affected chart files too:
# git add dashboard-web/src/components/RoasChart.tsx dashboard-web/src/components/HeroOverview.tsx ...
git commit -m "chore(charts): bump recharts 2.15 → 3.x + minimal type-fixups"
```

---

## Task 2: ChartContainer primitive + tests

**Files:**
- Create: `dashboard-web/src/components/ui/chart/ChartContainer.tsx`
- Create: `dashboard-web/src/components/ui/chart/__tests__/ChartContainer.test.tsx`

The container is the outermost element of every consumer chart. It owns:
1. Sizing — explicit `height` prop OR fluid via `aspect` ratio.
2. The `ResponsiveContainer` from Recharts.
3. A theme-aware className that exposes chart-color CSS vars to descendants.

Consumers wrap their chart like:

```tsx
<ChartContainer height={256} className="...">
  <LineChart data={...}>
    ...
  </LineChart>
</ChartContainer>
```

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/chart/__tests__/ChartContainer.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart, Line } from 'recharts';
import { ChartContainer } from '../ChartContainer';

const NOOP_DATA = [{ x: 0, y: 1 }, { x: 1, y: 2 }];

describe('ChartContainer', () => {
  it('renders the chart child inside a wrapper div', () => {
    const { container } = render(
      <ChartContainer height={200} data-testid="cc">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]');
    expect(wrapper).not.toBeNull();
  });

  it('applies the chart-surface CSS vars to the wrapper', () => {
    const { container } = render(
      <ChartContainer height={120} data-testid="cc">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]') as HTMLElement;
    // The wrapper should set the chart-grid CSS var so descendants can reference it.
    // Both styles below should resolve at render time; this test only checks that
    // the CSS-var binding is declared in the wrapper's inline style attribute.
    const style = wrapper.getAttribute('style') || '';
    expect(style).toMatch(/--chart-grid/);
  });

  it('forwards arbitrary HTML attributes (data-testid, aria-label) to the wrapper', () => {
    const { container } = render(
      <ChartContainer height={120} data-testid="cc" aria-label="My chart">
        <LineChart data={NOOP_DATA}>
          <Line dataKey="y" />
        </LineChart>
      </ChartContainer>,
    );
    const wrapper = container.querySelector('[data-testid="cc"]') as HTMLElement;
    expect(wrapper.getAttribute('aria-label')).toBe('My chart');
  });

  it('renders nothing crashy when given a height of 0', () => {
    expect(() =>
      render(
        <ChartContainer height={0}>
          <LineChart data={NOOP_DATA}>
            <Line dataKey="y" />
          </LineChart>
        </ChartContainer>,
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → fail (module missing)**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npm run test:components -- ChartContainer.test.tsx
```

Expected: FAIL (cannot resolve `'../ChartContainer'`).

- [ ] **Step 3: Implement `ChartContainer.tsx`**

Create `dashboard-web/src/components/ui/chart/ChartContainer.tsx`:

```tsx
import { type ReactElement, type CSSProperties } from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart container. Wraps Recharts' `ResponsiveContainer`
 * and applies the chart-surface CSS vars (`--chart-grid`,
 * `--chart-axis`, `--chart-cursor`) so descendant SVG elements can
 * pull color values that respect the active light/dark theme.
 *
 * Sizing model: pass an explicit `height` (px). For fluid sizing, set
 * the outer wrapper's height via `className` and pass `height="100%"`
 * (string) — Recharts honors percentage heights when its parent has a
 * concrete pixel height.
 */
export function ChartContainer({
  children,
  className,
  style,
  height,
  ...rest
}: {
  children: ReactElement;
  className?: string;
  style?: CSSProperties;
  /** Chart pixel height OR the string "100%" for fluid sizing. */
  height: number | string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'children'>) {
  const cssVars: CSSProperties = {
    // The new shadcn chart token surface — descendants reference these via
    // `stroke="var(--chart-grid)"`, `fill="var(--chart-axis)"`, etc.
    // Defined on the wrapper so the chart theme can be overridden locally
    // (e.g. HeroOverview's chart sits on a dark navy card and overrides
    // these to white-ish via its own className).
    // NOTE — the right side of each entry must be a real CSS-var NAME
    // (defined in globals.css), NOT a Tailwind utility name. The Plan-1
    // CSS vars in scope here are --border-subtle, --text-muted,
    // --border-strong, --status-green, --accent (verified pre-flight).
    ['--chart-grid' as never]: 'var(--border-subtle)',
    ['--chart-axis' as never]: 'var(--text-muted)',
    ['--chart-cursor' as never]: 'var(--border-strong)',
    ['--chart-target' as never]: 'var(--status-green)',
  };

  return (
    <div
      className={cn('w-full', className)}
      style={{ ...cssVars, ...style }}
      {...rest}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run → pass**

```bash
npm run test:components -- ChartContainer.test.tsx
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/ui/chart/ChartContainer.tsx \
        dashboard-web/src/components/ui/chart/__tests__/ChartContainer.test.tsx
git commit -m "feat(charts): ChartContainer primitive — ResponsiveContainer + theme CSS vars"
```

---

## Task 3: ChartTooltip primitive + tests

**Files:**
- Create: `dashboard-web/src/components/ui/chart/ChartTooltip.tsx`
- Create: `dashboard-web/src/components/ui/chart/__tests__/ChartTooltip.test.tsx`

`ChartTooltip` is a styled `<div>` wrapper consumers render INSIDE their Recharts `<Tooltip content={fn}>` function. This pattern:
- Keeps existing tooltip content code (date labels, store rows, refund banner) byte-for-byte.
- Centralizes tooltip chrome (background, border, padding, shadow, RTL handling).
- Forces value spans to use `font-mono` via the locked 2026 vocabulary.

Public API:

```tsx
<Tooltip
  content={({ active, payload }) =>
    active && payload?.length ? (
      <ChartTooltip>
        <ChartTooltipLabel>{formatDate(payload[0].payload.date)}</ChartTooltipLabel>
        <ChartTooltipRow color={entry.color} label="uzoshop">
          <ChartTooltipValue>2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>
    ) : null
  }
/>
```

This task implements 4 sub-components in the same file:
- `<ChartTooltip>` — outer card (`bg-elevated`, `border-line`, `shadow-lg`, RTL via `dir="rtl"`).
- `<ChartTooltipLabel>` — top date / context label (`text-ink-muted`, `text-[10px]`).
- `<ChartTooltipRow>` — single row with a colored swatch on the start side + label + value slot.
- `<ChartTooltipValue>` — wraps numeric values in `font-mono` + `<bdi dir="ltr">` for RTL safety.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/chart/__tests__/ChartTooltip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '../ChartTooltip';

describe('ChartTooltip', () => {
  it('renders an RTL container with elevated background', () => {
    const { container } = render(
      <ChartTooltip>
        <ChartTooltipLabel>2026-05-29</ChartTooltipLabel>
      </ChartTooltip>,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.getAttribute('dir')).toBe('rtl');
    expect(card.className).toMatch(/bg-elevated/);
  });

  it('renders label, row, and value text content', () => {
    render(
      <ChartTooltip>
        <ChartTooltipLabel>2026-05-29</ChartTooltipLabel>
        <ChartTooltipRow color="#16a34a" label="uzoshop">
          <ChartTooltipValue>2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    expect(screen.getByText('2026-05-29')).toBeInTheDocument();
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('2.85')).toBeInTheDocument();
  });

  it('applies font-mono to numeric values for 2026 vocab compliance', () => {
    render(
      <ChartTooltip>
        <ChartTooltipRow color="#16a34a" label="uzoshop">
          <ChartTooltipValue data-testid="val">2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    const val = screen.getByTestId('val');
    expect(val.className).toMatch(/font-mono/);
  });

  it('row swatch uses the color prop as inline backgroundColor', () => {
    const { container } = render(
      <ChartTooltip>
        <ChartTooltipRow color="rgb(22, 163, 74)" label="uzoshop">
          <ChartTooltipValue>2.85</ChartTooltipValue>
        </ChartTooltipRow>
      </ChartTooltip>,
    );
    const swatch = container.querySelector('[data-swatch="true"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(22, 163, 74)');
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm run test:components -- ChartTooltip.test.tsx
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `ChartTooltip.tsx`**

Create `dashboard-web/src/components/ui/chart/ChartTooltip.tsx`:

```tsx
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart tooltip primitives. Consumers render these INSIDE
 * a Recharts `<Tooltip content={(...) => <ChartTooltip>...</ChartTooltip>}>`
 * function. The four sub-components map to the visual structure:
 *
 *   <ChartTooltip>                       — card chrome
 *     <ChartTooltipLabel />              — date / context line
 *     <ChartTooltipRow color="" label="">
 *       <ChartTooltipValue />            — numeric value with font-mono
 *     </ChartTooltipRow>
 *   </ChartTooltip>
 *
 * The card uses the new OKLCH tokens (bg-elevated, border-line, shadow-lg)
 * so it renders correctly in both light and dark themes.
 */
export function ChartTooltip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      dir="rtl"
      className={cn(
        'rounded-lg bg-elevated/95 border border-line text-ink',
        'px-3 py-2 text-xs shadow-lg backdrop-blur-sm',
        'min-w-[160px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChartTooltipLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('text-ink-muted mb-1 text-[10px]', className)}>
      {children}
    </div>
  );
}

export function ChartTooltipRow({
  color,
  label,
  children,
  className,
}: {
  color: string;
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2 leading-relaxed', className)}>
      <span
        data-swatch="true"
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-ink-secondary">{label}</span>
      <span className="ms-auto">{children}</span>
    </div>
  );
}

export function ChartTooltipValue({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <bdi
      dir="ltr"
      className={cn('font-mono font-semibold text-ink', className)}
      {...rest}
    >
      {children}
    </bdi>
  );
}
```

- [ ] **Step 4: Run → pass**

```bash
npm run test:components -- ChartTooltip.test.tsx
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/ui/chart/ChartTooltip.tsx \
        dashboard-web/src/components/ui/chart/__tests__/ChartTooltip.test.tsx
git commit -m "feat(charts): ChartTooltip primitives — RTL card + font-mono value spans"
```

---

## Task 4: ChartLegend primitive + tests

**Files:**
- Create: `dashboard-web/src/components/ui/chart/ChartLegend.tsx`
- Create: `dashboard-web/src/components/ui/chart/__tests__/ChartLegend.test.tsx`

`ChartLegend` is a small flex container; consumers render `<ChartLegendItem>` children inside it. Used by `RoasChart` (multi-store) and reserved for any future multi-series chart.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/chart/__tests__/ChartLegend.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartLegend, ChartLegendItem } from '../ChartLegend';

describe('ChartLegend', () => {
  it('renders all legend items', () => {
    render(
      <ChartLegend>
        <ChartLegendItem color="#16a34a" label="uzoshop" />
        <ChartLegendItem color="#1c4587" label="Zol Plus" />
        <ChartLegendItem color="#d97706" label="360usmile" />
      </ChartLegend>,
    );
    expect(screen.getByText('uzoshop')).toBeInTheDocument();
    expect(screen.getByText('Zol Plus')).toBeInTheDocument();
    expect(screen.getByText('360usmile')).toBeInTheDocument();
  });

  it('item swatch uses the color prop as inline backgroundColor', () => {
    const { container } = render(
      <ChartLegend>
        <ChartLegendItem color="rgb(22, 163, 74)" label="uzoshop" />
      </ChartLegend>,
    );
    const swatch = container.querySelector('[data-swatch="true"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.backgroundColor).toBe('rgb(22, 163, 74)');
  });

  it('uses flex-wrap so long legends wrap on narrow viewports', () => {
    const { container } = render(
      <ChartLegend>
        <ChartLegendItem color="#000" label="a" />
      </ChartLegend>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/flex-wrap/);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm run test:components -- ChartLegend.test.tsx
```

- [ ] **Step 3: Implement `ChartLegend.tsx`**

Create `dashboard-web/src/components/ui/chart/ChartLegend.tsx`:

```tsx
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn-style chart legend. Consumers wrap a list of `<ChartLegendItem>`
 * children in `<ChartLegend>`. Used by RoasChart's multi-store view and
 * any future multi-series chart in the dashboard.
 *
 * Sits OUTSIDE the Recharts chart (typically below or to the side) so
 * consumers control placement. The primitive is just chrome — no
 * interaction, no toggling, no Recharts integration.
 */
export function ChartLegend({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1.5',
        'text-xs text-ink-secondary',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ChartLegendItem({
  color,
  label,
  className,
}: {
  color: string;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        data-swatch="true"
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run → pass**

```bash
npm run test:components -- ChartLegend.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/ui/chart/ChartLegend.tsx \
        dashboard-web/src/components/ui/chart/__tests__/ChartLegend.test.tsx
git commit -m "feat(charts): ChartLegend primitive — flex-wrap swatch+label rows"
```

---

## Task 5: Migrate HeroOverview chart to primitives + 2026 vocab

**Files:**
- Modify: `dashboard-web/src/components/HeroOverview.tsx` (chart JSX block, currently lines 493–609)

HeroOverview's area chart sits inside the dark hero card (gradient background). The migration:

A. Wrap the existing `<ResponsiveContainer>` in `<ChartContainer>` and drop the inner `<ResponsiveContainer>` (the new container provides one).

B. Migrate hardcoded colors per the migration map at the top of this plan:
- `#bfdbfe` (gradient stops) → `var(--accent-soft)` — but verify `--accent-soft` exists. If not, fall back to `var(--accent)` with `stopOpacity` adjusted.
- `rgba(255,255,255,0.45)` (ReferenceLine on dark hero) → KEEP (white-on-navy is correct in both themes since the hero card itself doesn't theme-swap).
- `#ffffff` (Line stroke + dot fill) → KEEP for the same reason.
- `#0d3680` (activeDot stroke) → `var(--accent)` (Plan 1's accent token IS that navy).

C. Replace the existing tooltip `<div>` body (RoasChart:589-603 today's HeroOverview line numbers) with `<ChartTooltip>` + child primitives, preserving the existing content (date + ROAS + revenue + spend rows).

D. Apply 2026 vocab — the area fill stays ≤15% via `stopOpacity={0.15}` at the top stop (was `0.45`); the bottom stop stays at `0`. Stroke stays solid (`stroke="#ffffff"` continues; was transparent on the area, white on the line — keep as-is).

- [ ] **Step 1: Read** `dashboard-web/src/components/HeroOverview.tsx` lines 480-615 end-to-end. Note exact positions of the chart JSX block and the existing tooltip body.

- [ ] **Step 2: Add imports** at the top of `HeroOverview.tsx` (find the other component imports block and add):

```tsx
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
```

- [ ] **Step 3: Wrap the chart in ChartContainer**

Find:
```tsx
<div className="h-32 sm:h-36">
  <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={series} margin={{ top: 28, right: 12, left: 12, bottom: 0 }}>
      ...
    </ComposedChart>
  </ResponsiveContainer>
</div>
```

Replace with:
```tsx
<ChartContainer
  className="h-32 sm:h-36"
  height="100%"
  // The hero card has its own dark navy background; override the chart
  // surface vars so white-ish gridlines/axes are visible on it.
  style={{
    ['--chart-grid' as never]: 'rgba(255,255,255,0.20)',
    ['--chart-axis' as never]: 'rgba(255,255,255,0.55)',
    ['--chart-target' as never]: 'rgba(255,255,255,0.45)',
  }}
>
  <ComposedChart data={series} margin={{ top: 28, right: 12, left: 12, bottom: 0 }}>
    ...
  </ComposedChart>
</ChartContainer>
```

The `style` overrides are local to this chart because the hero card has a permanent dark background that doesn't theme-swap. All other charts (e.g. RoasChart) inherit the default CSS vars from `ChartContainer`.

- [ ] **Step 4: Migrate the gradient stops**

Find:
```tsx
<linearGradient id="hero-roas-fill" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%"   stopColor="#bfdbfe" stopOpacity={0.45} />
  <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0} />
</linearGradient>
```

Replace with — apply 2026 vocab (top stop ≤15 %, keep the existing soft blue color via white-with-alpha since the hero card is navy):

```tsx
<linearGradient id="hero-roas-fill" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%"   stopColor="#ffffff" stopOpacity={0.15} />
  <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
</linearGradient>
```

The fill now reads as a soft white wash that fades to nothing — consistent with the 2026 vocab (solid stroke, light fill).

- [ ] **Step 5: Migrate the ReferenceLine + Line**

`<ReferenceLine y={3} stroke="rgba(255,255,255,0.45)" ...>` — KEEP this exact stroke (hero card is dark).

For the `<Line>` (around current line 564-577):
```tsx
<Line
  type="monotone"
  dataKey="roas"
  stroke="#ffffff"
  strokeWidth={2}
  dot={{ r: 2.5, fill: '#ffffff', stroke: 'transparent' }}
  activeDot={{ r: 5, fill: '#ffffff', stroke: '#0d3680', strokeWidth: 3 }}
  connectNulls={false}
  isAnimationActive
  animationDuration={500}
/>
```

Change ONLY the `activeDot` stroke:
```tsx
activeDot={{ r: 5, fill: '#ffffff', stroke: 'var(--accent)', strokeWidth: 3 }}
```

The rest stays — `#ffffff` is correct on the dark hero card.

- [ ] **Step 6: Migrate the tooltip body**

Find the existing inline `content={({ active, payload }) => { ... return <div className="rounded-lg bg-ink/95 ..."> ... </div>; }}` block.

Replace the returned JSX (NOT the destructuring or the type / null guards) with `ChartTooltip` primitives. Existing destructuring stays:

```tsx
<Tooltip
  content={({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload as {
      date: string;
      revenue: number;
      spend: number;
      roas: number | null;
    };
    return (
      <ChartTooltip>
        <ChartTooltipLabel>{fmtDateShort(d.date)}</ChartTooltipLabel>
        <div className="font-semibold mb-0.5">
          ROAS{' '}
          <ChartTooltipValue>
            {d.roas !== null ? d.roas.toFixed(2) : '—'}
          </ChartTooltipValue>
        </div>
        <div className="text-ink-muted text-[11px]">
          הכנסות{' '}
          <ChartTooltipValue className="text-ink-secondary text-[11px] font-normal">
            {Math.round(d.revenue).toLocaleString('he-IL')}
          </ChartTooltipValue>
          {' · '}
          הוצאה{' '}
          <ChartTooltipValue className="text-ink-secondary text-[11px] font-normal">
            {Math.round(d.spend).toLocaleString('he-IL')}
          </ChartTooltipValue>
        </div>
      </ChartTooltip>
    );
  }}
/>
```

The inline `bg-ink/95 shadow-elevated tabular-nums` className on the old tooltip body is GONE — `ChartTooltip` owns those concerns. The `ChartTooltipValue` adds `font-mono`.

- [ ] **Step 7: Verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Expected: tsc=0, 1296+ node tests pass, 32+11 = 43 component tests pass (added 4+4+3 from Tasks 2-4 = 11 new), build clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/HeroOverview.tsx
git commit -m "refactor(charts): HeroOverview — adopt ChartContainer + ChartTooltip + 2026 vocab"
```

---

## Task 6: Migrate RoasChart chart to primitives + 2026 vocab

**Files:**
- Modify: `dashboard-web/src/components/RoasChart.tsx` (chart JSX block, currently lines 77–202)

RoasChart is the multi-line ROAS trend chart in the ניתוח tab. The migration:

A. Wrap the existing `<ResponsiveContainer>` in `<ChartContainer>`.

B. Migrate hardcoded colors:
- `#e5e7eb` (CartesianGrid stroke) → `var(--chart-grid)` (which `ChartContainer` provides as `var(--line-subtle)`).
- `#64748b` (axis tick fill) → `var(--chart-axis)` (which `ChartContainer` provides as `var(--ink-muted)`).
- `#16a34a` (ROAS target ReferenceLine) → `var(--chart-target)` (which `ChartContainer` provides as `var(--status-green)`).
- `#94a3b8` (tooltip cursor stroke) → `var(--chart-cursor)`.
- `rgb(245, 158, 11)` (amber refund ring) → KEEP. Tailwind base palette per non-negotiable; Plan 7 may revisit.

C. Replace the existing tooltip `<div>` body with `<ChartTooltip>` + child primitives, preserving the heavy-refund-day banner block (the `(() => { ... })()` IIFE).

D. Per-store colors — keep `storeColors.ts` SSOT via `colorFor(s, i)`. NO changes to those values.

E. Apply 2026 vocab:
- Solid stroke — already in place (`strokeWidth={2 or 2.75}`).
- No gradient fill on a line chart — n/a.
- Dashed gridlines at low opacity — already done (`strokeDasharray="2 4" strokeOpacity={0.55}`); keep.
- Live crosshair — already done (`Tooltip cursor={{ stroke, strokeDasharray }}`); migrate the cursor stroke color via the chart-cursor var.

- [ ] **Step 1: Read** `dashboard-web/src/components/RoasChart.tsx` lines 60-210 end-to-end.

- [ ] **Step 2: Add imports** to the top of `RoasChart.tsx`:

```tsx
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
```

- [ ] **Step 3: Wrap the chart in ChartContainer**

Find (around current line 77):
```tsx
<div className="h-64 sm:h-80">
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={chartData} margin={{ top: 10, right: 12, left: 8, bottom: 0 }}>
      ...
    </LineChart>
  </ResponsiveContainer>
</div>
```

Replace with:
```tsx
<ChartContainer className="h-64 sm:h-80" height="100%">
  <LineChart data={chartData} margin={{ top: 10, right: 12, left: 8, bottom: 0 }}>
    ...
  </LineChart>
</ChartContainer>
```

`ChartContainer` provides the CSS vars; no inline `style` override needed (RoasChart lives on the default elevated surface, not on a dark hero card).

- [ ] **Step 4: Migrate the CartesianGrid + axes + ReferenceLine + Tooltip cursor**

```tsx
<CartesianGrid
  strokeDasharray="2 4"
  stroke="var(--chart-grid)"
  strokeOpacity={0.55}
  vertical={false}
/>
<XAxis
  dataKey="dateLabel"
  tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
  axisLine={false}
  tickLine={false}
  tickMargin={6}
/>
<YAxis
  tick={{ fontSize: 11, fill: 'var(--chart-axis)', fontVariant: 'tabular-nums' }}
  axisLine={false}
  tickLine={false}
  domain={[0, 'auto']}
  width={32}
  tickFormatter={v => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
/>
<ReferenceLine
  y={3}
  stroke="var(--chart-target)"
  strokeDasharray="4 4"
  strokeOpacity={0.55}
  strokeWidth={1.5}
/>
<Tooltip
  cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1, strokeDasharray: '3 3' }}
  content={({ active, payload }) => { ... }}
/>
```

- [ ] **Step 5: Migrate the tooltip body**

Find the existing tooltip content function (around current line 106-157) and replace the returned JSX. Keep the destructuring + null guards + the heavy-refund-day IIFE inside.

Old (the returned JSX block — NOT the whole content function):
```tsx
return (
  <div
    dir="rtl"
    className="rounded-lg bg-text-primary/95 text-white px-3 py-2 text-xs shadow-elevated tabular-nums backdrop-blur-sm"
  >
    <div className="text-white/65 mb-1 text-[10px]">{formatDate(date)}</div>
    <ul className="space-y-0.5">
      {payload.map(entry => { ... })}
    </ul>
    {(() => { /* heavy refund banner */ })()}
  </div>
);
```

New:
```tsx
return (
  <ChartTooltip>
    <ChartTooltipLabel>{formatDate(date)}</ChartTooltipLabel>
    <ul className="space-y-0.5">
      {payload.map(entry => {
        const v = Number(entry.value);
        if (!Number.isFinite(v)) return null;
        return (
          <li key={String(entry.dataKey)}>
            <ChartTooltipRow color={entry.color as string} label={String(entry.dataKey)}>
              ROAS{' '}
              <ChartTooltipValue>{formatNumber(v)}</ChartTooltipValue>
            </ChartTooltipRow>
          </li>
        );
      })}
    </ul>
    {(() => {
      let refundSum = 0;
      let anyHeavy = false;
      for (const entry of payload) {
        const storeName = entry.dataKey as string;
        const row = rows.find(r => r.date === date && r.storeName === storeName);
        if (row?.refundDeduction) refundSum += row.refundDeduction;
        if (refundDayKeys.has(`${date}|${storeName}`)) anyHeavy = true;
      }
      if (!anyHeavy || refundSum <= 0) return null;
      return (
        <div className="mt-1 pt-1 border-t border-status-orange/30 text-xs text-status-orange">
          ↩ יום רפאנד כבד — החזרים: -CAD{' '}
          <ChartTooltipValue className="font-normal text-status-orange">
            {Math.round(refundSum).toLocaleString('he-IL')}
          </ChartTooltipValue>
          . ה-ROAS משקף את הנטו.
        </div>
      );
    })()}
  </ChartTooltip>
);
```

Note the heavy-refund banner's amber tint was `border-amber-400/30 text-amber-300` — these survived the Plan 2 migration sweep because they were chart-internal. The new color set (`border-status-orange/30 text-status-orange`) uses the project token system, matching the rest of the dashboard's "heavy refund" treatment.

- [ ] **Step 6: Verify**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Expected: tsc=0, 1296+ node tests pass, 43 component tests pass, build clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/RoasChart.tsx
git commit -m "refactor(charts): RoasChart — adopt ChartContainer + ChartTooltip + 2026 vocab"
```

---

## Task 7: Wrap-up — chart audit + tag

**No new files.** Verification-only.

- [ ] **Step 1: Grep for any remaining hardcoded chart colors in Plan-3-scope files**

```bash
cd /Users/dorperetz/script-roas

# RoasChart should have only the amber rgb literal left (Tailwind base palette).
grep -nE 'stroke="#|fill="#|stroke="rgba|fill="rgba|stroke="rgb\(|fill="rgb\(' \
  dashboard-web/src/components/RoasChart.tsx \
  | grep -v "amber\|245, 158" \
  || echo "(RoasChart clean)"

# HeroOverview should have only the explicit white/navy literals which are
# intentional on the dark hero card.
grep -nE 'stroke="#|fill="#|stroke="rgba|fill="rgba|stroke="rgb\(|fill="rgb\(' \
  dashboard-web/src/components/HeroOverview.tsx \
  | grep -v "rgba(255,255,255\|#ffffff" \
  || echo "(HeroOverview clean of unintentional literals)"
```

Each section should print its `(clean)` line — meaning the only literals that survived are the explicitly-preserved ones from the migration map.

- [ ] **Step 2: Full test + build + lint**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test:all 2>&1 | tail -5
npm run build 2>&1 | tail -5
npm run lint 2>&1 | tail -3
```

Expected: tsc=0, 1296+ node tests pass, 43 component tests pass (Plan 2's 32 + 11 new from chart primitives), build succeeds, no NEW lint errors (pre-existing warnings are acceptable per Plan 2 baseline).

- [ ] **Step 3: Confirm Plan 3 didn't touch out-of-scope files**

```bash
cd /Users/dorperetz/script-roas
# Files Plan 3 may NOT modify (Plan 4/5 territory):
git diff --name-only acce545..HEAD -- \
  dashboard-web/src/components/CampaignDrawer.tsx \
  dashboard-web/src/components/CampaignsTable.tsx \
  dashboard-web/src/components/MetaShopifyReconciliation.tsx \
  dashboard-web/src/components/MonthlyTables.tsx \
  dashboard-web/src/lib/storeColors.ts \
  dashboard-web/src/lib/chartColors.ts
```

Expected output: empty (no out-of-scope files in the diff).

- [ ] **Step 4: Tag wrap-up commit**

```bash
cd /Users/dorperetz/script-roas
git tag plan-03-charts-done
```

No final commit — Plan 3 ends with whatever the previous tasks committed.

---

## Self-Review

Before declaring Plan 3 complete, confirm:

1. **Spec coverage:**
   - ✅ Recharts 2.15 → 3.x bump (Task 1)
   - ✅ `ChartContainer` shadcn primitive (Task 2)
   - ✅ `ChartTooltip` shadcn primitive + sub-components (Task 3)
   - ✅ `ChartLegend` shadcn primitive (Task 4)
   - ✅ HeroOverview chart migration (Task 5)
   - ✅ RoasChart chart migration (Task 6)
   - ✅ 2026 vocab — solid stroke + ≤15 % gradient fill (Task 5 step 4)
   - ✅ 2026 vocab — mono-font tooltip values (`ChartTooltipValue` uses `font-mono`, Task 3)
   - ✅ 2026 vocab — dashed gridlines at low opacity (preserved on RoasChart, Task 6 step 4)
   - ✅ 2026 vocab — live crosshair on hover (preserved on RoasChart's `Tooltip cursor`, Task 6 step 4)
   - ✅ Per-store colors continue from `storeColors.ts` SSOT (Task 6 step 4 — colorFor unchanged)
   - ✅ Light/dark theme — CSS vars from Plan 1 drive chart chrome; tested via `tsc + build` (theme switching is exercised by Plan 1's tests already)

2. **Out-of-scope confirmations:**
   - ✅ MetaShopifyReconciliation — deferred to Plan 4
   - ✅ CampaignDrawer charts — deferred to Plan 4
   - ✅ CampaignsTable chart — deferred to Plan 4
   - ✅ Both Sparkline.tsx files — no Recharts, no migration
   - ✅ InsightsBoard/WhatsWorking/CohortComparisonPanel/AttributionAnalysisPanel — no Recharts today, nothing to migrate
   - ✅ `storeColors.ts` and `chartColors.ts` — untouched

3. **Placeholder scan:** No "TBD", "implement later", or "similar to" sloppy references. Every step has executable code or a commit command.

4. **Type consistency:**
   - `ChartContainer`, `ChartTooltip`, `ChartLegend` named exports defined once, consumed in HeroOverview / RoasChart.
   - `ChartTooltip` sub-components (`ChartTooltipLabel`, `ChartTooltipRow`, `ChartTooltipValue`) named exports defined once.
   - `ChartLegend` sub-component (`ChartLegendItem`) named export defined once. (No consumer in Plan 3 — Plan 5 / Plan 4 will use it. It exists for future use; the test still validates it.)

5. **Non-negotiables verified:**
   - ROAS target ReferenceLine preserved (Task 6 step 4)
   - `connectNulls={false}` preserved on both charts (Tasks 5+6)
   - Annotation pin ReferenceLines on HeroOverview preserved byte-for-byte (Task 5 unchanged section)
   - Heavy-refund-day amber ring on RoasChart preserved (Task 6 unchanged dot function)
   - Per-store colors via `storeColors.ts` preserved (Task 6 step 4 `colorFor(s, i)` call unchanged)

6. **Test count expectations:**
   - 4 (ChartContainer) + 4 (ChartTooltip) + 3 (ChartLegend) = 11 new component tests.
   - 32 + 11 = 43 component tests total after Plan 3.
   - Node test count unchanged (no `lib/` files added).

7. **Scope check:** Each task produces working, committable software. The chart primitives are testable standalone (Tasks 2-4). The chart migrations preserve all existing chart behavior (Tasks 5-6). Plan 3 ships if any 6 of 7 tasks land — Task 1 (recharts bump) is the only one that gates the others. If a partial completion is needed (e.g. one migration deferred), the wrap-up audit (Task 7) reports which charts shipped vs deferred.
