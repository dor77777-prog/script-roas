/**
 * prioritizeInsights — pure, deterministic ranking for the InsightsBoard.
 *
 * This module does ONE thing: take a flat list of insights and return the
 * top-N most important ones, deterministically, with criticals guaranteed.
 * It performs NO visibility filtering — the caller is responsible for passing
 * only currently-visible insights (i.e. `isInsightVisible` has already run).
 *
 * Pipeline:
 *   1. DEDUP — multiple detectors firing on the same target collapse to the
 *      single highest-weight insight. The dedup key is:
 *        - `c:${campaignId}`          when the insight references a campaign
 *        - `s:${scope}:${kind}`       when it has a scope but no campaign
 *        - `id:${id}`                 otherwise (unique → never collapses)
 *      Ties (same weight) keep the more SEVERE severity, then the
 *      lexicographically smaller id, for total determinism.
 *
 *   2. SORT — DESC by weight; tie-break by severity rank
 *      (critical > warning > opportunity > positive > info); then id asc.
 *
 *   3. GUARANTEE-CRITICAL top-N — keep the sort order, cut to the first `n`,
 *      but NEVER drop a `critical` even if it ranks beyond `n`.
 */
import type { Insight, Severity } from '../insights';

/**
 * Severity priority — higher number = more severe. Mirrors the documented
 * ladder in insights.ts: info → positive → opportunity → warning → critical.
 * Built off the real `Severity` union so a future union change surfaces here.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  warning: 3,
  opportunity: 2,
  positive: 1,
  info: 0,
};

/** The collapse key that decides which insights are "the same target". */
function dedupKey(ins: Insight): string {
  if (ins.campaignId) return `c:${ins.campaignId}`;
  if (ins.scope) return `s:${ins.scope}:${ins.kind}`;
  return `id:${ins.id}`;
}

/**
 * Returns true when `candidate` should REPLACE `current` as the survivor for
 * a dedup key: strictly higher weight, OR equal weight with a more severe
 * severity, OR equal weight + equal severity with a smaller id.
 */
function isPreferred(candidate: Insight, current: Insight): boolean {
  if (candidate.weight !== current.weight) {
    return candidate.weight > current.weight;
  }
  const cs = SEVERITY_RANK[candidate.severity];
  const us = SEVERITY_RANK[current.severity];
  if (cs !== us) return cs > us;
  return candidate.id < current.id;
}

/** Sort comparator: weight desc → severity rank desc → id asc. */
function compareInsights(a: Insight, b: Insight): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sevDiff !== 0) return sevDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rank insights and return the top-N, guaranteeing every `critical` survives.
 *
 * @param insights currently-visible insights (caller already filtered)
 * @param n        soft cap on how many non-critical insights to return
 */
export function prioritizeInsights(insights: Insight[], n: number): Insight[] {
  // 1. DEDUP — keep the single best insight per target key.
  const byKey = new Map<string, Insight>();
  for (const ins of insights) {
    const key = dedupKey(ins);
    const current = byKey.get(key);
    if (!current || isPreferred(ins, current)) {
      byKey.set(key, ins);
    }
  }

  // 2. SORT — copy out of the Map first so we never mutate the input.
  const sorted = Array.from(byKey.values()).sort(compareInsights);

  // 3. GUARANTEE-CRITICAL top-N — keep sort order, cut to n, never drop a critical.
  return sorted.filter((ins, idx) => idx < n || ins.severity === 'critical');
}
