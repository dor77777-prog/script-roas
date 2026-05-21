// dashboard-web/src/lib/fetchers/fx.ts
//
// PARALLEL-WAVE STUB — Phase 05.6 plan 07 (manualOverrides) needs to import
// `getFxRate` from this path at typecheck time. The real implementation lands
// with plan 06 (FX fetcher port). Both plans branch off plan 02 in parallel
// worktrees; this file's exported signature MUST match plan 06's so the
// downstream merge is conflict-free.
//
// Signature contract (plan 06 spec):
//   - Returns a Promise<number> with the FX rate from→to on dateStr (YYYY-MM-DD)
//   - from === to returns 1 immediately
//   - Throws on any failure with a message containing from/to/dateStr
//
// At runtime, the un-mocked stub throws so any accidental invocation outside
// of tests (e.g. an Inngest function wired before plan 06 merges) surfaces
// loudly instead of silently returning 0/NaN.
//
// Plan 06's `getFxRate` will overwrite this file with the real Frankfurter
// implementation. Tests in plan 07 mock this module via `vi.mock(...)`.

export async function getFxRate(
  from: string,
  to: string,
  dateStr: string,
): Promise<number> {
  if (from === to) return 1;
  throw new Error(
    `FX fetcher not yet implemented (parallel-wave stub) for ${from}->${to} on ${dateStr} — plan 05.6-06 lands the real Frankfurter port.`,
  );
}
