// dashboard-web/src/lib/dateValidation.ts
//
// Strict YYYY-MM-DD calendar-day validation, shared between the operator
// routes:
//   - `app/api/operator/backfill/route.ts`
//   - `app/api/operator/manual-overrides/route.ts`
//
// Audit fix 2026-05-23 (HIGH-14 / O4-HI-03 + Codex-NEW-5): both routes
// previously used a regex-only check `/^\d{4}-\d{2}-\d{2}$/` that happily
// accepted `2026-99-99`, `2026-13-01`, `2026-02-30`, and `2025-04-31`.
// Downstream pipelines built dates via `Date.UTC(y, m-1, d)`, which
// silently NORMALIZES out-of-range input (Date.UTC(2026, 12, 1) →
// 2027-01-01). The result was a bypass of the D-A3 history boundary on
// backfill AND silent date corruption on override rows that never matched
// any daily job.
//
// Fix: regex shape check + Date.UTC round-trip — if normalization happens,
// at least one component fails the equality check. Year < 1 is rejected
// outright (no Year-0 in Gregorian).
//
// Why a dedicated module: Next.js App Router route files only allow
// specific top-level exports (GET/POST/PATCH/DELETE/dynamic/etc.).
// Exporting arbitrary helpers from a route.ts triggers a build error
// ("Property 'X' is incompatible with index signature" against the
// generated `.next/types/.../route.ts` constraint shape). The shared
// helper lives in a normal `lib/` module so the routes can import + the
// regression tests can pin its behavior directly.

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  // Year 0000 isn't a real Gregorian year; require year >= 1.
  if (y < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
