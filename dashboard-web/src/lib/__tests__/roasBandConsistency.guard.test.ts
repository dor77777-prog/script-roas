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
