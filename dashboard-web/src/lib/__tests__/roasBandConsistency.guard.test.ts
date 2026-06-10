/**
 * roasBandConsistency.guard.test.ts — 2026-06-09 (Task 13 / consistency audit)
 *
 * FALSE-ALARM GUARD. The two ROAS-band helpers must stay in lock-step so the
 * SAME ROAS value reads the same band + wording on every surface:
 *   - useRoasBandGradient (lib/format) — drives per-store cards, hero, the
 *     RoasTargetChart KPI tile (band + canonical BAND_TAG_LABEL wording).
 *   - roasLabel (lib/analytics) — drives table badges, StoreDetailModal, etc.
 *
 * A future "consistency fix" that nudges one threshold or relabels one band
 * MUST update both — this test fails loudly if they drift apart (the exact
 * class of bug the 2026-06-09 audit found at the 3.0 boundary + the chart's
 * bespoke "מול היעד" vocabulary).
 */
import { describe, expect, it } from 'vitest';
import { useRoasBandGradient, BAND_TAG_LABEL, type RoasBand } from '@/lib/format/useRoasBandGradient';
import { roasLabel } from '@/lib/analytics';
import { synthesizeRoasChart } from '@/lib/synthesis/roasChart';

// Positive ROAS only — at exactly 0 the two helpers diverge BY DESIGN
// (gradient surfaces the red-alarm "0 sales with spend" path via a flag; label
// treats a bare 0 as "no data"/gray). Every positive value must agree.
const SAMPLES = [0.5, 1.99, 2.0, 2.35, 2.69, 2.7, 2.85, 2.99, 3.0, 3.01, 5.4, 1000];

describe('ROAS band helpers stay in lock-step (false-alarm guard)', () => {
  it.each(SAMPLES)('useRoasBandGradient(%s).band === roasLabel(%s).tone', (r) => {
    expect(useRoasBandGradient(r).band).toBe(roasLabel(r).tone);
  });

  it('BAND_TAG_LABEL wording matches roasLabel text for every band', () => {
    const reps: Array<[number, RoasBand]> = [
      [1.5, 'red'], [2.3, 'orange'], [2.8, 'green'], [4, 'blue'],
    ];
    for (const [r, band] of reps) {
      expect(roasLabel(r).tone).toBe(band);
      expect(BAND_TAG_LABEL[band]).toBe(roasLabel(r).text);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P1-10 (audit 2026-06-10) — synthesis/roasChart drifted: its PRIVATE
// bandForRoas copy mapped exactly-3.0 to BLUE while the canonical helper
// maps 3.0 to GREEN (the 2026-06-09 Task 11 lock), and it banded the
// UNROUNDED average while displaying the ROUNDED anchor (3.04 showed "3.0"
// tinted blue beside a green KPI tile). The synthesiser now delegates to
// useRoasBandGradient on the ROUNDED anchor — this guard keeps it locked.
// ─────────────────────────────────────────────────────────────────────────

function flatPoints(roas: number) {
  return [1, 2, 3].map((d) => ({ date: `2026-06-0${d}`, roas }));
}

describe('synthesizeRoasChart band stays in lock-step with the canonical helper (P1-10)', () => {
  it.each(SAMPLES)('flat series at %s → chart band === useRoasBandGradient(anchor).band', (r) => {
    const out = synthesizeRoasChart({ points: flatPoints(r), range: '7' });
    expect(out.band).toBe(useRoasBandGradient(out.anchorMetric).band);
  });

  it('ROAS exactly 3.0 → GREEN ("at target", Task 11 lock) — not blue', () => {
    const out = synthesizeRoasChart({ points: flatPoints(3.0), range: '7' });
    expect(out.anchorMetric).toBe(3.0);
    expect(out.band).toBe('green');
    expect(useRoasBandGradient(3.0).band).toBe('green');
  });

  it('bands the ROUNDED anchor: avg 3.04 displays "3.0" and must tint green like the KPI tile', () => {
    const out = synthesizeRoasChart({ points: flatPoints(3.04), range: '7' });
    expect(out.anchorMetric).toBe(3.0);
    expect(out.band).toBe('green');
  });
});
