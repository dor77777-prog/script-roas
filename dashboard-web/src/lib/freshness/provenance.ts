/**
 * DQ-4 — provenanceForRange (pure).
 *
 * Collapses the per-day provenance flags of a date range into a single
 * verdict so the UI can label a range as definitively FINALIZED, still a
 * LIVE estimate, or of UNKNOWN provenance.
 *
 * Back-compat is the load-bearing rule: historical rows predate the
 * `isFinalized` column and arrive as `null` (or the field omitted). A range
 * made entirely of such rows must NOT be claimed finalized — it is UNKNOWN,
 * and downstream renders nothing rather than a misleading badge.
 *
 * Verdict:
 *   - 'unknown'       → NO row carries a defined `isFinalized` flag.
 *   - 'finalized'     → at least one defined flag, and EVERY defined flag is true.
 *   - 'live_estimate' → at least one defined flag is false.
 *
 * `allFinalized` mirrors the finalized verdict: every defined-isFinalized row
 * is true AND at least one such row exists. (False for an all-null range.)
 *
 * `anyLiveTick` is true when ANY row carries a non-null `lastLiveTickAt`. It
 * is independent of the finalized flags — a finalized range can still have
 * received a live tick earlier in the day.
 *
 * Pure: deterministic, no I/O, no React.
 */

export interface ProvenanceRow {
  isFinalized?: boolean | null;
  source?: string | null;
  lastLiveTickAt?: string | null;
  reconciledAt?: string | null;
}

export type ProvenanceVerdict = 'finalized' | 'live_estimate' | 'unknown';

export interface ProvenanceResult {
  allFinalized: boolean;
  anyLiveTick: boolean;
  verdict: ProvenanceVerdict;
}

export function provenanceForRange(rows: ProvenanceRow[]): ProvenanceResult {
  let anyDefined = false;
  let anyNotFinal = false;
  let anyLiveTick = false;

  for (const row of rows) {
    if (row.isFinalized != null) {
      anyDefined = true;
      if (row.isFinalized === false) anyNotFinal = true;
    }
    if (row.lastLiveTickAt != null) anyLiveTick = true;
  }

  let verdict: ProvenanceVerdict;
  if (!anyDefined) {
    verdict = 'unknown';
  } else if (anyNotFinal) {
    verdict = 'live_estimate';
  } else {
    verdict = 'finalized';
  }

  const allFinalized = anyDefined && !anyNotFinal;

  return { allFinalized, anyLiveTick, verdict };
}
