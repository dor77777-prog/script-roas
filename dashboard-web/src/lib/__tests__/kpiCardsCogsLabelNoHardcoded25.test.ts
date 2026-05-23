// dashboard-web/src/lib/__tests__/kpiCardsCogsLabelNoHardcoded25.test.ts
//
// Codex-NEW-1 (MEDIUM) regression: the COGS KpiCard rendered
// `labelSuffix="(25%)"` even though live rows can use a per-store
// `${STORE_UPPERCASE}_COGS_RATE` (e.g. usmile360 at 18%), AND a multi-store
// aggregate's effective rate is a revenue-weighted blend. The big-number
// itself was always correct from `aggregate()`; only the label lied —
// undermining operator trust in the card and making per-store calibration
// look ignored.
//
// vitest runs node so we can't render JSX. Pin the fix as a static-source
// invariant: read the KpiCards.tsx file and assert it no longer contains
// the hardcoded `(25%)` literal. This is the same brittleness flavor as
// "TODO" / "FIXME" lint rules — fine for a one-shot regression guard.
//
// If a future refactor wants to surface a *dynamic* label (e.g.
// "לפי חנות" / "mixed rates"), this test passes as long as the literal
// string "(25%)" stays out of the source.

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const KPI_CARDS_PATH = path.resolve(__dirname, '../../components/KpiCards.tsx');

describe('KpiCards COGS card has NO hardcoded "(25%)" label (Codex-NEW-1)', () => {
  // Strip comments (both // single-line and /* */ block) before scanning so
  // audit-trail comments in the file's docstrings — which legitimately
  // reference the pre-fix shape — don't trip the assertions.
  function readCodeOnly(): string {
    const raw = fs.readFileSync(KPI_CARDS_PATH, 'utf-8');
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlockComments
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
  }

  it('no JSX prop assigns `labelSuffix="(25%)"`', () => {
    const code = readCodeOnly();
    expect(code).not.toMatch(/labelSuffix\s*=\s*["']\(25%\)["']/);
  });

  it('no JSX prop in the source assigns a literal "(25%)" string value', () => {
    // Broader guard: a future card might want to render the live blended
    // rate as a chip — that path must compute it from the aggregate,
    // NOT hardcode 25%. Match either quote style around the parens.
    const code = readCodeOnly();
    expect(code).not.toMatch(/["']\(25%\)["']/);
  });
});
