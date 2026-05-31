// dashboard-web/src/components/__tests__/dashboardChartPinsWiring.test.ts
//
// Bug fix regression guard (2026-05-31).
//
// User report: "לא מתווסף לגרף אירוע" — annotation events the operator
// logged via <AnnotationsPanel> were not surfacing as pins on the
// <RoasTargetChart>. Root cause: `toChartData()` in lib/home/adapters.ts
// was returning `pins: []` (stub) and Dashboard.tsx wasn't passing the
// annotations through.
//
// Fix: HomeTab now reads `annotationsAll` from localStorage (same source
// AnnotationsPanel writes to) + filters by `chartFromTo` + `filters.store`,
// then threads the result into `toChartData(...)` as the 5th argument.
//
// This source-file guard asserts:
//   1. HomeTab subscribes to the 'roas-annotations-changed' window event
//      so a freshly-logged annotation re-renders the chart.
//   2. The toChartData call site receives the scope-filtered annotations.
//   3. The `annotationsInScope` reader is imported and called with
//      `chartFromTo` (NOT `filters.range`), so pins follow the chart's
//      independent date picker — not the page filter.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_SRC = resolve(__dirname, '..', 'Dashboard.tsx');

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

describe('RoasTargetChart annotation pins wiring (Bug fix 2026-05-31)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf8');
  const homeTabBody = sliceBetween(
    src,
    /function\s+HomeTab\s*\(/,
    /\n\s*\/\/\s*=+\s*\nfunction\s+\w+/,
  );

  it('imports the annotation readers + Annotation type used by the chart wiring', () => {
    expect(src).toMatch(/\bannotationsInScope\b/);
    expect(src).toMatch(/\breadAnnotations\b/);
    expect(src).toMatch(/\btype\s+Annotation\b/);
  });

  it('HomeTab subscribes to roas-annotations-changed so new pins surface immediately', () => {
    expect(homeTabBody).toMatch(/addEventListener\(\s*['"]roas-annotations-changed['"]/);
    expect(homeTabBody).toMatch(/removeEventListener\(\s*['"]roas-annotations-changed['"]/);
  });

  it('HomeTab scopes annotations by chartFromTo (NOT filters.range) so the chart-local date picker drives pin visibility', () => {
    // The annotationsInScope call must use chartFromTo as the range arg —
    // RoasTargetChart's date picker is independent of the page filter.
    // If a future refactor swaps the arg to filters.range, the pins would
    // stop following the chart picker and the user-visible "pin count
    // chip" would diverge from what's actually plotted.
    expect(homeTabBody).toMatch(
      /annotationsInScope\([^)]*chartFromTo[^)]*\)/,
    );
  });

  it('passes the scope-filtered annotations through to toChartData as the 5th argument', () => {
    // Match the toChartData(...) call inside HomeTab. We expect a 5th
    // argument named `chartAnnotations` (or similar) — the legacy
    // 4-arg call would re-introduce the bug.
    expect(homeTabBody).toMatch(
      /toChartData\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*chartAnnotations\s*,?\s*\)/,
    );
  });
});
