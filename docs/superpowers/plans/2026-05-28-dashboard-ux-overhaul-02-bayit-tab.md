# Dashboard UX/UI Overhaul — Plan 02: בית tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every section of the בית (`home`) tab from the legacy hex palette to the new OKLCH tokens AND add the single new feature for this tab — a narrative line woven into TodayLive between the LIVE header and the 6 stat cards. After this plan, the בית tab works identically (same data, same controls, same ROAS-driven gradient personality) but renders correctly in both light and dark themes.

**Architecture:** Pure token migration for 8 components. New `lib/todayNarrative.ts` helper computes the narrative sentence as a pure function of (today's aggregate, store aggregates, monthly goal, daily pace). TodayLive reads the goal from `localStorage` (existing pattern from `GoalTracker.tsx`) and passes it into the helper. The narrative renders as a single `<div>` inserted between the existing `<header>` and the `grid` of 6 LiveStat cards inside TodayLive — no other structural change. All other HomeTab sections are token-only edits.

**Tech Stack:** Same as Plan 1. No new dependencies. The migration leverages the OKLCH tokens + Tailwind utilities introduced in Plan 1 Tasks 3-4.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` (current HEAD `96697e7` at Plan 1 wrap-up). Commits use `feat(home)`, `refactor(home)`, `chore(home)`, `test(home)` prefixes.

---

## Token migration map — single source of truth

Every migration task in this plan refers back to this table. The legacy palette stays defined in `tailwind.config.ts` so unmigrated callers keep working — this plan only changes consumers in the בית tab.

| Legacy class | New class | Notes |
|--------------|-----------|-------|
| `bg-background` | `bg-canvas` | OKLCH-driven; dark-mode aware |
| `bg-surface` | `bg-elevated` | |
| `bg-surfaceMuted` | `bg-elevated2` | |
| `bg-surfaceSubtle` | `bg-elevated2` | No `-subtle` in new scale; same as `bg-elevated2` |
| `bg-surfaceSunken` | `bg-canvas` | Sunken is same depth as canvas in new scale |
| `border-border` | `border-line` | |
| `border-borderSubtle` | `border-line-subtle` | |
| `border-borderStrong` | `border-line-strong` | |
| `text-text-primary` | `text-ink` | Defaults |
| `text-text-secondary` | `text-ink-secondary` | |
| `text-text-muted` | `text-ink-muted` | |
| `text-text-subtle` | `text-ink-subtle` | |
| `text-primary` | `text-accent` | Was navy `#0d3680`; now OKLCH accent indigo |
| `bg-primary` | `bg-accent` | Same |
| `bg-primary-dark` | `bg-accent` | The deep navy gradient header is GONE (Plan 1 swapped to Sidebar) |
| `bg-primary-light` | `bg-accent` | Same |
| `bg-primary/8`, `bg-primary/15` | `bg-accent/8`, `bg-accent/15` | Slash-alpha works on var-based tokens |
| `bg-roas-redBg` | `bg-status-redBg` | The `-bg` suffix is kept |
| `bg-roas-orangeBg` | `bg-status-orangeBg` | |
| `bg-roas-greenBg` | `bg-status-greenBg` | |
| `bg-roas-blueBg` | `bg-status-blueBg` | |
| `text-roas-red` | `text-status-red` | |
| `text-roas-orange` | `text-status-orange` | |
| `text-roas-green` | `text-status-green` | |
| `text-roas-blue` | `text-status-blue` | |
| `border-roas-red` | `border-status-red` | (same for all 4 colors) |
| `shadow-card` | `shadow-sm` | Existing Tailwind shadow scale |
| `shadow-cardHover` | `shadow-md` | |
| `shadow-elevated` | `shadow-lg` | |
| `bg-roas-red/12`, `bg-roas-red/35` | `bg-status-red/12`, `border-status-red/35` | Alpha syntax preserved |

The legacy classes are NOT removed from `tailwind.config.ts` — they stay so unmigrated callers (CampaignsTable, PnL components, etc.) keep working. Plan 7 deletes them in a single sweep once nothing consumes them.

**A note on `text-white`**: where a component uses literal `text-white` (e.g. on a primary button), keep it for now. The dark-mode contrast is preserved by the accent token swap (white on accent is correct in both themes). Plan 7 audits remaining `text-white` usages.

**A note on ROAS gradient**: TodayLive's `liveToneFromRoas()` returns class names like `'bg-gradient-to-br from-roas-redBg/60 via-surface to-surface'`. The migration task for TodayLive (Task 2.2 below) rewrites the LIVE_TONE_STYLES record's class strings to use the new tokens (`bg-status-redBg/60`, `bg-elevated`). The function signature, the SSOT `roasLabel()` call, the 4 tones, the pulse animation, the blob blur — all unchanged.

---

## Task 1: Pure `todayNarrative` helper + test

**Files:**
- Create: `dashboard-web/src/lib/todayNarrative.ts`
- Create: `dashboard-web/src/lib/__tests__/todayNarrative.test.ts`

The narrative line shown inside TodayLive is computed from the same data TodayLive already has: today's aggregate, per-store aggregates, the monthly goal (read from localStorage by TodayLive and passed in as a number or null), and the day-of-month position so we can compute "pace vs target". This task creates the helper as a pure function with golden tests; Task 2 wires it into TodayLive.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/__tests__/todayNarrative.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTodayNarrative, type NarrativeInputs } from '../todayNarrative';

function inputs(overrides: Partial<NarrativeInputs> = {}): NarrativeInputs {
  return {
    revenue: 48250,
    roas: 2.42,
    storeAggs: [
      { store: 'uzoshop', revenue: 21180, roas: 2.81 },
      { store: 'storia', revenue: 15880, roas: 2.14 },
      { store: 'marlene', revenue: 9540, roas: 1.92 },
    ],
    monthlyGoal: 1_000_000,
    monthToDateRevenue: 720_000,
    dayOfMonth: 22,
    daysInMonth: 30,
    ...overrides,
  };
}

describe('buildTodayNarrative', () => {
  it('combines today number + ROAS + pace vs goal + top store', () => {
    const text = buildTodayNarrative(inputs());
    // Should mention the revenue (with thousands separator), the ROAS (2 decimals), and the top store.
    expect(text).toMatch(/48,250|48[,.]250/);
    expect(text).toMatch(/2\.42/);
    expect(text).toMatch(/uzoshop/i);
  });

  it('says "above goal pace" when MTD ≥ target pace', () => {
    // Target pace at day 22 of 30 = 22/30 of 1M = 733,333. MTD 800k > 733k → above.
    const text = buildTodayNarrative(inputs({ monthToDateRevenue: 800_000 }));
    expect(text).toMatch(/מעל|מקדים/);
  });

  it('says "below goal pace" when MTD < target pace', () => {
    const text = buildTodayNarrative(inputs({ monthToDateRevenue: 600_000 }));
    expect(text).toMatch(/מתחת|לפני/);
  });

  it('omits pace line when monthlyGoal is null', () => {
    const text = buildTodayNarrative(inputs({ monthlyGoal: null }));
    expect(text).not.toMatch(/יעד|מטרה/);
    // Should still mention revenue + ROAS.
    expect(text).toMatch(/48,250|48[,.]250/);
    expect(text).toMatch(/2\.42/);
  });

  it('omits top store when storeAggs is empty', () => {
    const text = buildTodayNarrative(inputs({ storeAggs: [] }));
    expect(text).not.toMatch(/uzoshop|storia|marlene/);
  });

  it('returns a fallback when revenue is 0 (no data yet today)', () => {
    const text = buildTodayNarrative(inputs({ revenue: 0, roas: 0, storeAggs: [] }));
    expect(text).toMatch(/אין נתונים|עוד אין|טוען/);
  });

  it('handles RTL number formatting (uses he-IL locale)', () => {
    const text = buildTodayNarrative(inputs({ revenue: 1234567 }));
    expect(text).toContain(new Intl.NumberFormat('he-IL').format(1234567));
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/todayNarrative.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `lib/todayNarrative.ts`**

Create `dashboard-web/src/lib/todayNarrative.ts`:

```ts
/**
 * Pure helper that builds the single narrative sentence shown inside
 * TodayLive between the LIVE header and the 6 stat cards.
 *
 * Inputs are everything TodayLive already has on hand: today's aggregate,
 * per-store aggregates, the monthly goal (read from localStorage by the
 * caller — keeping this function pure for testing), and the day-of-month
 * position for pace calculation.
 *
 * The output is a single Hebrew sentence (he-IL) that summarizes:
 *   1. Today's revenue + ROAS
 *   2. Position vs the monthly goal pace (skip if no goal set)
 *   3. The top store by revenue (skip if no stores have data)
 *
 * The sentence is intentionally compact — under ~140 characters so it
 * fits as a one-line eyebrow inside the LIVE hero. Long names truncate
 * naturally via the CSS `.lh-narrative` rule (line-clamp).
 */
export interface NarrativeInputs {
  /** Today's aggregate revenue in display currency (CAD). */
  revenue: number;
  /** Today's aggregate ROAS as a number (e.g. 2.42). */
  roas: number;
  /** Per-store aggregates for today; used to pick the top store by revenue. */
  storeAggs: Array<{ store: string; revenue: number; roas: number }>;
  /** Monthly revenue goal in display currency. `null` if no goal is set. */
  monthlyGoal: number | null;
  /** Revenue accrued from the 1st of the month through end-of-yesterday. */
  monthToDateRevenue: number;
  /** Day-of-month (1..31) for pace calculation. */
  dayOfMonth: number;
  /** Number of days in the current month. */
  daysInMonth: number;
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.round(n));

const fmtRoas = (n: number) => n.toFixed(2);

export function buildTodayNarrative(inputs: NarrativeInputs): string {
  const {
    revenue,
    roas,
    storeAggs,
    monthlyGoal,
    monthToDateRevenue,
    dayOfMonth,
    daysInMonth,
  } = inputs;

  // Fallback: no data yet today.
  if (revenue <= 0 && roas <= 0) {
    return 'עוד אין נתונים להיום. הלייב יתעדכן אוטומטית כשהקמפיינים מתחילים לרוץ.';
  }

  // Lead clause — always present.
  const lead = `היום עשית ₪${fmtCurrency(revenue)} מכירות ב-ROAS של ${fmtRoas(roas)}x`;

  // Pace clause — present iff a monthly goal is set.
  let paceClause = '';
  if (monthlyGoal != null && monthlyGoal > 0 && daysInMonth > 0) {
    // Pace = where MTD revenue "should" be to hit the target by month-end.
    const targetPace = (monthlyGoal * dayOfMonth) / daysInMonth;
    const ahead = monthToDateRevenue >= targetPace;
    const pct = targetPace > 0
      ? Math.round(Math.abs(monthToDateRevenue - targetPace) / targetPace * 100)
      : 0;
    paceClause = ahead
      ? ` — ${pct}% מעל יעד הקצב החודשי`
      : ` — ${pct}% מתחת ליעד הקצב החודשי`;
  }

  // Top-store clause — present iff at least one store has positive revenue.
  let topStoreClause = '';
  const withRevenue = storeAggs.filter(s => s.revenue > 0);
  if (withRevenue.length > 0) {
    const top = withRevenue.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    topStoreClause = `; ${top.store} מובילה היום.`;
  } else {
    topStoreClause = '.';
  }

  return `${lead}${paceClause}${topStoreClause}`;
}
```

- [ ] **Step 4: Run → pass**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/todayNarrative.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/todayNarrative.ts \
        dashboard-web/src/lib/__tests__/todayNarrative.test.ts
git commit -m "feat(home): buildTodayNarrative pure helper — revenue + ROAS + pace + top store"
```

---

## Task 2: Wire narrative into TodayLive + token migration

**Files:**
- Modify: `dashboard-web/src/components/TodayLive.tsx`

This is the most consequential single change in Plan 2. Two things land in the same commit because they touch the same file and would conflict if split:

A. **Narrative line** rendered between the `<header>` (LIVE pulse + title + timestamp) and the `<div className="grid">` (6 stat cards). It's a single `<div>` that calls `buildTodayNarrative()` with values TodayLive already computes.

B. **Token migration** for the 13 hardcoded color references inside `LIVE_TONE_STYLES` and the surrounding markup. The migration map (top of this file) is the SSOT.

The ROAS-driven gradient logic stays byte-for-byte: same SSOT (`roasLabel()` in `analytics.ts`), same 5 tones, same pulse, same blob blur — only the Tailwind class names inside the style record change.

- [ ] **Step 1: Read TodayLive.tsx** end-to-end so the structural picture is fresh. The relevant sections:

  - Lines 37-43: `TONE_BG` map for badge backgrounds.
  - Lines 84-125: `LIVE_TONE_STYLES` record — 5 tones × 6 style fields. These are the strings to migrate.
  - Lines ~317-410: The render JSX — the `<section>`, `<header>`, decorative blob, stat grid, per-store cards, footer.
  - Lines 460+ near the per-store store cards: more uses of `bg-surface`, `border-borderSubtle`, etc.

- [ ] **Step 2: Add the goal-read helper and narrative rendering**

Add an import at the top of TodayLive.tsx:

```ts
import { buildTodayNarrative } from '@/lib/todayNarrative';
```

Inside the `TodayLive` component body (after `agg`, `storeAggs`, `roas`, `hasAnyData` are computed), add the goal read and narrative compute:

```ts
// Read the monthly goal that GoalTracker maintains in localStorage. Re-reads
// on every render — cheap, and a focus event / cloud-sync update would
// trigger a re-render anyway via the existing `roas-goal-changed` event
// listened to elsewhere. Returns null if not set.
const monthlyGoal: number | null = useMemo(() => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem('roas-monthly-goal');
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}, []);

// Compute month-to-date revenue + day-of-month for pace calculation. The
// liveDataResp slice TodayLive fetches is today-only; for MTD we need to
// look at the parent's range data — but for an MTD calculation that's
// strictly historical (1st of month → end of yesterday), the SWR data
// passed via `_parentRows` is what we want, scoped to dates < today.
// Note: _parentRows is intentionally ignored elsewhere (range-decoupling),
// but for MTD we DO want the parent's broader window. If the parent's
// range doesn't cover the month-to-date span (e.g. operator chose "last 7
// days" before today), we fall back to whatever MTD is reachable inside
// the slice and explain that in the narrative.
const today = todayInIsrael(); // existing helper
const todayDate = new Date(today + 'T00:00:00');
const dayOfMonth = todayDate.getDate();
const daysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
const monthToDateRevenue = useMemo(() => {
  if (monthlyGoal == null) return 0;
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)
    .toISOString().slice(0, 10);
  let sum = 0;
  for (const r of _parentRows) {
    if (r.date >= monthStart && r.date < today) sum += r.revenue;
  }
  return sum;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- todayDate is stable per render; _parentRows from props
}, [_parentRows, today, monthlyGoal]);

const narrative = useMemo(
  () => buildTodayNarrative({
    revenue: agg.revenue,
    roas: agg.roas,
    storeAggs: storeAggs.map(s => ({ store: s.store, revenue: s.revenue, roas: s.roas })),
    monthlyGoal,
    monthToDateRevenue,
    dayOfMonth,
    daysInMonth,
  }),
  [agg.revenue, agg.roas, storeAggs, monthlyGoal, monthToDateRevenue, dayOfMonth, daysInMonth],
);
```

**Important — the `_parentRows` prop**: TodayLive currently marks `_parentRows` as intentionally unused. That comment + the `void _parentRows;` line stay there. For MTD we re-read the prop but the live-snapshot logic continues to use the today-only SWR fetch. The prop is now genuinely consumed for the MTD context — REMOVE the `void _parentRows;` line and update the JSDoc to note the new usage.

- [ ] **Step 3: Render the narrative between header and stat grid**

Find the JSX block (around line 339-359 today) that opens `<div className="relative p-4 sm:p-6">` and renders the `<header>` block first. Right AFTER the `</header>` and BEFORE the `{/* Stats grid */}` comment, insert:

```tsx
{/* ===== NEW: narrative line — sits between the LIVE header and the 6
            stat cards. Single sentence summarizing today's revenue, ROAS,
            pace vs monthly goal, and top store. ===== */}
{hasAnyData && (
  <div
    className="mt-3 sm:mt-4 mb-3 sm:mb-4 px-3 sm:px-4 py-2.5 rounded-lg bg-canvas/40 border-s-2 border-status-green/60 text-xs sm:text-sm leading-relaxed text-ink-secondary tabular-nums"
    data-testid="today-narrative"
  >
    {narrative}
  </div>
)}
```

The narrative uses `border-s-2 border-status-green/60` — a thin start-side accent that mirrors the green ROAS band so the narrative visually belongs to the same hero. The border color is intentionally NOT tied to `liveTone.cardBorder` — using a single green accent keeps the narrative readable in all 4 ROAS-tone states (otherwise on a red day the narrative would read as an error banner).

- [ ] **Step 4: Migrate the LIVE_TONE_STYLES record + surrounding tokens**

Replace the `LIVE_TONE_STYLES` record's class strings using the migration map. Specifically:

```ts
const LIVE_TONE_STYLES: Record<string, LiveTone> = {
  gray: {
    cardBg: 'bg-gradient-to-br from-status-grayBg/60 via-elevated to-elevated',
    cardBorder: 'border-line',
    blob: 'bg-status-gray/10',
    pulse: 'bg-status-gray',
    pill: 'bg-status-gray text-white',
    iconColor: 'text-status-gray',
  },
  red: {
    cardBg: 'bg-gradient-to-br from-status-redBg/60 via-elevated to-elevated',
    cardBorder: 'border-status-red/35',
    blob: 'bg-status-red/12',
    pulse: 'bg-status-red',
    pill: 'bg-status-red text-white',
    iconColor: 'text-status-red',
  },
  orange: {
    cardBg: 'bg-gradient-to-br from-status-orangeBg/60 via-elevated to-elevated',
    cardBorder: 'border-status-orange/35',
    blob: 'bg-status-orange/12',
    pulse: 'bg-status-orange',
    pill: 'bg-status-orange text-white',
    iconColor: 'text-status-orange',
  },
  green: {
    cardBg: 'bg-gradient-to-br from-status-greenBg/50 via-elevated to-elevated',
    cardBorder: 'border-status-green/30',
    blob: 'bg-status-green/10',
    pulse: 'bg-status-green',
    pill: 'bg-status-green text-white',
    iconColor: 'text-status-green',
  },
  blue: {
    cardBg: 'bg-gradient-to-br from-status-blueBg/55 via-elevated to-elevated',
    cardBorder: 'border-status-blue/30',
    blob: 'bg-status-blue/12',
    pulse: 'bg-status-blue',
    pill: 'bg-status-blue text-white',
    iconColor: 'text-status-blue',
  },
};
```

Also update the `TONE_BG` record at line 37-43:

```ts
const TONE_BG: Record<string, string> = {
  red:    'bg-status-redBg text-status-red',
  orange: 'bg-status-orangeBg text-status-orange',
  green:  'bg-status-greenBg text-status-green',
  blue:   'bg-status-blueBg text-status-blue',
  gray:   'bg-elevated2 text-ink-muted',
};
```

- [ ] **Step 5: Migrate the rest of the markup tokens**

Apply the migration map to the remaining hardcoded references in TodayLive.tsx. The grep targets:

- `bg-surface` → `bg-elevated`
- `bg-surface/90` → `bg-elevated/90`
- `border-borderSubtle` → `border-line-subtle`
- `text-text-primary` → `text-ink`
- `text-text-secondary` → `text-ink-secondary`
- `text-text-muted` → `text-ink-muted`
- `text-text-muted/70` → `text-ink-muted/70`
- `text-text-muted/80` → `text-ink-muted/80`
- `text-text-subtle` → `text-ink-subtle`
- `shadow-xs` → `shadow-sm`
- `shadow-card` → `shadow-sm` (or keep `shadow-card` until Plan 7 if the Tailwind extension still defines it — check)
- `bg-roas-greenBg/40` (used inside per-store card revenue chip) → `bg-status-greenBg/40`
- `text-roas-green/80` → `text-status-green/80`
- `text-roas-green` → `text-status-green`
- `text-roas-red` → `text-status-red`
- `border-roas-green/15` (footer border) → `border-status-green/15`

The per-store card subcomponents (lines 408-535) use most of these. Search-and-replace is safe because the migration is mechanical — but verify by reading the full file after the edits.

- [ ] **Step 6: Verify tsc + build + tests + visual**

```bash
cd dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run build 2>&1 | tail -5
npm run test 2>&1 | tail -5
npm run test:components 2>&1 | tail -5
```

All must pass. No new tests are added in this task (the narrative helper is already tested in Task 1; the TodayLive structural change is too visual for a unit test — Plan 7's visual diff harness handles it).

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/components/TodayLive.tsx
git commit -m "feat(home): TodayLive — narrative line + OKLCH token migration (ROAS gradient preserved)"
```

---

## Task 3: HeroOverview token migration

**Files:**
- Modify: `dashboard-web/src/components/HeroOverview.tsx`

HeroOverview (738L) is the editorial-story + chart-as-background + floating-KPI section that sits second on the בית tab. The Recharts upgrade happens in Plan 3 — this task is tokens only.

- [ ] **Step 1: Read HeroOverview.tsx** to identify the legacy palette usages. Quickly count by grep:

```bash
cd dashboard-web
grep -nE "bg-(surface|background|primary|surfaceMuted|surfaceSubtle|surfaceSunken|roas-)|border-(border|borderSubtle|borderStrong|roas-)|text-(text-|primary|roas-)" src/components/HeroOverview.tsx | wc -l
```

Use this number as a sanity check at the end (after migration the count is 0 within the HeroOverview file).

- [ ] **Step 2: Apply the migration map** to every legacy class. Keep all logic (the heavy-refund chip from `refundDayHeuristic.ts`, the FloatingKpi sub-components, RoasTrendChart, ContextStat) byte-for-byte; only the className strings change.

Specific pitfalls to watch for in HeroOverview:
- The chart's gradient stops use literal hex colors as fill values (`fill="rgba(13, 54, 128, 0.18)"` etc.). Plan 3 migrates these to CSS variables; leave them alone in Plan 2.
- The "amber chip" for heavy refund days uses `text-amber-600` / `bg-amber-50`. Tailwind's `amber` palette is preserved — KEEP these as-is. The migration map only covers the project-specific legacy tokens.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit ; echo "tsc=$?"
npm run build 2>&1 | tail -5
npm run test 2>&1 | tail -5
grep -cE "bg-(surface|background|primary|surfaceMuted|surfaceSubtle|surfaceSunken|roas-)|border-(border|borderSubtle|borderStrong|roas-)|text-(text-|primary|roas-)" dashboard-web/src/components/HeroOverview.tsx
```

The last grep should return 0 (no remaining legacy class usages). If it returns >0, those are unintentional misses — fix them.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/HeroOverview.tsx
git commit -m "refactor(home): HeroOverview token migration (legacy → OKLCH; structure unchanged)"
```

---

## Task 4: GoalTracker token migration

**Files:**
- Modify: `dashboard-web/src/components/GoalTracker.tsx`

GoalTracker is the global monthly-goal section. Non-Negotiable: it continues to ignore `filters.store` and `filters.range`. Migration is tokens only.

- [ ] **Step 1: Read GoalTracker.tsx** and apply the migration map.

The notable internal patterns:
- The progress bar uses ROAS-aware tinting; the tones are: red when behind by >20%, amber when behind 0-20%, green when on/ahead of pace, blue when ahead by >10%. These tints map 1-to-1 to the new `status-*` tokens. Migration map handles them.
- The `roas-billing-changed` event listener stays — it's a global event, not a color.
- The `localStorage.getItem('roas-monthly-goal')` interaction stays — Task 2 of this plan reads the same key.

- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
npx tsc --noEmit
npm run test
git add dashboard-web/src/components/GoalTracker.tsx
git commit -m "refactor(home): GoalTracker token migration (global-filter behavior preserved)"
```

---

## Task 5: InsightsBoard token migration

**Files:**
- Modify: `dashboard-web/src/components/InsightsBoard.tsx`

InsightsBoard surfaces anomalies + opportunities. The card severity colors (good = green, attention = amber, alert = red) map to status tokens. The migration is mechanical.

- [ ] **Step 1: Apply migration map** to every legacy class.

Specific: the `cardSeverity` function (or wherever severity → class is computed) likely returns strings like `'bg-roas-greenBg border-roas-green/30 text-roas-green'`. Each becomes the `status-*` equivalent.

- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
npx tsc --noEmit
npm run test
git add dashboard-web/src/components/InsightsBoard.tsx
git commit -m "refactor(home): InsightsBoard token migration"
```

---

## Task 6: AnnotationsPanel token migration

**Files:**
- Modify: `dashboard-web/src/components/AnnotationsPanel.tsx`

Activity log overlay. Each annotation has a type (info / warning / event) which maps to a tone. Migration is mechanical.

- [ ] **Step 1: Apply migration map.**
- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
git add dashboard-web/src/components/AnnotationsPanel.tsx
git commit -m "refactor(home): AnnotationsPanel token migration"
```

---

## Task 7: KpiCards token migration

**Files:**
- Modify: `dashboard-web/src/components/KpiCards.tsx`

The detailed range KPIs ("מדדים מסכמים לתקופה"). Each card has a primary number + delta vs previous period. The delta tone (green when better, red when worse) is computed inline.

- [ ] **Step 1: Apply migration map** + verify the delta tone logic uses the new status tokens.
- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
git add dashboard-web/src/components/KpiCards.tsx
git commit -m "refactor(home): KpiCards token migration"
```

---

## Task 8: PerStoreCards token migration

**Files:**
- Modify: `dashboard-web/src/components/PerStoreCards.tsx`

Per-store summary cards for the selected range. Each card uses the canonical `storeColors.ts` dot color (kept as-is — those are not migrated) plus surface/border/text tokens (migrated).

- [ ] **Step 1: Apply migration map.** Do NOT touch `storeColors.ts` or any of the per-store dot color logic — those are content-domain colors, not chrome tokens.
- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
git add dashboard-web/src/components/PerStoreCards.tsx
git commit -m "refactor(home): PerStoreCards token migration (per-store dot colors preserved)"
```

---

## Task 9: AiReportButton token migration

**Files:**
- Modify: `dashboard-web/src/components/AiReportButton.tsx`

The entry point for the AI day summary. Renders a button in the row above the global Filters (in the original layout) — after Plan 1's restructure, it lives in the same row but as part of the per-tab header strip.

- [ ] **Step 1: Apply migration map** to the button + modal styling.

Watch out: the modal Dialog uses Tailwind classes that already migrated via the components/ui/Dialog wrapper — the inline modal in AiReportButton may have its OWN style; check whether it uses our new `components/ui/Dialog` or rolls its own. If it rolls its own, migrate tokens but don't convert to the new Dialog primitive in this task (that's a separate refactor for Plan 7).

- [ ] **Step 2: Verify + commit**

```bash
cd dashboard-web
git add dashboard-web/src/components/AiReportButton.tsx
git commit -m "refactor(home): AiReportButton token migration"
```

---

## Task 10: Inline AI insight pill component + wire to InsightsBoard

**Files:**
- Create: `dashboard-web/src/components/ui/AiInsightPill.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/AiInsightPill.test.tsx`
- Modify: `dashboard-web/src/components/InsightsBoard.tsx`

The spec calls for "inline AI insight pills" — small contextual sentences next to existing SectionIntro headers, generated from the same `aiReport` data that today's `AiReportButton` opens as a modal. The pill is a new primitive (component + a CSS class set); the InsightsBoard is the FIRST consumer.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/__tests__/AiInsightPill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiInsightPill } from '../AiInsightPill';

describe('AiInsightPill', () => {
  it('renders the AI-tagged text content', () => {
    render(<AiInsightPill>הקמפיין הראשון מתחיל לטפוף.</AiInsightPill>);
    expect(screen.getByText('הקמפיין הראשון מתחיל לטפוף.')).toBeInTheDocument();
  });

  it('has role="status" so screen readers pick it up as a non-disruptive announcement', () => {
    render(<AiInsightPill data-testid="pill">x</AiInsightPill>);
    expect(screen.getByTestId('pill')).toHaveAttribute('role', 'status');
  });

  it('renders nothing when children is falsy', () => {
    const { container } = render(<AiInsightPill>{null}</AiInsightPill>);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for empty string', () => {
    const { container } = render(<AiInsightPill>{''}</AiInsightPill>);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
npm run test:components -- AiInsightPill.test.tsx
```

- [ ] **Step 3: Implement `AiInsightPill.tsx`**

Create `dashboard-web/src/components/ui/AiInsightPill.tsx`:

```tsx
import { type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tiny inline AI-generated context line. Used next to SectionIntro headers
 * to surface a sentence of context from the existing aiReport data without
 * the heavy modal experience. The component renders nothing when there's
 * no content so consumers can pass `null` safely.
 *
 * Render contract:
 *   - role="status" so screen readers announce non-disruptively.
 *   - Sparkles icon at the start (inline, before the text).
 *   - Subtle background (canvas/40) with a short start-side accent.
 *   - No close affordance — this is information, not a notification.
 */
export function AiInsightPill({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  if (!children || (typeof children === 'string' && children.trim() === '')) {
    return null;
  }
  return (
    <div
      role="status"
      className={cn(
        'inline-flex items-start gap-1.5 rounded-md bg-canvas/40 border-s-2 border-accent/40',
        'px-2.5 py-1.5 text-xs leading-relaxed text-ink-secondary',
        className,
      )}
      {...rest}
    >
      <Sparkles size={12} className="shrink-0 mt-0.5 text-accent" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
```

- [ ] **Step 4: Wire AiInsightPill into InsightsBoard**

Inside `InsightsBoard.tsx`, find the top-level SectionIntro (or wherever the section title renders). Render an `<AiInsightPill>` next to it that pulls a one-sentence summary from the same data that drives the full insights cards. The exact wiring depends on what InsightsBoard exposes — keep it simple:

```tsx
import { AiInsightPill } from '@/components/ui/AiInsightPill';

// Inside the component, after computing the insights array:
const headlineInsight = insights.length > 0 ? insights[0].title : null;

// In the JSX, before the cards grid:
{headlineInsight && (
  <div className="mb-3">
    <AiInsightPill>{headlineInsight}</AiInsightPill>
  </div>
)}
```

If InsightsBoard already has a hero-summary slot, drop the pill there instead. This is light wiring — the goal is to demonstrate the AiInsightPill in production. Plan 5 will expand AiInsightPill consumers in other tabs.

- [ ] **Step 5: Run tests + verify InsightsBoard still renders normally**

```bash
cd dashboard-web
npm run test:components -- AiInsightPill.test.tsx
npm run test
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/ui/AiInsightPill.tsx \
        dashboard-web/src/components/ui/__tests__/AiInsightPill.test.tsx \
        dashboard-web/src/components/InsightsBoard.tsx
git commit -m "feat(home): AiInsightPill primitive + first consumer in InsightsBoard"
```

---

## Task 11: Adopt TabHeader on בית tab in Dashboard.tsx

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx`

Plan 1 introduced `TabHeader` as a primitive for per-tab title/description/filter strips. This task adopts it on the בית tab specifically. The other 5 tabs continue to use their existing SectionIntro pattern until their respective plans migrate them.

- [ ] **Step 1: Import TabHeader**

Add to the imports near the top of Dashboard.tsx:

```ts
import { TabHeader } from './TabHeader';
```

- [ ] **Step 2: Replace the בית tab's filter+AiReport row with TabHeader**

Find the `HomeTab` function (around line 333 today). The current structure is:

```tsx
{/* ===== Filters — quiet, just controls. AI-report button on the right. ===== */}
<div className="flex items-center justify-between gap-3 flex-wrap pt-1">
  <div className="flex items-center gap-2 text-xs sm:text-sm text-text-secondary">
    <CalendarDays size={14} className="text-text-muted" />
    <span>שנה טווח או חנות לעדכון כל המסך</span>
  </div>
  <AiReportButton data={data} filters={filters} openSignal={aiReportSignal} />
</div>
<Filters filters={filters} stores={data.stores} onChange={setFilters} />
```

Replace with:

```tsx
<TabHeader
  title="בית"
  description="שנה טווח או חנות לעדכון כל המסך."
  filterSlot={<Filters filters={filters} stores={data.stores} onChange={setFilters} />}
  actionSlot={<AiReportButton data={data} filters={filters} openSignal={aiReportSignal} />}
/>
```

TabHeader handles spacing/dividing line. The original CalendarDays icon + "שנה טווח..." hint becomes the description line.

- [ ] **Step 3: Verify build + manual sanity**

```bash
cd dashboard-web
npx tsc --noEmit
npm run build 2>&1 | tail -5
npm run test 2>&1 | tail -5
```

Manual sanity (if dev server is available): on the בית tab, the filters appear inside a header strip with title "בית" and an AiReport button on the action side. Filter URL params still work.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx
git commit -m "feat(home): adopt TabHeader on בית tab (Filters + AiReport hosted inside)"
```

---

## Task 12: Wrap-up — full migration audit

**No new files.** This is a verification-only task.

- [ ] **Step 1: Grep for any remaining legacy tokens in בית tab files**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
for f in \
  src/components/TodayLive.tsx \
  src/components/HeroOverview.tsx \
  src/components/GoalTracker.tsx \
  src/components/InsightsBoard.tsx \
  src/components/AnnotationsPanel.tsx \
  src/components/KpiCards.tsx \
  src/components/PerStoreCards.tsx \
  src/components/AiReportButton.tsx ; do
  echo "=== $f ==="
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary|roas-)|border-(border|borderSubtle|borderStrong|roas-)|text-(text-|primary|roas-)" "$f" || echo "(clean)"
done
```

Every section should print "(clean)" — meaning zero legacy token references survived. Any line that does not should be migrated before finishing this plan.

- [ ] **Step 2: Full test + build + lint**

```bash
npm run test:all
npm run build 2>&1 | tail -10
npx tsc --noEmit
npm run lint 2>&1 | tail -3
```

Expected: all green. The DOM suite gained 4 tests from AiInsightPill; the node suite gained 7 tests from todayNarrative. Total: 1,328 tests pass.

- [ ] **Step 3: Update memory + non-final notes**

Plan 2 doesn't require a memory update by itself (the project memory already tracks branch state). Plan 7 (polish) will close out and update memory with merge details.

- [ ] **Step 4: Tag wrap-up commit**

```bash
git tag plan-02-bayit-tab-done
```

No final commit — Plan 2 ends with whatever the previous tasks committed.

---

## Self-Review

Run through this checklist before declaring Plan 2 complete:

1. **Spec coverage:**
   - ✅ TodayLive narrative line (Task 1 + 2)
   - ✅ Inline AI insight pills (Task 10)
   - ✅ Token migration of every HomeTab section (Tasks 2-9)
   - ✅ TabHeader adoption on בית tab (Task 11)
   - ✅ ROAS-gradient preserved 1-to-1 (Task 2 step 4)
   - ✅ GoalTracker stays global, ignores filters (Task 4)
   - ✅ Filter contract unchanged (Tasks 11)
   - ✅ Data layer untouched (no API routes modified)

2. **Placeholder scan:** No TBD / TODO / "add appropriate" / "similar to" — search the document.

3. **Type consistency:** `NarrativeInputs` defined once, consumed by buildTodayNarrative and tests. `AiInsightPill` typed via React.HTMLAttributes<HTMLDivElement>.

4. **Scope check:** Plan produces a working, testable בית tab. The other 5 tabs continue to function (their SectionIntro pattern, their original Filters placement) until their plans migrate them. No partial states.

5. **Non-negotiables verified:** Each migration task explicitly preserves the relevant non-negotiable (ROAS gradient, global goal, RTL, filter contract).
