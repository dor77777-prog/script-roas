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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  upsertCapture.payload = null;
  sendMock.mockReset();
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
