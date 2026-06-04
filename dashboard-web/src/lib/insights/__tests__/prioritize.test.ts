/**
 * prioritizeInsights — pure ranking for the InsightsBoard.
 *
 * Contract (no visibility filtering — the CALLER passes only currently-visible
 * insights):
 *   1. DEDUP collapses multiple detectors on the same target to the single
 *      highest-weight insight. key = campaignId ? `c:${campaignId}`
 *      : scope ? `s:${scope}:${kind}` : `id:${id}`. Ties → more severe
 *      severity, then lexicographically smaller id.
 *   2. SORT DESC by weight; tie-break by severity rank
 *      (critical > warning > opportunity > positive > info); then id asc.
 *   3. GUARANTEE-CRITICAL top-N: keep sort order, cut to top-N, but NEVER
 *      drop a `critical` even if it ranks beyond n.
 */
import { describe, it, expect } from 'vitest';
import { prioritizeInsights } from '@/lib/insights/prioritize';
import type { Insight, Severity } from '@/lib/insights';

function ins(patch: Partial<Insight> & { id: string }): Insight {
  return {
    severity: 'info',
    kind: 'recommendation',
    title: 'כותרת',
    detail: 'פירוט',
    weight: 50,
    ...patch,
  };
}

describe('prioritizeInsights', () => {
  it('(a) dedups by campaignId, keeping the higher-weight insight', () => {
    const low = ins({ id: 'a', campaignId: 'C1', weight: 60 });
    const high = ins({ id: 'b', campaignId: 'C1', weight: 90 });
    const out = prioritizeInsights([low, high], 10);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b');
  });

  it('(b) dedups by scope+kind when there is no campaignId', () => {
    const low = ins({ id: 'a', scope: 'uzoshop', kind: 'anomaly', weight: 40 });
    const high = ins({ id: 'b', scope: 'uzoshop', kind: 'anomaly', weight: 80 });
    // Different kind on same scope must NOT collapse with the above.
    const other = ins({ id: 'c', scope: 'uzoshop', kind: 'recommendation', weight: 70 });
    const out = prioritizeInsights([low, high, other], 10);
    expect(out).toHaveLength(2);
    const ids = out.map(o => o.id).sort();
    expect(ids).toEqual(['b', 'c']);
  });

  it('(c) sorts by weight desc, then severity rank, then id asc', () => {
    const a = ins({ id: 'a', campaignId: 'A', weight: 50, severity: 'info' });
    const b = ins({ id: 'b', campaignId: 'B', weight: 90, severity: 'warning' });
    // same weight as `d`, but more severe severity → ranks higher
    const c = ins({ id: 'c', campaignId: 'C', weight: 70, severity: 'critical' });
    const d = ins({ id: 'd', campaignId: 'D', weight: 70, severity: 'warning' });
    // same weight + same severity as a later one → id breaks the tie
    const e = ins({ id: 'e', campaignId: 'E', weight: 70, severity: 'critical' });
    const out = prioritizeInsights([a, b, c, d, e], 10);
    expect(out.map(o => o.id)).toEqual(['b', 'c', 'e', 'd', 'a']);
  });

  it('(d) top-N cut drops the lowest-ranked non-critical beyond n', () => {
    const a = ins({ id: 'a', campaignId: 'A', weight: 90, severity: 'warning' });
    const b = ins({ id: 'b', campaignId: 'B', weight: 80, severity: 'warning' });
    const c = ins({ id: 'c', campaignId: 'C', weight: 70, severity: 'warning' });
    const out = prioritizeInsights([a, b, c], 2);
    expect(out.map(o => o.id)).toEqual(['a', 'b']);
  });

  it('(e) a critical ranked beyond n is STILL included', () => {
    const a = ins({ id: 'a', campaignId: 'A', weight: 95, severity: 'warning' });
    const b = ins({ id: 'b', campaignId: 'B', weight: 90, severity: 'warning' });
    // lowest weight but critical → must survive the top-2 cut
    const c = ins({ id: 'c', campaignId: 'C', weight: 10, severity: 'critical' });
    const out = prioritizeInsights([a, b, c], 2);
    expect(out.map(o => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('(f) n larger than the list returns all insights (sorted)', () => {
    const a = ins({ id: 'a', campaignId: 'A', weight: 30 });
    const b = ins({ id: 'b', campaignId: 'B', weight: 70 });
    const out = prioritizeInsights([a, b], 50);
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('(g) empty input returns empty output', () => {
    expect(prioritizeInsights([], 5)).toEqual([]);
  });

  it('(dedup tie-break) equal weight → keeps the more severe severity', () => {
    const warn = ins({ id: 'b', campaignId: 'C1', weight: 80, severity: 'warning' });
    const crit = ins({ id: 'z', campaignId: 'C1', weight: 80, severity: 'critical' });
    const out = prioritizeInsights([warn, crit], 10);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('z');
    expect(out[0].severity).toBe('critical');
  });

  it('(dedup tie-break) equal weight + equal severity → keeps smaller id', () => {
    const second = ins({ id: 'm', campaignId: 'C1', weight: 80, severity: 'warning' });
    const first = ins({ id: 'a', campaignId: 'C1', weight: 80, severity: 'warning' });
    const out = prioritizeInsights([second, first], 10);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });

  it('(id fallback key) insights without campaignId or scope key off id', () => {
    const a = ins({ id: 'a', weight: 60 });
    const b = ins({ id: 'b', weight: 90 });
    const out = prioritizeInsights([a, b], 10);
    // No collapse — distinct ids → two rows.
    expect(out.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const a = ins({ id: 'a', campaignId: 'A', weight: 30 });
    const b = ins({ id: 'b', campaignId: 'B', weight: 70 });
    const input: Insight[] = [a, b];
    const snapshot = [...input];
    prioritizeInsights(input, 1);
    expect(input).toEqual(snapshot);
  });
});

// Touch the Severity import so the type is exercised in the test surface.
const _severityCheck: Severity = 'critical';
void _severityCheck;
