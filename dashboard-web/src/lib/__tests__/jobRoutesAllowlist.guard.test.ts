/**
 * Guard test — the new Vercel-Cron + QStash route families MUST be in
 * `isDashboardAuthAllowlisted` (Task 0.6 of the Inngest→QStash migration).
 *
 * `/api/cron/*`  — invoked by Vercel Cron; authenticates via the `CRON_SECRET`
 *                  bearer header at the route level (verifyCron).
 * `/api/worker/*`— invoked by QStash; authenticates via the QStash signature
 *                  (verifyQstash). Neither can present the dashboard cookie, so
 *                  the password gate MUST skip them — exactly like `/api/inngest`.
 *
 * Gating these would 401 the cron/worker calls (same silent-pin incident class
 * as the 2026-06-03 Inngest pinning). The negative assertion guards against an
 * over-broad rule accidentally allowlisting normal/sensitive routes.
 */
import { describe, it, expect } from 'vitest';
import { isDashboardAuthAllowlisted } from '../middlewareHelpers';

describe('isDashboardAuthAllowlisted — cron + worker route families (Task 0.6)', () => {
  it('allowlists every /api/cron/* route', () => {
    expect(isDashboardAuthAllowlisted('/api/cron/live')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/cron/daily')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/cron/tick')).toBe(true);
  });

  it('allowlists every /api/worker/* route', () => {
    expect(isDashboardAuthAllowlisted('/api/worker/meta')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/worker/live-store')).toBe(true);
    expect(isDashboardAuthAllowlisted('/api/worker/backfill')).toBe(true);
  });

  it('does NOT allowlist normal gated routes (rule is not over-broad)', () => {
    // A normal data route must stay password-gated.
    expect(isDashboardAuthAllowlisted('/api/data')).toBe(false);
    // Sensitive operator routes must stay gated — the prefix is exactly
    // /api/cron/ and /api/worker/, NOT a substring match.
    expect(isDashboardAuthAllowlisted('/api/operator/sync-now')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/operator')).toBe(false);
    // Bare prefixes (no trailing segment) are NOT the cron/worker family.
    expect(isDashboardAuthAllowlisted('/api/cron')).toBe(false);
    expect(isDashboardAuthAllowlisted('/api/worker')).toBe(false);
    // A route merely containing "cron"/"worker" elsewhere stays gated.
    expect(isDashboardAuthAllowlisted('/api/x/api/cron/live')).toBe(false);
  });
});
