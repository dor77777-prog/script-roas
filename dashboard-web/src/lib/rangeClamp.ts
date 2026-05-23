/**
 * Shared date-range clamp helpers.
 *
 * HIGH-3 audit fix (2026-05-23): the global `Filters` (custom-range
 * branch) previously wrote `e.target.value` directly into the range
 * with no validation — an empty input flipped the range to `''` and
 * cascaded into 6 SWR keys downstream (`/api/data`, `/api/products`,
 * `/api/campaigns`, `/api/orders-attribution`, `/api/insights`,
 * `/api/cohort-comparison`) which then 400'd with malformed YYYY-MM-DD
 * params. A future date input flowed through unclamped and silently
 * broke the cohort/cross-store comparisons (which assume `to <= today`).
 *
 * CampaignsTable.tsx (lines ~1083-1130) had a hand-rolled clamp inline
 * that already handled the empty-string + future-date + swap-on-invert
 * cases correctly. Both consumers now share the same helpers, so a fix
 * here propagates to both UI surfaces.
 *
 * Contract:
 *   - Both inputs are 'YYYY-MM-DD' strings (lexicographic === calendar).
 *   - `today` is the canonical Asia/Jerusalem boundary (caller pulls
 *     from `todayInIsrael()` so we don't import a TZ helper here and
 *     reverse the dep direction).
 *
 * All four helpers are PURE — no `Date` math, no setState, no localStorage.
 * Callers feed the result into their own state setter.
 */

import type { DateRange } from './types';

/**
 * Clamp a candidate date to `[, today]`. Empty inputs return null so
 * the caller can swallow the keystroke without flipping state.
 *
 * Returns:
 *   - null          → empty input; caller must NOT update state.
 *   - 'YYYY-MM-DD'  → input value, clamped to today if it was in the future.
 *
 * Why null instead of throwing: the date <input> fires onChange while the
 * user is mid-typing (e.g., backspacing the year); throwing would break
 * the input UX. A null sentinel lets the caller no-op the bad keystroke
 * without losing state.
 */
export function clampDateToToday(
  candidate: string,
  today: string,
): string | null {
  if (!candidate) return null;
  // Defensive: if the input is malformed (browser shouldn't deliver
  // non-YYYY-MM-DD but a paste-into-text could in some agents), bail out.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  // Lexicographic comparison on canonical ISO date is calendar-correct.
  return candidate > today ? today : candidate;
}

/**
 * Apply a clamped `from` candidate to an existing range, with
 * swap-on-invert semantics: if the new `from` is after the existing
 * `to`, collapse the range to a single day at `from` (the user pulled
 * the start past the end — interpret as "I want this single day").
 *
 * Returns `null` when `candidate` was empty/malformed (mirrors
 * `clampDateToToday`'s null sentinel — caller should no-op state).
 */
export function applyFromCandidate(
  range: DateRange,
  candidate: string,
  today: string,
): DateRange | null {
  const safe = clampDateToToday(candidate, today);
  if (safe === null) return null;
  return safe > range.to ? { from: safe, to: safe } : { ...range, from: safe };
}

/**
 * Symmetric counterpart of `applyFromCandidate` — clamp + swap-on-invert
 * for the `to` side.
 */
export function applyToCandidate(
  range: DateRange,
  candidate: string,
  today: string,
): DateRange | null {
  const safe = clampDateToToday(candidate, today);
  if (safe === null) return null;
  return safe < range.from ? { from: safe, to: safe } : { ...range, to: safe };
}
