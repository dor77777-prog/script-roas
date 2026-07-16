// dashboard-web/src/lib/notifications/__tests__/tokenFailures.test.ts
//
// Regression test for d/CR-09: notifyTokenFailure must advance the throttle
// clock (`last_alert_sent_at`) on EVERY send attempt, not only on success.
//
// Pre-fix: the `last_alert_sent_at` UPSERT was gated by `if (result.alerted)`,
// so a failed WhatsApp send (token dead, template 132001 "not approved",
// network blip) would NOT update the column. The next cron-live tick (~30s
// later) would re-attempt the alert and re-fail in a tight loop, hammering
// both Meta's API and the operator's notification quota.
//
// Post-fix: the bump fires on `shouldAlert` (i.e. any attempt) so the
// throttle window is preserved even when the send fails. The failure is
// still recorded in `last_error_msg` and the operator can see it on
// `/operator`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------

const upsertCapture: { payload: Record<string, unknown> | null } = { payload: null };

// Tiny Supabase mock that records the upsert payload so we can assert on
// `last_alert_sent_at`.
function makeSupabaseMock() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              // No existing row.
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
      upsert: async (payload: Record<string, unknown>) => {
        upsertCapture.payload = payload;
        return { error: null };
      },
    }),
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabaseMock(),
}));

// WhatsApp send: we replace this in each test to control success/failure.
const sendMock = vi.fn();
vi.mock('../whatsapp', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendMock(...args),
}));

// Sentry fallback path: when WhatsApp can't deliver (token dead / provider
// IS whatsapp), the notifier must still raise the alert via Sentry.
const captureExceptionMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  upsertCapture.payload = null;
  sendMock.mockReset();
  captureExceptionMock.mockClear();
  process.env.SUPABASE_URL = 'https://test.supabase';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// Phase A 2026-05-29: _budget_skip operations must skip WhatsApp but still
// write the DB row and bump last_alert_sent_at (d/CR-09 invariant preserved).
describe('notifyTokenFailure (_budget_skip WhatsApp gate — Phase A 2026-05-29)', () => {
  it('notifyTokenFailure with operation cron_live_heavy_budget_skip — skips WhatsApp but writes DB row + bumps last_alert_sent_at', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'meta',
      storeId: 'uzoshop',
      operation: 'cron_live_heavy_budget_skip',
      errorMsg: 'META_BUDGET_HIGH: relevant BUC reached 85% (threshold 80%)',
    });

    // WhatsApp must NOT be called for _budget_skip operations
    expect(sendMock).not.toHaveBeenCalled();
    // alerted=false (no WhatsApp sent), throttled=false (was not throttled — was intentionally suppressed)
    expect(result.alerted).toBe(false);
    expect(result.throttled).toBe(false);
    // DB row is still written
    expect(result.dbWritten).toBe(true);
    // Throttle clock MUST still be bumped (d/CR-09 invariant)
    expect(upsertCapture.payload).not.toBeNull();
    expect(upsertCapture.payload?.last_alert_sent_at).toBeTruthy();
    expect(typeof upsertCapture.payload?.last_alert_sent_at).toBe('string');
    // Error message is recorded
    expect(upsertCapture.payload?.last_error_msg).toContain('META_BUDGET_HIGH');
  });

  it('notifyTokenFailure with operation cron_daily_budget_skip — same skip behavior', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'meta',
      storeId: 'zolplus',
      operation: 'cron_daily_budget_skip',
      errorMsg: 'META_BUDGET_HIGH: relevant BUC reached 92% (threshold 80%)',
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.alerted).toBe(false);
    expect(result.throttled).toBe(false);
    expect(result.dbWritten).toBe(true);
    expect(upsertCapture.payload?.last_alert_sent_at).toBeTruthy();
    expect(upsertCapture.payload?.last_error_msg).toContain('META_BUDGET_HIGH');
  });

  it('notifyTokenFailure with operation NOT ending _budget_skip — WhatsApp IS sent', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'google',
      storeId: 'usmile360',
      operation: 'oauth_refresh',
      errorMsg: 'invalid_grant',
    });

    // Sanity baseline: non-budget-skip operation should still send WhatsApp
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.alerted).toBe(true);
    expect(result.dbWritten).toBe(true);
  });
});

describe('notifyTokenFailure (d/CR-09 — throttle clock advances on send failure)', () => {
  it('bumps last_alert_sent_at when the WhatsApp send throws', async () => {
    sendMock.mockRejectedValue(
      new Error('132001: template name does not exist'),
    );

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'meta',
      storeId: 'uzoshop',
      operation: 'access_token',
      errorMsg: 'OAuthException: expired token',
      advice: 'Refresh OAuth + redeploy',
    });

    // The send itself failed -> alerted=false but we still attempted.
    expect(result.alerted).toBe(false);
    expect(result.throttled).toBe(false);
    expect(result.dbWritten).toBe(true);
    // CRITICAL: last_alert_sent_at must be populated so the throttle window
    // takes effect on the next call (preventing the tight retry loop).
    expect(upsertCapture.payload).not.toBeNull();
    expect(upsertCapture.payload?.last_alert_sent_at).toBeTruthy();
    expect(typeof upsertCapture.payload?.last_alert_sent_at).toBe('string');
  });

  it('still bumps last_alert_sent_at on successful send (existing behavior preserved)', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'google',
      storeId: 'usmile360',
      operation: 'oauth_refresh',
      errorMsg: 'invalid_grant',
    });

    expect(result.alerted).toBe(true);
    expect(result.dbWritten).toBe(true);
    expect(upsertCapture.payload?.last_alert_sent_at).toBeTruthy();
    // alerts_sent_count must increment on success.
    expect(upsertCapture.payload?.alerts_sent_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2026-07-16 (fx_rate_failure #55) — a failure upsert must CLEAR resolved_at.
//
// Pre-fix: the operator pressed "✓ סומן כתוקן" on the fx/global row weeks ago
// (resolved_at set), then Frankfurter kept failing nightly. Each failure
// upserted seen_count/last_seen_at but left resolved_at at the OLD date, so
// the row kept sending WhatsApp alerts every 6h while /operator's
// `resolved_at IS NULL OR resolved_at >= now()-7d` filter HID it — the alert
// linked to /operator "for details" and /operator showed nothing (verified
// against prod 2026-07-16: alert said "Seen 230 / Alert #55", API returned
// 0 rows). A failure happening NOW means the issue is NOT resolved.
// ---------------------------------------------------------------------------
describe('notifyTokenFailure (resolved_at clears on re-failure — 2026-07-16)', () => {
  it('sets resolved_at to null in every failure upsert', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    await notifyTokenFailure({
      provider: 'fx',
      storeId: 'global',
      operation: 'fx_rate_failure',
      errorMsg: 'FX fetch failed (ILS->CAD on 2026-07-16): frankfurter: status 522',
    });

    expect(upsertCapture.payload).not.toBeNull();
    // The key must be PRESENT with an explicit null (an absent key would
    // leave a stale resolved_at untouched in Postgres).
    expect('resolved_at' in (upsertCapture.payload ?? {})).toBe(true);
    expect(upsertCapture.payload?.resolved_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #34 — non-WhatsApp fallback when WhatsApp itself is the dead dependency.
//
// When the WhatsApp TOKEN is what died (exactly when a token-failure alert is
// most needed), the WhatsApp send throws and the operator learns nothing in
// real time. The notifier must route a `provider==='whatsapp'` failure OR a
// dead-token send error to Sentry as an alternate alert path, so a dead
// notifier channel can't silence ALL token-failure alerts. The DB row must
// still be written and the function must still soft-fail (never throw).
// ---------------------------------------------------------------------------
describe('notifyTokenFailure (#34 — Sentry fallback when WhatsApp can\'t deliver)', () => {
  it('routes to Sentry when the WhatsApp send throws (dead-token send error)', async () => {
    sendMock.mockRejectedValue(new Error('OAuthException: WhatsApp token expired'));

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'meta',
      storeId: 'uzoshop',
      operation: 'access_token',
      errorMsg: 'OAuthException: expired token',
      advice: 'Refresh OAuth + redeploy',
    });

    // Fallback alert path was invoked.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    // DB row still written; function did not throw.
    expect(result.dbWritten).toBe(true);
    expect(upsertCapture.payload).not.toBeNull();
  });

  it('routes to Sentry when the failing provider IS whatsapp (even if the send would succeed)', async () => {
    // A whatsapp-provider token failure means our own notifier channel is the
    // dead dependency — we can't trust WhatsApp to carry its own alert, so the
    // Sentry path must fire regardless of the send outcome.
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    const result = await notifyTokenFailure({
      provider: 'whatsapp',
      storeId: 'global',
      operation: 'send_template',
      errorMsg: '132001: template send rejected — token invalid',
    });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(result.dbWritten).toBe(true);
  });

  it('does NOT route to Sentry for a healthy non-whatsapp alert', async () => {
    sendMock.mockResolvedValue(undefined);

    const { notifyTokenFailure } = await import('../tokenFailures');
    await notifyTokenFailure({
      provider: 'google',
      storeId: 'usmile360',
      operation: 'oauth_refresh',
      errorMsg: 'invalid_grant',
    });

    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('Sentry fallback itself soft-fails: a throwing capture must not crash the notifier', async () => {
    sendMock.mockRejectedValue(new Error('WhatsApp token dead'));
    captureExceptionMock.mockImplementation(() => {
      throw new Error('Sentry transport down');
    });

    const { notifyTokenFailure } = await import('../tokenFailures');
    // Must not throw despite both WhatsApp AND Sentry failing.
    const result = await notifyTokenFailure({
      provider: 'meta',
      storeId: 'uzoshop',
      operation: 'access_token',
      errorMsg: 'expired token',
    });

    expect(result.dbWritten).toBe(true);
  });
});
