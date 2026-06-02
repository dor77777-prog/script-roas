// dashboard-web/src/components/__tests__/dashboardGoalWiring.test.ts
//
// T4 wiring guard (2026-06-02 — per-month, range-aware monthly goal).
//
// GoalTracker evolved from a single global current-month target to per-month
// goals with range-aware lookback (T3). It now REQUIRES a `range` prop: the
// dashboard's selected range picks the single calendar month the panel shows
// (via `monthFromRange`), and any other span renders the empty state. If a
// regress drops the prop, the panel can no longer resolve a month — so this
// source-file guard locks the wiring.
//
// Mirrors the existing source-file guards (goalTrackerPlacement.test.ts +
// dashboardSalariesWiring.test.ts): a fast fs.readFileSync + regex assertion,
// no React render / SWR mock / jsdom needed. It asserts:
//   1. The single production <GoalTracker> render passes BOTH data + the
//      `range={filters.range}` prop (the page-level selected range — never a
//      per-store or per-chart range).
//   2. No legacy single-goal API (readGoal / writeGoal) is imported into
//      Dashboard.tsx — the panel reads per-month goals via useGoalSettings now,
//      and the legacy helpers stay in lib/insights.ts for migration ONLY.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_SRC = resolve(__dirname, '..', 'Dashboard.tsx');

describe('Dashboard GoalTracker wiring (T4 — per-month, range-aware)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');

  it('renders <GoalTracker> with the data prop and range={filters.range}', () => {
    // data + range, order-independent, whitespace-tolerant. The `range` must be
    // the page-level `filters.range` (not a chart range or per-store range) so
    // the panel resolves to the single calendar month the operator selected.
    expect(src).toMatch(
      /<GoalTracker\b[^>]*\bdata=\{data\}[^>]*\brange=\{filters\.range\}/,
    );
  });

  it('passes range={filters.range} to GoalTracker exactly once (single render)', () => {
    const renders = src.match(/<GoalTracker\b[^>]*\/>/g) ?? [];
    expect(renders.length, 'GoalTracker should render exactly once in Dashboard.tsx').toBe(1);
    expect(renders[0]).toMatch(/range=\{filters\.range\}/);
  });

  it('does NOT import the legacy single-goal API (readGoal / writeGoal) into Dashboard.tsx', () => {
    // The legacy helpers live in lib/insights.ts for migration / back-compat
    // hydrate only. The panel now reads per-month goals via useGoalSettings, so
    // Dashboard must not pull the legacy single-goal functions back in.
    const goalImports = src.match(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*insights['"]/g) ?? [];
    for (const line of goalImports) {
      expect(line, 'Dashboard.tsx must not import the legacy readGoal').not.toMatch(/\breadGoal\b/);
      expect(line, 'Dashboard.tsx must not import the legacy writeGoal').not.toMatch(/\bwriteGoal\b/);
    }
  });
});
