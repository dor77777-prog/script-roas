// dashboard-web/src/components/__tests__/goalTrackerPlacement.test.ts
//
// Wave 5 Task 5.11 — regression guard.
//
// The user explicitly decided GoalTracker stays on the P&L tab, NOT Home.
// See MEMORY entry [[feedback_monthly_goal_is_global]] + Q8 in the
// 2026-05-30 UI/UX overhaul plan. The monthly-goal panel is a business-
// wide target that ignores filters.store + filters.range — it does not
// belong on Home, which is a heavily filterable surface.
//
// This is a source-file guard (fs.readFileSync + regex) rather than a
// DOM mount because:
//   - it has to assert *absence* on one tab body, not just presence in
//     the rendered output (the active tab is one-of-N at any time);
//   - it stays fast (no React render, no SWR mocking, no jsdom);
//   - source-file slice is robust against future refactors that move
//     the surrounding markup around as long as the function boundaries
//     `function HomeTab(…)` / `function PnLTab(…)` stay intact.
//
// If/when GoalTracker is renamed or hoisted into a sub-component, update
// the markers below; the assertion semantics stay the same.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_SRC = resolve(
  __dirname,
  '..',
  'Dashboard.tsx',
);

function sliceBetween(source: string, startMarker: RegExp, endMarker: RegExp): string {
  const startMatch = startMarker.exec(source);
  if (!startMatch) {
    throw new Error(`startMarker ${startMarker} not found in Dashboard.tsx`);
  }
  const afterStart = source.slice(startMatch.index);
  const endMatch = endMarker.exec(afterStart);
  if (!endMatch) {
    throw new Error(`endMarker ${endMarker} not found after startMarker`);
  }
  return afterStart.slice(0, endMatch.index);
}

describe('GoalTracker placement (Q8 — P&L only, not Home)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');

  it('imports GoalTracker exactly once at the top of Dashboard.tsx', () => {
    // The import line must still exist so the regex sliced bodies can
    // mount it. If this assertion fails, GoalTracker was probably
    // deleted entirely — the next two assertions will then be ambiguous,
    // so we lock the import up-front.
    const importMatches = src.match(/import\s*\{[^}]*\bGoalTracker\b[^}]*\}\s*from\s*['"][^'"]+['"]\s*;/g);
    expect(importMatches, 'GoalTracker import line missing from Dashboard.tsx').not.toBeNull();
    expect(importMatches!.length).toBe(1);
  });

  it('renders <GoalTracker> inside the PnLTab function body', () => {
    const pnlTabBody = sliceBetween(
      src,
      /function\s+PnLTab\s*\(/,
      // The next top-level `function ` declaration ends the PnLTab body
      // (functions in Dashboard.tsx are flat — no nested function decls).
      /\n\s*\/\/\s*=+\s*\nfunction\s+\w+/,
    );
    expect(pnlTabBody, 'GoalTracker must render inside PnLTab').toMatch(/<GoalTracker\b/);
  });

  it('does NOT render <GoalTracker> inside the HomeTab function body', () => {
    const homeTabBody = sliceBetween(
      src,
      /function\s+HomeTab\s*\(/,
      // The next top-level `function ` declaration ends the HomeTab body.
      /\n\s*\/\/\s*=+\s*\nfunction\s+\w+/,
    );
    expect(
      homeTabBody,
      'GoalTracker drifted back onto Home — per Q8 it lives on P&L only because it is a business-wide goal that ignores filters.store + filters.range',
    ).not.toMatch(/<GoalTracker\b/);
  });
});
